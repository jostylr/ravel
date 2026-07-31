const classificationRank = Object.freeze({
  automatic: 0,
  preview: 1,
  action: 2,
  rejected: 3
});

const rangeValue = (value) => {
  if (Number.isInteger(value)) return value;
  if (Number.isInteger(value?.offset)) return value.offset;
  return undefined;
};

const normalizeRange = (range) => {
  const start = rangeValue(range?.start);
  const end = rangeValue(range?.end);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
    ? { start, end }
    : null;
};

const normalizedTextEdit = (edit) => {
  const range = normalizeRange(edit?.range);
  const text = edit?.newText ?? edit?.text;
  if (!range || typeof text !== "string") return null;
  return { range, text };
};

const documentEdits = (workspaceEdit) => {
  const documents = [];
  if (workspaceEdit?.changes && !Array.isArray(workspaceEdit.changes)) {
    for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
      documents.push({ uri, edits });
    }
  }
  for (const change of workspaceEdit?.documentChanges ?? workspaceEdit?.documents ?? []) {
    if (change?.kind === "create" || change?.kind === "rename" || change?.kind === "delete") {
      documents.push({ resourceOperation: change });
      continue;
    }
    documents.push({
      uri: change?.textDocument?.uri ?? change?.uri,
      version: change?.textDocument?.version ?? change?.version,
      edits: change?.edits
    });
  }
  return documents;
};

const projectionForUri = (service, uri) => {
  if (typeof service?.getProjectionByUri === "function") {
    return service.getProjectionByUri(uri);
  }
  if (typeof service?.listProjections === "function") {
    return service.listProjections().find((entry) => entry.uri === uri);
  }
  if (service?.projections instanceof Map) {
    return [...service.projections.values()].find((entry) => entry.uri === uri);
  }
  return undefined;
};

const sourceFromMatch = (match) => {
  const source = match?.source ?? match?.sourceRange ?? match;
  const uri = source?.uri ?? match?.uri;
  const range = normalizeRange(source?.range ?? source);
  return typeof uri === "string" && range ? { uri, range } : null;
};

const mappingKind = (match) =>
  match?.kind ?? match?.mappingKind ?? match?.quality ?? match?.precision;

const exactMapping = (match) => ["exact", "identity"].includes(mappingKind(match));

const sourceVersionFor = (sourceVersions, uri) =>
  sourceVersions?.get?.(uri) ?? sourceVersions?.[uri];

const classifyOne = (service, projection, edit, options) => {
  const mapped = typeof service?.toSource === "function"
    ? service.toSource(projection.id, edit.range)
    : [];
  const matches = Array.isArray(mapped) ? mapped : mapped ? [mapped] : [];
  const exact = matches.filter((match) => exactMapping(match) && sourceFromMatch(match));

  if (exact.length === 1) {
    const source = sourceFromMatch(exact[0]);
    const sourceEdit = { ...source, text: edit.text };
    if (exact[0].writable === false || projection.capabilities?.writableEdits === false) {
      return {
        classification: "rejected",
        reason: "non-writable-mapping",
        message: "The exact mapping is not declared writable at this projection stage.",
        projection,
        virtualEdit: edit,
        sourceEdit
      };
    }
    if (typeof options.isWritableSource !== "function") {
      return {
        classification: "rejected",
        reason: "writability-unverified",
        message: "The host did not prove that the mapped source is writable.",
        projection,
        virtualEdit: edit,
        sourceEdit
      };
    }
    if (!options.isWritableSource(source.uri)) {
      return {
        classification: "rejected",
        reason: "outside-workspace",
        message: "The mapped source is outside the writable workspace.",
        projection,
        virtualEdit: edit,
        sourceEdit
      };
    }
    const version = sourceVersionFor(options.sourceVersions, source.uri);
    if (!Number.isInteger(version) || version < 0) {
      return {
        classification: "rejected",
        reason: "source-version-unavailable",
        message: "The host cannot prove that the mapped source version is current.",
        projection,
        virtualEdit: edit,
        sourceEdit
      };
    }
    const projectedVersion = sourceVersionFor(projection.sourceVersions, source.uri);
    if (!Number.isInteger(projectedVersion) || projectedVersion < 0 ||
        projectedVersion !== version) {
      return {
        classification: "rejected",
        reason: "projection-source-version-mismatch",
        message: "The projection was not built from the host-current source version.",
        projection,
        virtualEdit: edit,
        sourceEdit,
        expectedVersion: projectedVersion,
        actualVersion: version
      };
    }
    return {
      classification: "automatic",
      projection,
      virtualEdit: edit,
      sourceEdit
    };
  }

  if (exact.length > 1) {
    return {
      classification: "preview",
      reason: "ambiguous-source",
      message: "The generated edit maps exactly to more than one authored range.",
      projection,
      virtualEdit: edit,
      matches
    };
  }

  const qualities = new Set(matches.map(mappingKind).filter(Boolean));
  if (qualities.has("synthetic") && options.importDestination) {
    return {
      classification: "action",
      reason: "import-destination",
      message: "The generated edit needs a declared imports or preamble destination.",
      projection,
      virtualEdit: edit,
      action: {
        kind: "route-import",
        destination: options.importDestination,
        text: edit.text
      }
    };
  }
  if (qualities.has("anchored") || qualities.has("transformed") ||
      qualities.has("coarse")) {
    return {
      classification: "preview",
      reason: "non-exact-mapping",
      message: "The generated edit has provenance but no exact reversible character mapping.",
      projection,
      virtualEdit: edit,
      matches
    };
  }
  return {
    classification: "rejected",
    reason: qualities.has("opaque")
      ? "opaque-transform"
      : qualities.has("synthetic")
        ? "synthetic-text"
        : "unmapped-text",
    message: qualities.has("opaque")
      ? "The generated edit crosses an opaque transform."
      : qualities.has("synthetic")
        ? "Synthetic generated text has no authored destination."
        : "The generated edit has no authored destination.",
    projection,
    virtualEdit: edit,
    matches
  };
};

const overlaps = (left, right) =>
  left.range.start < right.range.end && right.range.start < left.range.end ||
  left.range.start === left.range.end && right.range.start === right.range.end &&
    left.range.start === right.range.start;

const classifyConflicts = (entries) => {
  const byUri = new Map();
  for (const entry of entries) {
    if (!entry.sourceEdit) continue;
    const list = byUri.get(entry.sourceEdit.uri) ?? [];
    list.push(entry);
    byUri.set(entry.sourceEdit.uri, list);
  }
  for (const list of byUri.values()) {
    list.sort((left, right) =>
      left.sourceEdit.range.start - right.sourceEdit.range.start ||
      left.sourceEdit.range.end - right.sourceEdit.range.end
    );
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      const current = list[index];
      if (!overlaps(previous.sourceEdit, current.sourceEdit)) continue;
      const identical = previous.sourceEdit.range.start === current.sourceEdit.range.start &&
        previous.sourceEdit.range.end === current.sourceEdit.range.end &&
        previous.sourceEdit.text === current.sourceEdit.text;
      if (identical) {
        current.duplicate = true;
        continue;
      }
      for (const entry of [previous, current]) {
        entry.classification = "rejected";
        entry.reason = "conflicting-source-edits";
        entry.message = "Generated edits request conflicting changes to one authored range.";
      }
    }
  }
};

const sourceDocuments = (entries, sourceVersions) => {
  const documents = new Map();
  for (const entry of entries) {
    if (!entry.sourceEdit || entry.duplicate || entry.classification === "rejected") continue;
    const { uri, range, text } = entry.sourceEdit;
    const document = documents.get(uri) ?? {
      uri,
      version: sourceVersions?.get?.(uri) ?? sourceVersions?.[uri],
      edits: []
    };
    document.edits.push({ range, text });
    documents.set(uri, document);
  }
  for (const document of documents.values()) {
    document.edits.sort((left, right) =>
      right.range.start - left.range.start || right.range.end - left.range.end
    );
  }
  return [...documents.values()].sort((left, right) => left.uri.localeCompare(right.uri));
};

const positiveLimit = (value, fallback) =>
  Number.isInteger(value) && value > 0 ? value : fallback;

const rejectedWorkspaceEdit = (reason, message, details = {}) => ({
  classification: "rejected",
  applicable: false,
  entries: [{ classification: "rejected", reason, message, ...details }],
  sourceEdit: { documents: [] }
});

export const classifyWorkspaceEdit = (workspaceEdit, options = {}) => {
  const service = options.projectionService;
  if (!service) throw new TypeError("classifyWorkspaceEdit requires a projectionService.");
  const limits = {
    documents: positiveLimit(options.limits?.documents, 128),
    edits: positiveLimit(options.limits?.edits, 5_000),
    replacementTextCodeUnits: positiveLimit(
      options.limits?.replacementTextCodeUnits,
      1_000_000
    )
  };
  const documents = documentEdits(workspaceEdit);
  if (documents.length > limits.documents) {
    return rejectedWorkspaceEdit(
      "edit-limit-exceeded",
      "The generated language tool returned too many edited documents.",
      { limit: limits.documents, actual: documents.length }
    );
  }
  let editCount = 0;
  let replacementTextCodeUnits = 0;
  for (const document of documents) {
    if (document.resourceOperation) continue;
    if (!Array.isArray(document.edits)) {
      return rejectedWorkspaceEdit(
        "invalid-edit",
        "The generated language tool returned an invalid edit collection."
      );
    }
    editCount += document.edits.length;
    for (const edit of document.edits) {
      const text = edit?.newText ?? edit?.text;
      if (typeof text === "string") replacementTextCodeUnits += text.length;
    }
    if (editCount > limits.edits ||
        replacementTextCodeUnits > limits.replacementTextCodeUnits) break;
  }
  if (editCount > limits.edits ||
      replacementTextCodeUnits > limits.replacementTextCodeUnits) {
    return rejectedWorkspaceEdit(
      "edit-limit-exceeded",
      "The generated language tool returned an oversized workspace edit.",
      {
        editLimit: limits.edits,
        editCount,
        replacementTextCodeUnitLimit: limits.replacementTextCodeUnits,
        replacementTextCodeUnits
      }
    );
  }
  const entries = [];
  for (const document of documents) {
    if (document.resourceOperation) {
      entries.push({
        classification: "rejected",
        reason: "resource-operation",
        message: "Generated language tools cannot directly create, rename, or delete authored files.",
        resourceOperation: document.resourceOperation
      });
      continue;
    }
    const projection = projectionForUri(service, document.uri);
    if (!projection) {
      entries.push({
        classification: "rejected",
        reason: "unknown-virtual-document",
        message: "The edit targets an unknown or closed virtual document.",
        uri: document.uri
      });
      continue;
    }
    if (document.version !== undefined && document.version !== null &&
        document.version !== projection.version) {
      entries.push({
        classification: "rejected",
        reason: "stale-projection",
        message: "The edit targets a stale projection version.",
        projection,
        expectedVersion: projection.version,
        actualVersion: document.version
      });
      continue;
    }
    for (const supplied of document.edits) {
      const edit = normalizedTextEdit(supplied);
      entries.push(edit
        ? classifyOne(service, projection, edit, options)
        : {
            classification: "rejected",
            reason: "invalid-edit",
            message: "The generated language tool returned an invalid text edit.",
            projection,
            virtualEdit: supplied
          });
    }
  }
  classifyConflicts(entries);
  const classification = entries.reduce((highest, entry) =>
    classificationRank[entry.classification] > classificationRank[highest]
      ? entry.classification
      : highest,
  "automatic");
  return {
    classification,
    applicable: classification === "automatic",
    entries,
    sourceEdit: {
      documents: sourceDocuments(entries, options.sourceVersions)
    }
  };
};

export const validateSourceEditVersions = (sourceEdit, currentVersions) => {
  const stale = [];
  for (const document of sourceEdit?.documents ?? []) {
    const current = currentVersions?.get?.(document.uri) ?? currentVersions?.[document.uri];
    if (!Number.isInteger(document.version) || document.version < 0 ||
        current !== document.version) {
      stale.push({ uri: document.uri, expected: document.version, actual: current });
    }
  }
  return { valid: stale.length === 0, stale };
};
