import { createLineIndex } from "./line-index.js";
import { buildProjectionIndexes, coalesceProjectionSegments, validateProjectionSegments } from "./mapping.js";
import {
  clone,
  deepFreeze,
  defaultCapabilities,
  encodeUriPart,
  encodeVirtualPath,
  isInteger,
  projectionStages,
  sourceLocation,
  sourceRangeOffsets,
  stableHash,
  stableStringify,
  throwIfAborted
} from "./internal.js";

const defaultPosition = () => ({ line: 0, column: 0, offset: 0 });
const defaultSource = (uri) => ({
  uri,
  range: { start: defaultPosition(), end: defaultPosition() }
});

const languageForName = (name) => {
  const extension = String(name).split(".").at(-1)?.toLowerCase();
  return ({
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    css: "css",
    html: "html",
    json: "json",
    md: "markdown"
  })[extension] ?? extension ?? "plaintext";
};

export const createProjectionId = ({
  workspaceId = "workspace",
  targetId = "default",
  artifactId,
  stage = "assembled",
  languageId = "plaintext"
} = {}) => [
  "ravel-projection",
  workspaceId,
  targetId,
  artifactId ?? "artifact",
  stage,
  languageId
].map((part) => encodeUriPart(part)).join(":");

export const createVirtualUri = ({
  workspaceId = "workspace",
  targetId = "default",
  artifactId,
  stage = "assembled",
  path
} = {}) => {
  const safeStage = projectionStages.has(stage) ? stage : "assembled";
  const virtualPath = path ?? artifactId ?? "artifact.txt";
  return `pieceful-virtual://${encodeUriPart(workspaceId)}/` +
    `${encodeUriPart(targetId)}/${encodeUriPart(artifactId ?? virtualPath)}/` +
    `${encodeUriPart(safeStage)}/${encodeVirtualPath(virtualPath)}`;
};

const referenceKey = (reference) => {
  const range = sourceRangeOffsets(reference?.source);
  return stableStringify({
    from: reference?.from,
    to: reference?.to ?? reference?.chunk,
    uri: reference?.source?.uri,
    start: range?.start,
    end: range?.end
  });
};

const normalizeReference = (reference, fallbackFrom) => ({
  kind: "reference",
  from: reference?.from ?? fallbackFrom,
  to: reference?.to ?? reference?.chunk,
  source: sourceLocation(reference?.source)
});

const referencesForSegment = (segment) => (segment?.via ?? [])
  .filter((step) => step?.kind === "reference" && typeof step.to === "string")
  .map((step) => normalizeReference(step))
  .reverse();

const transformsForSegment = (segment) => (segment?.via ?? [])
  .filter((step) => step?.kind === "transform")
  .map((step) => ({
    kind: "transform",
    name: step.name,
    phase: step.phase,
    source: sourceLocation(step.source)
  }));

const classifyCoreSegment = (segment) => {
  if (!segment?.source) return "synthetic";
  const virtualLength = segment.generated?.end - segment.generated?.start;
  const sourceRange = sourceRangeOffsets(segment.source);
  const exact = segment.precision === "exact" && sourceRange &&
    sourceRange.end - sourceRange.start === virtualLength;
  if (exact) return transformsForSegment(segment).length ? "transformed" : "exact";
  if (segment.kind === "transform" || segment.kind === "delay-fulfillment" ||
      (segment.origins?.length && transformsForSegment(segment).length)) return "opaque";
  return "anchored";
};

const directReferences = (program, pieceId) => (program.chunks?.[pieceId]?.references ?? [])
  .map((reference) => normalizeReference(reference, pieceId))
  .filter((reference) => typeof reference.to === "string");

const occurrenceBuilder = (program, projectionId, rootPieceId, bodyRange, rawSegments, shift, signal) => {
  const occurrences = [];
  const byId = new Map();
  const childByKey = new Map();

  const add = ({ pieceId, parent, reference, implicit = false }) => {
    const key = parent
      ? `${parent.id}\u0000${referenceKey(reference)}\u0000${pieceId}`
      : `${projectionId}\u0000root\u0000${pieceId}`;
    const id = `${projectionId}:occ:${stableHash(key)}`;
    const existing = byId.get(id);
    if (existing) return existing;
    const occurrence = {
      id,
      pieceId,
      projectionId,
      virtual: parent ? null : clone(bodyRange),
      invocationSource: sourceLocation(reference?.source),
      definitionSource: sourceLocation(program.chunks?.[pieceId]?.source),
      expansionPath: parent ? [...parent.expansionPath, pieceId] : [pieceId],
      parentOccurrenceId: parent?.id,
      childOccurrenceIds: [],
      implicit,
      _ranges: []
    };
    occurrences.push(occurrence);
    byId.set(id, occurrence);
    if (parent) {
      parent.childOccurrenceIds.push(id);
      childByKey.set(`${parent.id}\u0000${referenceKey(reference)}`, occurrence);
    }
    return occurrence;
  };

  const root = add({ pieceId: rootPieceId });

  const ensureChain = (chain, leafPieceId) => {
    let current = root;
    for (const reference of chain) {
      throwIfAborted(signal);
      if (reference.from && reference.from !== current.pieceId) continue;
      const key = `${current.id}\u0000${referenceKey(reference)}`;
      current = childByKey.get(key) ?? add({ pieceId: reference.to, parent: current, reference });
    }
    if (leafPieceId && leafPieceId !== current.pieceId && leafPieceId !== rootPieceId) {
      const implicitReference = {
        from: current.pieceId,
        to: leafPieceId,
        source: program.chunks?.[leafPieceId]?.source
      };
      const key = `${current.id}\u0000${referenceKey(implicitReference)}`;
      current = childByKey.get(key) ?? add({
        pieceId: leafPieceId,
        parent: current,
        reference: implicitReference,
        implicit: true
      });
    }
    return current;
  };

  const assignments = [];
  for (const segment of rawSegments) {
    throwIfAborted(signal);
    const leaf = ensureChain(referencesForSegment(segment), segment.chunk);
    const range = {
      start: shift + segment.generated.start,
      end: shift + segment.generated.end
    };
    assignments.push({ segment, occurrence: leaf, range });
    let cursor = leaf;
    while (cursor) {
      cursor._ranges.push(range);
      cursor = cursor.parentOccurrenceId ? byId.get(cursor.parentOccurrenceId) : undefined;
    }
  }

  const inferAnchor = (parent, reference) => {
    const invocation = sourceRangeOffsets(reference.source);
    if (!invocation) return parent.virtual?.start ?? bodyRange.start;
    let before;
    let after;
    for (const assignment of assignments) {
      if (assignment.occurrence.id !== parent.id || assignment.segment.source?.uri !== reference.source?.uri) continue;
      const sourceRange = sourceRangeOffsets(assignment.segment.source);
      if (!sourceRange) continue;
      if (sourceRange.end <= invocation.start && (!before || sourceRange.end > before.sourceEnd)) {
        before = { sourceEnd: sourceRange.end, virtual: assignment.range.end };
      }
      if (sourceRange.start >= invocation.end && (!after || sourceRange.start < after.sourceStart)) {
        after = { sourceStart: sourceRange.start, virtual: assignment.range.start };
      }
    }
    for (const siblingId of parent.childOccurrenceIds) {
      const sibling = byId.get(siblingId);
      const siblingSource = sourceRangeOffsets(sibling?.invocationSource);
      const siblingVirtual = sibling?.virtual ?? (sibling?._ranges?.length ? {
        start: Math.min(...sibling._ranges.map((range) => range.start)),
        end: Math.max(...sibling._ranges.map((range) => range.end))
      } : undefined);
      if (!siblingSource || sibling?.invocationSource?.uri !== reference.source?.uri || !siblingVirtual) continue;
      if (siblingSource.end <= invocation.start && (!before || siblingSource.end > before.sourceEnd)) {
        before = { sourceEnd: siblingSource.end, virtual: siblingVirtual.end };
      }
      if (siblingSource.start >= invocation.end && (!after || siblingSource.start < after.sourceStart)) {
        after = { sourceStart: siblingSource.start, virtual: siblingVirtual.start };
      }
    }
    return before?.virtual ?? after?.virtual ?? parent.virtual?.start ?? bodyRange.start;
  };

  // Core provenance cannot emit a text segment for an empty reference. Walk
  // each concrete parent occurrence to retain those semantic occurrences as
  // zero-width anchors.
  for (let index = 0; index < occurrences.length; index += 1) {
    throwIfAborted(signal);
    const parent = occurrences[index];
    if (parent.expansionPath.slice(0, -1).includes(parent.pieceId)) continue;
    for (const reference of directReferences(program, parent.pieceId)) {
      const key = `${parent.id}\u0000${referenceKey(reference)}`;
      if (childByKey.has(key)) continue;
      if (parent.expansionPath.includes(reference.to)) continue;
      const child = add({ pieceId: reference.to, parent, reference });
      const anchor = inferAnchor(parent, reference);
      child.virtual = { start: anchor, end: anchor };
    }
  }

  for (const occurrence of occurrences) {
    if (!occurrence.virtual) {
      if (occurrence._ranges.length) occurrence.virtual = {
        start: Math.min(...occurrence._ranges.map((range) => range.start)),
        end: Math.max(...occurrence._ranges.map((range) => range.end))
      };
      else {
        const parent = byId.get(occurrence.parentOccurrenceId);
        occurrence.virtual = { start: parent?.virtual?.start ?? bodyRange.start, end: parent?.virtual?.start ?? bodyRange.start };
      }
    }
    delete occurrence._ranges;
  }

  return { occurrences, assignments, root, byId };
};

const projectionSegmentFor = (assignment, shift = 0) => {
  const { segment, occurrence, range } = assignment;
  return {
    virtual: clone(range ?? {
      start: shift + segment.generated.start,
      end: shift + segment.generated.end
    }),
    source: sourceLocation(segment.source),
    pieceId: segment.chunk ?? occurrence?.pieceId,
    occurrenceId: occurrence?.id,
    expansionPath: clone(occurrence?.expansionPath ?? [segment.chunk].filter(Boolean)),
    kind: classifyCoreSegment(segment),
    role: segment.kind === "literal" ? "content" : segment.kind ?? "content",
    startAffinity: "right",
    endAffinity: "left",
    transformChain: transformsForSegment(segment)
  };
};

const sourceTextsRecord = (sourceTexts) => {
  if (sourceTexts instanceof Map) return Object.fromEntries([...sourceTexts.entries()]);
  return sourceTexts && typeof sourceTexts === "object" ? sourceTexts : {};
};

const reachableProjectionChunks = (program, rootPieceId) => {
  const result = [];
  const seen = new Set();
  const pending = [rootPieceId];
  while (pending.length) {
    const id = pending.shift();
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    const chunk = program?.chunks?.[id];
    if (!chunk) continue;
    result.push([id, chunk]);
    const dependencies = new Set([
      ...(chunk.dependencies ?? []),
      ...(chunk.references ?? []).map((reference) => reference.chunk)
    ]);
    pending.push(...[...dependencies].filter((entry) => typeof entry === "string").sort());
  }
  return result.sort(([left], [right]) => left.localeCompare(right));
};

const occurrenceForOrigin = (occurrenceData, segment, origin) => {
  const chain = [
    ...(origin?.via ?? []),
    ...(segment?.via ?? [])
  ].filter((step) => step?.kind === "reference").map(normalizeReference).reverse();
  let current = occurrenceData.root;
  for (const reference of chain) {
    const key = `${current.id}\u0000${referenceKey(reference)}`;
    const child = occurrenceData.occurrences.find((entry) =>
      entry.parentOccurrenceId === current.id &&
      referenceKey({ from: current.pieceId, to: entry.pieceId, source: entry.invocationSource }) === referenceKey(reference));
    if (!child) break;
    current = child;
  }
  return origin?.chunk
    ? occurrenceData.occurrences.find((entry) => entry.pieceId === origin.chunk &&
      entry.expansionPath.every((piece, index) => current.expansionPath[index] === piece)) ?? current
    : current;
};

export const buildVirtualDocument = (program, options = {}) => {
  const signal = options.signal;
  throwIfAborted(signal);
  const deliverableNames = Object.keys(program?.deliverables ?? {}).sort();
  const artifactId = options.artifactId ?? deliverableNames[0] ?? "missing-artifact";
  const deliverable = program?.deliverables?.[artifactId];
  const targetId = options.targetId ?? "default";
  const workspaceId = options.workspaceId ?? "workspace";
  const stage = projectionStages.has(options.stage) ? options.stage : "assembled";
  const rootPieceId = deliverable?.from ?? options.rootPieceId ?? "<missing>";
  const languageId = options.languageId ??
    program?.chunks?.[rootPieceId]?.metadata?.language ?? languageForName(artifactId);
  const id = options.projectionId ?? createProjectionId({
    workspaceId, targetId, artifactId, stage, languageId
  });
  const uri = options.uri ?? createVirtualUri({
    workspaceId,
    targetId,
    artifactId,
    stage,
    path: options.path ?? artifactId
  });
  const prefix = typeof options.prefix === "string" ? options.prefix : "";
  const suffix = typeof options.suffix === "string" ? options.suffix : "";
  const body = deliverable?.value ?? "";
  const text = prefix + body + suffix;
  const bodyRange = { start: prefix.length, end: prefix.length + body.length };
  const rawSegments = Array.isArray(deliverable?.segments) ? deliverable.segments : [];
  const occurrenceData = occurrenceBuilder(
    program ?? {}, id, rootPieceId, bodyRange, rawSegments, prefix.length, signal
  );
  const mappings = occurrenceData.assignments.map((assignment) => projectionSegmentFor(assignment));

  // A coarse transform retains all known input origins for navigation. Each
  // origin is a separate candidate over the same virtual range, intentionally
  // preserving one-to-many provenance.
  for (const assignment of occurrenceData.assignments) {
    for (const origin of assignment.segment.origins ?? []) {
      if (!origin?.source) continue;
      const occurrence = occurrenceForOrigin(occurrenceData, assignment.segment, origin);
      mappings.push({
        virtual: clone(assignment.range),
        source: sourceLocation(origin.source),
        pieceId: origin.chunk ?? occurrence.pieceId,
        occurrenceId: occurrence.id,
        expansionPath: clone(occurrence.expansionPath),
        kind: "opaque",
        role: "transform-origin",
        startAffinity: "right",
        endAffinity: "left",
        transformChain: transformsForSegment(assignment.segment)
      });
    }
  }

  if (prefix.length) mappings.push({
    virtual: { start: 0, end: prefix.length },
    pieceId: rootPieceId,
    occurrenceId: occurrenceData.root.id,
    expansionPath: [rootPieceId],
    kind: "synthetic",
    role: "prefix",
    startAffinity: "right",
    endAffinity: "left",
    transformChain: []
  });
  if (suffix.length) mappings.push({
    virtual: { start: bodyRange.end, end: text.length },
    pieceId: rootPieceId,
    occurrenceId: occurrenceData.root.id,
    expansionPath: [rootPieceId],
    kind: "synthetic",
    role: "suffix",
    startAffinity: "right",
    endAffinity: "left",
    transformChain: []
  });

  const contentMappings = coalesceProjectionSegments(mappings);
  const invocationMappings = occurrenceData.occurrences
    .filter((occurrence) => occurrence.parentOccurrenceId && occurrence.invocationSource)
    .map((occurrence) => ({
      virtual: { start: occurrence.virtual.start, end: occurrence.virtual.start },
      source: clone(occurrence.invocationSource),
      pieceId: occurrence.pieceId,
      occurrenceId: occurrence.id,
      expansionPath: clone(occurrence.expansionPath),
      kind: "anchored",
      role: "invocation",
      startAffinity: "right",
      endAffinity: "left",
      transformChain: []
    }));
  const finalMappings = coalesceProjectionSegments([...contentMappings, ...invocationMappings]);
  const occurrences = occurrenceData.occurrences.map((occurrence) => ({
    ...occurrence,
    invocationSource: sourceLocation(occurrence.invocationSource),
    definitionSource: sourceLocation(occurrence.definitionSource)
  }));
  const lineIndex = createLineIndex(text);
  const sourceLineIndexes = Object.fromEntries(Object.entries(sourceTextsRecord(options.sourceTexts))
    .filter(([, sourceText]) => typeof sourceText === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceUri, sourceText]) => [sourceUri, createLineIndex(sourceText)]));
  const indexes = buildProjectionIndexes(finalMappings, occurrences);
  const projectionDiagnostics = [
    ...(program?.diagnostics ?? []).map(clone),
    ...(!deliverable ? [{
      code: "RVP001",
      severity: "error",
      message: `Unknown projection artifact: ${artifactId}`,
      source: defaultSource(artifactId)
    }] : []),
    ...validateProjectionSegments(text, finalMappings).map((issue) => ({
      ...issue,
      severity: "error",
      source: sourceLocation(deliverable?.source) ?? defaultSource(artifactId)
    }))
  ];
  const capabilities = deepFreeze({
    ...defaultCapabilities(stage),
    ...(options.capabilities ?? {})
  });
  const snapshotId = String(options.snapshotId ?? `snapshot:${stableHash({
    documents: program?.documents,
    artifactId,
    text,
    mappings: finalMappings
  })}`);
  const inputHash = stableHash({
    artifactId,
    workspaceId,
    targetId,
    stage,
    languageId,
    rootPieceId,
    uri,
    prefix,
    suffix,
    capabilities,
    deliverable,
    chunks: reachableProjectionChunks(program, rootPieceId)
  });
  const document = {
    id,
    uri,
    snapshotId,
    sourceVersions: clone(options.sourceVersions ?? {}),
    version: isInteger(options.version) && options.version > 0 ? options.version : 1,
    workspaceId,
    artifactId,
    targetId,
    stage,
    languageId,
    text,
    mappings: finalMappings,
    occurrences,
    lineIndex,
    sourceLineIndexes,
    indexes,
    contentHash: stableHash(text),
    inputHash,
    artifactSource: sourceLocation(deliverable?.source),
    projectionDiagnostics,
    capabilities
  };
  return deepFreeze(document);
};

export const projectionInputHash = (program, options = {}) => {
  const artifactId = options.artifactId ?? Object.keys(program?.deliverables ?? {}).sort()[0];
  const deliverable = program?.deliverables?.[artifactId];
  const workspaceId = options.workspaceId ?? "workspace";
  const targetId = options.targetId ?? "default";
  const stage = projectionStages.has(options.stage) ? options.stage : "assembled";
  const rootPieceId = deliverable?.from ?? options.rootPieceId ?? "<missing>";
  const languageId = options.languageId ??
    program?.chunks?.[rootPieceId]?.metadata?.language ?? languageForName(artifactId);
  const uri = options.uri ?? createVirtualUri({
    workspaceId,
    targetId,
    artifactId,
    stage,
    path: options.path ?? artifactId
  });
  const capabilities = {
    ...defaultCapabilities(stage),
    ...(options.capabilities ?? {})
  };
  return stableHash({
    artifactId,
    workspaceId,
    targetId,
    stage,
    languageId,
    rootPieceId,
    uri,
    prefix: typeof options.prefix === "string" ? options.prefix : "",
    suffix: typeof options.suffix === "string" ? options.suffix : "",
    capabilities,
    deliverable,
    chunks: reachableProjectionChunks(program, rootPieceId)
  });
};
