import { randomBytes } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import { transformGraph } from "@pieceful/ravel-core";
import {
  assertExplorerMessage,
  createExplorerEntityDetails,
  createExplorerSnapshot,
  diffExplorerSnapshots
} from "@pieceful/ravel-explorer";
import { loadBuildInput } from "@pieceful/ravel-host-node";
import {
  findExplorerDefinitionAtSelection,
  findExplorerEntityAtSelection,
  resolveProjectInput
} from "./project.js";

let activePanel;
let activeProject;
let pendingSourceReveal;
let refreshTimer;
let refreshGeneration = 0;
const webviewRequestTypes = new Set([
  "view/request",
  "entity/select",
  "source/reveal"
]);

const nonce = () => randomBytes(16).toString("base64");

const exists = async (path) => {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return true;
  } catch {
    return false;
  }
};

const workspaceFor = (uri) =>
  vscode.workspace.getWorkspaceFolder(uri) ??
  vscode.workspace.workspaceFolders?.[0];

const resolveInput = async (uri) => {
  if (!uri || uri.scheme !== "file") return null;
  const workspace = workspaceFor(uri);
  const root = workspace?.uri.fsPath ?? dirname(uri.fsPath);
  return resolveProjectInput(uri.fsPath, root, exists);
};

const contained = (root, target) => {
  const base = resolve(root);
  const path = resolve(target);
  return path === base || path.startsWith(base + sep);
};

const sourceUri = (project, source) => {
  if (!source?.uri || source.uri.startsWith("<")) return null;
  const path = resolve(project.rootDirectory, source.uri);
  return contained(project.rootDirectory, path) ? vscode.Uri.file(path) : null;
};

const revealSource = async (project, source, { preserveFocus = true } = {}) => {
  const uri = sourceUri(project, source);
  if (!uri) return false;
  pendingSourceReveal = {
    uri: uri.toString(),
    range: source.range,
    expires: Date.now() + 1_000
  };
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: project.sourceColumn,
    preserveFocus,
    preview: true
  });
  if (!source.range) {
    pendingSourceReveal = undefined;
    return true;
  }
  const { start, end } = source.range;
  const range = new vscode.Range(
    new vscode.Position(start.line, start.column),
    new vscode.Position(end.line, end.column)
  );
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return true;
};

const postError = (panel, requestId, error) => panel.webview.postMessage({
  version: 1,
  type: "request/error",
  requestId,
  message: error?.message ?? String(error)
});

const entityFor = (project, id) =>
  project.snapshot.nodes.find((node) => node.id === id) ??
  project.snapshot.edges.find((edge) => edge.id === id);

const postSnapshot = (panel, requestId, project) => panel.webview.postMessage({
  version: 1,
  type: "view/result",
  requestId,
  revision: project.snapshot.revision,
  snapshot: project.snapshot,
  preview: project.preview,
  diff: project.diff
});

const handleMessage = async (panel, message) => {
  try {
    assertExplorerMessage(message);
    if (!webviewRequestTypes.has(message.type)) {
      throw new TypeError("Message type is not accepted from the Explorer webview.");
    }
    if (!activeProject) throw new Error("No Ravel project is loaded.");
    if (message.type !== "view/request" &&
        message.revision !== activeProject.snapshot.revision) {
      throw new Error("Explorer request targets a stale project revision.");
    }

    if (message.type === "view/request") {
      await postSnapshot(panel, message.requestId, activeProject);
      return;
    }

    if (message.type === "entity/select" || message.type === "source/reveal") {
      if (typeof message.entityId !== "string" || !message.entityId) {
        throw new TypeError("entityId must be a nonempty string.");
      }
      const entity = entityFor(activeProject, message.entityId);
      if (!entity) throw new Error("Explorer entity is not present in this revision.");
      const source = entity.source ?? entity.authoredAt;
      const revealed = await revealSource(activeProject, source, {
        preserveFocus: message.type === "entity/select"
      });
      activeProject.lastEditorEntityId = entity.id;
      const details = createExplorerEntityDetails(
        activeProject.context,
        message.entityId,
        { maxTextLength: 20_000 }
      );
      await panel.webview.postMessage({
        version: 1,
        type: "selection/changed",
        requestId: message.requestId,
        revision: activeProject.snapshot.revision,
        entity,
        details,
        revealed,
        origin: message.type === "source/reveal" ? "reveal-button" : "graph"
      });
      return;
    }
  } catch (error) {
    await postError(panel, message?.requestId ?? "unknown", error);
  }
};

const getHtml = (webview, extensionUri) => {
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.mjs")
  );
  const style = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "explorer.css")
  );
  const token = nonce();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${token}';">
    <link rel="stylesheet" href="${style}">
    <title>Ravel Explorer</title>
  </head>
  <body>
    <main class="app">
      <nav class="toolbar" aria-label="Explorer controls">
        <strong>Ravel Explorer</strong>
        <select id="lens" aria-label="Graph lens">
          <option value="overview">Overview</option>
          <option value="dependencies" selected>Dependencies</option>
          <option value="derivation">Derivation</option>
        </select>
        <select id="orientation" aria-label="Layout orientation">
          <option value="DOWN" selected>Vertical</option>
          <option value="RIGHT">Horizontal</option>
        </select>
        <input id="search" type="search" aria-label="Find entity"
          placeholder="Find chunk, transform, output…">
        <button id="fit" type="button">Fit</button>
        <span id="preview" class="preview" hidden>Preview</span>
        <output id="status" aria-live="polite">Loading…</output>
      </nav>
      <section class="workspace">
        <div id="graph" role="application" aria-label="Ravel project graph"></div>
        <aside id="details" aria-label="Selection details">
          <h1>Select a graph entity</h1>
          <p>Its source range and authored chunk will appear here.</p>
        </aside>
      </section>
    </main>
    <script type="module" nonce="${token}" src="${script}"></script>
  </body>
</html>`;
};

const documentOverlays = () => new Map(
  vscode.workspace.textDocuments
    .filter((document) => document.uri.scheme === "file" && document.isDirty)
    .map((document) => [
      resolve(document.uri.fsPath),
      { text: document.getText(), version: document.version }
    ])
);

const evaluateProject = async (
  inputPath,
  sourceColumn,
  overlays = new Map()
) => {
  const loaded = await loadBuildInput(inputPath, { overlays });
  const program = transformGraph(loaded.pretransform);
  const context = {
    program,
    pretransform: loaded.pretransform,
    project: {
      id: relative(loaded.rootDirectory, inputPath) || "ravel",
      label: relative(loaded.rootDirectory, inputPath) || "Ravel project"
    }
  };
  const snapshot = createExplorerSnapshot(context, { maxNodes: 500 });
  return {
    context: { ...context, revision: snapshot.revision },
    snapshot,
    inputPath,
    rootDirectory: loaded.rootDirectory,
    sourceColumn
  };
};

const evaluateProjectState = async (inputPath, sourceColumn) => {
  const baseline = await evaluateProject(inputPath, sourceColumn);
  const overlays = documentOverlays();
  const candidate = overlays.size
    ? await evaluateProject(inputPath, sourceColumn, overlays)
    : baseline;
  const preview = candidate.snapshot.revision !== baseline.snapshot.revision;
  return {
    ...candidate,
    baselineSnapshot: baseline.snapshot,
    preview,
    diff: preview
      ? diffExplorerSnapshots(baseline.snapshot, candidate.snapshot)
      : undefined
  };
};

const loadProject = async (inputPath, sourceColumn) =>
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Ravel: loading Explorer",
    cancellable: false
  }, () => evaluateProjectState(inputPath, sourceColumn));

const refreshProject = async (generation) => {
  const current = activeProject;
  if (!activePanel || !current) return;
  try {
    const next = await evaluateProjectState(
      current.inputPath,
      current.sourceColumn
    );
    if (generation !== refreshGeneration || activeProject !== current) return;
    const errors = next.context.program.diagnostics
      ?.filter((diagnostic) => diagnostic.severity === "error") ?? [];
    if (next.preview && errors.length) {
      throw new Error(
        "Preview has diagnostics: " +
        errors.slice(0, 3).map((diagnostic) => diagnostic.message).join(" ")
      );
    }
    activeProject = {
      ...next,
      lastEditorEntityId: current.lastEditorEntityId
    };
    await postSnapshot(activePanel, "document-preview-" + generation, activeProject);
  } catch (error) {
    if (generation !== refreshGeneration || activeProject !== current) return;
    await activePanel.webview.postMessage({
      version: 1,
      type: "document/changed",
      requestId: "document-preview-" + generation,
      revision: current.snapshot.revision,
      ok: false,
      message: error?.message ?? String(error)
    });
  }
};

const scheduleProjectRefresh = (document) => {
  if (!activeProject || document.uri.scheme !== "file" ||
      !contained(activeProject.rootDirectory, document.uri.fsPath)) {
    return;
  }
  refreshGeneration += 1;
  const generation = refreshGeneration;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refreshProject(generation);
  }, 250);
};

const openExplorer = async (extensionUri, requestedUri) => {
  const sourceEditor = vscode.window.activeTextEditor;
  const uri = requestedUri?.scheme && requestedUri?.fsPath
    ? requestedUri
    : sourceEditor?.document.uri;
  const inputPath = await resolveInput(uri);
  if (!inputPath) {
    void vscode.window.showErrorMessage(
      "Open a supported Ravel source or ravel.toml before opening Explorer."
    );
    return;
  }

  try {
    activeProject = await loadProject(
      inputPath,
      sourceEditor?.viewColumn ?? vscode.ViewColumn.One
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Ravel Explorer could not load the project: ${error?.message ?? String(error)}`
    );
    return;
  }

  if (!activePanel) {
    activePanel = vscode.window.createWebviewPanel(
      "ravelExplorer",
      "Ravel Explorer",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist"),
          vscode.Uri.joinPath(extensionUri, "media")
        ]
      }
    );
    activePanel.webview.html = getHtml(activePanel.webview, extensionUri);
    activePanel.webview.onDidReceiveMessage((message) =>
      handleMessage(activePanel, message)
    );
    activePanel.onDidDispose(() => {
      activePanel = undefined;
      activeProject = undefined;
    });
  } else {
    activePanel.reveal(vscode.ViewColumn.Beside);
    await postSnapshot(activePanel, "project-reload", activeProject);
  }
  activePanel.title = `Ravel Explorer · ${activeProject.snapshot.project.label}`;
};

const editorSelectionChanged = async (event) => {
  if (!activePanel || !activeProject) return;
  const uri = event.textEditor.document.uri;
  if (pendingSourceReveal && Date.now() >= pendingSourceReveal.expires) {
    pendingSourceReveal = undefined;
  }
  if (pendingSourceReveal?.uri === uri.toString()) {
    const expected = pendingSourceReveal.range;
    const actual = event.selections[0];
    if (expected && actual &&
        actual.start.line === expected.start.line &&
        actual.start.character === expected.start.column &&
        actual.end.line === expected.end.line &&
        actual.end.character === expected.end.column) {
      pendingSourceReveal = undefined;
    }
    return;
  }
  if (uri.scheme !== "file" || !contained(activeProject.rootDirectory, uri.fsPath)) return;
  const source = relative(activeProject.rootDirectory, uri.fsPath).split(sep).join("/");
  const selection = event.selections[0];
  if (!selection) return;
  const entity = findExplorerEntityAtSelection(activeProject.snapshot, source, {
    start: {
      line: selection.start.line,
      column: selection.start.character
    },
    end: {
      line: selection.end.line,
      column: selection.end.character
    }
  });
  if (!entity || entity.id === activeProject.lastEditorEntityId) return;
  activeProject.lastEditorEntityId = entity.id;
  const details = createExplorerEntityDetails(
    activeProject.context,
    entity.id,
    { maxTextLength: 20_000 }
  );
  await activePanel.webview.postMessage({
    version: 1,
    type: "selection/changed",
    requestId: "editor-selection-" + Date.now(),
    revision: activeProject.snapshot.revision,
    entity,
    details,
    revealed: true,
    origin: "editor"
  });
};

const definitionAt = (document, position) => {
  if (!activeProject || document.uri.scheme !== "file" ||
      !contained(activeProject.rootDirectory, document.uri.fsPath)) {
    return null;
  }
  const uri = relative(activeProject.rootDirectory, document.uri.fsPath)
    .split(sep).join("/");
  const definition = findExplorerDefinitionAtSelection(activeProject.snapshot, uri, {
    start: { line: position.line, column: position.character },
    end: { line: position.line, column: position.character }
  });
  const source = definition?.source;
  const target = sourceUri(activeProject, source);
  if (!target) return null;
  const range = source.range
    ? new vscode.Range(
      new vscode.Position(source.range.start.line, source.range.start.column),
      new vscode.Position(source.range.end.line, source.range.end.column)
    )
    : new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0)
    );
  return new vscode.Location(target, range);
};

export const activate = (context) => {
  context.subscriptions.push(
    vscode.commands.registerCommand("ravel.openExplorer", (uri) =>
      openExplorer(context.extensionUri, uri)
    ),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      void editorSelectionChanged(event);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleProjectRefresh(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument(scheduleProjectRefresh),
    vscode.workspace.onDidCloseTextDocument(scheduleProjectRefresh),
    vscode.languages.registerDefinitionProvider({ scheme: "file" }, {
      provideDefinition: definitionAt
    })
  );
};

export const deactivate = () => {
  clearTimeout(refreshTimer);
};
