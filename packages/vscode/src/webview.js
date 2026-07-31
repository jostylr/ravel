import {
  createExplorerView,
  explorerLayoutOptions
} from "@pieceful/ravel-explorer/browser";
import { diffText } from "./text-diff.js";
import {
  createNavigationHistory,
  sameNavigation
} from "./navigation-history.js";

const vscode = acquireVsCodeApi();
const byId = (id) => document.getElementById(id);
const graph = byId("graph");
const detailsPanel = byId("details");
const lens = byId("lens");
const orientation = byId("orientation");
const search = byId("search");
const status = byId("status");
const previewBadge = byId("preview");
const changesLens = byId("changes-lens");
const changeLegend = byId("change-legend");
const backButton = byId("back");

let snapshot;
let changeSnapshot;
let view;
let selected;
let preview = false;
let snapshotDiff;
let requestSequence = 0;
let latestOutputRequest;
let currentGeneratedOffset;
let restoringNavigation = false;
const navigationHistory = createNavigationHistory(100);

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

const navigationEntry = () => selected ? {
  entityId: selected.id,
  generatedOffset: currentGeneratedOffset,
  lens: lens.value
} : null;

const updateBackButton = () => {
  backButton.disabled = navigationHistory.length === 0;
  backButton.title = navigationHistory.length
    ? `Return to ${navigationHistory.peek().entityId}`
    : "No previous Explorer selection";
};

const rememberNavigation = () => {
  const current = navigationEntry();
  if (navigationHistory.push(current)) updateBackButton();
};

const filterSnapshot = (base, currentLens) => {
  if (currentLens === "changes" && changeSnapshot) return changeSnapshot;
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
  ${previewCode(preview)}` : "";

const previewCode = (value) => `<pre><code>${escapeHtml(value.text)}${value.truncated
    ? `\n\n… ${value.length - value.text.length} more characters`
    : ""}</code></pre>`;

const samePreview = (before, current) =>
  before?.text === current?.text &&
  before?.length === current?.length &&
  before?.truncated === current?.truncated;

const diffCode = (value, parts, side) => {
  const visible = parts
    .filter(({ type }) => type === "equal" ||
      (side === "saved" ? type === "removed" : type === "added"))
    .map(({ type, text }) => type === "equal"
      ? escapeHtml(text)
      : `<span class="diff-${type}">${escapeHtml(text)}</span>`)
    .join("");
  const remainder = value.truncated
    ? `\n\n… ${value.length - value.text.length} more characters`
    : "";
  return `<pre class="diff"><code>${visible}${escapeHtml(remainder)}</code></pre>`;
};

const comparisonPreview = (heading, before, current) => {
  if (!before) {
    if (!preview || !current) return textPreview(heading, current);
    return `
      <h2>${escapeHtml(heading)}</h2>
      <div class="comparison single added-copy">
        <section><h3>Candidate · added</h3>${diffCode(
          current,
          [{ type: "added", text: current.text }],
          "candidate"
        )}</section>
      </div>`;
  }
  if (!current) return `
    <h2>${escapeHtml(heading)}</h2>
    <div class="comparison single removed-copy">
      <section><h3>Saved · removed</h3>${diffCode(
        before,
        [{ type: "removed", text: before.text }],
        "saved"
      )}</section>
    </div>`;
  if (samePreview(before, current)) return textPreview(heading, current);
  const parts = diffText(before.text, current.text);
  return `
    <h2>${escapeHtml(heading)}</h2>
    <div class="comparison">
      <section><h3>Saved</h3>${diffCode(before, parts, "saved")}</section>
      <section><h3>Candidate</h3>${diffCode(current, parts, "candidate")}</section>
    </div>`;
};

const requestOutput = (entityId, generatedOffset) => {
  const requestId = nextRequest();
  latestOutputRequest = requestId;
  vscode.postMessage({
    version: 1,
    type: "output/request",
    requestId,
    revision: snapshot.revision,
    entityId,
    ...(Number.isInteger(generatedOffset) ? { generatedOffset } : {})
  });
};

const mappedOutput = (output) => {
  const selectedOffset = output.explanation?.generatedOffset;
  const segments = [...output.segments].sort((left, right) =>
    left.generated.start - right.generated.start || left.generated.end - right.generated.end
  );
  let cursor = 0;
  const fragments = [];
  for (const segment of segments) {
    const start = Math.max(cursor, segment.generated.start);
    const end = Math.max(start, segment.generated.end);
    if (start > cursor) fragments.push(escapeHtml(output.value.text.slice(cursor, start)));
    if (end > start) {
      const active = Number.isInteger(selectedOffset) &&
        selectedOffset >= start && selectedOffset < end;
      fragments.push(
        `<span class="provenance-segment ${escapeHtml(segment.precision)}${
          active ? " selected" : ""
        }" role="button" tabindex="0" aria-pressed="${active}" ` +
        `data-generated-start="${start}" data-generated-end="${end}" ` +
        `title="${escapeHtml(segment.precision)} · ${escapeHtml(segment.chunk)} · ${
          escapeHtml(segment.kind)
        }">${escapeHtml(output.value.text.slice(start, end))}</span>`
      );
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < output.value.text.length) {
    fragments.push(escapeHtml(output.value.text.slice(cursor)));
  }
  return fragments.join("");
};

const pathHtml = (path) => path.length ? `
  <ol class="dependency-path">
    ${path.map((id) => `<li><button type="button" data-focus-entity="chunk:${
      escapeHtml(id)
    }">${escapeHtml(id)}</button></li>`).join("")}
  </ol>` : "<p>No dependency path was retained.</p>";

const stepLabel = (step) => [
  step.kind,
  step.name,
  step.from && step.to ? `${step.from} → ${step.to}` : undefined
].filter(Boolean).join(" · ");

const explanationHtml = (explanation) => {
  if (!explanation) return "<p>No source mapping covers this generated position.</p>";
  const { segment } = explanation;
  const source = segment.source
    ? sourceText(segment.source) + (Number.isInteger(segment.sourceOffset)
      ? ` · exact source offset ${segment.sourceOffset}`
      : "")
    : "No direct source range";
  return `
    <div class="provenance-heading">
      <span class="precision-badge ${escapeHtml(segment.precision)}">${
        escapeHtml(segment.precision)
      }</span>
      <strong>${escapeHtml(segment.chunk)}</strong>
      <span>${escapeHtml(segment.kind)}</span>
    </div>
    <p class="provenance-note">${segment.precision === "exact"
      ? "Exact mapping: this generated character corresponds directly to source text."
      : "Coarse attribution: a transform or composition step changed character correspondence."
    }</p>
    <dl class="provenance-facts">
      <div><dt>Generated</dt><dd>${segment.generated.start}–${segment.generated.end} · selected ${
        explanation.generatedOffset
      }</dd></div>
      <div><dt>Source</dt><dd>${escapeHtml(source)}</dd></div>
    </dl>
    ${segment.source ? `<button type="button" data-reveal-generated="${
      explanation.generatedOffset
    }">${segment.precision === "exact" ? "Reveal exact source character" : "Reveal attributed source"}</button>` : ""}
    ${explanation.definition ? `<button type="button" data-focus-entity="chunk:${
      escapeHtml(explanation.definition.id)
    }">Reveal defining chunk</button>` : ""}
    <h3>Dependency path</h3>
    ${pathHtml(explanation.dependencyPath)}
    <h3>Derivation steps</h3>
    ${(segment.via?.length ?? 0) ? `<ol class="derivation-steps">${segment.via.map((step) =>
      `<li>${escapeHtml(stepLabel(step))}</li>`
    ).join("")}</ol>` : "<p>Literal source text; no intermediate step.</p>"}
    ${(segment.origins?.length ?? 0) ? `
      <h3>Retained transform origins</h3>
      <ul class="derivation-steps">${segment.origins.map((origin) =>
        `<li>${escapeHtml(origin.chunk)} · ${escapeHtml(sourceText(origin.source))}</li>`
      ).join("")}</ul>` : ""}
    ${explanation.truncated ? "<p>Long derivation details were truncated by the host.</p>" : ""}`;
};

const renderProvenanceOutput = (output) => {
  const container = detailsPanel.querySelector("[data-provenance-output]");
  if (!container || selected?.id !== output.entityId) return;
  const visibleSegments = output.segments.length;
  container.innerHTML = `
    <div class="provenance-title">
      <h2>Generated provenance${output.basis === "saved" ? " · saved" : ""}</h2>
      <span>${output.language ? `${escapeHtml(output.language)} · ` : ""}${
        visibleSegments
      } of ${output.availableSegments} mapped segments</span>
    </div>
    <p class="provenance-help">Click generated text to explain where it came from.
      <span class="precision-key exact">Exact</span>
      <span class="precision-key coarse">Coarse</span>
    </p>
    <pre class="mapped-output"><code>${mappedOutput(output)}</code></pre>
    ${output.value.truncated
      ? `<p>Showing the first ${output.value.text.length} of ${output.value.length} characters.</p>`
      : ""}
    ${output.truncatedSegments ? "<p>Additional provenance segments were not transported.</p>" : ""}
    <section class="provenance-explanation" aria-live="polite">
      ${explanationHtml(output.explanation)}
    </section>`;
};

const generatedMatchesHtml = (result) => {
  if (!result) return "";
  const count = result.availableMatches;
  if (!count) return `
    <section class="generated-matches">
      <h2>Generated occurrences</h2>
      <p>No generated output corresponds to the current source selection.</p>
    </section>`;
  return `
    <section class="generated-matches">
      <div class="provenance-title">
        <h2>Generated occurrences</h2>
        <span>${result.matches.length} of ${count} matches</span>
      </div>
      <p class="provenance-help">Select an occurrence to open its deliverable provenance.</p>
      <ul>${result.matches.map((match) => `
        <li>
          <button type="button" data-generated-entity="${escapeHtml(match.entityId)}"
            data-generated-offset="${match.generatedOffset ?? match.generated.start}">
            <span class="precision-badge ${escapeHtml(match.precision)}">${
              escapeHtml(match.precision)
            }</span>
            <strong>${escapeHtml(match.name)}</strong>
            <span>${match.generated.start}–${match.generated.end}</span>
            <small>${escapeHtml(match.chunk)} · ${escapeHtml(match.kind)}</small>
          </button>
        </li>`).join("")}</ul>
      ${result.truncated ? "<p>Additional generated matches were not transported.</p>" : ""}
    </section>`;
};

const renderDetails = (
  entity,
  content,
  revealed,
  beforeContent,
  generatedOffset,
  generatedMatches
) => {
  selected = entity;
  const source = entity?.source ?? entity?.authoredAt;
  const changeStates = (entity.state ?? [])
    .filter((state) => ["added", "changed", "removed"].includes(state));
  const kind = content?.kind ?? beforeContent?.kind;
  detailsPanel.innerHTML = `
    <p class="eyebrow">${escapeHtml(entity.kind)}</p>
    <h1>${escapeHtml(entity.label ?? entity.kind)}</h1>
    ${changeStates.map((state) =>
      `<span class="change-state ${escapeHtml(state)}">${escapeHtml(state)}</span>`
    ).join("")}
    <p class="source">${escapeHtml(sourceText(source))}</p>
    ${source ? `<button type="button" data-reveal>Reveal source</button>` : ""}
    ${comparisonPreview(
      "Authored chunk · before Ravel",
      beforeContent?.authored,
      content?.authored
    )}
    ${kind === "deliverable" && !preview ? "" : comparisonPreview(
      kind === "deliverable" ? "Generated output" : "Evaluated value",
      beforeContent?.evaluated,
      content?.evaluated
    )}
    ${kind === "deliverable"
      ? `<section data-provenance-output><p>Loading generated provenance…</p></section>`
      : ""}
    ${generatedMatchesHtml(generatedMatches)}
    <h2>Identity</h2>
    <pre><code>${escapeHtml(entity.id)}</code></pre>
    ${revealed === false ? "<p>Source is outside the current project.</p>" : ""}`;
  if (kind === "deliverable") requestOutput(entity.id, generatedOffset);
  else latestOutputRequest = undefined;
};

const requestSelection = (entity, generatedOffset) => {
  status.textContent = `Loading ${entity.label ?? entity.kind}…`;
  vscode.postMessage({
    version: 1,
    type: "entity/select",
    requestId: nextRequest(),
    revision: snapshot.revision,
    entityId: entity.id,
    ...(Number.isInteger(generatedOffset) ? { generatedOffset } : {})
  });
};

const containsEntity = (projected, id) =>
  projected.nodes.some((entity) => entity.id === id) ||
  projected.edges.some((entity) => entity.id === id);

const entityById = (id) =>
  (changeSnapshot ?? snapshot).nodes.find((entity) => entity.id === id) ??
  snapshot.nodes.find((entity) => entity.id === id) ??
  (changeSnapshot ?? snapshot).edges.find((entity) => entity.id === id) ??
  snapshot.edges.find((entity) => entity.id === id);

const render = async () => {
  const projected = filterSnapshot(snapshot, lens.value);
  changeLegend.hidden = lens.value !== "changes";
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
    changeSnapshot = message.changeSnapshot;
    preview = message.preview === true;
    snapshotDiff = message.diff;
    changesLens.disabled = !preview;
    if (!preview && lens.value === "changes") lens.value = "dependencies";
    previewBadge.hidden = !preview;
    previewBadge.textContent = "Preview · Changes available";
    await render();
    return;
  }
  if (message.type === "selection/changed") {
    const entityChanged = selected?.id !== message.entity.id;
    const nextNavigation = {
      entityId: message.entity.id,
      generatedOffset: message.generatedOffset,
      lens: lens.value
    };
    if (!restoringNavigation && !sameNavigation(navigationEntry(), nextNavigation)) {
      rememberNavigation();
    }
    restoringNavigation = false;
    currentGeneratedOffset = message.generatedOffset;
    const visible = containsEntity(
      filterSnapshot(snapshot, lens.value),
      message.entity.id
    );
    if (!visible) {
      lens.value = "derivation";
      await render();
    }
    if (entityChanged) view.select(message.entity.id);
    renderDetails(
      message.entity,
      message.details,
      message.revealed,
      message.beforeDetails,
      message.generatedOffset,
      message.generatedMatches
    );
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
  if (message.type === "output/result") {
    if (message.requestId !== latestOutputRequest) return;
    currentGeneratedOffset = message.output.explanation?.generatedOffset;
    renderProvenanceOutput(message.output);
    status.textContent = `Mapped ${message.output.availableSegments} provenance segments for ${
      message.output.name
    }`;
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
  for (const node of filterSnapshot(snapshot, lens.value).nodes) {
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
  const candidates = lens.value === "changes" && changeSnapshot
    ? changeSnapshot
    : snapshot;
  const match = candidates.nodes.find((node) =>
    [node.id, node.label, node.kind, node.language, node.source?.uri]
      .filter(Boolean).join(" ").toLowerCase().includes(query)
  );
  if (match) {
    if (!containsEntity(filterSnapshot(snapshot, lens.value), match.id)) {
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
backButton.addEventListener("click", async () => {
  const target = navigationHistory.pop();
  updateBackButton();
  if (!target) return;
  if (target.lens !== lens.value &&
      [...lens.options].some((option) => option.value === target.lens && !option.disabled)) {
    lens.value = target.lens;
    await render();
  }
  if (selected?.id === target.entityId && Number.isInteger(target.generatedOffset)) {
    requestOutput(target.entityId, target.generatedOffset);
    return;
  }
  const entity = entityById(target.entityId);
  if (!entity) {
    status.textContent = "The previous entity is not present in this revision.";
    return;
  }
  restoringNavigation = true;
  requestSelection(entity, target.generatedOffset);
});
detailsPanel.addEventListener("click", (event) => {
  const generatedMatch = event.target.closest("[data-generated-entity]");
  if (generatedMatch) {
    const entity = entityById(generatedMatch.dataset.generatedEntity);
    if (entity) {
      requestSelection(entity, Number(generatedMatch.dataset.generatedOffset));
    }
    return;
  }
  const generated = event.target.closest("[data-generated-start]");
  if (generated && selected) {
    const start = Number(generated.dataset.generatedStart);
    const end = Number(generated.dataset.generatedEnd);
    const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const offsetNode = caret?.offsetNode ?? range?.startContainer;
    const offset = caret?.offset ?? range?.startOffset;
    const localOffset = offsetNode && generated.contains(offsetNode) && Number.isInteger(offset)
      ? offset
      : 0;
    const generatedOffset = Math.min(end - 1, start + localOffset);
    if (generatedOffset !== currentGeneratedOffset) rememberNavigation();
    requestOutput(selected.id, generatedOffset);
    return;
  }
  const focus = event.target.closest("[data-focus-entity]");
  if (focus) {
    const id = focus.dataset.focusEntity;
    const entity = entityById(id);
    if (entity) requestSelection(entity);
    return;
  }
  const generatedSource = event.target.closest("[data-reveal-generated]");
  if (generatedSource && selected) {
    vscode.postMessage({
      version: 1,
      type: "source/reveal",
      requestId: nextRequest(),
      revision: snapshot.revision,
      entityId: selected.id,
      generatedOffset: Number(generatedSource.dataset.revealGenerated)
    });
    return;
  }
  if (event.target.closest("[data-reveal]") && selected) {
    vscode.postMessage({
      version: 1,
      type: "source/reveal",
      requestId: nextRequest(),
      revision: snapshot.revision,
      entityId: selected.id
    });
  }
});

detailsPanel.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const generated = event.target.closest("[data-generated-start]");
  if (!generated || !selected) return;
  event.preventDefault();
  const generatedOffset = Number(generated.dataset.generatedStart);
  if (generatedOffset !== currentGeneratedOffset) rememberNavigation();
  requestOutput(selected.id, generatedOffset);
});

vscode.postMessage({
  version: 1,
  type: "view/request",
  requestId: nextRequest()
});
