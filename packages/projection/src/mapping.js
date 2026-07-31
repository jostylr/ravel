import {
  affinities,
  clone,
  containsOffset,
  deepFreeze,
  isInteger,
  mappingKinds,
  rangesOverlap,
  sameSourceLocation,
  sourceLocation,
  sourceRangeOffsets,
  stableStringify,
  validOffsetRange
} from "./internal.js";

const emptyFailure = (reason) => deepFreeze({ ok: false, reason, matches: [] });

const segmentSort = (left, right) =>
  left.virtual.start - right.virtual.start ||
  // Content wins before zero-width anchors at the same boundary.
  (right.virtual.end - right.virtual.start) - (left.virtual.end - left.virtual.start) ||
  String(left.occurrenceId ?? "").localeCompare(String(right.occurrenceId ?? ""));

const positionEqual = (left, right) => left?.offset === right?.offset &&
  left?.line === right?.line && left?.column === right?.column;

const canCoalesce = (left, right) => {
  if (left.virtual.end !== right.virtual.start ||
      left.virtual.start === left.virtual.end || right.virtual.start === right.virtual.end ||
      left.kind !== right.kind || left.role !== right.role ||
      left.pieceId !== right.pieceId || left.occurrenceId !== right.occurrenceId ||
      left.endAffinity !== right.startAffinity ||
      stableStringify(left.expansionPath ?? []) !== stableStringify(right.expansionPath ?? []) ||
      stableStringify(left.transformChain ?? []) !== stableStringify(right.transformChain ?? [])) {
    return false;
  }
  if (!left.source && !right.source) return true;
  return left.source?.uri === right.source?.uri &&
    positionEqual(left.source?.range?.end, right.source?.range?.start);
};

/** Merge only adjacent ranges whose forward and reverse behavior is identical. */
export const coalesceProjectionSegments = (segments = []) => {
  const ordered = segments.filter((segment) => validOffsetRange(segment?.virtual) &&
    mappingKinds.has(segment?.kind)).map(clone).sort(segmentSort);
  const content = [];
  const anchors = [];
  for (const segment of ordered) {
    if (segment.virtual.start === segment.virtual.end) {
      anchors.push(segment);
      continue;
    }
    const previous = content.at(-1);
    if (!previous || !canCoalesce(previous, segment)) {
      content.push(segment);
      continue;
    }
    previous.virtual.end = segment.virtual.end;
    previous.endAffinity = segment.endAffinity;
    if (previous.source && segment.source) previous.source.range.end = clone(segment.source.range.end);
  }
  return deepFreeze([...content, ...anchors].sort(segmentSort));
};

export const buildProjectionIndexes = (segments = [], occurrences = []) => {
  const virtual = segments.map((_, index) => index).sort((left, right) =>
    segmentSort(segments[left], segments[right]));
  const virtualMaxEnds = [];
  let virtualMaximum = 0;
  for (const [position, index] of virtual.entries()) {
    virtualMaximum = Math.max(virtualMaximum, segments[index].virtual.end);
    virtualMaxEnds[position] = virtualMaximum;
  }
  const source = {};
  for (const [index, segment] of segments.entries()) {
    if (!segment.source?.uri || !sourceRangeOffsets(segment.source)) continue;
    (source[segment.source.uri] ??= []).push(index);
  }
  for (const indexes of Object.values(source)) indexes.sort((left, right) => {
    const leftRange = sourceRangeOffsets(segments[left].source);
    const rightRange = sourceRangeOffsets(segments[right].source);
    return leftRange.start - rightRange.start || leftRange.end - rightRange.end ||
      segmentSort(segments[left], segments[right]);
  });
  const sourceMaxEnds = {};
  for (const [uri, indexes] of Object.entries(source)) {
    let maximum = 0;
    sourceMaxEnds[uri] = indexes.map((index) => {
      maximum = Math.max(maximum, sourceRangeOffsets(segments[index].source).end);
      return maximum;
    });
  }
  const occurrenceById = {};
  const children = {};
  for (const [index, occurrence] of occurrences.entries()) {
    occurrenceById[occurrence.id] = index;
    if (occurrence.parentOccurrenceId) {
      (children[occurrence.parentOccurrenceId] ??= []).push(index);
    }
  }
  return deepFreeze({ virtual, virtualMaxEnds, source, sourceMaxEnds, occurrenceById, children });
};

const selectionMatches = (document, segment, selection = {}) =>
  (selection.targetId === undefined || selection.targetId === document.targetId) &&
  (selection.artifactId === undefined || selection.artifactId === document.artifactId) &&
  (selection.stage === undefined || selection.stage === document.stage) &&
  (selection.occurrenceId === undefined || selection.occurrenceId === segment.occurrenceId);

const occurrenceFor = (document, id) => {
  const index = document.indexes?.occurrenceById?.[id];
  return isInteger(index) ? document.occurrences[index] : undefined;
};

const responsibleSource = (document, segment) => {
  const occurrence = occurrenceFor(document, segment.occurrenceId);
  return sourceLocation(
    occurrence?.invocationSource ??
    occurrence?.definitionSource ??
    document.artifactSource
  );
};

const exactSourceLocation = (document, segment, virtualStart, virtualEnd) => {
  const source = sourceLocation(segment.source);
  const sourceOffsets = sourceRangeOffsets(source);
  const virtualLength = segment.virtual.end - segment.virtual.start;
  if (!source || !sourceOffsets || sourceOffsets.end - sourceOffsets.start !== virtualLength) return undefined;
  const relativeStart = virtualStart - segment.virtual.start;
  const relativeEnd = virtualEnd - segment.virtual.start;
  const segmentText = document.text.slice(segment.virtual.start, segment.virtual.end);
  let start = clone(source.range.start);
  let end = clone(source.range.start);
  for (let index = 0; index < relativeEnd; index += 1) {
    if (index === relativeStart) start = clone(end);
    if (segmentText[index] === "\n") {
      end.line += 1;
      end.column = 0;
    } else {
      end.column += 1;
    }
    end.offset += 1;
  }
  if (relativeStart === relativeEnd) start = clone(end);
  return { uri: source.uri, range: { start, end } };
};

const virtualCandidates = (document, offset, affinity) => {
  const indexes = document.indexes?.virtual ?? document.mappings.map((_, index) => index);
  const maxEnds = document.indexes?.virtualMaxEnds;
  const result = [];
  let low = 0;
  let high = indexes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (document.mappings[indexes[middle]].virtual.start <= offset) low = middle + 1;
    else high = middle;
  }
  for (let position = low - 1; position >= 0; position -= 1) {
    if (maxEnds && maxEnds[position] < offset) break;
    const index = indexes[position];
    const segment = document.mappings[index];
    if (containsOffset(segment.virtual, offset, affinity)) result.push([index, segment]);
  }
  return result.reverse();
};

const sourceCandidatesAt = (document, uri, offset, affinity) => {
  const indexes = document.indexes?.source?.[uri] ?? [];
  const maxEnds = document.indexes?.sourceMaxEnds?.[uri];
  let low = 0;
  let high = indexes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sourceRangeOffsets(document.mappings[indexes[middle]].source).start <= offset) low = middle + 1;
    else high = middle;
  }
  const result = [];
  for (let position = low - 1; position >= 0; position -= 1) {
    if (maxEnds && maxEnds[position] < offset) break;
    const index = indexes[position];
    const range = sourceRangeOffsets(document.mappings[index].source);
    if (sourceCandidateContains(range, offset, affinity)) result.push(index);
  }
  return result.reverse();
};

const matchForVirtual = (document, index, segment, offset, affinity) => {
  const isPrecise = segment.kind === "exact" || segment.kind === "transformed";
  const source = isPrecise
    ? exactSourceLocation(document, segment, offset, offset)
    : sourceLocation(segment.source) ?? responsibleSource(document, segment);
  return {
    projectionId: document.id,
    uri: document.uri,
    projectionVersion: document.version,
    snapshotId: document.snapshotId,
    virtualOffset: offset,
    virtual: clone(segment.virtual),
    source,
    ...(isPrecise && source ? { sourceOffset: source.range.start.offset } : {}),
    pieceId: segment.pieceId,
    occurrenceId: segment.occurrenceId,
    quality: segment.kind,
    role: segment.role ?? "content",
    affinity,
    writable: (segment.kind === "exact" || segment.kind === "transformed") &&
      document.capabilities?.writableEdits !== false,
    segmentIndex: index
  };
};

/** Query a cursor offset. Invalid and stale inputs are typed failures, never exceptions. */
export const mapVirtualOffset = (document, offset, options = {}) => {
  const affinity = options.affinity ?? "none";
  if (!document || !isInteger(offset) || offset < 0 || offset > document.text?.length ||
      !affinities.has(affinity)) return emptyFailure("invalid-position");
  if (options.projectionVersion !== undefined && options.projectionVersion !== document.version) {
    return emptyFailure("stale-projection");
  }
  const matches = virtualCandidates(document, offset, affinity)
    .filter(([, segment]) => selectionMatches(document, segment, options))
    .map(([index, segment]) => matchForVirtual(document, index, segment, offset, affinity));
  return deepFreeze({ ok: true, matches });
};

const sourceCandidateContains = (range, offset, affinity) =>
  containsOffset(range, offset, affinity);

const virtualOffsetForSource = (segment, sourceRange, offset) =>
  segment.virtual.start + offset - sourceRange.start;

export const mapSourceOffset = (document, uri, offset, options = {}) => {
  const affinity = options.affinity ?? "none";
  if (!document || typeof uri !== "string" || !isInteger(offset) || offset < 0 ||
      !affinities.has(affinity)) return emptyFailure("invalid-position");
  if (options.projectionVersion !== undefined && options.projectionVersion !== document.version) {
    return emptyFailure("stale-projection");
  }
  const indexes = sourceCandidatesAt(document, uri, offset, affinity);
  const matches = [];
  for (const index of indexes) {
    const segment = document.mappings[index];
    const sourceRange = sourceRangeOffsets(segment.source);
    if (!sourceRange || !selectionMatches(document, segment, options)) continue;
    const precise = (segment.kind === "exact" || segment.kind === "transformed") &&
      sourceRange.end - sourceRange.start === segment.virtual.end - segment.virtual.start;
    const virtualOffset = precise
      ? virtualOffsetForSource(segment, sourceRange, offset)
      : segment.virtual.start;
    matches.push({
      projectionId: document.id,
      uri: document.uri,
      projectionVersion: document.version,
      snapshotId: document.snapshotId,
      source: clone(segment.source),
      sourceOffset: offset,
      virtualOffset,
      virtual: clone(segment.virtual),
      pieceId: segment.pieceId,
      occurrenceId: segment.occurrenceId,
      quality: segment.kind,
      role: segment.role ?? "content",
      affinity,
      writable: precise && document.capabilities?.writableEdits !== false,
      segmentIndex: index
    });
  }
  return deepFreeze({ ok: true, matches });
};

const rangeFailure = (document, range) => !document || !validOffsetRange(range) ||
  range.end > document.text?.length;

export const mapVirtualRange = (document, range, options = {}) => {
  if (rangeFailure(document, range)) return emptyFailure("invalid-range");
  if (range.start === range.end) return mapVirtualOffset(document, range.start, options);
  if (options.projectionVersion !== undefined && options.projectionVersion !== document.version) {
    return emptyFailure("stale-projection");
  }
  const matches = [];
  for (const [index, segment] of document.mappings.entries()) {
    if (segment.virtual.start > range.start) break;
    if (segment.virtual.start === segment.virtual.end || segment.virtual.start > range.start ||
        segment.virtual.end < range.end || !selectionMatches(document, segment, options)) continue;
    const precise = segment.kind === "exact" || segment.kind === "transformed";
    const source = precise
      ? exactSourceLocation(document, segment, range.start, range.end)
      : sourceLocation(segment.source) ?? responsibleSource(document, segment);
    matches.push({
      projectionId: document.id,
      uri: document.uri,
      projectionVersion: document.version,
      snapshotId: document.snapshotId,
      virtual: clone(range),
      relatedVirtual: clone(segment.virtual),
      source,
      pieceId: segment.pieceId,
      occurrenceId: segment.occurrenceId,
      quality: segment.kind,
      role: segment.role ?? "content",
      writable: Boolean(precise && source && document.capabilities?.writableEdits !== false),
      segmentIndex: index
    });
  }
  return deepFreeze({ ok: true, matches });
};

export const mapSourceRange = (document, uri, range, options = {}) => {
  if (!document || typeof uri !== "string" || !validOffsetRange(range)) {
    return emptyFailure("invalid-range");
  }
  if (range.start === range.end) return mapSourceOffset(document, uri, range.start, options);
  if (options.projectionVersion !== undefined && options.projectionVersion !== document.version) {
    return emptyFailure("stale-projection");
  }
  const matches = [];
  for (const index of document.indexes?.source?.[uri] ?? []) {
    const segment = document.mappings[index];
    const sourceRange = sourceRangeOffsets(segment.source);
    if (!sourceRange || !rangesOverlap(sourceRange, range) || !selectionMatches(document, segment, options)) continue;
    const overlap = {
      start: Math.max(sourceRange.start, range.start),
      end: Math.min(sourceRange.end, range.end)
    };
    const precise = (segment.kind === "exact" || segment.kind === "transformed") &&
      sourceRange.end - sourceRange.start === segment.virtual.end - segment.virtual.start;
    const virtual = precise ? {
      start: virtualOffsetForSource(segment, sourceRange, overlap.start),
      end: virtualOffsetForSource(segment, sourceRange, overlap.end)
    } : clone(segment.virtual);
    matches.push({
      projectionId: document.id,
      uri: document.uri,
      projectionVersion: document.version,
      snapshotId: document.snapshotId,
      source: clone(segment.source),
      sourceOverlap: overlap,
      virtual,
      pieceId: segment.pieceId,
      occurrenceId: segment.occurrenceId,
      quality: segment.kind,
      role: segment.role ?? "content",
      writable: precise && document.capabilities?.writableEdits !== false,
      segmentIndex: index
    });
  }
  return deepFreeze({ ok: true, matches });
};

export const validateProjectionSegments = (text, segments = []) => {
  const issues = [];
  for (const [index, segment] of segments.entries()) {
    if (!validOffsetRange(segment?.virtual) || segment.virtual.end > text.length) {
      issues.push({ code: "RVP101", message: `mappings[${index}] has an invalid virtual range.` });
    }
    if (!mappingKinds.has(segment?.kind)) {
      issues.push({ code: "RVP101", message: `mappings[${index}] has an invalid mapping kind.` });
    }
    if (segment.source && !sourceLocation(segment.source)) {
      issues.push({ code: "RVP101", message: `mappings[${index}] has an invalid source range.` });
    }
  }
  return deepFreeze(issues);
};

export const sameProjectionMapping = (left, right) =>
  sameSourceLocation(left?.source, right?.source) &&
  stableStringify({ ...left, source: undefined }) === stableStringify({ ...right, source: undefined });
