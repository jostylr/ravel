import {
  createExplorerView,
  explorerLayoutOptions
} from "@pieceful/ravel-explorer/browser";

const vscode = acquireVsCodeApi();
const byId = (id) => document.getElementById(id);
const graph = byId("graph");
const detailsPanel = byId("details");
const lens = byId("lens");
const orientation = byId("orientation");
const search = byId("search");
const status = byId("status");
const previewBadge = byId("preview");

let snapshot;
let view;
let selected;
let preview = false;
let snapshotDiff;
let requestSequence = 0;

const nextRequest = () => `webview-${++requestSequence}`;
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const sourceText = (source) => {
  if (!source?.uri) return "generated";
  if (!source.range) return source.uri;
  const { start, end } = source.range;
  return `${source.uri}:${start.line + 1}:${start.column + 1}–` +
    `${end.line + 1}:${end.column + 1}`;
};

const filterSnapshot = (base, currentLens) => {
  if (currentLens === "derivation") return { ...base, lens: currentLens };
  const allowed = currentLens === "overview"
    ? new Set(["document", "deliverable"])
    : new Set(["document", "chunk", "deliverable"]);
  const nodes = base.nodes.filter((node) => allowed.has(node.kind));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = base.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map(({ label: _label, ...edge }) => edge);
  return {
    ...base,
    lens: currentLens,
    nodes,
    edges,
    counts: {
      ...base.counts,
      visibleNodes: nodes.length,
      visibleEdges: edges.length
    }
  };
};

const layoutOptions = () => ({
  ...explorerLayoutOptions,
  elk: {
    ...explorerLayoutOptions.elk,
    "elk.direction": orientation.value
  }
});

const textPreview = (heading, preview) => preview ? `
  <h2>${escapeHtml(heading)}</h2>
  <pre><code>${escapeHtml(preview.text)}${preview.truncated
    ? `\n\n… ${preview.length - preview.text.length} more characters`
    : ""}</code></pre>` : "";

const renderDetails = (entity, content, revealed) => {
  selected = entity;
  const source = entity?.source ?? entity?.authoredAt;
  detailsPanel.innerHTML = `
    <p class="eyebrow">${escapeHtml(entity.kind)}</p>
    <h1>${escapeHtml(entity.label ?? entity.kind)}</h1>
    <p class="source">${escapeHtml(sourceText(source))}</p>
    ${source ? `<button type="button" data-reveal>Reveal source</button>` : ""}
    ${textPreview("Authored chunk · before Ravel", content?.authored)}
    ${textPreview(
      content?.kind === "deliverable" ? "Generated output" : "Evaluated value",
      content?.evaluated
    )}
    <h2>Identity</h2>
    <pre><code>${escapeHtml(entity.id)}</code></pre>
    ${revealed === false ? "<p>Source is outside the current project.</p>" : ""}`;
};

const requestSelection = (entity) => {
  selected = entity;
  status.textContent = `Loading ${entity.label ?? entity.kind}…`;
  vscode.postMessage({
    version: 1,
    type: "entity/select",
    requestId: nextRequest(),
    revision: snapshot.revision,
    entityId: entity.id
  });
};

const render = async () => {
  const projected = filterSnapshot(snapshot, lens.value);
  if (!view) {
    view = createExplorerView(graph, projected, {
      onSelect: requestSelection,
      layout: layoutOptions()
    });
    await view.ready;
  } else {
    await view.update(projected, { layout: layoutOptions() });
  }
  const counts =
    `${projected.counts.visibleNodes} nodes · ${projected.counts.visibleEdges} edges`;
  if (preview && snapshotDiff) {
    const nodeChanges = snapshotDiff.nodes.added.length +
      snapshotDiff.nodes.removed.length +
      snapshotDiff.nodes.changed.length;
    const edgeChanges = snapshotDiff.edges.added.length +
      snapshotDiff.edges.removed.length +
      snapshotDiff.edges.changed.length;
    status.textContent = `${counts} · ${nodeChanges} node changes · ${edgeChanges} edge changes`;
  } else {
    status.textContent = counts;
  }
};

window.addEventListener("message", async ({ data: message }) => {
  if (message?.version !== 1 || typeof message.type !== "string") return;
  if (message.type === "view/result") {
    snapshot = message.snapshot;
    preview = message.preview === true;
    snapshotDiff = message.diff;
    previewBadge.hidden = !preview;
    previewBadge.textContent = "Preview";
    await render();
    return;
  }
  if (message.type === "selection/changed") {
    const visible = filterSnapshot(snapshot, lens.value).nodes
      .some(({ id }) => id === message.entity.id);
    if (!visible) {
      lens.value = "derivation";
      await render();
    }
    view.select(message.entity.id);
    renderDetails(message.entity, message.details, message.revealed);
    const label = message.entity.label ?? message.entity.kind;
    status.textContent = message.origin === "editor"
      ? `Focused ${label} from editor`
      : message.origin === "reveal-button"
        ? `Source editor focused for ${label}`
        : message.revealed
          ? `Source highlighted for ${label}`
          : `Selected ${label}`;
    return;
  }
  if (message.type === "request/error") {
    status.textContent = message.message;
    detailsPanel.innerHTML = `<h1>Explorer error</h1><p>${escapeHtml(message.message)}</p>`;
  }
  if (message.type === "document/changed" && message.ok === false) {
    previewBadge.hidden = false;
    previewBadge.textContent = "Preview unavailable";
    status.textContent = message.message;
  }
});

lens.addEventListener("change", () => {
  if (snapshot) void render();
});

orientation.addEventListener("change", () => {
  if (snapshot) void render();
});

search.addEventListener("input", () => {
  if (!view) return;
  const query = search.value.trim().toLowerCase();
  view.cy.nodes().removeClass("search-match");
  if (!query) return;
  for (const node of snapshot.nodes) {
    const text = [
      node.id,
      node.label,
      node.kind,
      node.language,
      node.source?.uri,
      ...(node.tags ?? [])
    ].filter(Boolean).join(" ").toLowerCase();
    if (text.includes(query)) view.cy.getElementById(node.id).addClass("search-match");
  }
});

search.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !snapshot) return;
  const query = search.value.trim().toLowerCase();
  const match = snapshot.nodes.find((node) =>
    [node.id, node.label, node.kind, node.language, node.source?.uri]
      .filter(Boolean).join(" ").toLowerCase().includes(query)
  );
  if (match) {
    if (!filterSnapshot(snapshot, lens.value).nodes.some(({ id }) => id === match.id)) {
      lens.value = "derivation";
      void render().then(() => {
        view.select(match.id);
        requestSelection(match);
      });
    } else {
      view.select(match.id);
      requestSelection(match);
    }
  }
});

byId("fit").addEventListener("click", () => view?.fit());
detailsPanel.addEventListener("click", (event) => {
  if (!event.target.closest("[data-reveal]") || !selected) return;
  vscode.postMessage({
    version: 1,
    type: "source/reveal",
    requestId: nextRequest(),
    revision: snapshot.revision,
    entityId: selected.id
  });
});

vscode.postMessage({
  version: 1,
  type: "view/request",
  requestId: nextRequest()
});
