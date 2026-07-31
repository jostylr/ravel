import {
  buildVirtualDocument,
  createProjectionId,
  projectionInputHash
} from "./builder.js";
import { generatedContext as contextForOccurrence } from "./context.js";
import {
  mapSourceOffset,
  mapSourceRange,
  mapVirtualOffset,
  mapVirtualRange
} from "./mapping.js";
import { createLineIndex } from "./line-index.js";
import {
  abortError,
  clone,
  deepFreeze,
  isInteger,
  sourceOffset,
  sourceRangeOffsets,
  stableHash,
  throwIfAborted,
  validOffsetRange
} from "./internal.js";

const languageFor = (program, artifactId, requested) => {
  if (requested) return requested;
  const deliverable = program?.deliverables?.[artifactId];
  const declared = program?.chunks?.[deliverable?.from]?.metadata?.language;
  if (declared) return declared;
  const extension = String(artifactId).split(".").at(-1)?.toLowerCase();
  return ({ ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact", py: "python", rs: "rust" })[extension] ?? extension ?? "plaintext";
};

const snapshotIdentity = (snapshot) => String(snapshot?.id ?? snapshot?.snapshotId ??
  `snapshot:${snapshot?.version ?? 0}:${stableHash({
    documents: snapshot?.program?.documents,
    deliverables: snapshot?.program?.deliverables
  })}`);

const projectionOptions = (snapshot, serviceOptions) => {
  const configured = typeof snapshot?.projections === "function"
    ? snapshot.projections(snapshot)
    : snapshot?.projections ??
      (typeof serviceOptions.projections === "function"
        ? serviceOptions.projections(snapshot)
        : serviceOptions.projections);
  if (Array.isArray(configured)) return configured.map(clone);
  return Object.keys(snapshot?.program?.deliverables ?? {}).sort().map((artifactId) => ({ artifactId }));
};

const projectionKey = (program, options, defaults) => createProjectionId({
  workspaceId: options.workspaceId ?? defaults.workspaceId,
  targetId: options.targetId ?? defaults.targetId,
  artifactId: options.artifactId,
  stage: options.stage ?? defaults.stage,
  languageId: languageFor(program, options.artifactId, options.languageId)
});

const safeBoundary = (text, offset, direction) => {
  if (offset <= 0 || offset >= text.length) return offset;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  const splitsSurrogate = previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
  if (!splitsSurrogate) return offset;
  return direction === "left" ? offset - 1 : offset + 1;
};

/** Compute one deterministic replacement, or explicitly choose a full sync. */
export const createProjectionTextChange = (previousText, nextText, { minimumReuseRatio = 0.2 } = {}) => {
  if (previousText === nextText) return deepFreeze({ kind: "none", changes: [] });
  let prefix = 0;
  const shortest = Math.min(previousText.length, nextText.length);
  while (prefix < shortest && previousText[prefix] === nextText[prefix]) prefix += 1;
  prefix = safeBoundary(previousText, prefix, "left");
  let previousSuffix = previousText.length;
  let nextSuffix = nextText.length;
  while (previousSuffix > prefix && nextSuffix > prefix &&
      previousText[previousSuffix - 1] === nextText[nextSuffix - 1]) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }
  previousSuffix = safeBoundary(previousText, previousSuffix, "right");
  nextSuffix = safeBoundary(nextText, nextSuffix, "right");
  const reused = prefix + (previousText.length - previousSuffix);
  const denominator = Math.max(1, previousText.length, nextText.length);
  if (reused / denominator < minimumReuseRatio) {
    return deepFreeze({
      kind: "full",
      changes: [{ range: { start: 0, end: previousText.length }, text: nextText }]
    });
  }
  return deepFreeze({
    kind: "incremental",
    changes: [{
      range: { start: prefix, end: previousSuffix },
      text: nextText.slice(prefix, nextSuffix)
    }]
  });
};

const refreshUnchangedDocument = (previous, snapshot, sourceTexts) => {
  const sourceEntries = sourceTexts instanceof Map
    ? [...sourceTexts.entries()]
    : sourceTexts && typeof sourceTexts === "object"
      ? Object.entries(sourceTexts)
      : undefined;
  const sourceLineIndexes = sourceEntries
    ? Object.fromEntries(sourceEntries
      .filter(([, text]) => typeof text === "string")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([uri, text]) => [uri, createLineIndex(text)]))
    : previous.sourceLineIndexes;
  const currentProgramDiagnostics = (snapshot.program?.diagnostics ?? []).map(clone);
  const localDiagnostics = previous.projectionDiagnostics.filter((diagnostic) =>
    String(diagnostic.code).startsWith("RVP"));
  return deepFreeze({
    ...previous,
    snapshotId: snapshotIdentity(snapshot),
    sourceVersions: clone(snapshot.sourceVersions ?? {}),
    sourceLineIndexes,
    projectionDiagnostics: [...currentProgramDiagnostics, ...localDiagnostics]
  });
};

const freezeDelta = (delta) => deepFreeze(delta);

export class ProjectionService {
  constructor(options = {}) {
    this.options = {
      workspaceId: options.workspaceId ?? "workspace",
      targetId: options.targetId ?? "default",
      stage: options.stage ?? "assembled",
      projections: options.projections,
      yieldEvery: isInteger(options.yieldEvery) && options.yieldEvery > 0 ? options.yieldEvery : 8,
      maxRetainedSnapshots: isInteger(options.maxRetainedSnapshots) && options.maxRetainedSnapshots > 0
        ? options.maxRetainedSnapshots
        : 3,
      backgroundDebounceMs: isInteger(options.backgroundDebounceMs) && options.backgroundDebounceMs >= 0
        ? options.backgroundDebounceMs
        : 40,
      scheduler: options.scheduler ?? (() => new Promise((resolve) => setTimeout(resolve, 0))),
      trace: typeof options.trace === "function" ? options.trace : undefined
    };
    this._documents = new Map();
    this._uris = new Map();
    this._generation = 0;
    this._history = [];
    this._scheduled = undefined;
    this._stats = { built: 0, reused: 0, cancelled: 0, updates: 0 };
  }

  _trace(event, data = {}) {
    this.options.trace?.(deepFreeze({ event, ...data }));
  }

  async update(snapshot, signal) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.program) {
      throw new TypeError("ProjectionService.update requires a snapshot with a Ravel program.");
    }
    throwIfAborted(signal);
    const generation = ++this._generation;
    const snapshotId = snapshotIdentity(snapshot);
    const candidates = projectionOptions(snapshot, this.options);
    const next = new Map();
    const nextUris = new Map();
    const opened = [];
    const changed = [];
    const unchanged = [];
    const textChanges = {};
    let completed = false;
    this._trace("projection-update-started", { snapshotId, projectionCount: candidates.length });
    try {
      for (const [index, candidate] of candidates.entries()) {
        throwIfAborted(signal);
        if (generation !== this._generation) throw abortError("Projection update was superseded.");
        const options = {
          ...candidate,
          workspaceId: candidate.workspaceId ?? this.options.workspaceId,
          targetId: candidate.targetId ?? this.options.targetId,
          stage: candidate.stage ?? this.options.stage,
          snapshotId,
          sourceVersions: snapshot.sourceVersions,
          sourceTexts: snapshot.sourceTexts,
          signal
        };
        const id = projectionKey(snapshot.program, options, this.options);
        const previous = this._documents.get(id);
        const inputHash = projectionInputHash(snapshot.program, options);
        let document;
        if (previous && previous.inputHash === inputHash &&
            (!options.uri || options.uri === previous.uri)) {
          document = refreshUnchangedDocument(previous, snapshot, snapshot.sourceTexts);
          unchanged.push(document);
          this._stats.reused += 1;
          this._trace("projection-reused", { snapshotId, projectionId: id });
        } else {
          document = buildVirtualDocument(snapshot.program, {
            ...options,
            projectionId: id,
            version: previous ? previous.version + 1 : 1
          });
          this._stats.built += 1;
          if (previous) {
            changed.push(document);
            textChanges[id] = createProjectionTextChange(previous.text, document.text);
          } else {
            opened.push(document);
            textChanges[id] = deepFreeze({
              kind: "full",
              changes: [{ range: { start: 0, end: 0 }, text: document.text }]
            });
          }
          this._trace("projection-completed", { snapshotId, projectionId: id, version: document.version });
        }
        if (next.has(id)) {
          throw new TypeError(`Projection update contains duplicate projection ID: ${id}`);
        }
        const uriOwner = nextUris.get(document.uri);
        if (uriOwner && uriOwner !== id) {
          throw new TypeError(
            `Projection update maps multiple projection IDs to the same virtual URI: ${document.uri}`
          );
        }
        next.set(id, document);
        nextUris.set(document.uri, id);
        if ((index + 1) % this.options.yieldEvery === 0 && index + 1 < candidates.length) {
          await this.options.scheduler();
        }
      }
      throwIfAborted(signal);
      if (generation !== this._generation) throw abortError("Projection update was superseded.");
      const closed = [...this._documents.values()].filter((document) => !next.has(document.id));
      this._documents = next;
      this._uris = new Map([...next.values()].map((document) => [document.uri, document]));
      this._stats.updates += 1;
      const delta = freezeDelta({
        snapshotId,
        sourceVersions: clone(snapshot.sourceVersions ?? {}),
        opened,
        changed,
        unchanged,
        closed,
        textChanges,
        projectionDiagnostics: (snapshot.program.diagnostics ?? []).map(clone)
      });
      this._history.push({
        snapshotId,
        projectionIds: [...next.keys()],
        versions: Object.fromEntries([...next].map(([id, document]) => [id, document.version]))
      });
      while (this._history.length > this.options.maxRetainedSnapshots) this._history.shift();
      completed = true;
      return delta;
    } finally {
      if (!completed) {
        this._stats.cancelled += 1;
        this._trace("projection-cancelled", { snapshotId });
      }
    }
  }

  scheduleUpdate(snapshot, { signal, priority = "background" } = {}) {
    if (priority === "interactive") {
      if (this._scheduled) {
        clearTimeout(this._scheduled.timer);
        this._scheduled.reject(abortError("Background projection was superseded."));
        this._scheduled = undefined;
      }
      return this.update(snapshot, signal);
    }
    if (this._scheduled) {
      clearTimeout(this._scheduled.timer);
      this._scheduled.reject(abortError("Background projection was superseded."));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._scheduled = undefined;
        this.update(snapshot, signal).then(resolve, reject);
      }, this.options.backgroundDebounceMs);
      this._scheduled = { timer, reject };
    });
  }

  getProjection(id) {
    return this._documents.get(id);
  }

  getProjectionByUri(uri) {
    return this._uris.get(uri);
  }

  listProjections() {
    return deepFreeze([...this._documents.values()].sort((left, right) => left.id.localeCompare(right.id)));
  }

  listProjectionsForSource(source) {
    const uri = source?.uri;
    const range = sourceRangeOffsets(source);
    if (typeof uri !== "string" || !range) return deepFreeze([]);
    return deepFreeze(this.listProjections().filter((document) => {
      const result = range.start === range.end
        ? mapSourceOffset(document, uri, range.start)
        : mapSourceRange(document, uri, range);
      return result.ok && result.matches.length > 0;
    }).map((document) => ({
      projectionId: document.id,
      uri: document.uri,
      artifactId: document.artifactId,
      targetId: document.targetId,
      stage: document.stage,
      version: document.version
    })));
  }

  listOccurrences(pieceId, targetId) {
    if (typeof pieceId !== "string") return deepFreeze([]);
    return deepFreeze(this.listProjections().flatMap((document) =>
      (targetId === undefined || document.targetId === targetId)
        ? document.occurrences.filter((occurrence) => occurrence.pieceId === pieceId)
        : []));
  }

  toVirtual(source, selection = {}) {
    const uri = source?.uri;
    const range = sourceRangeOffsets(source);
    const offset = sourceOffset(source?.offset ?? source?.position ?? source?.range?.start);
    if (typeof uri !== "string" || (!range && !isInteger(offset))) return deepFreeze([]);
    const results = [];
    for (const document of this.listProjections()) {
      if (selection.projectionId && selection.projectionId !== document.id) continue;
      if (selection.targetId && selection.targetId !== document.targetId) continue;
      if (selection.artifactId && selection.artifactId !== document.artifactId) continue;
      if (selection.stage && selection.stage !== document.stage) continue;
      const query = range && range.start !== range.end
        ? mapSourceRange(document, uri, range, selection)
        : mapSourceOffset(document, uri, range?.start ?? offset, selection);
      if (query.ok) results.push(...query.matches);
    }
    return deepFreeze(results);
  }

  toSource(projectionId, virtual, options = {}) {
    const document = this._documents.get(projectionId);
    if (!document) return deepFreeze([]);
    const query = validOffsetRange(virtual)
      ? (virtual.start === virtual.end
          ? mapVirtualOffset(document, virtual.start, options)
          : mapVirtualRange(document, virtual, options))
      : mapVirtualOffset(document, virtual, options);
    return deepFreeze(query.ok ? query.matches : []);
  }

  generatedContext(occurrenceId, options = {}) {
    for (const document of this._documents.values()) {
      if (document.indexes.occurrenceById[occurrenceId] !== undefined) {
        return contextForOccurrence(document, occurrenceId, options);
      }
    }
    return deepFreeze({ ok: false, reason: "unknown-occurrence" });
  }

  getStats() {
    return deepFreeze({
      ...this._stats,
      retainedSnapshots: this._history.length,
      currentProjections: this._documents.size
    });
  }

  dispose() {
    ++this._generation;
    if (this._scheduled) {
      clearTimeout(this._scheduled.timer);
      this._scheduled.reject(abortError("Projection service was disposed."));
      this._scheduled = undefined;
    }
    this._documents.clear();
    this._uris.clear();
    this._history.length = 0;
  }
}

export const createProjectionService = (options) => new ProjectionService(options);
