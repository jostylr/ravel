import { lineWindow } from "./line-index.js";
import { mapVirtualRange } from "./mapping.js";
import { clone, deepFreeze, rangesOverlap, sourceRangeOffsets, validOffsetRange } from "./internal.js";

const occurrenceMap = (document) => new Map(
  (document?.occurrences ?? []).map((occurrence) => [occurrence.id, occurrence])
);

const isDescendant = (candidate, selected, byId) => {
  let current = candidate;
  while (current?.parentOccurrenceId) {
    if (current.parentOccurrenceId === selected.id) return true;
    current = byId.get(current.parentOccurrenceId);
  }
  return false;
};

const sourceSelectionMatches = (segment, selection) => {
  if (!selection || segment.source?.uri !== selection.uri) return false;
  const segmentRange = sourceRangeOffsets(segment.source);
  const selectionRange = sourceRangeOffsets(selection);
  return Boolean(segmentRange && selectionRange && rangesOverlap(segmentRange, selectionRange, {
    includeBoundary: segmentRange.start === segmentRange.end || selectionRange.start === selectionRange.end
  }));
};

const highlightCategories = (segment, occurrence, selected, byId, sourceSelection) => {
  const categories = [];
  if (sourceSelectionMatches(segment, sourceSelection)) categories.push("selected-fragment");
  if (occurrence?.id === selected.id) categories.push("selected-piece");
  else if (occurrence && isDescendant(occurrence, selected, byId)) categories.push("descendant");
  else categories.push("surrounding-context");
  if (segment.kind === "transformed" || segment.transformChain?.length) categories.push("transformed");
  if (segment.kind === "synthetic") categories.push("synthetic");
  return categories;
};

const concisePath = (occurrence) => occurrence.expansionPath.join(" › ");

export const generatedContext = (document, occurrenceId, options = {}) => {
  if (!document || typeof occurrenceId !== "string") {
    return deepFreeze({ ok: false, reason: "invalid-occurrence" });
  }
  if (options.projectionVersion !== undefined && options.projectionVersion !== document.version) {
    return deepFreeze({ ok: false, reason: "stale-projection" });
  }
  const byId = occurrenceMap(document);
  const selected = byId.get(occurrenceId);
  if (!selected) return deepFreeze({ ok: false, reason: "unknown-occurrence" });
  const window = lineWindow(document.lineIndex, selected.virtual, options.surroundingLines ?? 3);
  const visibleRange = window.ok ? window.range : clone(selected.virtual);
  const highlights = [];
  for (const segment of document.mappings) {
    if (segment.virtual.start === segment.virtual.end ||
        !rangesOverlap(segment.virtual, visibleRange, { includeBoundary: true })) continue;
    const occurrence = byId.get(segment.occurrenceId);
    const categories = highlightCategories(segment, occurrence, selected, byId, options.sourceSelection);
    highlights.push({
      range: {
        start: Math.max(segment.virtual.start, visibleRange.start),
        end: Math.min(segment.virtual.end, visibleRange.end)
      },
      kind: categories[0],
      categories,
      mappingKind: segment.kind,
      pieceId: segment.pieceId,
      occurrenceId: segment.occurrenceId
    });
  }
  const breadcrumb = [];
  let cursor = selected;
  while (cursor) {
    breadcrumb.unshift({
      occurrenceId: cursor.id,
      pieceId: cursor.pieceId,
      label: cursor.pieceId,
      virtual: clone(cursor.virtual),
      invocationSource: clone(cursor.invocationSource)
    });
    cursor = cursor.parentOccurrenceId ? byId.get(cursor.parentOccurrenceId) : undefined;
  }
  const siblings = document.occurrences
    .filter((occurrence) => occurrence.pieceId === selected.pieceId && occurrence.id !== selected.id)
    .map((occurrence) => ({
      occurrenceId: occurrence.id,
      pieceId: occurrence.pieceId,
      targetId: document.targetId,
      artifactId: document.artifactId,
      stage: document.stage,
      virtual: clone(occurrence.virtual),
      pathLabel: concisePath(occurrence)
    }));
  return deepFreeze({
    ok: true,
    projection: document,
    projectionVersion: document.version,
    selectedOccurrenceId: selected.id,
    visibleRange,
    highlights,
    breadcrumb,
    siblings
  });
};

export const navigateGeneratedSelection = (document, range, options = {}) => {
  if (!validOffsetRange(range)) return deepFreeze({ ok: false, reason: "invalid-range", matches: [] });
  return mapVirtualRange(document, range, options);
};
