import { createProjectionId, createVirtualUri } from "./builder.js";
import { createLineIndex, offsetAt } from "./line-index.js";
import { buildProjectionIndexes, coalesceProjectionSegments } from "./mapping.js";
import {
  clone,
  deepFreeze,
  defaultCapabilities,
  isInteger,
  projectionStages,
  sourceLocation,
  sourceRangeOffsets,
  stableHash,
  throwIfAborted,
  validOffsetRange
} from "./internal.js";

const modes = new Set(["copy", "mapped", "inserted", "removed"]);

const span = (inputStart, inputEnd, outputStart, outputEnd, mode = "copy") => ({
  input: { start: inputStart, end: inputEnd },
  output: { start: outputStart, end: outputEnd },
  mode
});

const appendSpan = (spans, entry) => {
  if (!validOffsetRange(entry.input) || !validOffsetRange(entry.output) || !modes.has(entry.mode)) return;
  const previous = spans.at(-1);
  if (previous && previous.mode === entry.mode &&
      previous.input.end === entry.input.start && previous.output.end === entry.output.start &&
      // Do not merge a deletion and insertion pair at the same anchor.
      (entry.mode === "copy" || entry.mode === "mapped")) {
    previous.input.end = entry.input.end;
    previous.output.end = entry.output.end;
  } else {
    spans.push(entry);
  }
};

const finalizeMap = (name, inputLength, outputLength, spans) => deepFreeze({
  kind: "offset",
  name,
  inputLength,
  outputLength,
  spans
});

export const identityTransformMap = (input) => {
  const length = typeof input === "string" ? input.length : input;
  if (!isInteger(length) || length < 0) return deepFreeze({ kind: "invalid", reason: "invalid-length" });
  return finalizeMap("identity", length, length, length ? [span(0, length, 0, length)] : []);
};

export const createIndentOffsetMap = (input, count = 2) => {
  if (typeof input !== "string" || !isInteger(count) || count < 0) {
    return deepFreeze({ ok: false, reason: "invalid-indent" });
  }
  if (count === 0) return deepFreeze({ ok: true, text: input, map: identityTransformMap(input) });
  const padding = " ".repeat(count);
  const spans = [];
  let output = "";
  let inputCursor = 0;
  for (const line of input.split("\n")) {
    const lineStart = inputCursor;
    const lineEnd = lineStart + line.length;
    if (line.length) {
      const outputStart = output.length;
      output += padding;
      appendSpan(spans, span(lineStart, lineStart, outputStart, output.length, "inserted"));
    }
    if (line.length) {
      const outputStart = output.length;
      output += line;
      appendSpan(spans, span(lineStart, lineEnd, outputStart, output.length));
    }
    inputCursor = lineEnd;
    if (inputCursor < input.length) {
      const outputStart = output.length;
      output += "\n";
      appendSpan(spans, span(inputCursor, inputCursor + 1, outputStart, output.length));
      inputCursor += 1;
    }
  }
  return deepFreeze({ ok: true, text: output, map: finalizeMap("indent", input.length, output.length, spans) });
};

export const createDedentOffsetMap = (input) => {
  if (typeof input !== "string") return deepFreeze({ ok: false, reason: "invalid-input" });
  const lines = input.split("\n");
  const indents = lines.filter((line) => /\S/.test(line)).map((line) => /^\s*/.exec(line)[0].length);
  const amount = indents.length ? Math.min(...indents) : 0;
  if (amount === 0) return deepFreeze({ ok: true, text: input, amount, map: identityTransformMap(input) });
  const spans = [];
  let output = "";
  let inputCursor = 0;
  for (const line of lines) {
    const lineStart = inputCursor;
    const lineEnd = lineStart + line.length;
    const removed = Math.min(amount, line.length);
    if (removed) appendSpan(spans, span(lineStart, lineStart + removed, output.length, output.length, "removed"));
    if (line.length > removed) {
      const outputStart = output.length;
      output += line.slice(removed);
      appendSpan(spans, span(lineStart + removed, lineEnd, outputStart, output.length));
    }
    inputCursor = lineEnd;
    if (inputCursor < input.length) {
      const outputStart = output.length;
      output += "\n";
      appendSpan(spans, span(inputCursor, inputCursor + 1, outputStart, output.length));
      inputCursor += 1;
    }
  }
  return deepFreeze({ ok: true, text: output, amount, map: finalizeMap("dedent", input.length, output.length, spans) });
};

export const createEolOffsetMap = (input, eol = "\n") => {
  if (typeof input !== "string" || (eol !== "\n" && eol !== "\r\n")) {
    return deepFreeze({ ok: false, reason: "invalid-eol" });
  }
  const spans = [];
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "\r" && input[index] !== "\n") {
      const start = index;
      while (index < input.length && input[index] !== "\r" && input[index] !== "\n") index += 1;
      const outputStart = output.length;
      output += input.slice(start, index);
      appendSpan(spans, span(start, index, outputStart, output.length));
      continue;
    }
    const newlineStart = index;
    const consumed = input[index] === "\r" && input[index + 1] === "\n" ? 2 : 1;
    const original = input.slice(index, index + consumed);
    const outputStart = output.length;
    output += eol;
    if (original === eol) {
      appendSpan(spans, span(index, index + consumed, outputStart, output.length));
    } else if (consumed === 2 && eol === "\n") {
      appendSpan(spans, span(index, index + 1, outputStart, outputStart, "removed"));
      appendSpan(spans, span(index + 1, index + 2, outputStart, output.length));
    } else if (consumed === 1 && eol === "\r\n") {
      appendSpan(spans, span(index, index, outputStart, outputStart + 1, "inserted"));
      appendSpan(spans, span(index, index + 1, outputStart + 1, output.length, "mapped"));
    } else {
      appendSpan(spans, span(index, index + consumed, outputStart, output.length, "mapped"));
    }
    index = newlineStart + consumed;
  }
  return deepFreeze({ ok: true, text: output, map: finalizeMap("normalize-eol", input.length, output.length, spans) });
};

export const validateTransformMapping = (mapping) => {
  if (mapping?.kind === "identity") return deepFreeze({ ok: true });
  if (mapping?.kind === "opaque") return deepFreeze({ ok: true });
  if (mapping?.kind === "source-map" && Array.isArray(mapping.entries)) return deepFreeze({ ok: true });
  if (mapping?.kind !== "offset" || !isInteger(mapping.inputLength) || mapping.inputLength < 0 ||
      !isInteger(mapping.outputLength) || mapping.outputLength < 0 || !Array.isArray(mapping.spans)) {
    return deepFreeze({ ok: false, reason: "invalid-transform-map" });
  }
  let lastInput = 0;
  let lastOutput = 0;
  for (const [index, entry] of mapping.spans.entries()) {
    if (!validOffsetRange(entry.input) || !validOffsetRange(entry.output) || !modes.has(entry.mode) ||
        entry.input.end > mapping.inputLength || entry.output.end > mapping.outputLength ||
        entry.input.start < lastInput || entry.output.start < lastOutput ||
        ((entry.mode === "copy" || entry.mode === "mapped") &&
          entry.input.end - entry.input.start !== entry.output.end - entry.output.start) ||
        (entry.mode === "inserted" && entry.input.start !== entry.input.end) ||
        (entry.mode === "removed" && entry.output.start !== entry.output.end)) {
      return deepFreeze({ ok: false, reason: "invalid-transform-span", index });
    }
    lastInput = entry.input.end;
    lastOutput = entry.output.end;
  }
  return deepFreeze({ ok: true });
};

const characterOrigins = (mapping) => {
  const origins = Array(mapping.outputLength).fill(null);
  const mapped = Array(mapping.outputLength).fill(false);
  for (const entry of mapping.spans) {
    if (entry.mode !== "copy" && entry.mode !== "mapped") continue;
    for (let offset = 0; offset < entry.output.end - entry.output.start; offset += 1) {
      origins[entry.output.start + offset] = entry.input.start + offset;
      mapped[entry.output.start + offset] = entry.mode === "mapped";
    }
  }
  return { origins, mapped };
};

const mapFromOrigins = (name, inputLength, origins, mappedFlags) => {
  const spans = [];
  let output = 0;
  while (output < origins.length) {
    const origin = origins[output];
    const mode = origin === null ? "inserted" : mappedFlags[output] ? "mapped" : "copy";
    let end = output + 1;
    while (end < origins.length) {
      const nextOrigin = origins[end];
      const nextMode = nextOrigin === null ? "inserted" : mappedFlags[end] ? "mapped" : "copy";
      if (nextMode !== mode || (mode !== "inserted" && nextOrigin !== origin + end - output)) break;
      end += 1;
    }
    let anchor = origin;
    if (mode === "inserted") {
      const previous = output > 0 ? origins[output - 1] : null;
      const next = origins.slice(end).find((candidate) => candidate !== null);
      anchor = previous !== null ? previous + 1 : next ?? inputLength;
    }
    appendSpan(spans, mode === "inserted"
      ? span(anchor, anchor, output, end, mode)
      : span(origin, origin + end - output, output, end, mode));
    output = end;
  }
  return finalizeMap(name, inputLength, origins.length, spans);
};

export const composeOffsetMaps = (...inputMaps) => {
  const maps = inputMaps.length === 1 && Array.isArray(inputMaps[0]) ? inputMaps[0] : inputMaps;
  if (!maps.length) return deepFreeze({ ok: false, reason: "no-transform-maps" });
  if (maps.some((mapping) => !validateTransformMapping(mapping).ok || mapping.kind !== "offset")) {
    return deepFreeze({ ok: false, reason: "incompatible-transform-map" });
  }
  let current = maps[0];
  for (const next of maps.slice(1)) {
    if (current.outputLength !== next.inputLength) {
      return deepFreeze({ ok: false, reason: "transform-length-mismatch" });
    }
    const first = characterOrigins(current);
    const second = characterOrigins(next);
    const origins = [];
    const mapped = [];
    for (let output = 0; output < next.outputLength; output += 1) {
      const middle = second.origins[output];
      const origin = middle === null ? null : first.origins[middle];
      origins.push(origin);
      mapped.push(second.mapped[output] || (middle !== null && first.mapped[middle]));
    }
    current = mapFromOrigins(`${current.name}+${next.name}`, current.inputLength, origins, mapped);
  }
  return deepFreeze({ ok: true, map: current });
};

const pointFromSpan = (entry, offset, direction, fromOutput) => {
  const from = fromOutput ? entry.output : entry.input;
  const to = fromOutput ? entry.input : entry.output;
  if (entry.mode === "inserted" || entry.mode === "removed") return undefined;
  if (offset > from.start && offset < from.end) return to.start + offset - from.start;
  if (offset === from.start && direction !== "left") return to.start;
  if (offset === from.end && direction !== "right") return to.end;
  return undefined;
};

export const mapTransformOffset = (mapping, offset, { direction = "output-to-input", affinity = "none" } = {}) => {
  if (!validateTransformMapping(mapping).ok || mapping.kind !== "offset" || !isInteger(offset) || offset < 0) {
    return deepFreeze({ ok: false, reason: "invalid-position", matches: [] });
  }
  const fromOutput = direction === "output-to-input";
  const length = fromOutput ? mapping.outputLength : mapping.inputLength;
  if (offset > length) return deepFreeze({ ok: false, reason: "invalid-position", matches: [] });
  const matches = [];
  for (const entry of mapping.spans) {
    const mapped = pointFromSpan(entry, offset, affinity, fromOutput);
    if (mapped !== undefined && !matches.includes(mapped)) matches.push(mapped);
  }
  return deepFreeze({ ok: true, matches });
};

export const opaqueTransformMap = (anchor) => deepFreeze({
  kind: "opaque",
  anchor: sourceLocation(anchor)
});

export const stageCapabilities = (stage, overrides = {}) => {
  if (!projectionStages.has(stage)) {
    throw new TypeError(`Unknown projection stage: ${String(stage)}`);
  }
  return deepFreeze({
    ...defaultCapabilities(stage),
    ...overrides
  });
};

export const validateAnalysisTransform = (descriptor) => {
  if (!descriptor || typeof descriptor !== "object") return deepFreeze({ ok: false, reason: "invalid-transform" });
  if (descriptor.pure !== true) return deepFreeze({ ok: false, reason: "transform-not-declared-pure" });
  if ((descriptor.effects?.length ?? 0) > 0 || (descriptor.authorities?.length ?? 0) > 0 || descriptor.effect) {
    return deepFreeze({ ok: false, reason: "analysis-transform-requested-effect" });
  }
  const mapping = descriptor.mapping ?? descriptor.map;
  return validateTransformMapping(mapping?.kind === "identity" ? mapping : mapping);
};

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const decodeVlq = (text, cursor) => {
  let result = 0;
  let shift = 0;
  let continuation;
  do {
    const digit = base64.indexOf(text[cursor.index++]);
    if (digit < 0) return undefined;
    continuation = digit & 32;
    result += (digit & 31) << shift;
    shift += 5;
  } while (continuation);
  const negative = result & 1;
  result >>>= 1;
  return negative ? -result : result;
};

/** Decode a version-3 source map into presentation-neutral mapping points. */
export const normalizeSourceMap = (sourceMap) => {
  if (!sourceMap || sourceMap.version !== 3 || !Array.isArray(sourceMap.sources) ||
      typeof sourceMap.mappings !== "string") {
    return deepFreeze({ ok: false, reason: "invalid-source-map" });
  }
  const entries = [];
  let generatedLine = 0;
  let generatedColumn = 0;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  const lines = sourceMap.mappings.split(";");
  for (const line of lines) {
    generatedColumn = 0;
    for (const encoded of line.split(",")) {
      if (!encoded) continue;
      const cursor = { index: 0 };
      const generatedDelta = decodeVlq(encoded, cursor);
      if (generatedDelta === undefined) return deepFreeze({ ok: false, reason: "invalid-source-map-vlq" });
      generatedColumn += generatedDelta;
      if (cursor.index >= encoded.length) {
        entries.push({ generated: { line: generatedLine, column: generatedColumn } });
        continue;
      }
      const sourceDelta = decodeVlq(encoded, cursor);
      const lineDelta = decodeVlq(encoded, cursor);
      const columnDelta = decodeVlq(encoded, cursor);
      if ([sourceDelta, lineDelta, columnDelta].some((value) => value === undefined)) {
        return deepFreeze({ ok: false, reason: "invalid-source-map-vlq" });
      }
      sourceIndex += sourceDelta;
      originalLine += lineDelta;
      originalColumn += columnDelta;
      const entry = {
        generated: { line: generatedLine, column: generatedColumn },
        source: sourceMap.sources[sourceIndex],
        original: { line: originalLine, column: originalColumn }
      };
      if (cursor.index < encoded.length) {
        const nameDelta = decodeVlq(encoded, cursor);
        nameIndex += nameDelta;
        entry.name = sourceMap.names?.[nameIndex];
      }
      entries.push(entry);
    }
    generatedLine += 1;
  }
  return deepFreeze({
    ok: true,
    map: {
      kind: "source-map",
      sourceRoot: sourceMap.sourceRoot,
      sources: clone(sourceMap.sources),
      sourcesContent: clone(sourceMap.sourcesContent ?? []),
      entries
    }
  });
};

const mappingForInputOffset = (document, offset, affinity = "right") => {
  const candidates = document.mappings.filter((segment) => {
    if (segment.virtual.start === segment.virtual.end) return segment.virtual.start === offset;
    return affinity === "right"
      ? segment.virtual.start <= offset && offset < segment.virtual.end
      : segment.virtual.start < offset && offset <= segment.virtual.end;
  });
  return candidates.find((segment) => segment.kind !== "synthetic") ?? candidates[0];
};

const outputRangeForInputRange = (mapping, inputRange) => {
  const start = mapTransformOffset(mapping, inputRange.start, { direction: "input-to-output", affinity: "right" });
  const end = mapTransformOffset(mapping, inputRange.end, { direction: "input-to-output", affinity: "left" });
  return start.matches.length && end.matches.length
    ? { start: Math.min(...start.matches), end: Math.max(...end.matches) }
    : undefined;
};

const transformedSource = (document, segment, inputStart, inputEnd) => {
  const source = sourceLocation(segment.source);
  const offsets = sourceRangeOffsets(source);
  const inputLength = segment.virtual.end - segment.virtual.start;
  if (!source || !offsets || offsets.end - offsets.start !== inputLength) return source;
  const relativeStart = inputStart - segment.virtual.start;
  const relativeEnd = inputEnd - segment.virtual.start;
  const text = document.text.slice(segment.virtual.start, segment.virtual.end);
  const advance = (count) => {
    const result = clone(source.range.start);
    for (let index = 0; index < count; index += 1) {
      if (text[index] === "\n") { result.line += 1; result.column = 0; }
      else result.column += 1;
      result.offset += 1;
    }
    return result;
  };
  return { uri: source.uri, range: { start: advance(relativeStart), end: advance(relativeEnd) } };
};

const sourceMapToOffsetMap = (document, outputText, mapping, inputSource) => {
  const generatedIndex = createLineIndex(outputText);
  const inputIndex = document.lineIndex;
  const sourceName = inputSource ?? document.uri;
  const points = mapping.entries.filter((entry) => entry.source === sourceName)
    .map((entry) => {
      const generated = offsetAt(generatedIndex, {
        line: entry.generated.line,
        character: entry.generated.column
      });
      const original = offsetAt(inputIndex, {
        line: entry.original.line,
        character: entry.original.column
      });
      return generated.ok && original.ok ? { output: generated.offset, input: original.offset } : undefined;
    }).filter(Boolean).sort((left, right) => left.output - right.output);
  if (!points.length) return undefined;
  const spans = [];
  for (const [index, point] of points.entries()) {
    const next = points[index + 1];
    const outputEnd = next?.output ?? outputText.length;
    const inputEnd = next?.input ?? document.text.length;
    const length = Math.min(outputEnd - point.output, inputEnd - point.input);
    if (length > 0) appendSpan(spans, span(point.input, point.input + length, point.output, point.output + length, "mapped"));
  }
  return finalizeMap("source-map", document.text.length, outputText.length, spans);
};

/** Apply a pure transform map to a virtual document while retaining provenance. */
export const applyTransformMap = (document, outputText, capability, options = {}) => {
  throwIfAborted(options.signal);
  if (!document || typeof outputText !== "string") return deepFreeze({ ok: false, reason: "invalid-transform-input" });
  if (!projectionStages.has(options.stage ?? "transformed")) {
    return deepFreeze({ ok: false, reason: "invalid-stage" });
  }
  let mapping = capability?.map ?? capability;
  if (mapping?.kind === "identity") mapping = identityTransformMap(document.text);
  if (mapping?.kind === "source-map") mapping = sourceMapToOffsetMap(document, outputText, mapping, options.inputSource);
  if (capability?.kind === "opaque" || mapping?.kind === "opaque" || !mapping) {
    const root = document.occurrences.find((occurrence) => !occurrence.parentOccurrenceId);
    const source = sourceLocation(capability?.anchor ?? mapping?.anchor ?? root?.definitionSource ?? document.artifactSource);
    const occurrenceId = root?.id;
    const mappings = outputText.length ? [{
      virtual: { start: 0, end: outputText.length },
      source,
      pieceId: root?.pieceId,
      occurrenceId,
      expansionPath: clone(root?.expansionPath ?? []),
      kind: "opaque",
      role: "transform-output",
      startAffinity: "right",
      endAffinity: "left",
      transformChain: [...(options.transformChain ?? []), { name: options.name ?? "opaque" }]
    }] : [];
    const occurrences = document.occurrences.map((occurrence) => ({
      ...clone(occurrence),
      virtual: occurrence.id === occurrenceId
        ? { start: 0, end: outputText.length }
        : { start: 0, end: 0 }
    }));
    return transformedDocument(document, outputText, mappings, occurrences, options);
  }
  const validation = validateTransformMapping(mapping);
  if (!validation.ok || mapping.kind !== "offset" || mapping.inputLength !== document.text.length ||
      mapping.outputLength !== outputText.length) {
    return deepFreeze({ ok: false, reason: "transform-map-does-not-match-text" });
  }
  const resultSegments = [];
  for (const transformSpan of mapping.spans) {
    throwIfAborted(options.signal);
    if (transformSpan.mode === "removed" || transformSpan.output.start === transformSpan.output.end) continue;
    if (transformSpan.mode === "inserted") {
      const responsible = mappingForInputOffset(document, transformSpan.input.start);
      resultSegments.push({
        virtual: clone(transformSpan.output),
        source: sourceLocation(options.transformSource),
        pieceId: responsible?.pieceId,
        occurrenceId: responsible?.occurrenceId,
        expansionPath: clone(responsible?.expansionPath ?? []),
        kind: options.transformSource ? "anchored" : "synthetic",
        role: "transform-insert",
        startAffinity: "right",
        endAffinity: "left",
        transformChain: [...(responsible?.transformChain ?? []), { name: options.name ?? mapping.name }]
      });
      continue;
    }
    for (const segment of document.mappings) {
      if (segment.virtual.start === segment.virtual.end) continue;
      const start = Math.max(segment.virtual.start, transformSpan.input.start);
      const end = Math.min(segment.virtual.end, transformSpan.input.end);
      if (start >= end) continue;
      const outputStart = transformSpan.output.start + start - transformSpan.input.start;
      const outputEnd = outputStart + end - start;
      const precise = segment.kind === "exact" || segment.kind === "transformed";
      resultSegments.push({
        virtual: { start: outputStart, end: outputEnd },
        source: transformedSource(document, segment, start, end),
        pieceId: segment.pieceId,
        occurrenceId: segment.occurrenceId,
        expansionPath: clone(segment.expansionPath ?? []),
        kind: precise ? (mapping.name === "identity" ? segment.kind : "transformed") : segment.kind,
        role: segment.role,
        startAffinity: segment.startAffinity,
        endAffinity: segment.endAffinity,
        transformChain: [...(segment.transformChain ?? []), { name: options.name ?? mapping.name }]
      });
    }
  }
  const mappings = coalesceProjectionSegments(resultSegments);
  const occurrences = document.occurrences.map((occurrence) => ({
    ...clone(occurrence),
    virtual: outputRangeForInputRange(mapping, occurrence.virtual) ?? { start: 0, end: 0 }
  }));
  return transformedDocument(document, outputText, mappings, occurrences, options);
};

const transformedDocument = (document, text, mappings, occurrences, options) => {
  const stage = options.stage ?? "transformed";
  const languageId = options.languageId ?? document.languageId;
  const id = options.projectionId ?? createProjectionId({
    workspaceId: document.workspaceId,
    targetId: document.targetId,
    artifactId: document.artifactId,
    stage,
    languageId
  });
  const uri = options.uri ?? createVirtualUri({
    workspaceId: document.workspaceId,
    targetId: document.targetId,
    artifactId: document.artifactId,
    stage,
    path: options.path ?? document.artifactId
  });
  const finalMappings = coalesceProjectionSegments(mappings);
  const result = {
    ...document,
    id,
    uri,
    version: options.version ?? 1,
    stage,
    languageId,
    text,
    mappings: finalMappings,
    occurrences,
    lineIndex: createLineIndex(text),
    indexes: buildProjectionIndexes(finalMappings, occurrences),
    contentHash: stableHash(text),
    inputHash: stableHash({ previous: document.inputHash, text, stage, languageId, mappings: finalMappings }),
    capabilities: stageCapabilities(stage, options.capabilities)
  };
  return deepFreeze({ ok: true, document: deepFreeze(result) });
};
