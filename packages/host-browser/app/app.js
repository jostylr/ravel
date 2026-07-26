import { basicSetup, EditorView } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { renderMarkdownDocument } from "../src/index.js";
import defaultDocument from "./fizzbuzz.md";
import "./styles.css";

const elements = {
  autoRender: document.querySelector("#auto-render"),
  renderButton: document.querySelector("#render-button"),
  dirtyStatus: document.querySelector("#dirty-status"),
  diagnostics: document.querySelector("#diagnostics"),
  outputTab: document.querySelector("#output-tab"),
  provenanceTab: document.querySelector("#provenance-tab"),
  outputView: document.querySelector("#output-view"),
  provenanceView: document.querySelector("#provenance-view"),
  deliverableSelect: document.querySelector("#deliverable-select"),
  copyButton: document.querySelector("#copy-button"),
  artifactName: document.querySelector("#artifact-name"),
  artifactSize: document.querySelector("#artifact-size"),
  outputCode: document.querySelector("#output-code"),
  provenanceSummary: document.querySelector("#provenance-summary"),
  mappedOutput: document.querySelector("#mapped-output"),
  provenanceLegend: document.querySelector("#provenance-legend"),
  segmentDetail: document.querySelector("#segment-detail"),
  rawMapJson: document.querySelector("#raw-map-json"),
  renderStatus: document.querySelector("#render-status")
};

let currentResult = null;
let currentDeliverable = null;
let selectedSegment = 0;
let autoRenderTimer = null;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#0d1916",
    color: "#e7eee9",
    fontSize: "14px"
  },
  ".cm-content": {
    caretColor: "#f6b854",
    padding: "22px 0 50vh",
    fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", monospace',
    lineHeight: "1.68"
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#f6b854" },
  ".cm-gutters": {
    backgroundColor: "#0d1916",
    color: "#5f7770",
    border: "none",
    paddingLeft: "8px"
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#152823" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#285447 !important" },
  ".cm-line span": { color: "#72ddb7" },
  ".cm-focused": { outline: "none" }
}, { dark: true });

const markDirty = () => {
  elements.dirtyStatus.dataset.state = "dirty";
  elements.dirtyStatus.textContent = "Changes pending";
  elements.renderStatus.textContent = elements.autoRender.checked
    ? "Waiting for a pause in typing…"
    : "Changes are not rendered yet.";
};

const editor = new EditorView({
  doc: defaultDocument,
  parent: document.querySelector("#editor"),
  extensions: [
    basicSetup,
    markdown(),
    editorTheme,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      markDirty();
      window.clearTimeout(autoRenderTimer);
      if (elements.autoRender.checked) {
        autoRenderTimer = window.setTimeout(() => render(), 850);
      }
    })
  ]
});

const formatBytes = (value) => {
  const bytes = new TextEncoder().encode(value).length;
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(bytes / 1000) + " kB";
};

const sourceLabel = (source) => {
  if (!source?.range) return "No direct source range";
  const start = source.range.start;
  const end = source.range.end;
  return `${source.uri}:${start.line + 1}:${start.column + 1}–${end.line + 1}:${end.column + 1}`;
};

const chunkColor = (chunk) => {
  let value = 0;
  for (const character of chunk ?? "") value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value % 8;
};

const jumpToSource = (source) => {
  const start = source?.range?.start?.offset;
  const end = source?.range?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return;
  const length = editor.state.doc.length;
  editor.dispatch({
    selection: { anchor: Math.min(start, length), head: Math.min(Math.max(start, end), length) },
    scrollIntoView: true
  });
  editor.focus();
};

const diagnosticButton = (entry) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagnostic-item";
  const code = document.createElement("span");
  code.className = "diagnostic-code";
  code.textContent = entry.code;
  const message = document.createElement("span");
  message.textContent = entry.message;
  const location = document.createElement("small");
  location.textContent = sourceLabel(entry.source);
  button.append(code, message, location);
  button.addEventListener("click", () => jumpToSource(entry.source));
  return button;
};

const showDiagnostics = (diagnostics) => {
  elements.diagnostics.replaceChildren();
  const errors = diagnostics.filter((entry) => entry.severity === "error");
  elements.diagnostics.hidden = errors.length === 0;
  if (!errors.length) return;
  const header = document.createElement("div");
  header.className = "diagnostic-heading";
  header.innerHTML = `<strong>${errors.length} ${errors.length === 1 ? "problem" : "problems"} found</strong><span>Your last successful output is still shown.</span>`;
  const list = document.createElement("div");
  list.className = "diagnostic-list";
  for (const entry of errors) list.append(diagnosticButton(entry));
  elements.diagnostics.append(header, list);
};

const setView = (view) => {
  const provenance = view === "provenance";
  elements.outputTab.setAttribute("aria-selected", String(!provenance));
  elements.provenanceTab.setAttribute("aria-selected", String(provenance));
  elements.outputView.hidden = provenance;
  elements.provenanceView.hidden = !provenance;
};

const showSegmentDetail = (index) => {
  const segments = currentDeliverable?.provenanceMap?.segments ?? [];
  const segment = segments[index];
  if (!segment) {
    elements.segmentDetail.innerHTML = "<p>Select a mapped range to inspect it.</p>";
    return;
  }
  selectedSegment = index;
  for (const node of elements.mappedOutput.querySelectorAll("[data-segment]")) {
    node.setAttribute("aria-pressed", String(Number(node.dataset.segment) === index));
  }

  const generatedText = currentDeliverable.value.slice(segment.generated.start, segment.generated.end);
  const source = document.createElement("button");
  source.type = "button";
  source.className = "source-link";
  source.textContent = sourceLabel(segment.source);
  source.disabled = !segment.source;
  source.addEventListener("click", () => jumpToSource(segment.source));

  const heading = document.createElement("div");
  heading.className = "detail-heading";
  const badge = document.createElement("span");
  badge.className = `mapping-dot color-${chunkColor(segment.chunk)}`;
  const title = document.createElement("strong");
  title.textContent = segment.chunk ?? "Composed range";
  heading.append(badge, title);

  const grid = document.createElement("dl");
  const addDetail = (term, value, { code = false, className = "" } = {}) => {
    const row = document.createElement("div");
    const name = document.createElement("dt");
    const description = document.createElement("dd");
    const content = code ? document.createElement("code") : document.createElement("span");
    name.textContent = term;
    content.textContent = value;
    if (className) content.className = className;
    description.append(content);
    row.append(name, description);
    grid.append(row);
  };
  addDetail("Generated", `${segment.generated.start}–${segment.generated.end}`);
  addDetail("Precision", segment.precision, { className: `precision ${segment.precision}` });
  addDetail("Kind", segment.kind);
  addDetail("Text", generatedText.replace(/\n/g, " ↵ ") || "newline", { code: true });

  const derivation = document.createElement("div");
  derivation.className = "derivation";
  const label = document.createElement("span");
  label.className = "panel-kicker";
  label.textContent = "Derivation";
  const steps = document.createElement("ol");
  const via = segment.via ?? [];
  if (via.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Literal source";
    steps.append(item);
  } else {
    for (const step of via) {
      const item = document.createElement("li");
      const name = step.name ? ` · ${step.name}` : "";
      item.textContent = `${step.kind}${name}`;
      steps.append(item);
    }
  }
  derivation.append(label, steps);

  elements.segmentDetail.replaceChildren(heading, source, grid, derivation);
};

const mappedSegment = (text, index, segment) => {
  const span = document.createElement("span");
  span.className = `mapped-segment color-${chunkColor(segment.chunk)}`;
  span.dataset.segment = index;
  span.tabIndex = 0;
  span.setAttribute("role", "button");
  span.setAttribute("aria-pressed", String(index === selectedSegment));
  span.setAttribute("aria-label", `${segment.chunk}, ${segment.precision} mapping`);
  span.textContent = text;
  span.addEventListener("click", () => showSegmentDetail(index));
  span.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showSegmentDetail(index);
    }
  });
  return span;
};

const renderProvenance = () => {
  const map = currentDeliverable.provenanceMap;
  const segments = map.segments ?? [];
  const sorted = segments
    .map((segment, index) => ({ segment, index }))
    .sort((left, right) => left.segment.generated.start - right.segment.generated.start);
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const { segment, index } of sorted) {
    const start = Math.max(cursor, segment.generated.start);
    const end = Math.max(start, segment.generated.end);
    if (start > cursor) fragment.append(document.createTextNode(currentDeliverable.value.slice(cursor, start)));
    if (end > start) fragment.append(mappedSegment(currentDeliverable.value.slice(start, end), index, segment));
    cursor = Math.max(cursor, end);
  }
  if (cursor < currentDeliverable.value.length) {
    fragment.append(document.createTextNode(currentDeliverable.value.slice(cursor)));
  }
  elements.mappedOutput.replaceChildren(fragment);
  elements.rawMapJson.textContent = JSON.stringify(map, null, 2);

  const chunks = [...new Set(segments.map((segment) => segment.chunk).filter(Boolean))];
  const segmentLabel = segments.length === 1 ? "map segment" : "map segments";
  const chunkLabel = chunks.length === 1 ? "source chunk" : "source chunks";
  elements.provenanceSummary.textContent = `${segments.length} ${segmentLabel} across ${chunks.length} ${chunkLabel}`;
  elements.provenanceLegend.replaceChildren(...chunks.map((chunk) => {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    dot.className = `mapping-dot color-${chunkColor(chunk)}`;
    item.append(dot, document.createTextNode(chunk));
    return item;
  }));
  showSegmentDetail(Math.min(selectedSegment, Math.max(0, segments.length - 1)));
};

const showDeliverable = (name) => {
  currentDeliverable = currentResult.deliverables.find((entry) => entry.name === name) ??
    currentResult.deliverables[0];
  if (!currentDeliverable) return;
  selectedSegment = 0;
  elements.deliverableSelect.value = currentDeliverable.name;
  elements.artifactName.textContent = currentDeliverable.name;
  elements.artifactSize.textContent = `${formatBytes(currentDeliverable.value)} · ${currentDeliverable.value.length} characters`;
  elements.outputCode.textContent = currentDeliverable.value;
  renderProvenance();
};

const showResult = (result) => {
  currentResult = result;
  elements.deliverableSelect.replaceChildren(...result.deliverables.map((deliverable) => {
    const option = document.createElement("option");
    option.value = deliverable.name;
    option.textContent = deliverable.name;
    return option;
  }));
  elements.deliverableSelect.closest(".deliverable-field").hidden = result.deliverables.length < 2;
  showDeliverable(result.deliverables[0]?.name);
};

const render = () => {
  window.clearTimeout(autoRenderTimer);
  elements.renderButton.disabled = true;
  elements.renderButton.querySelector("span").textContent = "Rendering…";
  const result = renderMarkdownDocument(editor.state.doc.toString(), {
    uri: "fizzbuzz.md",
    mode: "opt-in"
  });
  showDiagnostics(result.diagnostics);

  if (result.ok && result.deliverables.length) {
    showResult(result);
    elements.dirtyStatus.dataset.state = "clean";
    elements.dirtyStatus.textContent = "Rendered";
    elements.renderStatus.textContent = `Rendered ${result.deliverables.length} ${result.deliverables.length === 1 ? "artifact" : "artifacts"} successfully.`;
  } else if (result.ok) {
    elements.renderStatus.textContent = "The document is valid, but it declares no out() deliverable.";
  } else {
    elements.dirtyStatus.dataset.state = "error";
    elements.dirtyStatus.textContent = "Render failed";
    elements.renderStatus.textContent = "Fix the source diagnostics and render again.";
  }

  elements.renderButton.disabled = false;
  elements.renderButton.querySelector("span").textContent = "Render document";
};

elements.renderButton.addEventListener("click", render);
elements.autoRender.addEventListener("change", () => {
  window.clearTimeout(autoRenderTimer);
  if (elements.autoRender.checked && elements.dirtyStatus.dataset.state === "dirty") {
    autoRenderTimer = window.setTimeout(() => render(), 250);
  }
});
elements.outputTab.addEventListener("click", () => setView("output"));
elements.provenanceTab.addEventListener("click", () => setView("provenance"));
elements.deliverableSelect.addEventListener("change", () => showDeliverable(elements.deliverableSelect.value));
elements.copyButton.addEventListener("click", async () => {
  if (!currentDeliverable) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentDeliverable.value);
    } else {
      const copyField = document.createElement("textarea");
      copyField.value = currentDeliverable.value;
      copyField.style.position = "fixed";
      copyField.style.opacity = "0";
      document.body.append(copyField);
      copyField.select();
      document.execCommand("copy");
      copyField.remove();
    }
    const original = elements.copyButton.textContent;
    elements.copyButton.textContent = "Copied";
    window.setTimeout(() => { elements.copyButton.textContent = original; }, 1200);
  } catch {
    elements.copyButton.textContent = "Select and copy";
    window.setTimeout(() => { elements.copyButton.textContent = "Copy output"; }, 1600);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    render();
  }
});

render();
