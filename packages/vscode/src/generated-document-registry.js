const supportedStages = new Set([
  "authoring",
  "assembled",
  "transformed",
  "emitted"
]);

const requireString = (value, name) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(name + " must be a nonempty string.");
  }
  return value;
};

const requireVersion = (value) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError("Generated document version must be a nonnegative integer.");
  }
  return value;
};

const normalizeRange = (range, name, maximum) => {
  const start = range?.start;
  const end = range?.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end < start || end > maximum) {
    throw new TypeError(name + " must be a valid half-open offset range.");
  }
  return { start, end };
};

const encodeSegment = (value, name) =>
  encodeURIComponent(requireString(value, name));

const encodePath = (value) => requireString(value, "Generated document path")
  .split("/")
  .filter(Boolean)
  .map((segment) => encodeURIComponent(segment))
  .join("/");

/**
 * Build the stable logical URI used by a generated document. Snapshot and
 * projection versions are deliberately excluded so an open editor can refresh
 * in place.
 */
export const createGeneratedDocumentUri = ({
  workspaceId,
  targetId,
  artifactId,
  stage,
  path = artifactId
}) => {
  if (!supportedStages.has(stage)) {
    throw new TypeError("Generated document stage is not supported: " + String(stage));
  }
  return "pieceful-virtual://" + encodeSegment(workspaceId, "Workspace ID") + "/" +
    encodeSegment(targetId, "Target ID") + "/" +
    encodeSegment(artifactId, "Artifact ID") + "/" +
    encodeSegment(stage, "Projection stage") + "/" + encodePath(path);
};

const stableUriFor = (document) => document.uri ?? createGeneratedDocumentUri(document);

const cloneSource = (source) => source === undefined
  ? undefined
  : structuredClone(source);

const normalizeOccurrence = (occurrence, projectionId, textLength) => ({
  id: requireString(occurrence?.id, "Occurrence ID"),
  pieceId: requireString(occurrence?.pieceId, "Occurrence piece ID"),
  projectionId: occurrence?.projectionId === undefined
    ? projectionId
    : requireString(occurrence.projectionId, "Occurrence projection ID"),
  virtual: normalizeRange(occurrence?.virtual, "Occurrence virtual range", textLength),
  ...(occurrence?.invocationSource === undefined
    ? {}
    : { invocationSource: cloneSource(occurrence.invocationSource) }),
  expansionPath: Object.freeze(
    (occurrence?.expansionPath ?? []).map((pieceId) =>
      requireString(pieceId, "Expansion path piece ID")
    )
  ),
  ...(occurrence?.parentOccurrenceId === undefined
    ? {}
    : { parentOccurrenceId: requireString(
      occurrence.parentOccurrenceId,
      "Parent occurrence ID"
    ) })
});

const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const normalizeDocument = (document) => {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("Generated document must be an object.");
  }
  const projectionId = requireString(document.id ?? document.projectionId, "Projection ID");
  const text = typeof document.text === "string"
    ? document.text
    : (() => { throw new TypeError("Generated document text must be a string."); })();
  const uri = stableUriFor(document);
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("Generated document URI must be an absolute URI.");
  }
  if (parsed.protocol !== "pieceful-virtual:") {
    throw new TypeError("Generated document URI must use the pieceful-virtual scheme.");
  }
  if (!supportedStages.has(document.stage)) {
    throw new TypeError("Generated document stage is not supported: " + String(document.stage));
  }

  const occurrences = (document.occurrences ?? []).map((occurrence) =>
    normalizeOccurrence(occurrence, projectionId, text.length)
  );
  const ids = new Set();
  for (const occurrence of occurrences) {
    if (ids.has(occurrence.id)) {
      throw new TypeError("Generated document occurrence IDs must be unique: " + occurrence.id);
    }
    if (occurrence.projectionId !== projectionId) {
      throw new TypeError("Generated document occurrence belongs to another projection: " + occurrence.id);
    }
    ids.add(occurrence.id);
  }
  occurrences.sort((left, right) =>
    left.virtual.start - right.virtual.start ||
    left.virtual.end - right.virtual.end ||
    left.id.localeCompare(right.id)
  );

  return deepFreeze({
    uri,
    id: projectionId,
    projectionId,
    snapshotId: requireString(document.snapshotId, "Snapshot ID"),
    version: requireVersion(document.version),
    workspaceId: requireString(document.workspaceId, "Workspace ID"),
    artifactId: requireString(document.artifactId, "Artifact ID"),
    targetId: requireString(document.targetId, "Target ID"),
    stage: document.stage,
    languageId: requireString(document.languageId, "Language ID"),
    text,
    contentHash: typeof document.contentHash === "string" ? document.contentHash : undefined,
    occurrences: Object.freeze(occurrences),
    state: "current",
    staleReason: undefined,
    invalidated: false
  });
};

const stateChange = (entry, values) => deepFreeze({ ...entry, ...values });

const sameProjectionIdentity = (left, right) =>
  left.projectionId === right.projectionId &&
  left.workspaceId === right.workspaceId &&
  left.artifactId === right.artifactId &&
  left.targetId === right.targetId &&
  left.stage === right.stage;

/**
 * Maintain current and last-good generated documents without binding the state
 * to a particular editor API. Returned records are deeply frozen so callers
 * cannot accidentally treat generated content as a writable source buffer.
 */
export const createGeneratedDocumentRegistry = () => {
  const documents = new Map();
  const listeners = new Set();

  const notify = (change) => {
    for (const listener of [...listeners]) listener(change);
  };

  const lookup = (uri) => documents.get(String(uri));

  const update = (document) => {
    const next = normalizeDocument(document);
    const previous = documents.get(next.uri);
    if (previous && !sameProjectionIdentity(previous, next)) {
      throw new Error("Stable generated document URI was reused for another projection.");
    }
    if (previous && next.version < previous.version) {
      throw new Error("Generated document version moved backwards.");
    }
    if (previous && next.version === previous.version) {
      const contentUnchanged = previous.text === next.text &&
        previous.languageId === next.languageId &&
        JSON.stringify(previous.occurrences) === JSON.stringify(next.occurrences);
      if (!contentUnchanged || previous.invalidated) {
        throw new Error("Generated document version must increase when content or state changes.");
      }
      if (previous.snapshotId === next.snapshotId && previous.state === "current") return previous;
    }
    documents.set(next.uri, next);
    notify(deepFreeze({ type: previous ? "updated" : "added", uri: next.uri, previous, document: next }));
    return next;
  };

  const markStale = (uri, reason = "Projection is being recomputed.") => {
    const previous = lookup(uri);
    if (!previous) return undefined;
    if (previous.state === "stale" && previous.staleReason === reason && !previous.invalidated) {
      return previous;
    }
    const next = stateChange(previous, {
      state: "stale",
      staleReason: requireString(reason, "Stale reason"),
      invalidated: false
    });
    documents.set(next.uri, next);
    notify(deepFreeze({ type: "stale", uri: next.uri, previous, document: next }));
    return next;
  };

  const invalidate = (uri, reason = "Projection is no longer available.") => {
    const previous = lookup(uri);
    if (!previous) return undefined;
    if (previous.invalidated && previous.staleReason === reason) return previous;
    const next = stateChange(previous, {
      state: "stale",
      staleReason: requireString(reason, "Invalidation reason"),
      invalidated: true
    });
    documents.set(next.uri, next);
    notify(deepFreeze({ type: "invalidated", uri: next.uri, previous, document: next }));
    return next;
  };

  const remove = (uri) => {
    const key = String(uri);
    const previous = documents.get(key);
    if (!previous) return false;
    documents.delete(key);
    notify(deepFreeze({ type: "removed", uri: key, previous }));
    return true;
  };

  const getContent = (uri, { allowStale = true, allowInvalidated = true } = {}) => {
    const document = lookup(uri);
    if (!document) return undefined;
    if (!allowStale && document.state !== "current") return undefined;
    if (!allowInvalidated && document.invalidated) return undefined;
    return document.text;
  };

  const occurrencesFor = (uri, { pieceId } = {}) => {
    const document = lookup(uri);
    if (!document) return Object.freeze([]);
    return Object.freeze(document.occurrences.filter((occurrence) =>
      pieceId === undefined || occurrence.pieceId === pieceId
    ));
  };

  const adjacentOccurrence = (uri, currentId, direction, options = {}) => {
    const document = lookup(uri);
    if (!document) return undefined;
    const current = document.occurrences.find((occurrence) => occurrence.id === currentId);
    const pieceId = options.pieceId ?? current?.pieceId;
    const occurrences = document.occurrences.filter((occurrence) =>
      pieceId === undefined || occurrence.pieceId === pieceId
    );
    if (!occurrences.length) return undefined;
    const index = current
      ? occurrences.findIndex((occurrence) => occurrence.id === current.id)
      : -1;
    if (index === -1) return direction > 0 ? occurrences[0] : occurrences.at(-1);
    const nextIndex = index + direction;
    if (nextIndex >= 0 && nextIndex < occurrences.length) return occurrences[nextIndex];
    if (options.wrap === false) return undefined;
    return direction > 0 ? occurrences[0] : occurrences.at(-1);
  };

  return Object.freeze({
    update,
    markStale,
    invalidate,
    remove,
    get: lookup,
    getContent,
    list: () => Object.freeze([...documents.values()].sort((left, right) =>
      left.uri.localeCompare(right.uri)
    )),
    occurrences: occurrencesFor,
    nextOccurrence: (uri, currentId, options) =>
      adjacentOccurrence(uri, currentId, 1, options),
    previousOccurrence: (uri, currentId, options) =>
      adjacentOccurrence(uri, currentId, -1, options),
    onDidChange(listener) {
      if (typeof listener !== "function") throw new TypeError("Registry listener must be a function.");
      listeners.add(listener);
      return Object.freeze({ dispose: () => listeners.delete(listener) });
    },
    clear() {
      for (const uri of [...documents.keys()]) remove(uri);
    }
  });
};
