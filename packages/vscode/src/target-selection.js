const requireString = (value, name) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(name + " must be a nonempty string.");
  }
  return value;
};

const normalizeScope = (scope) => ({
  workspaceId: requireString(scope?.workspaceId, "Target-selection workspace ID"),
  documentUri: requireString(scope?.documentUri, "Target-selection document URI"),
  ...(scope?.pieceId === undefined
    ? {}
    : { pieceId: requireString(scope.pieceId, "Target-selection piece ID") })
});

const scopeKey = (scope) => {
  const normalized = normalizeScope(scope);
  return JSON.stringify([
    normalized.workspaceId,
    normalized.documentUri,
    normalized.pieceId ?? null
  ]);
};

const normalizeSelection = (selection) => ({
  targetId: requireString(selection?.targetId, "Selected target ID"),
  ...(selection?.artifactId === undefined
    ? {}
    : { artifactId: requireString(selection.artifactId, "Selected artifact ID") }),
  ...(selection?.projectionId === undefined
    ? {}
    : { projectionId: requireString(selection.projectionId, "Selected projection ID") }),
  ...(selection?.occurrenceId === undefined
    ? {}
    : { occurrenceId: requireString(selection.occurrenceId, "Selected occurrence ID") })
});

const normalizeCandidate = (candidate) => ({
  targetId: requireString(candidate?.targetId, "Candidate target ID"),
  artifactId: requireString(candidate?.artifactId, "Candidate artifact ID"),
  ...(candidate?.projectionId === undefined
    ? {}
    : { projectionId: requireString(candidate.projectionId, "Candidate projection ID") }),
  ...(candidate?.occurrenceId === undefined
    ? {}
    : { occurrenceId: requireString(candidate.occurrenceId, "Candidate occurrence ID") }),
  ...(candidate?.semanticIdentity === undefined
    ? {}
    : { semanticIdentity: requireString(candidate.semanticIdentity, "Candidate semantic identity") })
});

const candidateKey = (candidate) => [
  candidate.targetId,
  candidate.artifactId,
  candidate.projectionId ?? "",
  candidate.occurrenceId ?? ""
].join("\u0000");

export const normalizeTargetCandidates = (candidates) => {
  if (!Array.isArray(candidates)) throw new TypeError("Target candidates must be an array.");
  const unique = new Map();
  for (const raw of candidates) {
    const candidate = normalizeCandidate(raw);
    unique.set(candidateKey(candidate), Object.freeze(candidate));
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    left.targetId.localeCompare(right.targetId) ||
    left.artifactId.localeCompare(right.artifactId) ||
    (left.projectionId ?? "").localeCompare(right.projectionId ?? "") ||
    (left.occurrenceId ?? "").localeCompare(right.occurrenceId ?? "")
  ));
};

const candidatesForSelection = (candidates, selection) => candidates.filter((candidate) =>
  candidate.targetId === selection.targetId &&
  (selection.artifactId === undefined || candidate.artifactId === selection.artifactId) &&
  (selection.projectionId === undefined || candidate.projectionId === selection.projectionId) &&
  (selection.occurrenceId === undefined || candidate.occurrenceId === selection.occurrenceId)
);

export const targetSelectionAvailable = (selection, candidates) =>
  candidatesForSelection(normalizeTargetCandidates(candidates), normalizeSelection(selection)).length > 0;

const selectedResult = (reason, selection, candidates, applicable) => {
  const selectedCandidates = candidatesForSelection(candidates, selection);
  const artifacts = [...new Set(selectedCandidates.map(({ artifactId }) => artifactId))];
  const projections = [...new Set(selectedCandidates.map(({ projectionId }) => projectionId))];
  const occurrences = [...new Set(selectedCandidates.map(({ occurrenceId }) => occurrenceId))];
  return Object.freeze({
    status: "selected",
    reason,
    targetId: selection.targetId,
    ...(selection.artifactId !== undefined
      ? { artifactId: selection.artifactId }
      : artifacts.length === 1
        ? { artifactId: artifacts[0] }
        : {}),
    ...(selection.projectionId !== undefined
      ? { projectionId: selection.projectionId }
      : projections.length === 1 && projections[0] !== undefined
        ? { projectionId: projections[0] }
        : {}),
    ...(selection.occurrenceId !== undefined
      ? { occurrenceId: selection.occurrenceId }
      : occurrences.length === 1 && occurrences[0] !== undefined
        ? { occurrenceId: occurrences[0] }
        : {}),
    candidates: Object.freeze(selectedCandidates),
    applicableTargetIds: applicable
  });
};

const validSelection = (selection, candidates) => {
  if (!selection) return undefined;
  const normalized = normalizeSelection(selection);
  return candidatesForSelection(candidates, normalized).length ? normalized : undefined;
};

/**
 * Apply the normative active-target priority order. An ambiguous result is
 * explicit and contains no arbitrarily selected candidate.
 */
export const resolveActiveTarget = ({
  candidates: rawCandidates,
  explicitPieceSelection,
  explicitDocumentSelection,
  generatedViewSelection,
  defaultSelection,
  defaultTargetId
}) => {
  const candidates = normalizeTargetCandidates(rawCandidates);
  const applicable = Object.freeze([...new Set(candidates.map(({ targetId }) => targetId))]);
  if (!candidates.length) {
    return Object.freeze({
      status: "unavailable",
      reason: "no-applicable-target",
      candidates,
      applicableTargetIds: applicable
    });
  }

  const priorities = [
    ["explicit-piece", explicitPieceSelection],
    ["explicit-document", explicitDocumentSelection],
    ["generated-view", generatedViewSelection]
  ];
  for (const [reason, raw] of priorities) {
    const selection = validSelection(raw, candidates);
    if (selection) return selectedResult(reason, selection, candidates, applicable);
  }

  const artifacts = new Map();
  for (const candidate of candidates) {
    artifacts.set(candidate.targetId + "\u0000" + candidate.artifactId, candidate);
  }
  if (artifacts.size === 1) {
    const sole = artifacts.values().next().value;
    return selectedResult("sole-artifact", {
      targetId: sole.targetId,
      artifactId: sole.artifactId
    }, candidates, applicable);
  }

  const configuredDefault = defaultSelection ?? (defaultTargetId === undefined
    ? undefined
    : { targetId: defaultTargetId });
  const selection = validSelection(configuredDefault, candidates);
  if (selection) return selectedResult("configured-default", selection, candidates, applicable);

  return Object.freeze({
    status: "ambiguous",
    reason: "target-selection-required",
    candidates,
    applicableTargetIds: applicable
  });
};

const initialEntries = (value) => {
  if (value === undefined) return [];
  if (!value || value.version !== 1 || !Array.isArray(value.selections)) {
    throw new TypeError("Persisted target selections must use version 1.");
  }
  return value.selections;
};

/**
 * Store only explicit user selections. Generated-view and configured-default
 * choices remain ephemeral inputs to resolveActiveTarget.
 */
export const createTargetSelectionStore = (persisted) => {
  const values = new Map();
  for (const entry of initialEntries(persisted)) {
    const scope = normalizeScope(entry?.scope);
    values.set(scopeKey(scope), Object.freeze({
      scope: Object.freeze(scope),
      selection: Object.freeze(normalizeSelection(entry?.selection))
    }));
  }

  const exact = (scope) => values.get(scopeKey(scope));
  const selectionFor = (scope) => {
    const normalized = normalizeScope(scope);
    const piece = normalized.pieceId === undefined ? undefined : exact(normalized);
    const document = exact({
      workspaceId: normalized.workspaceId,
      documentUri: normalized.documentUri
    });
    return Object.freeze({
      piece: piece?.selection,
      document: document?.selection
    });
  };

  return Object.freeze({
    set(scope, selection) {
      const normalizedScope = normalizeScope(scope);
      const entry = Object.freeze({
        scope: Object.freeze(normalizedScope),
        selection: Object.freeze(normalizeSelection(selection))
      });
      values.set(scopeKey(normalizedScope), entry);
      return entry.selection;
    },
    get(scope) {
      return exact(scope)?.selection;
    },
    selectionsFor: selectionFor,
    delete(scope) {
      return values.delete(scopeKey(scope));
    },
    invalidate(scope, candidates) {
      const key = scopeKey(scope);
      const entry = values.get(key);
      if (!entry || targetSelectionAvailable(entry.selection, candidates)) return undefined;
      values.delete(key);
      return entry.selection;
    },
    resolve(scope, options) {
      const explicit = selectionFor(scope);
      return resolveActiveTarget({
        ...options,
        explicitPieceSelection: explicit.piece,
        explicitDocumentSelection: explicit.document
      });
    },
    toJSON() {
      return {
        version: 1,
        selections: [...values.values()]
          .sort((left, right) => scopeKey(left.scope).localeCompare(scopeKey(right.scope)))
          .map(({ scope, selection }) => ({ scope: { ...scope }, selection: { ...selection } }))
      };
    },
    clear() {
      values.clear();
    }
  });
};
