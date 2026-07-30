import {
  collapseExplorerGroups
} from "../../packages/explorer/src/index.js";
import {
  createExplorerView,
  explorerLayoutOptions
} from "../../packages/explorer/src/browser.js";
import snapshot from "../generated/explorer-snapshot.json";
import entityDetails from "../generated/explorer-details.json";

const byId = (id) => document.querySelector("#" + id);
const root = byId("explorer");
const details = byId("details");
const status = byId("status");
const lensControl = byId("lens");
const searchControl = byId("search");
const upstreamButton = byId("upstream");
const downstreamButton = byId("downstream");
const foldButton = byId("fold");

const baseSnapshot = snapshot;
const allNodes = new Map(baseSnapshot.nodes.map((node) => [node.id, node]));
const allEdges = new Map(baseSnapshot.edges.map((edge) => [edge.id, edge]));
const documentGroups = new Map(
  baseSnapshot.groups.map((group) => [group.id.slice("group:".length), group.id])
);
const collapsedGroups = new Set();
let currentLens = "dependencies";
let focusedIds = null;
let selectedId = null;
let view;

const lensKinds = {
  overview: new Set(["document", "deliverable"]),
  dependencies: new Set(["document", "chunk", "deliverable"]),
  derivation: null
};

const sourceText = (source) => {
  if (!source?.uri) return "generated";
  if (!source.range) return source.uri;
  const { start, end } = source.range;
  const startText = `${start.line + 1}:${start.column + 1}`;
  const endText = `${end.line + 1}:${end.column + 1}`;
  return `${source.uri}:${startText}–${endText}`;
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const withAncestors = (ids) => {
  const result = new Set(ids);
  for (const id of [...result]) {
    let parent = allNodes.get(id)?.parent;
    while (parent) {
      result.add(parent);
      parent = allNodes.get(parent)?.parent;
    }
  }
  return result;
};

const filterSnapshot = (sourceSnapshot, ids) => {
  const included = withAncestors(ids);
  const nodes = sourceSnapshot.nodes.filter((node) => included.has(node.id));
  const visible = new Set(nodes.map((node) => node.id));
  const edges = sourceSnapshot.edges.filter((edge) =>
    visible.has(edge.source) && visible.has(edge.target)
  );
  return {
    ...sourceSnapshot,
    nodes,
    edges,
    counts: {
      ...sourceSnapshot.counts,
      visibleNodes: nodes.length,
      visibleEdges: edges.length
    }
  };
};

const applyLens = (sourceSnapshot, lens) => {
  if (lens === "derivation") return sourceSnapshot;
  const kinds = lensKinds[lens];
  const ids = sourceSnapshot.nodes
    .filter((node) => kinds.has(node.kind))
    .map((node) => node.id);
  const filtered = filterSnapshot(sourceSnapshot, ids);
  return {
    ...filtered,
    edges: filtered.edges.map(({ label: _label, ...edge }) => edge)
  };
};

const projectedSnapshot = () => {
  const forcedCollapsed = currentLens === "overview"
    ? new Set(baseSnapshot.groups.map((group) => group.id))
    : collapsedGroups;
  let next = collapseExplorerGroups(baseSnapshot, [...forcedCollapsed]);
  next = applyLens(next, currentLens);
  if (focusedIds) next = filterSnapshot(next, focusedIds);
  return { ...next, lens: currentLens };
};

const relationshipRows = (entity) => {
  if (!entity || !allNodes.has(entity.id)) return [];
  return baseSnapshot.edges
    .filter((edge) => edge.kind !== "contains" &&
      (edge.source === entity.id || edge.target === entity.id))
    .map((edge) => {
      const incoming = edge.target === entity.id;
      const neighborId = incoming ? edge.source : edge.target;
      const neighbor = allNodes.get(neighborId);
      return {
        direction: incoming ? "from" : "to",
        edge,
        neighbor
      };
    })
    .filter(({ neighbor }) => neighbor)
    .sort((left, right) =>
      left.direction.localeCompare(right.direction) ||
      left.edge.kind.localeCompare(right.edge.kind) ||
      left.neighbor.label.localeCompare(right.neighbor.label)
    );
};

const showDetails = (entity) => {
  if (!entity) {
    details.innerHTML = `
      <p class="eyebrow">${escapeHtml(baseSnapshot.project.label)}</p>
      <h1>Select a graph entity</h1>
      <p class="empty">Click a node or edge to inspect its source location and relationships.
      Double-click a document to collapse or expand it.</p>`;
    upstreamButton.disabled = true;
    downstreamButton.disabled = true;
    foldButton.disabled = true;
    selectedId = null;
    return;
  }

  selectedId = entity.id;
  const isNode = allNodes.has(entity.id);
  const node = isNode ? allNodes.get(entity.id) : null;
  const edge = isNode ? null : allEdges.get(entity.id) ?? entity;
  const source = node?.source ?? edge?.authoredAt;
  const states = node?.state ?? [];
  const badges = [
    node?.kind ?? edge?.kind,
    node?.language,
    ...(node?.tags ?? []),
    ...states
  ].filter(Boolean);
  const relationships = node ? relationshipRows(node) : [];
  const data = node?.data ?? {
    source: edge?.source,
    target: edge?.target,
    phase: edge?.phase,
    occurrence: edge?.occurrence,
    count: edge?.count,
    members: edge?.members
  };
  const counts = node?.counts
    ? Object.entries(node.counts)
      .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("")
    : "";
  const content = entityDetails[entity.id];
  const textPreview = (heading, preview) => preview ? `
    <h2>${escapeHtml(heading)}</h2>
    <pre><code>${escapeHtml(preview.text)}${preview.truncated
      ? `\n\n… ${preview.length - preview.text.length} more characters`
      : ""}</code></pre>` : "";

  details.innerHTML = `
    <p class="eyebrow">${escapeHtml(node?.kind ?? "edge · " + edge?.kind)}</p>
    <h1>${escapeHtml(node?.label ?? edge?.label ?? edge?.kind ?? entity.id)}</h1>
    <div class="badge-row">
      ${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    <p class="source">${escapeHtml(sourceText(source))}</p>
    <h2>Identity</h2>
    <dl class="detail-grid">
      <dt>ID</dt><dd>${escapeHtml(entity.id)}</dd>
      ${counts}
    </dl>
    ${textPreview("Authored chunk · before Ravel", content?.authored)}
    ${textPreview(
      content?.kind === "deliverable" ? "Generated output" : "Evaluated value",
      content?.evaluated
    )}
    ${relationships.length ? `
      <h2>Relationships</h2>
      <div class="relation-list">
        ${relationships.map(({ direction, edge: relation, neighbor }) => `
          <button class="relation" type="button" data-select="${escapeHtml(neighbor.id)}">
            <span class="edge-kind">${escapeHtml(direction + " " + relation.kind)}</span>
            <span class="relation-label">${escapeHtml(neighbor.label)}</span>
          </button>`).join("")}
      </div>` : ""}
    <h2>Data</h2>
    <pre><code>${escapeHtml(JSON.stringify(data, null, 2))}</code></pre>`;

  upstreamButton.disabled = !node;
  downstreamButton.disabled = !node;
  const documentGroup = node?.kind === "document" ? documentGroups.get(node.id) : null;
  foldButton.disabled = !documentGroup || currentLens === "overview";
  foldButton.textContent = documentGroup && collapsedGroups.has(documentGroup)
    ? "Expand"
    : "Collapse";
};

const updateStatus = (message) => {
  const visible = view?.snapshot?.counts;
  const summary = visible
    ? `${visible.visibleNodes} nodes · ${visible.visibleEdges} edges`
    : "";
  status.textContent = message ? `${message} · ${summary}` : summary;
  byId("project-label").textContent =
    `${baseSnapshot.project.label} · ${summary}` + (message ? ` · ${message}` : "");
};

const updateView = async ({ keepSelection = true, message = "" } = {}) => {
  const priorSelection = keepSelection ? selectedId : null;
  await view.update(projectedSnapshot());
  if (priorSelection) {
    const selected = view.select(priorSelection);
    if (selected) showDetails(allNodes.get(priorSelection) ?? allEdges.get(priorSelection) ?? selected);
  }
  updateStatus(message);
};

const semanticEdges = baseSnapshot.edges.filter((edge) => edge.kind !== "contains");

const connectedIds = (start, direction) => {
  const found = new Set([start]);
  const frontier = [start];
  while (frontier.length) {
    const current = frontier.shift();
    for (const edge of semanticEdges) {
      const next = direction === "upstream" && edge.target === current
        ? edge.source
        : direction === "downstream" && edge.source === current
          ? edge.target
          : null;
      if (!next || found.has(next)) continue;
      found.add(next);
      frontier.push(next);
    }
  }
  return found;
};

const focusDirection = async (direction) => {
  if (!selectedId || !allNodes.has(selectedId)) return;
  focusedIds = connectedIds(selectedId, direction);
  await updateView({ message: `${direction} of ${allNodes.get(selectedId).label}` });
  view.fit();
};

const toggleDocument = async (documentId) => {
  const groupId = documentGroups.get(documentId);
  if (!groupId || currentLens === "overview") return;
  if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId);
  else collapsedGroups.add(groupId);
  await updateView({
    message: `${allNodes.get(documentId)?.label ?? documentId} ` +
      (collapsedGroups.has(groupId) ? "collapsed" : "expanded")
  });
  view.fit();
};

const searchableText = (node) => [
  node.id,
  node.label,
  node.kind,
  node.language,
  node.source?.uri,
  ...(node.tags ?? []),
  ...(node.state ?? []),
  JSON.stringify(node.data ?? {})
].filter(Boolean).join(" ").toLocaleLowerCase();

const findNodes = (query) => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return baseSnapshot.nodes.filter((node) => {
    const text = searchableText(node);
    return terms.every((term) => text.includes(term));
  });
};

const selectEntity = async (id) => {
  const entity = allNodes.get(id) ?? allEdges.get(id);
  if (!entity) return;
  const parentGroup = entity.parent ? documentGroups.get(entity.parent) : null;
  if (parentGroup) collapsedGroups.delete(parentGroup);
  if (currentLens !== "derivation" &&
      entity.kind &&
      !lensKinds[currentLens]?.has(entity.kind)) {
    currentLens = "derivation";
    lensControl.value = currentLens;
  }
  focusedIds = null;
  await updateView({ keepSelection: false });
  const selected = view.select(id);
  if (selected) {
    showDetails(entity);
    updateStatus(`Selected ${entity.label ?? entity.kind}`);
  }
};

byId("project-label").textContent = baseSnapshot.project.label;

try {
  view = createExplorerView(root, projectedSnapshot(), {
    onSelect(entity) {
      showDetails(allNodes.get(entity.id) ?? allEdges.get(entity.id) ?? entity);
      updateStatus(`Selected ${entity.label ?? entity.kind}`);
    }
  });
  await view.ready;

  view.cy.on("dbltap", "node.kind-document", (event) => {
    void toggleDocument(event.target.id());
  });

  details.addEventListener("click", (event) => {
    const target = event.target.closest("[data-select]");
    if (target) void selectEntity(target.dataset.select);
  });

  lensControl.addEventListener("change", () => {
    currentLens = lensControl.value;
    focusedIds = null;
    void updateView({ message: `${lensControl.selectedOptions[0].text} lens` }).then(() => view.fit());
  });

  searchControl.addEventListener("input", () => {
    const matches = findNodes(searchControl.value);
    view.cy.nodes().removeClass("search-match");
    for (const match of matches) view.cy.getElementById(match.id).addClass("search-match");
    updateStatus(searchControl.value ? `${matches.length} search matches` : "");
  });

  searchControl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const [first] = findNodes(searchControl.value);
    if (first) void selectEntity(first.id);
  });

  byId("zoom-in").addEventListener("click", () => {
    view.cy.zoom({
      level: Math.min(view.cy.maxZoom(), view.cy.zoom() * 1.25),
      renderedPosition: { x: root.clientWidth / 2, y: root.clientHeight / 2 }
    });
  });
  byId("zoom-out").addEventListener("click", () => {
    view.cy.zoom({
      level: Math.max(view.cy.minZoom(), view.cy.zoom() / 1.25),
      renderedPosition: { x: root.clientWidth / 2, y: root.clientHeight / 2 }
    });
  });
  byId("fit").addEventListener("click", () => view.fit());
  byId("layout").addEventListener("click", async () => {
    updateStatus("Laying out");
    await new Promise((resolve) => {
      view.cy.one("layoutstop", resolve);
      view.cy.layout(explorerLayoutOptions).run();
    });
    updateStatus("Layout reset");
  });
  byId("reset").addEventListener("click", async () => {
    currentLens = "dependencies";
    lensControl.value = currentLens;
    focusedIds = null;
    collapsedGroups.clear();
    searchControl.value = "";
    showDetails(null);
    await updateView({ keepSelection: false, message: "View reset" });
    view.fit();
  });
  upstreamButton.addEventListener("click", () => void focusDirection("upstream"));
  downstreamButton.addEventListener("click", () => void focusDirection("downstream"));
  foldButton.addEventListener("click", () => {
    if (selectedId) void toggleDocument(selectedId);
  });

  const positioned = view.cy.nodes().every((node) => {
    const position = node.position();
    return Number.isFinite(position.x) && Number.isFinite(position.y);
  });
  const fixtureIsReal =
    baseSnapshot.project.id === "fizzbuzz" &&
    baseSnapshot.counts.visibleNodes >= 30 &&
    baseSnapshot.nodes.some(({ id }) => id === "chunk:fizzbuzz::program:main.js");
  document.body.dataset.ravelExplorerTest =
    positioned && fixtureIsReal ? "passed" : "failed";
  updateStatus("Ready");
} catch (error) {
  document.body.dataset.ravelExplorerTest = "failed";
  status.textContent = error.message;
  throw error;
}
