import { randomBytes } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import { transformGraph } from "@pieceful/ravel-core";
import {
  assertExplorerMessage,
  createExplorerEntityDetails,
  createExplorerSnapshot
} from "@pieceful/ravel-explorer";
import { loadBuildInput } from "@pieceful/ravel-host-node";
import { resolveProjectInput } from "./project.js";

let activePanel;
let activeProject;
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

const revealSource = async (project, source) => {
  const uri = sourceUri(project, source);
  if (!uri) return false;
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: project.sourceColumn,
    preserveFocus: true,
    preview: true
  });
  if (!source.range) return true;
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
      await panel.webview.postMessage({
        version: 1,
        type: "view/result",
        requestId: message.requestId,
        revision: activeProject.snapshot.revision,
        snapshot: activeProject.snapshot
      });
      return;
    }

    if (message.type === "entity/select" || message.type === "source/reveal") {
      if (typeof message.entityId !== "string" || !message.entityId) {
        throw new TypeError("entityId must be a nonempty string.");
      }
      const entity = entityFor(activeProject, message.entityId);
      if (!entity) throw new Error("Explorer entity is not present in this revision.");
      const source = entity.source ?? entity.authoredAt;
      const revealed = await revealSource(activeProject, source);
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
        revealed
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
        <input id="search" type="search" aria-label="Find entity"
          placeholder="Find chunk, transform, output…">
        <button id="fit" type="button">Fit</button>
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

const loadProject = async (inputPath, sourceColumn) =>
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Ravel: loading Explorer",
    cancellable: false
  }, async () => {
    const loaded = await loadBuildInput(inputPath);
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
  });

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
    await activePanel.webview.postMessage({
      version: 1,
      type: "view/result",
      requestId: "project-reload",
      revision: activeProject.snapshot.revision,
      snapshot: activeProject.snapshot
    });
  }
  activePanel.title = `Ravel Explorer · ${activeProject.snapshot.project.label}`;
};

export const activate = (context) => {
  context.subscriptions.push(
    vscode.commands.registerCommand("ravel.openExplorer", (uri) =>
      openExplorer(context.extensionUri, uri)
    )
  );
};

export const deactivate = () => {};
