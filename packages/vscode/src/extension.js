import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import { transformGraph } from "@pieceful/ravel-core";
import {
  assertExplorerMessage,
  createExplorerChangeSnapshot,
  createExplorerEntityDetails,
  createExplorerGeneratedMatches,
  createExplorerOutputDetails,
  createExplorerSnapshot,
  diffExplorerSnapshots
} from "@pieceful/ravel-explorer";
import { loadBuildInput } from "@pieceful/ravel-host-node";
import {
  createLanguageRouter,
  createRavelSemanticIndex
} from "@pieceful/ravel-language-service";
import { createTypeScriptLanguageBridgeWithApi } from "@pieceful/ravel-language-typescript";
import { createProjectionService } from "@pieceful/ravel-projection";
import * as typescript from "typescript";
import {
  findExplorerEntityAtSelection,
  projectIncludesPath,
  resolveProjectInput,
  shouldCaptureEditorPath
} from "./project.js";
import {
  diagnosticProjectionRouting,
  hasDiagnosticPublicationAuthority,
  hasDiagnosticRunAuthority,
  publishRavelDiagnostics
} from "./diagnostics.js";
import {
  isExactAuthoredRange,
  isSafePrimaryCompletion
} from "./completion-policy.js";
import {
  createGeneratedDocumentProvider,
  generatedTextDocumentIsCurrent,
  selectReturnToSourceMatch
} from "./generated-document-provider.js";
import { createGeneratedDocumentRegistry } from "./generated-document-registry.js";
import {
  assertRelevantEditorState,
  createEditorSnapshot,
  isSourceStateMismatch,
  projectionSourceState,
  sameRelevantReadState,
  stabilizeEditorSnapshot
} from "./projection-snapshot.js";
import {
  hasCurrentProjectionSourceVersion,
  hasCurrentRequestAuthority,
  hasSameLanguageRoutingContext,
  waitForPromiseOrAbort
} from "./request-coordination.js";
import { createTargetSelectionStore } from "./target-selection.js";

let activePanel;
let activeProject;
let pendingSourceReveal;
let refreshTimer;
let refreshGeneration = 0;
let refreshController;
let diagnosticCollection;
let targetDiagnosticCollection;
let projectLoadPromise;
let projectionService;
let projectionProjectKey;
let languageRouter;
let languageRouterProjectKey;
let generatedRegistry;
let generatedProvider;
let generatedStatus;
let activeGeneratedSelection;
let generatedDecorations;
let targetSelectionStore;
let extensionWorkspaceState;
let projectRefreshPending = false;
let interactiveRefreshPromise;
let interactiveRefreshController;
let generatedPresentationTimer;
let generatedSynchronizationGeneration = 0;
const webviewRequestTypes = new Set([
  "view/request",
  "entity/select",
  "source/reveal",
  "output/request"
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
  if (!project?.authoredSourceUris?.includes(source.uri)) return null;
  const path = resolve(project.rootDirectory, source.uri);
  if (!contained(project.rootDirectory, path)) return null;
  try {
    const root = realpathSync(project.rootDirectory);
    const canonical = realpathSync(path);
    return contained(root, canonical) ? vscode.Uri.file(canonical) : null;
  } catch {
    return null;
  }
};

const writableSourceUri = (project, source) =>
  project?.sourceEditsAllowed === true ? sourceUri(project, source) : null;

const publishProjectDiagnostics = (project) => {
  if (!diagnosticCollection || !project) return;
  publishRavelDiagnostics(
    vscode,
    diagnosticCollection,
    project.context.program.diagnostics,
    {
      resolveUri: (uri) => sourceUri(project, { uri })?.toString()
    }
  );
};

const documentSourceKey = (project, document) =>
  relative(project.rootDirectory, document.uri.fsPath).split(sep).join("/");

const sourcePosition = (document, position) => ({
  line: position.line,
  column: position.character,
  offset: document.offsetAt(position)
});

const projectKey = (project) => project.rootDirectory + "\u0000" + project.inputPath;

const captureEditorState = (
  rootDirectory,
  relevantSourceUris,
  { includeSupportedFallback = false } = {}
) => {
  const entries = [];
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== "file" ||
        !contained(rootDirectory, document.uri.fsPath)) continue;
    const uri = relative(rootDirectory, document.uri.fsPath).split(sep).join("/");
    if (!shouldCaptureEditorPath(
      rootDirectory,
      document.uri.fsPath,
      relevantSourceUris,
      { includeSupportedFallback }
    )) {
      continue;
    }
    entries.push({
      uri,
      path: resolve(document.uri.fsPath),
      version: document.version,
      text: document.getText(),
      dirty: document.isDirty
    });
  }
  return createEditorSnapshot(entries);
};

const relevantProjectSources = (project) => [
  ...(project?.loadedInputUris ?? []),
  ...(project?.authoredSourceUris ?? [])
];

const projectSourceStateIsCurrent = (project) => {
  if (!project?.editorSnapshot) return false;
  try {
    assertRelevantEditorState(
      project.editorSnapshot,
      captureEditorState(project.rootDirectory, relevantProjectSources(project)),
      relevantProjectSources(project)
    );
    return true;
  } catch (error) {
    if (isSourceStateMismatch(error)) return false;
    throw error;
  }
};

const assertProjectSourceStateCurrent = (project) => {
  const relevant = relevantProjectSources(project);
  assertRelevantEditorState(
    project.editorSnapshot,
    captureEditorState(project.rootDirectory, relevant),
    relevant
  );
};

const projectReadSourceStateIsCurrent = (project) => Boolean(
  project?.editorSnapshot &&
  activeProject === project &&
  sameRelevantReadState(
    project.editorSnapshot,
    captureEditorState(project.rootDirectory, relevantProjectSources(project)),
    relevantProjectSources(project),
    project.authoredSourceTexts
  )
);

const currentLanguageRequest = (project, requestGeneration) =>
  hasCurrentRequestAuthority({
    project,
    activeProject,
    requestGeneration,
    currentGeneration: refreshGeneration,
    refreshPending: projectRefreshPending,
    sourceStateCurrent: projectSourceStateIsCurrent(project)
  });

const currentReadRequestGeneration = (project, requestGeneration, token) =>
  token?.isCancellationRequested !== true && hasCurrentRequestAuthority({
    project,
    activeProject,
    requestGeneration,
    currentGeneration: refreshGeneration,
    refreshPending: projectRefreshPending,
    sourceStateCurrent: true
  });

const resetLanguageRouter = () => {
  const previous = languageRouter;
  languageRouter = undefined;
  languageRouterProjectKey = undefined;
  if (previous) void previous.dispose();
};

const ensureProjectionService = (project) => {
  const key = projectKey(project);
  if (projectionService && projectionProjectKey === key) return projectionService;
  generatedSynchronizationGeneration += 1;
  resetLanguageRouter();
  projectionService?.dispose();
  generatedRegistry?.clear();
  projectionService = createProjectionService({
    workspaceId: project.context.project.id,
    targetId: "default",
    stage: "assembled"
  });
  projectionProjectKey = key;
  return projectionService;
};

const ensureLanguageRouter = (project) => {
  const service = ensureProjectionService(project);
  const key = projectKey(project);
  if (languageRouter && languageRouterProjectKey === key) return languageRouter;
  resetLanguageRouter();
  const bridges = vscode.workspace.isTrusted === true
    ? [createTypeScriptLanguageBridgeWithApi(typescript, {
        currentDirectory: project.rootDirectory,
        configSearchRoot: project.rootDirectory
      })]
    : [];
  languageRouter = createLanguageRouter({
    projectionService: service,
    bridges
  });
  languageRouterProjectKey = key;
  return languageRouter;
};

const synchronizeGeneratedDocuments = async (project, signal) => {
  assertProjectSourceStateCurrent(project);
  const router = ensureLanguageRouter(project);
  const generation = ++generatedSynchronizationGeneration;
  const delta = await router.update({
    id: project.snapshot.revision,
    program: project.context.program,
    ...project.projectionSourceState
  }, signal);
  signal?.throwIfAborted();
  assertProjectSourceStateCurrent(project);
  if (generation !== generatedSynchronizationGeneration) {
    throw new DOMException(
      "A newer Ravel projection synchronization superseded this result.",
      "AbortError"
    );
  }
  // Registry publication is synchronous after this authority check. No editor
  // event can interleave and make only part of this delta current.
  assertProjectSourceStateCurrent(project);
  for (const document of [...delta.opened, ...delta.changed, ...delta.unchanged]) {
    signal?.throwIfAborted();
    generatedRegistry?.update(document);
  }
  for (const document of delta.closed) {
    signal?.throwIfAborted();
    generatedRegistry?.invalidate(
      document.uri,
      "The artifact or analysis target is no longer present."
    );
  }
  return delta;
};

const markGeneratedDocumentsStale = (reason) => {
  for (const document of generatedRegistry?.list() ?? []) {
    generatedRegistry?.markStale(document.uri, reason);
  }
};

const presentGeneratedContext = async (metadata, { editor, occurrence, sourceSelection }) => {
  activeGeneratedSelection = occurrence
    ? {
        uri: metadata.uri,
        projectionId: occurrence.projectionId,
        occurrenceId: occurrence.id,
        pieceId: occurrence.pieceId,
        targetId: metadata.targetId,
        artifactId: metadata.artifactId,
        sourceSelection
      }
    : {
        uri: metadata.uri,
        targetId: metadata.targetId,
        artifactId: metadata.artifactId
      };
  const context = occurrence && projectionService
    ? projectionService.generatedContext(occurrence.id, {
    projectionVersion: metadata.version,
    surroundingLines: 3,
    sourceSelection
  })
    : { ok: false };
  if (generatedStatus) {
    const breadcrumb = context.ok
      ? context.breadcrumb.map(({ label, pieceId }) => label ?? pieceId).join(" › ")
      : undefined;
    const staleLabel = metadata.freshness === "current"
      ? ""
      : " · " + metadata.freshness;
    generatedStatus.text = (metadata.freshness === "current"
      ? "$(file-code) "
      : "$(warning) ") + metadata.artifactId + " · " + metadata.targetId + staleLabel;
    generatedStatus.tooltip = breadcrumb
      ? metadata.header + "\n\nExpansion: " + breadcrumb
      : metadata.header;
    generatedStatus.show();
  }
  for (const [category, decoration] of Object.entries(generatedDecorations ?? {})) {
    const ranges = (context.ok ? context.highlights : [])
      .filter((highlight) => highlight.categories.includes(category))
      .map((highlight) => new vscode.Range(
        editor.document.positionAt(highlight.range.start),
        editor.document.positionAt(highlight.range.end)
      ));
    editor.setDecorations(decoration, ranges);
  }
};

const refreshActiveGeneratedPresentation = async (
  editor = vscode.window.activeTextEditor
) => {
  if (!editor || editor.document.uri.scheme !== "pieceful-virtual") {
    generatedStatus?.hide();
    return;
  }
  const uri = editor.document.uri.toString();
  const document = generatedRegistry?.get(uri);
  if (!document || !generatedTextDocumentIsCurrent(document, editor.document)) {
    generatedStatus?.hide();
    for (const decoration of Object.values(generatedDecorations ?? {})) {
      editor.setDecorations(decoration, []);
    }
    return;
  }
  const selection = activeGeneratedSelection?.uri === uri
    ? activeGeneratedSelection
    : undefined;
  const occurrence = selection?.occurrenceId
    ? document.occurrences.find(({ id }) => id === selection.occurrenceId)
    : undefined;
  await presentGeneratedContext(generatedProvider.metadata(uri), {
    editor,
    textDocument: editor.document,
    occurrence,
    sourceSelection: selection?.sourceSelection
  });
};

const generatedCandidatesAt = async (document, position) => {
  const project = await projectForLanguageRequest(document);
  if (!project) return [];
  await synchronizeGeneratedDocuments(project);
  const source = {
    uri: documentSourceKey(project, document),
    offset: document.offsetAt(position)
  };
  return projectionService.toVirtual(source).map((match) => {
    const projection = projectionService.getProjection(match.projectionId);
    return {
      match,
      projection,
      sourceSelection: {
        uri: source.uri,
        range: { start: source.offset, end: source.offset }
      }
    };
  }).filter(({ match, projection }) => projection && match.occurrenceId);
};

const chooseGeneratedCandidate = async (candidates) => {
  if (candidates.length <= 1) return candidates[0];
  const picked = await vscode.window.showQuickPick(candidates.map((candidate) => ({
    label: candidate.projection.artifactId,
    description: candidate.projection.targetId + " · " + candidate.projection.stage,
    detail: candidate.match.pieceId + " · " + candidate.match.quality,
    candidate
  })), {
    title: "Choose a generated Ravel occurrence",
    placeHolder: "This source appears in more than one generated context"
  });
  return picked?.candidate;
};

const openGeneratedAt = async (argument) => {
  let document;
  let position;
  if (argument?.sourceUri) {
    document = await vscode.workspace.openTextDocument(vscode.Uri.parse(argument.sourceUri));
    position = document.positionAt(argument.sourceOffset ?? 0);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;
    document = editor.document;
    position = editor.selection.active;
  }
  const selected = await chooseGeneratedCandidate(await generatedCandidatesAt(document, position));
  if (!selected) {
    void vscode.window.showInformationMessage("This Ravel source has no generated occurrence in the active project.");
    return;
  }
  await generatedProvider.revealOccurrence(
    selected.projection.uri,
    selected.match.occurrenceId,
    {
      expectedProjectionId: selected.projection.id,
      expectedSnapshotId: selected.projection.snapshotId,
      expectedVersion: selected.projection.version,
      sourceSelection: selected.sourceSelection,
      viewColumn: vscode.ViewColumn.Beside
    }
  );
};

const adjacentGeneratedOccurrence = async (direction) => {
  if (!activeGeneratedSelection?.occurrenceId) {
    void vscode.window.showInformationMessage("Open a generated Ravel occurrence first.");
    return;
  }
  const operation = direction > 0
    ? generatedProvider.nextOccurrence
    : generatedProvider.previousOccurrence;
  await operation(
    activeGeneratedSelection.uri,
    activeGeneratedSelection.occurrenceId,
    {
      pieceId: activeGeneratedSelection.pieceId,
      sourceSelection: activeGeneratedSelection.sourceSelection,
      viewColumn: vscode.ViewColumn.Active
    }
  );
};

const returnGeneratedToSource = async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "pieceful-virtual" || !projectionService) {
    void vscode.window.showInformationMessage("Open a generated Ravel document first.");
    return;
  }
  const generatedUri = editor.document.uri.toString();
  const generated = generatedRegistry?.get(generatedUri);
  const projection = projectionService.getProjectionByUri(generatedUri);
  const project = activeProject;
  if (!generated || !projection || !project || generated.state !== "current" ||
      generated.invalidated || !generatedTextDocumentIsCurrent(generated, editor.document) ||
      generated.projectionId !== projection.id ||
      generated.snapshotId !== projection.snapshotId ||
      generated.version !== projection.version ||
      !projectReadSourceStateIsCurrent(project)) return;
  const stillCurrent = () =>
    activeProject === project &&
    projectReadSourceStateIsCurrent(project) &&
    generatedRegistry?.get(generatedUri) === generated &&
    projectionService?.getProjection(projection.id) === projection &&
    generatedTextDocumentIsCurrent(generated, editor.document);
  const generatedOffset = editor.document.offsetAt(editor.selection.active);
  const selectedOccurrenceId = activeGeneratedSelection?.uri === generatedUri
    ? activeGeneratedSelection.occurrenceId
    : undefined;
  let selected = selectReturnToSourceMatch(selectedOccurrenceId
    ? projectionService.toSource(projection.id, generatedOffset, {
        occurrenceId: selectedOccurrenceId
      })
    : projectionService.toSource(projection.id, generatedOffset));
  // The cursor can move into a sibling, descendant, wrapper, or surrounding
  // context after the view was opened for one occurrence.
  if (selected.status === "unmapped" && selectedOccurrenceId) {
    selected = selectReturnToSourceMatch(
      projectionService.toSource(projection.id, generatedOffset)
    );
  }
  if (selected.status === "ambiguous") {
    void vscode.window.showInformationMessage(
      "This generated position maps to multiple source locations; select a more specific generated region."
    );
    return;
  }
  if (selected.status !== "selected") {
    void vscode.window.showInformationMessage("No source provenance is available at this generated position.");
    return;
  }
  if (!stillCurrent()) return;
  await revealSource(project, selected.match.source, {
    preserveFocus: false,
    isCurrent: stillCurrent
  });
};

const generatedCodeLenses = async (document) => {
  const project = await projectForLanguageRequest(document);
  if (!project) return [];
  await synchronizeGeneratedDocuments(project);
  const sourceKey = documentSourceKey(project, document);
  const mappedOffsets = new Map();
  for (const projection of projectionService.listProjections()) {
    for (const mapping of projection.mappings) {
      if (!mapping.pieceId || mapping.source?.uri !== sourceKey ||
          !Number.isInteger(mapping.source.range?.start?.offset)) continue;
      const candidate = {
        offset: mapping.source.range.start.offset,
        exact: mapping.kind === "exact"
      };
      const current = mappedOffsets.get(mapping.pieceId);
      if (!current || candidate.exact && !current.exact ||
          candidate.exact === current.exact && candidate.offset < current.offset) {
        mappedOffsets.set(mapping.pieceId, candidate);
      }
    }
  }
  return project.semanticIndex.documentSymbols(sourceKey).flatMap((symbol) => {
    if (symbol.kind !== "piece") return [];
    const occurrences = projectionService.listOccurrences(symbol.id);
    if (!occurrences.length) return [];
    const sourceOffset = mappedOffsets.get(symbol.id)?.offset;
    if (!Number.isInteger(sourceOffset)) return [];
    const position = new vscode.Position(symbol.range.start.line, symbol.range.start.column);
    return [new vscode.CodeLens(new vscode.Range(position, position), {
      title: occurrences.length === 1
        ? "1 generated occurrence"
        : occurrences.length + " generated occurrences",
      command: "ravel.openGenerated",
      arguments: [{
        sourceUri: document.uri.toString(),
        sourceOffset
      }]
    })];
  });
};

const revealSource = async (
  project,
  source,
  { preserveFocus = true, isCurrent } = {}
) => {
  if (isCurrent && !isCurrent()) return false;
  const uri = sourceUri(project, source);
  if (!uri) return false;
  pendingSourceReveal = {
    uri: uri.toString(),
    range: source.range,
    expires: Date.now() + 1_000
  };
  const document = await vscode.workspace.openTextDocument(uri);
  if (isCurrent && !isCurrent()) {
    pendingSourceReveal = undefined;
    return false;
  }
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: project.sourceColumn,
    preserveFocus,
    preview: true
  });
  if (isCurrent && !isCurrent()) {
    pendingSourceReveal = undefined;
    return false;
  }
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
  project.changeSnapshot?.nodes.find((node) => node.id === id) ??
  project.changeSnapshot?.edges.find((edge) => edge.id === id) ??
  project.snapshot.nodes.find((node) => node.id === id) ??
  project.snapshot.edges.find((edge) => edge.id === id) ??
  project.baselineSnapshot?.nodes.find((node) => node.id === id) ??
  project.baselineSnapshot?.edges.find((edge) => edge.id === id);

const advancePosition = (position, text) => {
  const lines = text.split("\n");
  return {
    line: position.line + lines.length - 1,
    column: lines.length === 1
      ? position.column + text.length
      : lines.at(-1).length,
    offset: position.offset + text.length
  };
};

const sourceForGeneratedOffset = (project, entityId, generatedOffset) => {
  if (!entityId.startsWith("deliverable:") || !Number.isInteger(generatedOffset)) return null;
  const name = entityId.slice("deliverable:".length);
  const context = project.context.program.deliverables[name]
    ? project.context
    : project.baselineContext;
  const deliverable = context?.program.deliverables[name];
  const output = createExplorerOutputDetails(context, entityId, { generatedOffset });
  const segment = output?.explanation?.segment;
  if (!deliverable || !segment?.source) return segment?.source ?? null;
  if (segment.precision !== "exact" || !Number.isInteger(segment.sourceOffset) ||
      !segment.source.range) {
    return segment.source;
  }
  const generatedPrefix = deliverable.value.slice(
    segment.generated.start,
    generatedOffset
  );
  const start = advancePosition(segment.source.range.start, generatedPrefix);
  const end = advancePosition(start, deliverable.value.slice(generatedOffset, generatedOffset + 1));
  return { uri: segment.source.uri, range: { start, end } };
};

const postSnapshot = (panel, requestId, project) => panel.webview.postMessage({
  version: 1,
  type: "view/result",
  requestId,
  revision: project.snapshot.revision,
  snapshot: project.snapshot,
  changeSnapshot: project.changeSnapshot,
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
    const project = activeProject;
    const revision = project.snapshot.revision;
    const requestGeneration = refreshGeneration;
    const isCurrent = () =>
      project.snapshot.revision === revision &&
      hasCurrentRequestAuthority({
        project,
        activeProject,
        requestGeneration,
        currentGeneration: refreshGeneration,
        refreshPending: projectRefreshPending,
        sourceStateCurrent: projectReadSourceStateIsCurrent(project)
      });
    if (message.type !== "view/request" &&
        message.revision !== revision) {
      throw new Error("Explorer request targets a stale project revision.");
    }
    if (!isCurrent()) throw new Error("Explorer project changed during the request.");

    if (message.type === "view/request") {
      await postSnapshot(panel, message.requestId, project);
      return;
    }

    if (message.type === "output/request") {
      if (typeof message.entityId !== "string" ||
          !message.entityId.startsWith("deliverable:")) {
        throw new TypeError("output/request requires a deliverable entityId.");
      }
      if (message.generatedOffset !== undefined &&
          (!Number.isInteger(message.generatedOffset) || message.generatedOffset < 0)) {
        throw new TypeError("generatedOffset must be a nonnegative integer.");
      }
      const name = message.entityId.slice("deliverable:".length);
      const current = project.context.program.deliverables[name];
      const output = createExplorerOutputDetails(
        current ? project.context : project.baselineContext,
        message.entityId,
        {
          generatedOffset: message.generatedOffset,
          maxTextLength: 20_000,
          maxSegments: 1_000
        }
      );
      if (!output) throw new Error("Deliverable output is not present in this revision.");
      if (!isCurrent()) throw new Error("Explorer project changed during the request.");
      await panel.webview.postMessage({
        version: 1,
        type: "output/result",
        requestId: message.requestId,
        revision,
        output: { ...output, basis: current ? "candidate" : "saved" }
      });
      return;
    }

    if (message.type === "entity/select" || message.type === "source/reveal") {
      if (typeof message.entityId !== "string" || !message.entityId) {
        throw new TypeError("entityId must be a nonempty string.");
      }
      const entity = entityFor(project, message.entityId);
      if (!entity) throw new Error("Explorer entity is not present in this revision.");
      if (message.generatedOffset !== undefined &&
          (!Number.isInteger(message.generatedOffset) || message.generatedOffset < 0)) {
        throw new TypeError("generatedOffset must be a nonnegative integer.");
      }
      const source = sourceForGeneratedOffset(
        project,
        message.entityId,
        message.generatedOffset
      ) ?? entity.source ?? entity.authoredAt;
      const revealed = await revealSource(project, source, {
        preserveFocus: message.type === "entity/select",
        isCurrent
      });
      if (!isCurrent()) throw new Error("Explorer project changed during source reveal.");
      project.lastEditorEntityId = entity.id;
      const details = createExplorerEntityDetails(
        project.context,
        message.entityId,
        { maxTextLength: 20_000 }
      );
      const beforeDetails = project.preview
        ? createExplorerEntityDetails(
          project.baselineContext,
          message.entityId,
          { maxTextLength: 20_000 }
        )
        : undefined;
      if (!isCurrent()) throw new Error("Explorer project changed during the request.");
      await panel.webview.postMessage({
        version: 1,
        type: "selection/changed",
        requestId: message.requestId,
        revision,
        entity,
        details,
        beforeDetails,
        generatedOffset: message.generatedOffset,
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
        <button id="back" type="button" title="Return to the previous graph or provenance selection" disabled>← Back</button>
        <select id="lens" aria-label="Graph lens">
          <option value="overview">Overview</option>
          <option value="dependencies" selected>Dependencies</option>
          <option value="derivation">Derivation</option>
          <option id="changes-lens" value="changes" disabled>Changes</option>
        </select>
        <select id="orientation" aria-label="Layout orientation">
          <option value="DOWN" selected>Vertical</option>
          <option value="RIGHT">Horizontal</option>
        </select>
        <input id="search" type="search" aria-label="Find entity"
          placeholder="Find chunk, transform, output…">
        <button id="fit" type="button">Fit</button>
        <span id="preview" class="preview" hidden>Preview</span>
        <span id="change-legend" class="change-legend" hidden>
          <span><i class="added"></i>Added</span>
          <span><i class="changed"></i>Changed</span>
          <span><i class="removed"></i>Removed</span>
        </span>
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

const evaluateProject = async (
  inputPath,
  sourceColumn,
  overlays = new Map(),
  signal
) => {
  const loaded = await loadBuildInput(inputPath, {
    overlays,
    readLiveResources: false,
    signal
  });
  signal?.throwIfAborted();
  const program = transformGraph(loaded.pretransform);
  signal?.throwIfAborted();
  const context = {
    program,
    pretransform: loaded.pretransform,
    project: {
      id: relative(loaded.rootDirectory, inputPath) || "ravel",
      label: relative(loaded.rootDirectory, inputPath) || "Ravel project"
    }
  };
  const snapshot = createExplorerSnapshot(context, { maxNodes: 500 });
  const semanticIndex = createRavelSemanticIndex({
    ...context,
    revision: snapshot.revision
  });
  return {
    context: { ...context, revision: snapshot.revision },
    snapshot,
    semanticIndex,
    inputPath,
    rootDirectory: loaded.rootDirectory,
    authoredSourceUris: loaded.authoredSourceUris ?? [],
    authoredSourceTexts: loaded.authoredSourceTexts ?? {},
    loadedInputUris: loaded.loadedInputUris ?? [],
    sourceEditsAllowed: loaded.sourceEditsAllowed === true,
    sourceColumn
  };
};

const evaluateProjectState = async (inputPath, sourceColumn, signal) => {
  const baseline = await evaluateProject(inputPath, sourceColumn, new Map(), signal);
  const initialEditorSnapshot = captureEditorState(
    baseline.rootDirectory,
    relevantProjectSources(baseline),
    { includeSupportedFallback: true }
  );
  const stabilized = await stabilizeEditorSnapshot({
    initialSnapshot: initialEditorSnapshot,
    evaluate: async (editorSnapshot) => {
      signal?.throwIfAborted();
      return editorSnapshot.overlays.size
        ? evaluateProject(
            inputPath,
            sourceColumn,
            editorSnapshot.overlays,
            signal
          )
        : baseline;
    },
    captureNext: (candidate) => captureEditorState(
      baseline.rootDirectory,
      [...new Set([
        ...relevantProjectSources(baseline),
        ...relevantProjectSources(candidate)
      ])],
      { includeSupportedFallback: true }
    )
  });
  const editorSnapshot = stabilized.snapshot;
  const candidate = stabilized.value;
  signal?.throwIfAborted();
  const preview = candidate.snapshot.revision !== baseline.snapshot.revision;
  const diff = preview
    ? diffExplorerSnapshots(baseline.snapshot, candidate.snapshot)
    : undefined;
  const capturedSourceState = projectionSourceState(
    editorSnapshot,
    candidate.authoredSourceUris
  );
  const project = {
    ...candidate,
    baselineContext: baseline.context,
    baselineSnapshot: baseline.snapshot,
    editorSnapshot,
    projectionSourceState: {
      sourceTexts: {
        ...candidate.authoredSourceTexts,
        ...capturedSourceState.sourceTexts
      },
      sourceVersions: capturedSourceState.sourceVersions
    },
    preview,
    diff,
    changeSnapshot: preview
      ? createExplorerChangeSnapshot(baseline.snapshot, candidate.snapshot, diff)
      : undefined
  };
  assertProjectSourceStateCurrent(project);
  return project;
};

const evaluateSynchronizedProjectState = async (
  inputPath,
  sourceColumn,
  signal,
  beforeSynchronization
) => {
  let mismatch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const project = await evaluateProjectState(inputPath, sourceColumn, signal);
      await beforeSynchronization?.(project);
      await synchronizeGeneratedDocuments(project, signal);
      assertProjectSourceStateCurrent(project);
      return project;
    } catch (error) {
      if (!isSourceStateMismatch(error)) throw error;
      mismatch = error;
    }
  }
  throw mismatch;
};

const loadProject = async (inputPath, sourceColumn) =>
  vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Ravel: loading Explorer",
    cancellable: true
  }, (_progress, token) => {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort(
      new Error("Ravel project loading was cancelled.")
    ));
    return evaluateSynchronizedProjectState(
      inputPath,
      sourceColumn,
      controller.signal
    );
  });

const refreshProject = async (generation, signal) => {
  const current = activeProject;
  if (!current) return;
  try {
    const next = await evaluateSynchronizedProjectState(
      current.inputPath,
      current.sourceColumn,
      signal,
      (candidate) => {
        const errors = candidate.context.program.diagnostics
          ?.filter((diagnostic) => diagnostic.severity === "error") ?? [];
        if (candidate.preview && errors.length) {
          publishProjectDiagnostics(candidate);
          throw new Error(
            "Preview has diagnostics: " +
            errors.slice(0, 3).map((diagnostic) => diagnostic.message).join(" ")
          );
        }
      }
    );
    if (generation !== refreshGeneration || activeProject !== current) return;
    assertProjectSourceStateCurrent(next);
    activeProject = {
      ...next,
      lastEditorEntityId: current.lastEditorEntityId
    };
    projectRefreshPending = false;
    publishProjectDiagnostics(activeProject);
    await refreshTargetDiagnosticsBestEffort(activeProject, signal);
    if (activePanel) {
      await postSnapshot(activePanel, "document-preview-" + generation, activeProject);
    }
  } catch (error) {
    if (generation !== refreshGeneration || activeProject !== current) return;
    if (activePanel) {
      await activePanel.webview.postMessage({
        version: 1,
        type: "document/changed",
        requestId: "document-preview-" + generation,
        revision: current.snapshot.revision,
        ok: false,
        message: error?.message ?? String(error)
      });
    }
  }
};

const queueProjectRefresh = (reason) => {
  if (!activeProject) return;
  generatedSynchronizationGeneration += 1;
  refreshGeneration += 1;
  projectRefreshPending = true;
  interactiveRefreshController?.abort(
    new Error("A newer Ravel editor revision superseded this language refresh.")
  );
  markGeneratedDocumentsStale(reason);
  targetDiagnosticCollection?.clear();
  const generation = refreshGeneration;
  refreshController?.abort(new Error("A newer Ravel editor revision superseded this preview."));
  refreshController = new AbortController();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refreshProject(generation, refreshController.signal);
  }, 250);
};

const scheduleProjectRefresh = (document) => {
  if (!activeProject || document.uri.scheme !== "file" ||
      !contained(activeProject.rootDirectory, document.uri.fsPath)) {
    return;
  }
  const sourceKey = documentSourceKey(activeProject, document);
  if (resolve(document.uri.fsPath) !== resolve(activeProject.inputPath) &&
      !activeProject.loadedInputUris.includes(sourceKey)) {
    return;
  }
  queueProjectRefresh(
    "Ravel source changed; projection recomputation is pending."
  );
};

const scheduleProjectOpen = (document) => {
  const project = activeProject;
  if (project && document?.uri?.scheme === "file" &&
      contained(project.rootDirectory, document.uri.fsPath)) {
    const sourceKey = documentSourceKey(project, document);
    if (document.isDirty !== true &&
        project.authoredSourceTexts?.[sourceKey] === document.getText()) {
      // Read-only navigation may open an evaluated source without changing its
      // bytes. Write-capable tooling will still force a versioned refresh.
      return;
    }
  }
  scheduleProjectRefresh(document);
};

const projectForDocument = async (document) => {
  if (document?.uri?.scheme !== "file") return null;
  if (activeProject && projectIncludesPath(activeProject, document.uri.fsPath)) {
    return activeProject;
  }
  const inputPath = await resolveInput(document.uri);
  if (!inputPath) return null;
  if (activeProject && resolve(activeProject.inputPath) === resolve(inputPath)) {
    return activeProject;
  }
  if (projectLoadPromise) {
    const pending = projectLoadPromise;
    try {
      await pending;
    } catch {
      // The requesting document still gets an independent discovery/load
      // attempt after an unrelated in-flight project load fails.
    } finally {
      if (projectLoadPromise === pending) projectLoadPromise = undefined;
    }
    return projectForDocument(document);
  }
  projectLoadPromise = (async () => {
    const project = await evaluateSynchronizedProjectState(
      inputPath,
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One
    );
    assertProjectSourceStateCurrent(project);
    activeProject = project;
    projectRefreshPending = false;
    publishProjectDiagnostics(project);
    await refreshTargetDiagnosticsBestEffort(project);
    return project;
  })();
  try {
    return await projectLoadPromise;
  } finally {
    projectLoadPromise = undefined;
  }
};

const projectForLanguageRequest = async (document, signal) => {
  const current = await projectForDocument(document);
  if (!current || !projectIncludesPath(current, document.uri.fsPath, {
    authoredOnly: true
  })) return null;
  if (current && !projectSourceStateIsCurrent(current)) {
    queueProjectRefresh(
      "Ravel source changed; target-language tooling is waiting for a current projection."
    );
  }
  if (!current || !projectRefreshPending) return current;
  if (interactiveRefreshPromise) {
    return waitForPromiseOrAbort(interactiveRefreshPromise, signal);
  }

  const generation = ++refreshGeneration;
  clearTimeout(refreshTimer);
  refreshController?.abort(new Error("An interactive language request superseded the pending preview."));
  refreshController = undefined;
  const controller = new AbortController();
  interactiveRefreshController = controller;

  const work = (async () => {
    controller.signal.throwIfAborted();
    const next = await evaluateSynchronizedProjectState(
      current.inputPath,
      current.sourceColumn,
      controller.signal
    );
    controller.signal.throwIfAborted();
    if (generation !== refreshGeneration) {
      throw new DOMException("The interactive Ravel projection was superseded.", "AbortError");
    }
    assertProjectSourceStateCurrent(next);
    activeProject = {
      ...next,
      lastEditorEntityId: current.lastEditorEntityId
    };
    projectRefreshPending = false;
    publishProjectDiagnostics(activeProject);
    const refreshedProject = activeProject;
    refreshTimer = setTimeout(() => {
      if (activeProject === refreshedProject) {
        void refreshTargetDiagnosticsBestEffort(refreshedProject);
      }
    }, 250);
    if (activePanel) {
      await postSnapshot(
        activePanel,
        "language-request-refresh-" + generation,
        activeProject
      );
    }
    return activeProject;
  })();
  interactiveRefreshPromise = work;
  const cleanup = () => {
    if (interactiveRefreshPromise === work) interactiveRefreshPromise = undefined;
    if (interactiveRefreshController === controller) interactiveRefreshController = undefined;
  };
  void work.then(cleanup, cleanup);
  return waitForPromiseOrAbort(work, signal);
};

const signalForCancellation = (token) => {
  const controller = new AbortController();
  if (token?.isCancellationRequested) {
    controller.abort(new Error("The editor language request was cancelled."));
  }
  const subscription = token?.onCancellationRequested?.(() => controller.abort(
    new Error("The editor language request was cancelled.")
  ));
  return {
    signal: controller.signal,
    dispose: () => subscription?.dispose?.()
  };
};

const targetScope = (project, document, pieceId) => ({
  workspaceId: project.context.project.id,
  documentUri: document.uri.toString(),
  ...(pieceId === undefined ? {} : { pieceId })
});

const soleCandidatePieceId = (candidates) => {
  const pieceIds = [...new Set(candidates.map(({ pieceId }) => pieceId).filter(Boolean))];
  return pieceIds.length === 1 ? pieceIds[0] : undefined;
};

const projectTargetCandidates = () => (projectionService?.listProjections() ?? [])
  .map((projection) => ({
    targetId: projection.targetId,
    artifactId: projection.artifactId,
    projectionId: projection.id
  }));

const targetSelectionFor = (project, document, source) => {
  if (!languageRouter || !targetSelectionStore) return {};
  const candidates = languageRouter.listTargets(source);
  const documentScope = targetScope(project, document);
  const pieceId = soleCandidatePieceId(candidates);
  const scope = targetScope(project, document, pieceId);
  const invalidated = [
    targetSelectionStore.invalidate(documentScope, projectTargetCandidates()),
    ...(pieceId === undefined
      ? []
      : [targetSelectionStore.invalidate(scope, candidates)])
  ].filter(Boolean);
  if (invalidated.length) {
    void extensionWorkspaceState?.update(
      "ravel.targetSelections",
      targetSelectionStore.toJSON()
    );
    void vscode.window.showInformationMessage(
      "A saved Ravel target context is no longer available in this project."
    );
  }
  const configuredDefault = vscode.workspace.getConfiguration("ravel", document.uri)
    .get("defaultTarget");
  const resolved = targetSelectionStore.resolve(scope, {
    candidates,
    generatedViewSelection: activeGeneratedSelection?.targetId
      ? {
          targetId: activeGeneratedSelection.targetId,
          artifactId: activeGeneratedSelection.artifactId,
          projectionId: activeGeneratedSelection.projectionId,
          occurrenceId: activeGeneratedSelection.occurrenceId
        }
      : undefined,
    defaultTargetId: configuredDefault || undefined
  });
  return resolved.status === "selected"
    ? {
        targetId: resolved.targetId,
        artifactId: resolved.artifactId,
        ...(resolved.projectionId === undefined
          ? {}
          : { projectionId: resolved.projectionId }),
        ...(resolved.occurrenceId === undefined
          ? {}
          : { occurrenceId: resolved.occurrenceId })
      }
    : {};
};

const languageRequestAt = async (
  kind,
  document,
  position,
  request,
  token,
  routingOptions = {}
) => {
  const cancellation = signalForCancellation(token);
  try {
    const project = await projectForLanguageRequest(document, cancellation.signal);
    if (!project) return { project, response: null };
    assertProjectSourceStateCurrent(project);
    if (!languageRouter || languageRouterProjectKey !== projectKey(project)) {
      await synchronizeGeneratedDocuments(project, cancellation.signal);
    }
    if (!languageRouter) return { project, response: null };
    const source = {
      uri: documentSourceKey(project, document),
      offset: document.offsetAt(position)
    };
    const requestGeneration = refreshGeneration;
    const response = await languageRouter.request(kind, source, {
      ...targetSelectionFor(project, document, source),
      ...routingOptions,
      request,
      sourceVersions: project.projectionSourceState.sourceVersions,
      isWritableSource: (uri) => writableSourceUri(project, { uri }) !== null
    }, cancellation.signal);
    cancellation.signal.throwIfAborted();
    assertProjectSourceStateCurrent(project);
    return { project, response, source, requestGeneration };
  } catch (error) {
    if (isSourceStateMismatch(error)) {
      queueProjectRefresh(
        "Ravel source changed during target-language analysis; retrying with a current projection."
      );
      return { project: undefined, response: null };
    }
    if (cancellation.signal.aborted || error?.code === "BRIDGE_ABORTED") {
      return { project: undefined, response: null };
    }
    throw error;
  } finally {
    cancellation.dispose();
  }
};

const selectTarget = async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") return;
  const cancellation = signalForCancellation();
  try {
    const project = await projectForLanguageRequest(editor.document, cancellation.signal);
    if (!project || !languageRouter || !targetSelectionStore) return;
    const source = {
      uri: documentSourceKey(project, editor.document),
      offset: editor.document.offsetAt(editor.selection.active)
    };
    const candidates = languageRouter.listTargets(source);
    const choices = new Map();
    for (const candidate of candidates) {
      const key = [
        candidate.targetId,
        candidate.artifactId,
        candidate.projectionId ?? "",
        candidate.occurrenceId ?? ""
      ].join("\u0000");
      if (!choices.has(key)) choices.set(key, candidate);
    }
    if (!choices.size) {
      void vscode.window.showInformationMessage("No generated target is available at this source position.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      [...choices.values()].map((candidate) => ({
        label: candidate.targetId,
        description: candidate.artifactId,
        detail: [
          candidate.stage,
          candidate.languageId,
          candidate.occurrenceId
        ].filter(Boolean).join(" · "),
        candidate
      })),
      { title: "Select the Ravel analysis target for this document" }
    );
    if (!picked) return;
    const documentScope = targetScope(project, editor.document);
    targetSelectionStore.set(documentScope, {
      targetId: picked.candidate.targetId,
      artifactId: picked.candidate.artifactId
    });
    const pieceId = picked.candidate.pieceId ?? soleCandidatePieceId(candidates);
    if (pieceId) {
      targetSelectionStore.set(targetScope(project, editor.document, pieceId), {
        targetId: picked.candidate.targetId,
        artifactId: picked.candidate.artifactId,
        ...(picked.candidate.projectionId === undefined
          ? {}
          : { projectionId: picked.candidate.projectionId }),
        ...(picked.candidate.occurrenceId === undefined
          ? {}
          : { occurrenceId: picked.candidate.occurrenceId })
      });
    }
    await extensionWorkspaceState?.update(
      "ravel.targetSelections",
      targetSelectionStore.toJSON()
    );
    void vscode.window.setStatusBarMessage(
      "Ravel target: " + picked.candidate.targetId + " · " + picked.candidate.artifactId,
      4_000
    );
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
  } finally {
    cancellation.dispose();
  }
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
    const project = await loadProject(
      inputPath,
      sourceEditor?.viewColumn ?? vscode.ViewColumn.One
    );
    assertProjectSourceStateCurrent(project);
    activeProject = project;
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Ravel Explorer could not load the project: ${error?.message ?? String(error)}`
    );
    return;
  }
  projectRefreshPending = false;
  publishProjectDiagnostics(activeProject);
  await refreshTargetDiagnosticsBestEffort(activeProject);

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
  if (!entity) return;
  activeProject.lastEditorEntityId = entity.id;
  const selectedEntity = entityFor(activeProject, entity.id) ?? entity;
  const details = createExplorerEntityDetails(
    activeProject.context,
    entity.id,
    { maxTextLength: 20_000 }
  );
  const beforeDetails = activeProject.preview
    ? createExplorerEntityDetails(
      activeProject.baselineContext,
      selectedEntity.id,
      { maxTextLength: 20_000 }
    )
    : undefined;
  const generatedMatches = createExplorerGeneratedMatches(
    activeProject.context,
    {
      uri: source,
      range: {
        start: {
          line: selection.start.line,
          column: selection.start.character,
          offset: event.textEditor.document.offsetAt(selection.start)
        },
        end: {
          line: selection.end.line,
          column: selection.end.character,
          offset: event.textEditor.document.offsetAt(selection.end)
        }
      }
    },
    { maxMatches: 500 }
  );
  await activePanel.webview.postMessage({
    version: 1,
    type: "selection/changed",
    requestId: "editor-selection-" + Date.now(),
    revision: activeProject.snapshot.revision,
    entity: selectedEntity,
    details,
    beforeDetails,
    generatedMatches,
    revealed: true,
    origin: "editor"
  });
};

const definitionAt = async (document, position) => {
  const project = await projectForLanguageRequest(document);
  if (!project) return null;
  const definition = project.semanticIndex.definitionAt(
    documentSourceKey(project, document),
    sourcePosition(document, position)
  );
  const target = sourceUri(project, definition);
  if (!target) return null;
  const range = definition.range
    ? new vscode.Range(
      new vscode.Position(definition.range.start.line, definition.range.start.column),
      new vscode.Position(definition.range.end.line, definition.range.end.column)
    )
    : new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0)
    );
  return new vscode.Location(target, range);
};

const hoverAt = async (document, position) => {
  const project = await projectForLanguageRequest(document);
  if (!project) return null;
  const hover = project.semanticIndex.hoverAt(
    documentSourceKey(project, document),
    sourcePosition(document, position)
  );
  if (!hover) return null;
  const contents = hover.contents ?? {};
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown("**" + String(contents.title ?? hover.kind ?? "Ravel") + "**\n\n");
  if (contents.canonicalId) markdown.appendCodeblock(contents.canonicalId, "text");
  if (contents.language) markdown.appendMarkdown("Language: `" + contents.language + "`\n\n");
  if (Array.isArray(contents.dependencies) && contents.dependencies.length) {
    markdown.appendMarkdown("Dependencies: " + contents.dependencies.map((id) => "`" + id + "`").join(", ") + "\n\n");
  }
  if (Number.isInteger(contents.referenceCount)) {
    markdown.appendMarkdown("References: " + contents.referenceCount);
  }
  const range = hover.range
    ? new vscode.Range(
      hover.range.start.line,
      hover.range.start.column,
      hover.range.end.line,
      hover.range.end.column
    )
    : undefined;
  return new vscode.Hover(markdown, range);
};

const referencesAt = async (document, position, context) => {
  const project = await projectForLanguageRequest(document);
  if (!project) return [];
  const index = project.semanticIndex;
  const entity = index.entityAt(
    documentSourceKey(project, document),
    sourcePosition(document, position)
  );
  const id = entity?.kind === "reference" ? entity.targetId : entity?.kind === "piece" ? entity.id : null;
  if (!id) return [];
  return index.referencesFor(id, {
    includeDeclaration: context?.includeDeclaration === true
  }).flatMap((entry) => {
    const uri = sourceUri(project, entry);
    if (!uri) return [];
    return [new vscode.Location(uri, new vscode.Range(
      entry.range.start.line,
      entry.range.start.column,
      entry.range.end.line,
      entry.range.end.column
    ))];
  });
};

const referenceCompletionAt = async (document, position) => {
  const offset = document.offsetAt(position);
  const prefixStart = Math.max(0, offset - 1_000);
  const prefix = document.getText().slice(prefixStart, offset);
  const match = /_"([^"|]*)$/.exec(prefix);
  if (!match) return [];
  const project = await projectForLanguageRequest(document);
  if (!project) return [];
  const query = match[1];
  const start = document.positionAt(offset - query.length);
  const replacement = new vscode.Range(start, position);
  return project.semanticIndex.completeReferences(query).map((entry) => {
    const item = new vscode.CompletionItem(entry.label, vscode.CompletionItemKind.Reference);
    item.detail = entry.detail;
    item.insertText = entry.insertText;
    item.range = replacement;
    item.filterText = entry.label;
    return item;
  });
};

const documentSymbols = async (document, token) => {
  const project = await projectForLanguageRequest(document);
  if (!project) return [];
  const sourceKey = documentSourceKey(project, document);
  const nativeSourceSymbols = project.semanticIndex.documentSymbols(sourceKey);
  const ravelSymbols = nativeSourceSymbols.map((entry) => {
    const range = new vscode.Range(
      entry.range.start.line,
      entry.range.start.column,
      entry.range.end.line,
      entry.range.end.column
    );
    return new vscode.DocumentSymbol(
      entry.name,
      entry.detail ?? "",
      entry.kind === "piece" ? vscode.SymbolKind.Module : vscode.SymbolKind.Event,
      range,
      range
    );
  });
  const firstPiece = nativeSourceSymbols.find((entry) => entry.kind === "piece");
  if (!firstPiece) return ravelSymbols;
  const firstPieceOffset = Number.isInteger(firstPiece.range.start.offset)
    ? firstPiece.range.start.offset
    : document.offsetAt(new vscode.Position(
      firstPiece.range.start.line,
      firstPiece.range.start.column
    ));
  try {
    const { response } = await languageRequestAt(
      "documentSymbols",
      document,
      document.positionAt(firstPieceOffset),
      {},
      token
    );
    if (response?.status !== "ok") return ravelSymbols;
    const targetSymbols = response.result.flatMap((entry) => {
      if (entry.uri !== sourceKey || !entry.range) return [];
      const range = offsetRangeIn(document, entry.range);
      return [new vscode.DocumentSymbol(
        entry.name,
        [entry.kind, response.context.targetId].filter(Boolean).join(" · "),
        symbolKind(entry.kind),
        range,
        range
      )];
    });
    return [...ravelSymbols, ...targetSymbols];
  } catch (error) {
    if (error?.code !== "BRIDGE_ABORTED") console.warn("Ravel target symbols unavailable:", error?.message ?? String(error));
    return ravelSymbols;
  }
};

const offsetRangeIn = (document, range) => new vscode.Range(
  document.positionAt(range?.start ?? 0),
  document.positionAt(range?.end ?? range?.start ?? 0)
);

const editorUriForLanguageLocation = (project, location) => {
  const authored = sourceUri(project, { uri: location?.uri });
  if (authored) return authored;
  try {
    const uri = vscode.Uri.parse(location?.uri);
    if (uri.scheme === "pieceful-virtual") {
      return generatedRegistry?.get(uri.toString()) ? uri : null;
    }
    if (uri.scheme !== "file" || vscode.workspace.isTrusted !== true) return null;
    const root = realpathSync(project.rootDirectory);
    const canonical = realpathSync(uri.fsPath);
    return contained(root, canonical) ? vscode.Uri.file(canonical) : null;
  } catch {
    return null;
  }
};

const languageLocation = async (project, location, isCurrent) => {
  if (isCurrent && !isCurrent()) return null;
  const uri = editorUriForLanguageLocation(project, location);
  if (!uri || !location?.range) return null;
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    if (isCurrent && !isCurrent()) return null;
    return new vscode.Location(uri, offsetRangeIn(document, location.range));
  } catch {
    return null;
  }
};

const completionKind = (kind) => ({
  alias: vscode.CompletionItemKind.Reference,
  class: vscode.CompletionItemKind.Class,
  const: vscode.CompletionItemKind.Constant,
  constructor: vscode.CompletionItemKind.Constructor,
  enum: vscode.CompletionItemKind.Enum,
  "enum member": vscode.CompletionItemKind.EnumMember,
  field: vscode.CompletionItemKind.Field,
  function: vscode.CompletionItemKind.Function,
  interface: vscode.CompletionItemKind.Interface,
  keyword: vscode.CompletionItemKind.Keyword,
  let: vscode.CompletionItemKind.Variable,
  method: vscode.CompletionItemKind.Method,
  module: vscode.CompletionItemKind.Module,
  property: vscode.CompletionItemKind.Property,
  type: vscode.CompletionItemKind.TypeParameter,
  var: vscode.CompletionItemKind.Variable,
  variable: vscode.CompletionItemKind.Variable
})[kind] ?? vscode.CompletionItemKind.Text;

const symbolKind = (kind) => ({
  alias: vscode.SymbolKind.Variable,
  class: vscode.SymbolKind.Class,
  const: vscode.SymbolKind.Constant,
  constructor: vscode.SymbolKind.Constructor,
  enum: vscode.SymbolKind.Enum,
  "enum member": vscode.SymbolKind.EnumMember,
  field: vscode.SymbolKind.Field,
  function: vscode.SymbolKind.Function,
  interface: vscode.SymbolKind.Interface,
  let: vscode.SymbolKind.Variable,
  method: vscode.SymbolKind.Method,
  module: vscode.SymbolKind.Module,
  property: vscode.SymbolKind.Property,
  type: vscode.SymbolKind.TypeParameter,
  var: vscode.SymbolKind.Variable,
  variable: vscode.SymbolKind.Variable
})[kind] ?? vscode.SymbolKind.Object;

const nativeCompletionAt = async (document, position, token, completionContext) => {
  const { project, response, requestGeneration } = await languageRequestAt(
    "completion",
    document,
    position,
    {
      options: {
        triggerCharacter: completionContext?.triggerCharacter,
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true
      }
    },
    token
  );
  if (response?.status === "target-required") {
    void vscode.window.setStatusBarMessage(
      "Ravel: select a target before requesting target-language completions.",
      4_000
    );
    return [];
  }
  if (!project || response?.status !== "ok" || project.sourceEditsAllowed !== true) return [];
  if (!hasCurrentRequestAuthority({
    project,
    activeProject,
    requestGeneration,
    currentGeneration: refreshGeneration,
    refreshPending: projectRefreshPending,
    sourceStateCurrent: projectSourceStateIsCurrent(project)
  })) return [];
  const sourceKey = documentSourceKey(project, document);
  const responseProjection = projectionService?.getProjection(
    response.context?.projectionId
  );
  if (!responseProjection ||
      responseProjection.version !== response.context?.projectionVersion ||
      !hasCurrentProjectionSourceVersion({
        projectionSourceVersions: responseProjection.sourceVersions,
        projectSourceVersions: project.projectionSourceState.sourceVersions,
        sourceUri: sourceKey,
        documentVersion: document.version
      })) return [];
  return response.result.items
    // Additional actions can require an unsafe import destination, and a
    // non-exact replacement span is not a reversible primary edit.
    .filter((entry) => isSafePrimaryCompletion(entry, sourceKey))
    .map((entry) => {
      const item = new vscode.CompletionItem(entry.name, completionKind(entry.kind));
      item.sortText = entry.sortText;
      item.filterText = entry.filterText;
      item.preselect = entry.isRecommended === true;
      item.commitCharacters = entry.commitCharacters ?? response.result.defaultCommitCharacters;
      if (entry.insertText !== undefined) {
        item.insertText = entry.isSnippet
          ? new vscode.SnippetString(entry.insertText)
          : entry.insertText;
      }
      if (entry.replacementSpan) {
        item.range = offsetRangeIn(document, entry.replacementSpan);
      }
      item.detail = [entry.kind, entry.source, response.context.targetId]
        .filter(Boolean)
        .join(" · ");
      item.ravelNativeCompletion = {
        documentUri: document.uri.toString(),
        documentVersion: document.version,
        offset: document.offsetAt(position),
        name: entry.name,
        source: entry.source,
        data: entry.data,
        project,
        requestGeneration
      };
      return item;
    });
};

const resolveNativeCompletion = async (item, token) => {
  const data = item.ravelNativeCompletion;
  if (!data) return item;
  const document = vscode.workspace.textDocuments.find((entry) =>
    entry.uri.toString() === data.documentUri
  );
  if (!document || document.version !== data.documentVersion) return item;
  if (!hasCurrentRequestAuthority({
    project: data.project,
    activeProject,
    requestGeneration: data.requestGeneration,
    currentGeneration: refreshGeneration,
    refreshPending: projectRefreshPending,
    sourceStateCurrent: projectSourceStateIsCurrent(data.project)
  })) return item;
  const { project, response, requestGeneration } = await languageRequestAt(
    "completionDetails",
    document,
    document.positionAt(data.offset),
    {
      name: data.name,
      source: data.source,
      data: data.data
    },
    token
  );
  if (project !== data.project || requestGeneration !== data.requestGeneration ||
      document.version !== data.documentVersion ||
      !hasCurrentRequestAuthority({
        project,
        activeProject,
        requestGeneration,
        currentGeneration: refreshGeneration,
        refreshPending: projectRefreshPending,
        sourceStateCurrent: projectSourceStateIsCurrent(project)
      })) return item;
  if (response?.status !== "ok" || !response.result) return item;
  item.detail = response.result.display || item.detail;
  if (response.result.documentation) {
    const documentation = new vscode.MarkdownString();
    documentation.appendMarkdown(response.result.documentation);
    item.documentation = documentation;
  }
  return item;
};

const nativeHoverAt = async (document, position, token) => {
  const { response } = await languageRequestAt(
    "hover",
    document,
    position,
    {},
    token
  );
  if (response?.status !== "ok" || !response.result) return null;
  const contents = new vscode.MarkdownString();
  if (response.result.display) {
    contents.appendCodeblock(response.result.display, "typescript");
  }
  if (response.result.documentation) {
    contents.appendMarkdown("\n" + response.result.documentation);
  }
  contents.appendMarkdown(
    "\n\n_Target: `" + response.context.targetId + "` · Artifact: `" +
      response.context.artifactId + "`_"
  );
  return new vscode.Hover(
    contents,
    response.result.range ? offsetRangeIn(document, response.result.range) : undefined
  );
};

const nativeSignatureHelpAt = async (document, position, token) => {
  const { response } = await languageRequestAt(
    "signatureHelp",
    document,
    position,
    {},
    token
  );
  if (response?.status !== "ok" || !response.result) return null;
  const help = new vscode.SignatureHelp();
  help.activeSignature = response.result.selectedItemIndex;
  help.activeParameter = response.result.argumentIndex;
  help.signatures = response.result.items.map((entry) => {
    const label = entry.prefix + entry.parameters
      .map((parameter) => parameter.display)
      .join(entry.separator) + entry.suffix;
    const signature = new vscode.SignatureInformation(label, entry.documentation);
    signature.parameters = entry.parameters.map((parameter) =>
      new vscode.ParameterInformation(parameter.display, parameter.documentation)
    );
    return signature;
  });
  return help;
};

const nativeLocationsAt = async (kind, document, position, token) => {
  const { project, response, requestGeneration } = await languageRequestAt(
    kind,
    document,
    position,
    {},
    token
  );
  if (!project || response?.status !== "ok") return [];
  // Full source-state capture copies open buffers. Do it once around the batch;
  // individual locations need only the cheap project/generation authority.
  const isCurrent = () => currentReadRequestGeneration(
    project,
    requestGeneration,
    token
  );
  if (!isCurrent() || !projectReadSourceStateIsCurrent(project)) return [];
  const converted = await Promise.all(
    response.result.map((entry) => languageLocation(project, entry, isCurrent))
  );
  return isCurrent() && projectReadSourceStateIsCurrent(project)
    ? converted.filter(Boolean)
    : [];
};

const nativePrepareRenameAt = async (document, position, token) => {
  const { project, response, requestGeneration } = await languageRequestAt(
    "prepareRename",
    document,
    position,
    {},
    token
  );
  if (response?.status !== "ok" || !response.result?.canRename) {
    throw new Error(response?.result?.reason ?? "This generated symbol cannot be renamed safely from Ravel source.");
  }
  if (!project?.sourceEditsAllowed) {
    throw new Error("Automatic source edits are disabled because this project contains supplied JSON map provenance.");
  }
  if (!currentLanguageRequest(project, requestGeneration)) {
    throw new Error("Ravel source changed while rename was being prepared; retry the rename.");
  }
  const sourceKey = project ? documentSourceKey(project, document) : undefined;
  if (!response.result.range || !isExactAuthoredRange(response.result, sourceKey)) {
    throw new Error("Rename requires one exact writable Ravel source range.");
  }
  return {
    range: offsetRangeIn(document, response.result.range),
    placeholder: response.result.placeholder
  };
};

const nativeRenameAt = async (document, position, newName, token) => {
  const { project, response, requestGeneration } = await languageRequestAt(
    "rename",
    document,
    position,
    { newName },
    token
  );
  if (!project || response?.status !== "ok" || !response.result?.canRename) {
    throw new Error(response?.result?.reason ?? "The target language service could not rename this symbol.");
  }
  const renameRequestIsCurrent = () =>
    requestGeneration === refreshGeneration &&
    projectRefreshPending === false &&
    project === activeProject;
  if (!renameRequestIsCurrent()) {
    throw new Error("Ravel source changed while rename analysis was running; retry the rename.");
  }
  const classified = response.result.classifiedEdit;
  if (classified?.classification !== "automatic") {
    const explanation = classified?.entries?.find((entry) => entry.message)?.message;
    throw new Error(explanation ?? "This rename requires generated-context preview and was not applied automatically.");
  }
  assertProjectSourceStateCurrent(project);
  const versions = project.projectionSourceState.sourceVersions;
  const validation = languageRouter.validateSourceEditVersions(
    classified.sourceEdit,
    versions
  );
  if (!validation.valid) {
    throw new Error("Ravel source changed while rename was being prepared; retry the rename.");
  }
  const targets = [];
  for (const sourceDocument of classified.sourceEdit.documents) {
    const uri = writableSourceUri(project, { uri: sourceDocument.uri });
    if (!uri) throw new Error("Rename attempted to edit a source outside the Ravel workspace.");
    const target = await vscode.workspace.openTextDocument(uri);
    targets.push({ sourceDocument, uri, target });
  }
  assertProjectSourceStateCurrent(project);
  const finalValidation = languageRouter.validateSourceEditVersions(
    classified.sourceEdit,
    project.projectionSourceState.sourceVersions
  );
  if (!finalValidation.valid) {
    throw new Error("Ravel source changed while rename documents were being opened; retry the rename.");
  }
  if (!renameRequestIsCurrent()) {
    throw new Error("Ravel source changed while rename documents were being opened; retry the rename.");
  }
  const edit = new vscode.WorkspaceEdit();
  for (const { sourceDocument, uri, target } of targets) {
    for (const replacement of sourceDocument.edits) {
      edit.replace(uri, offsetRangeIn(target, replacement.range), replacement.text);
    }
  }
  return edit;
};

const callHierarchyItem = async (
  project,
  entry,
  context,
  requestGeneration,
  isCurrent = () => projectReadSourceStateIsCurrent(project)
) => {
  if (!isCurrent()) return null;
  const location = await languageLocation(project, entry, isCurrent);
  if (!location) return null;
  const document = await vscode.workspace.openTextDocument(location.uri);
  if (!isCurrent()) return null;
  const selectionRange = entry.selectionRange
    ? offsetRangeIn(document, entry.selectionRange)
    : location.range;
  const item = new vscode.CallHierarchyItem(
    symbolKind(entry.kind),
    entry.name,
    [entry.containerName, context?.targetId].filter(Boolean).join(" · "),
    location.uri,
    location.range,
    selectionRange
  );
  item.ravelCallContext = {
    documentUri: location.uri.toString(),
    offset: entry.selectionRange?.start ?? entry.range.start,
    projectionId: entry.generated?.projectionId ?? context?.projectionId,
    targetId: entry.generated?.targetId ?? context?.targetId,
    artifactId: entry.generated?.artifactId ?? context?.artifactId,
    occurrenceId: entry.generated?.occurrenceId ?? context?.occurrenceId,
    project,
    requestGeneration,
    documentVersion: document.version
  };
  return item;
};

const prepareNativeCallHierarchy = async (document, position, token) => {
  const { project, response, requestGeneration } = await languageRequestAt(
    "prepareCallHierarchy",
    document,
    position,
    {},
    token
  );
  if (!project || response?.status !== "ok") return [];
  const isCurrent = () => currentReadRequestGeneration(
    project,
    requestGeneration,
    token
  );
  if (!isCurrent() || !projectReadSourceStateIsCurrent(project)) return [];
  const items = await Promise.all(response.result.map((entry) =>
    callHierarchyItem(project, entry, response.context, requestGeneration, isCurrent)
  ));
  return isCurrent() && projectReadSourceStateIsCurrent(project)
    ? items.filter(Boolean)
    : [];
};

const callRequest = async (kind, item, token) => {
  const call = item.ravelCallContext;
  if (!call?.project || !projectReadSourceStateIsCurrent(call.project)) return [];
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(call.documentUri));
  if (document.version !== call.documentVersion ||
      !projectReadSourceStateIsCurrent(call.project)) return [];
  const { project, response, requestGeneration } = await languageRequestAt(
    kind,
    document,
    document.positionAt(call.offset),
    {},
    token,
    {
      projectionId: call.projectionId,
      targetId: call.targetId,
      artifactId: call.artifactId,
      occurrenceId: call.occurrenceId
    }
  );
  if (!project || response?.status !== "ok" ||
      !hasSameLanguageRoutingContext(call, response.context)) return [];
  // Opening a previously closed, byte-identical source can require a strict
  // project refresh before the target-language request. Rebase this item to
  // that successfully validated project instead of pinning it to the old
  // in-memory project object forever.
  call.project = project;
  call.requestGeneration = requestGeneration;
  call.documentVersion = document.version;
  const isCurrent = () =>
    document.version === call.documentVersion &&
    currentReadRequestGeneration(project, requestGeneration, token);
  if (!isCurrent() || !projectReadSourceStateIsCurrent(project)) return [];
  if (kind === "incomingCalls") {
    const converted = await Promise.all(response.result.map(async (entry) => {
      const from = await callHierarchyItem(
        project,
        entry.from,
        response.context,
        requestGeneration,
        isCurrent
      );
      if (!from) return null;
      const fromDocument = await vscode.workspace.openTextDocument(from.uri);
      if (!isCurrent()) return null;
      return new vscode.CallHierarchyIncomingCall(
        from,
        entry.fromRanges.map((range) => offsetRangeIn(fromDocument, range))
      );
    }));
    return isCurrent() && projectReadSourceStateIsCurrent(project)
      ? converted.filter(Boolean)
      : [];
  }
  const converted = await Promise.all(response.result.map(async (entry) => {
    const to = await callHierarchyItem(
      project,
      entry.to,
      response.context,
      requestGeneration,
      isCurrent
    );
    if (!to) return null;
    return new vscode.CallHierarchyOutgoingCall(
      to,
      entry.fromRanges.map((range) => offsetRangeIn(document, range))
    );
  }));
  return isCurrent() && projectReadSourceStateIsCurrent(project)
    ? converted.filter(Boolean)
    : [];
};

const targetDiagnosticSeverity = (severity) => ({
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint
})[severity] ?? vscode.DiagnosticSeverity.Information;

const currentDiagnosticProject = (project) =>
  hasDiagnosticPublicationAuthority({
    project,
    activeProject,
    refreshPending: projectRefreshPending,
    sourceStateCurrent: projectSourceStateIsCurrent(project)
  });

const currentReadDiagnosticProject = (project) =>
  hasDiagnosticPublicationAuthority({
    project,
    activeProject,
    refreshPending: projectRefreshPending,
    sourceStateCurrent: projectReadSourceStateIsCurrent(project)
  });

const refreshTargetDiagnostics = async (project, signal) => {
  if (!targetDiagnosticCollection || !languageRouter || !projectionService ||
      !currentDiagnosticProject(project)) return;
  const router = languageRouter;
  const projections = projectionService;
  const diagnosticGeneration = refreshGeneration;
  const generationIsCurrent = () => hasDiagnosticRunAuthority({
    project,
    activeProject,
    refreshPending: projectRefreshPending,
    requestGeneration: diagnosticGeneration,
    currentGeneration: refreshGeneration,
    router,
    currentRouter: languageRouter,
    projectionService: projections,
    currentProjectionService: projectionService,
    aborted: signal?.aborted === true
  });
  const collected = [];
  for (const projection of projections.listProjections()) {
    signal?.throwIfAborted();
    const anchor = projection.mappings.find((mapping) =>
      mapping.source?.uri && Number.isInteger(mapping.source.range?.start?.offset)
    );
    if (!anchor || !sourceUri(project, anchor.source)) continue;
    const response = await router.request("diagnostics", {
      uri: anchor.source.uri,
      offset: anchor.source.range.start.offset
    }, {
      ...diagnosticProjectionRouting(projection, anchor),
      sourceVersions: project.projectionSourceState.sourceVersions,
      isWritableSource: (uri) => writableSourceUri(project, { uri }) !== null,
      request: {
        categories: ["configuration", "compilerOptions", "syntactic", "semantic", "suggestion"]
      }
    }, signal);
    signal?.throwIfAborted();
    if (!generationIsCurrent()) return;
    if (response.status !== "ok") continue;
    for (const entry of response.result) {
      const exactSource = sourceUri(project, { uri: entry.uri });
      collected.push({
        ...entry,
        uri: exactSource ?? sourceUri(project, anchor.source),
        range: exactSource ? entry.range : {
          start: anchor.source.range.start.offset,
          end: anchor.source.range.end.offset
        },
        targetId: response.context.targetId,
        artifactId: response.context.artifactId,
        generated: entry.generated
      });
    }
  }

  const grouped = new Map();
  const seen = new Set();
  for (const entry of collected) {
    if (!entry.uri) continue;
    const key = JSON.stringify([
      entry.uri.toString(),
      entry.range.start,
      entry.range.end,
      entry.code,
      entry.message,
      entry.targetId,
      entry.artifactId
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    const entries = grouped.get(entry.uri.toString()) ?? [];
    entries.push(entry);
    grouped.set(entry.uri.toString(), entries);
  }

  signal?.throwIfAborted();
  if (!generationIsCurrent() || !currentReadDiagnosticProject(project)) return;
  const published = [];
  for (const [uriString, entries] of grouped) {
    signal?.throwIfAborted();
    if (!generationIsCurrent()) return;
    const uri = vscode.Uri.parse(uriString);
    const document = await vscode.workspace.openTextDocument(uri);
    signal?.throwIfAborted();
    if (!generationIsCurrent()) return;
    published.push([uri, entries.map((entry) => {
      const suffix = entry.targetId
        ? " [" + entry.targetId + " · " + entry.artifactId + "]"
        : "";
      const diagnostic = new vscode.Diagnostic(
        offsetRangeIn(document, entry.range),
        entry.message + suffix,
        targetDiagnosticSeverity(entry.severity)
      );
      diagnostic.code = entry.code;
      diagnostic.source = entry.source ?? "typescript";
      diagnostic.ravelGenerated = entry.generated;
      return diagnostic;
    })]);
  }
  signal?.throwIfAborted();
  if (!generationIsCurrent() || !currentReadDiagnosticProject(project)) return;
  targetDiagnosticCollection.clear();
  targetDiagnosticCollection.set(published);
};

const refreshTargetDiagnosticsBestEffort = async (project, signal) => {
  const router = languageRouter;
  const projections = projectionService;
  try {
    await refreshTargetDiagnostics(project, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    // A failed request for an old project must not erase diagnostics already
    // published by the current project.
    if (languageRouter !== router || projectionService !== projections ||
        !currentDiagnosticProject(project)) return;
    targetDiagnosticCollection?.clear();
    console.warn("Ravel target diagnostics unavailable:", error?.message ?? String(error));
  }
};

export const activate = (context) => {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("ravel");
  targetDiagnosticCollection = vscode.languages.createDiagnosticCollection("ravel-target");
  generatedRegistry = createGeneratedDocumentRegistry();
  extensionWorkspaceState = context.workspaceState;
  targetSelectionStore = createTargetSelectionStore(
    context.workspaceState.get("ravel.targetSelections")
  );
  generatedStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  generatedStatus.name = "Ravel generated context";
  generatedStatus.command = "ravel.returnToSource";
  generatedDecorations = {
    "selected-fragment": vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      border: "1px solid",
      borderColor: new vscode.ThemeColor("editor.findMatchBorder")
    }),
    "selected-piece": vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("editor.selectionHighlightBackground")
    }),
    descendant: vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.infoForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right
    }),
    "surrounding-context": vscode.window.createTextEditorDecorationType({
      opacity: "0.72"
    }),
    transformed: vscode.window.createTextEditorDecorationType({
      textDecoration: "underline dotted"
    }),
    synthetic: vscode.window.createTextEditorDecorationType({
      opacity: "0.62",
      fontStyle: "italic"
    })
  };
  generatedProvider = createGeneratedDocumentProvider({
    vscode,
    registry: generatedRegistry,
    presentMetadata: presentGeneratedContext
  });
  const trustSubscription = vscode.workspace.onDidGrantWorkspaceTrust?.(() => {
    resetLanguageRouter();
    targetDiagnosticCollection?.clear();
    const project = activeProject;
    if (project) {
      void synchronizeGeneratedDocuments(project)
        .then(() => activeProject === project
          ? refreshTargetDiagnosticsBestEffort(project)
          : undefined)
        .catch((error) => {
          if (isSourceStateMismatch(error) && activeProject === project) {
            queueProjectRefresh(
              "Ravel source changed while target tooling was starting."
            );
            return;
          }
          console.warn(
            "Ravel target tooling could not start after workspace trust was granted:",
            error?.message ?? String(error)
          );
        });
    }
  });
  const generatedPresentationSubscription = generatedRegistry.onDidChange(({ uri }) => {
    if (vscode.window.activeTextEditor?.document.uri.toString() !== uri) return;
    clearTimeout(generatedPresentationTimer);
    generatedPresentationTimer = setTimeout(
      () => void refreshActiveGeneratedPresentation(),
      0
    );
  });
  const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor?.((editor) => {
    void refreshActiveGeneratedPresentation(editor);
  });
  context.subscriptions.push(
    diagnosticCollection,
    targetDiagnosticCollection,
    generatedStatus,
    generatedProvider,
    ...(trustSubscription ? [trustSubscription] : []),
    generatedPresentationSubscription,
    ...(activeEditorSubscription ? [activeEditorSubscription] : []),
    ...Object.values(generatedDecorations),
    vscode.commands.registerCommand("ravel.openExplorer", (uri) =>
      openExplorer(context.extensionUri, uri)
    ),
    vscode.commands.registerCommand("ravel.openGenerated", openGeneratedAt),
    vscode.commands.registerCommand("ravel.nextGeneratedOccurrence", () =>
      adjacentGeneratedOccurrence(1)
    ),
    vscode.commands.registerCommand("ravel.previousGeneratedOccurrence", () =>
      adjacentGeneratedOccurrence(-1)
    ),
    vscode.commands.registerCommand("ravel.returnToSource", returnGeneratedToSource),
    vscode.commands.registerCommand("ravel.selectTarget", selectTarget),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      void editorSelectionChanged(event);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme === "pieceful-virtual") {
        if (vscode.window.activeTextEditor?.document === event.document) {
          void refreshActiveGeneratedPresentation(vscode.window.activeTextEditor);
        }
        return;
      }
      scheduleProjectRefresh(event.document);
    }),
    vscode.workspace.onDidOpenTextDocument(scheduleProjectOpen),
    vscode.workspace.onDidSaveTextDocument(scheduleProjectRefresh),
    vscode.workspace.onDidCloseTextDocument(scheduleProjectRefresh),
    vscode.languages.registerDefinitionProvider({ scheme: "file" }, {
      provideDefinition: definitionAt
    }),
    vscode.languages.registerHoverProvider({ scheme: "file" }, {
      provideHover: hoverAt
    }),
    vscode.languages.registerReferenceProvider({ scheme: "file" }, {
      provideReferences: referencesAt
    }),
    vscode.languages.registerCompletionItemProvider({ scheme: "file" }, {
      provideCompletionItems: referenceCompletionAt
    }, '"'),
    vscode.languages.registerCompletionItemProvider({ scheme: "file" }, {
      provideCompletionItems: nativeCompletionAt,
      resolveCompletionItem: resolveNativeCompletion
    }, ".", "\"", "'", "/", "@", "<", "#", " "),
    vscode.languages.registerHoverProvider({ scheme: "file" }, {
      provideHover: nativeHoverAt
    }),
    vscode.languages.registerSignatureHelpProvider({ scheme: "file" }, {
      provideSignatureHelp: nativeSignatureHelpAt
    }, "(", ",", "<"),
    vscode.languages.registerDefinitionProvider({ scheme: "file" }, {
      provideDefinition: (document, position, token) =>
        nativeLocationsAt("definition", document, position, token)
    }),
    vscode.languages.registerTypeDefinitionProvider({ scheme: "file" }, {
      provideTypeDefinition: (document, position, token) =>
        nativeLocationsAt("typeDefinition", document, position, token)
    }),
    vscode.languages.registerReferenceProvider({ scheme: "file" }, {
      provideReferences: (document, position, _context, token) =>
        nativeLocationsAt("references", document, position, token)
    }),
    vscode.languages.registerRenameProvider({ scheme: "file" }, {
      prepareRename: nativePrepareRenameAt,
      provideRenameEdits: nativeRenameAt
    }),
    vscode.languages.registerCallHierarchyProvider({ scheme: "file" }, {
      prepareCallHierarchy: prepareNativeCallHierarchy,
      provideCallHierarchyIncomingCalls: (item, token) =>
        callRequest("incomingCalls", item, token),
      provideCallHierarchyOutgoingCalls: (item, token) =>
        callRequest("outgoingCalls", item, token)
    }),
    vscode.languages.registerDocumentSymbolProvider({ scheme: "file" }, {
      provideDocumentSymbols: documentSymbols
    }),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, {
      provideCodeLenses: generatedCodeLenses
    })
  );
};

export const deactivate = () => {
  clearTimeout(refreshTimer);
  clearTimeout(generatedPresentationTimer);
  refreshController?.abort(new Error("The Ravel extension was deactivated."));
  interactiveRefreshController?.abort(new Error("The Ravel extension was deactivated."));
  refreshController = undefined;
  interactiveRefreshController = undefined;
  interactiveRefreshPromise = undefined;
  resetLanguageRouter();
  projectionService?.dispose();
  projectionService = undefined;
  projectionProjectKey = undefined;
  generatedProvider?.dispose();
  generatedProvider = undefined;
  generatedRegistry?.clear();
  generatedRegistry = undefined;
  generatedStatus = undefined;
  generatedDecorations = undefined;
  generatedPresentationTimer = undefined;
  generatedSynchronizationGeneration += 1;
  targetSelectionStore = undefined;
  extensionWorkspaceState = undefined;
  projectRefreshPending = false;
  diagnosticCollection?.dispose();
  diagnosticCollection = undefined;
  targetDiagnosticCollection?.dispose();
  targetDiagnosticCollection = undefined;
};
