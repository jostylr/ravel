import {
  BRIDGE_ERROR_CODES,
  LanguageBridgeError,
  requireLanguageRequestSupport,
  supportsLanguageRequest,
  throwIfAborted
} from "@pieceful/ravel-language-bridge";
import {
  classifyWorkspaceEdit,
  validateSourceEditVersions
} from "./edits.js";

const exactKinds = new Set(["exact", "identity"]);
const writableRequestKinds = new Set(["completionDetails", "rename"]);
const exactCursorRequestKinds = new Set([
  "completion",
  "completionDetails",
  "signatureHelp",
  "prepareRename",
  "rename"
]);
const locationArrayKinds = new Set([
  "definition",
  "typeDefinition",
  "references",
  "documentSymbols",
  "workspaceSymbols",
  "prepareCallHierarchy"
]);

const mappingKind = (match) =>
  match?.kind ?? match?.mappingKind ?? match?.quality ?? match?.precision;

const projectionIdFor = (match) =>
  match?.projectionId ?? match?.projection?.id ?? match?.id;

const virtualOffsetFor = (match) =>
  match?.virtualOffset ?? match?.offset ?? match?.position?.offset ??
  match?.virtual?.offset ?? match?.virtual?.start;

const occurrenceIdFor = (match) =>
  match?.occurrenceId ?? match?.occurrence?.id;

const targetIdFor = (match, projection) =>
  match?.targetId ?? match?.target?.id ?? projection?.targetId;

const artifactIdFor = (match, projection) =>
  match?.artifactId ?? match?.artifact?.id ?? projection?.artifactId;

const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

const rangeValue = (value) => Number.isInteger(value)
  ? value
  : Number.isInteger(value?.offset)
    ? value.offset
    : undefined;

const offsetRange = (range) => {
  const start = rangeValue(range?.start);
  const end = rangeValue(range?.end);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
    ? { start, end }
    : null;
};

const sourceLocation = (match) => {
  const source = match?.source ?? match?.sourceRange ?? match;
  const uri = source?.uri ?? match?.uri;
  const range = offsetRange(source?.range ?? source);
  return typeof uri === "string" && range ? { uri, range } : null;
};

const projectionForUri = (service, uri, known) => {
  const cached = known.get(uri);
  if (cached) return cached;
  const projection = service.getProjectionByUri?.(uri) ??
    service.listProjections?.().find((entry) => entry.uri === uri) ??
    (service.projections instanceof Map
      ? [...service.projections.values()].find((entry) => entry.uri === uri)
      : undefined);
  if (projection) known.set(uri, projection);
  return projection;
};

const sourceMatchesForLocation = (service, projection, location) => {
  const range = offsetRange(location?.range);
  if (!projection || !range) return [];
  return asArray(service.toSource(projection.id, range));
};

const bestSourceMatch = (matches) =>
  matches.find((match) => exactKinds.has(mappingKind(match)) && sourceLocation(match)) ??
  matches.find((match) => sourceLocation(match));

const sourceLocationWithContext = (location, projection, match) => {
  const source = sourceLocation(match);
  if (!source) return null;
  return {
    ...location,
    uri: source.uri,
    range: source.range,
    generated: {
      uri: projection.uri,
      range: offsetRange(location.range),
      projectionId: projection.id,
      targetId: projection.targetId,
      artifactId: projection.artifactId,
      stage: projection.stage,
      occurrenceId: match?.occurrenceId,
      mappingKind: mappingKind(match)
    }
  };
};

const mappedSelectionRange = (service, projection, location, primary) => {
  const selectionRange = offsetRange(location?.selectionRange);
  if (!selectionRange) return undefined;
  const best = bestSourceMatch(asArray(service.toSource(projection.id, selectionRange)));
  const selection = sourceLocation(best);
  if (selection?.uri !== primary.uri ||
      selection.range.start < primary.range.start ||
      selection.range.end > primary.range.end) {
    return primary.range;
  }
  return selection.range;
};

const mapLocation = (service, known, location) => {
  if (!location || typeof location.uri !== "string") return location;
  const projection = projectionForUri(service, location.uri, known);
  if (!projection) return location;
  const matches = sourceMatchesForLocation(service, projection, location);
  const best = bestSourceMatch(matches);
  if (!best) return {
    ...location,
    generated: {
      uri: projection.uri,
      range: offsetRange(location.range),
      projectionId: projection.id,
      targetId: projection.targetId,
      artifactId: projection.artifactId,
      stage: projection.stage,
      mappingKind: matches.map(mappingKind).find(Boolean) ?? "synthetic"
    }
  };
  const mapped = sourceLocationWithContext(location, projection, best);
  const selectionRange = mappedSelectionRange(service, projection, location, mapped);
  return selectionRange ? { ...mapped, selectionRange } : mapped;
};

const mapLocations = (service, known, locations) =>
  asArray(locations).map((location) => mapLocation(service, known, location));

const mapOptionalRange = (service, projection, value) => {
  const range = offsetRange(value);
  if (!range) return { range: value };
  const best = bestSourceMatch(asArray(service.toSource(projection.id, range)));
  const source = sourceLocation(best);
  return source
    ? { range: source.range, sourceUri: source.uri, mappingKind: mappingKind(best) }
    : { range: value, generatedOnly: true };
};

const selectedReverseMapping = (selected) => Object.fromEntries([
  ["targetId", selected?.targetId],
  ["artifactId", selected?.artifactId],
  ["stage", selected?.stage],
  ["occurrenceId", selected?.occurrenceId],
  ["projectionVersion", selected?.projection?.version],
  ["affinity", selected?.match?.affinity]
].filter(([, value]) => value !== undefined));

const uniqueExactSourceDestinations = (matches) => {
  const destinations = new Map();
  for (const match of matches) {
    if (!exactKinds.has(mappingKind(match)) || match?.writable === false) continue;
    const source = sourceLocation(match);
    if (!source) continue;
    const key = JSON.stringify([
      source.uri,
      source.range.start,
      source.range.end
    ]);
    if (!destinations.has(key)) destinations.set(key, { match, source });
  }
  return [...destinations.values()];
};

// Completion replacement spans and prepare-rename ranges are primary authored
// edits. Reverse-map them only through the occurrence selected for the request;
// a best-effort destination from another occurrence is not safe to expose.
const mapWritablePrimaryRange = (service, selected, value) => {
  const range = offsetRange(value);
  if (!range) return { range: value, generatedOnly: true };
  const destinations = uniqueExactSourceDestinations(asArray(service.toSource(
    selected.projection.id,
    range,
    selectedReverseMapping(selected)
  )));
  if (destinations.length !== 1) {
    return {
      range: value,
      generatedOnly: true,
      ...(destinations.length > 1 ? { ambiguous: true } : {})
    };
  }
  const [{ match, source }] = destinations;
  return {
    range: source.range,
    sourceUri: source.uri,
    mappingKind: mappingKind(match)
  };
};

const mapCompletion = (service, selected, result) => ({
  ...result,
  items: asArray(result?.items).map((item) => {
    const replacement = mapWritablePrimaryRange(service, selected, item.replacementSpan);
    return {
      ...item,
      ...(item.replacementSpan ? {
        replacementSpan: replacement.range,
        sourceUri: replacement.sourceUri,
        mappingKind: replacement.mappingKind,
        generatedOnly: replacement.generatedOnly,
        ambiguous: replacement.ambiguous
      } : {})
    };
  })
});

const mapHover = (service, projection, result) => {
  if (!result?.range) return result;
  const mapped = mapOptionalRange(service, projection, result.range);
  return { ...result, range: mapped.range, sourceUri: mapped.sourceUri,
    mappingKind: mapped.mappingKind, generatedOnly: mapped.generatedOnly };
};

const mapSignature = (service, projection, result) => {
  if (!result?.applicableSpan) return result;
  const mapped = mapOptionalRange(service, projection, result.applicableSpan);
  return { ...result, applicableSpan: mapped.range, sourceUri: mapped.sourceUri,
    mappingKind: mapped.mappingKind, generatedOnly: mapped.generatedOnly };
};

const mapDiagnostics = (service, known, diagnostics) =>
  asArray(diagnostics).map((diagnostic) => {
    const mapped = mapLocation(service, known, diagnostic);
    return {
      ...mapped,
      related: asArray(diagnostic.related).map((entry) =>
        mapLocation(service, known, entry)
      )
    };
  });

const mapIncomingCalls = (service, known, calls) => asArray(calls).map((entry) => ({
  ...entry,
  from: mapLocation(service, known, entry.from),
  fromRanges: asArray(entry.fromRanges).map((range) => {
    const projection = projectionForUri(service, entry.from?.uri, known);
    return projection ? mapOptionalRange(service, projection, range).range : range;
  })
}));

const mapOutgoingCalls = (service, known, calls, sourceProjection) => asArray(calls).map((entry) => ({
  ...entry,
  to: mapLocation(service, known, entry.to),
  fromRanges: asArray(entry.fromRanges).map((range) =>
    mapOptionalRange(service, sourceProjection, range).range
  )
}));

const bridgeWorkspaceEdit = (result) => ({
  documentChanges: asArray(result?.changes).map((change) => ({
    textDocument: { uri: change.uri, version: change.version },
    edits: asArray(change.textChanges).map((edit) => ({
      range: edit.range,
      newText: edit.text
    }))
  }))
});

const mapRename = (service, result, options) => {
  if (result?.canRename === false) return result;
  const classified = classifyWorkspaceEdit(bridgeWorkspaceEdit(result), {
    projectionService: service,
    sourceVersions: options.sourceVersions,
    isWritableSource: options.isWritableSource,
    importDestination: options.importDestination
  });
  return { ...result, classifiedEdit: classified };
};

const mapCompletionDetails = (service, result, options) => ({
  ...result,
  codeActions: asArray(result?.codeActions).map((action) => ({
    ...action,
    classifiedEdit: classifyWorkspaceEdit({
      documentChanges: asArray(action.changes).map((change) => ({
        textDocument: { uri: change.uri, version: change.version },
        edits: asArray(change.textChanges).map((edit) => ({
          range: edit.range,
          newText: edit.text
        }))
      }))
    }, {
      projectionService: service,
      sourceVersions: options.sourceVersions,
      isWritableSource: options.isWritableSource,
      importDestination: options.importDestination
    })
  }))
});

const mapResponse = (service, known, kind, selected, result, options) => {
  const projection = selected.projection;
  if (locationArrayKinds.has(kind)) return mapLocations(service, known, result);
  if (kind === "completion") return mapCompletion(service, selected, result);
  if (kind === "completionDetails") return mapCompletionDetails(service, result, options);
  if (kind === "hover") return mapHover(service, projection, result);
  if (kind === "signatureHelp") return mapSignature(service, projection, result);
  if (kind === "diagnostics") return mapDiagnostics(service, known, result);
  if (kind === "incomingCalls") return mapIncomingCalls(service, known, result);
  if (kind === "outgoingCalls") return mapOutgoingCalls(service, known, result, projection);
  if (kind === "prepareRename") {
    if (!result?.range) return result;
    const mapped = mapWritablePrimaryRange(service, selected, result.range);
    return { ...result, range: mapped.range, sourceUri: mapped.sourceUri,
      mappingKind: mapped.mappingKind, generatedOnly: mapped.generatedOnly,
      ambiguous: mapped.ambiguous };
  }
  if (kind === "rename") return mapRename(service, result, options);
  return result;
};

const targetSummary = (match, projection) => ({
  targetId: targetIdFor(match, projection),
  artifactId: artifactIdFor(match, projection),
  projectionId: projection?.id,
  occurrenceId: occurrenceIdFor(match),
  pieceId: match?.pieceId ?? match?.piece?.id,
  virtualOffset: virtualOffsetFor(match),
  mappingKind: mappingKind(match),
  stage: projection?.stage,
  languageId: projection?.languageId
});

const uniqueTargets = (candidates) => {
  const targets = new Map();
  for (const candidate of candidates) {
    const id = candidate.targetId ?? "";
    if (!targets.has(id)) targets.set(id, candidate);
  }
  return [...targets.values()];
};

const uniqueArtifacts = (candidates) => {
  const artifacts = new Map();
  for (const candidate of candidates) {
    const id = (candidate.targetId ?? "") + "\u0000" + (candidate.artifactId ?? "");
    if (!artifacts.has(id)) artifacts.set(id, candidate);
  }
  return [...artifacts.values()];
};

const uniqueCandidateContexts = (candidates) => {
  const contexts = new Map();
  for (const candidate of candidates) {
    const key = JSON.stringify([
      candidate.targetId,
      candidate.artifactId,
      candidate.occurrenceId,
      candidate.projection?.id,
      candidate.offset,
      candidate.mappingKind,
      candidate.stage
    ]);
    if (!contexts.has(key)) contexts.set(key, candidate);
  }
  return [...contexts.values()];
};

const uniqueOccurrences = (candidates) => {
  const occurrences = new Map();
  for (const candidate of candidates) {
    const key = JSON.stringify([
      candidate.targetId,
      candidate.artifactId,
      candidate.occurrenceId
    ]);
    if (!occurrences.has(key)) occurrences.set(key, candidate);
  }
  return [...occurrences.values()];
};

const selectCandidates = (candidates, options) => {
  let matching = uniqueCandidateContexts(candidates);
  if (options.targetId) matching = matching.filter(({ targetId }) => targetId === options.targetId);
  if (options.artifactId) matching = matching.filter(({ artifactId }) => artifactId === options.artifactId);
  if (options.occurrenceId) matching = matching.filter(({ occurrenceId }) => occurrenceId === options.occurrenceId);
  if (options.projectionId) matching = matching.filter(({ projection }) =>
    projection?.id === options.projectionId
  );
  if (options.stage) matching = matching.filter(({ stage }) => stage === options.stage);
  if (matching.length === 0) return { status: "unmapped", candidates };
  const targets = uniqueTargets(matching);
  if (!options.targetId && targets.length > 1) {
    const configured = options.defaultTargetId &&
      matching.filter(({ targetId }) => targetId === options.defaultTargetId);
    if (configured?.length) matching = configured;
    else return { status: "target-required", candidates: targets };
  }
  const artifacts = uniqueArtifacts(matching);
  if (!options.artifactId && artifacts.length > 1) {
    return { status: "target-required", candidates: artifacts };
  }
  if (matching.length > 1) {
    const occurrences = uniqueOccurrences(matching);
    return {
      status: "target-required",
      ambiguityKind: occurrences.length > 1 ? "occurrence" : "mapping",
      candidates: occurrences.length > 1 ? occurrences : matching
    };
  }
  return { status: "selected", candidate: matching[0], candidates: matching };
};

const fullTextChange = (previous, next) => [{
  range: { start: 0, end: previous.text.length },
  text: next.text
}];

const bridgeForLanguage = (bridges, languageId) =>
  bridges.find((bridge) => bridge.languageIds.includes(languageId));

// Bridges receive only the generated-file view needed by native language
// tooling. Provenance maps, authored source text, line indexes, and router
// internals stay inside the trusted projection boundary.
const bridgeDocumentFor = (projection) => {
  const metadata = projection?.metadata && typeof projection.metadata === "object"
    ? Object.fromEntries([
        "fileName",
        "artifactPath",
        "outputPath",
        "tsconfigPath"
      ].flatMap((key) => projection.metadata[key] === undefined
        ? []
        : [[key, projection.metadata[key]]]))
    : undefined;
  return Object.freeze({
    id: projection.id,
    uri: projection.uri,
    snapshotId: projection.snapshotId,
    version: projection.version,
    artifactId: projection.artifactId,
    targetId: projection.targetId,
    stage: projection.stage,
    languageId: projection.languageId,
    text: projection.text,
    ...(projection.fileName === undefined ? {} : { fileName: projection.fileName }),
    ...(projection.path === undefined ? {} : { path: projection.path }),
    ...(projection.tsconfigPath === undefined ? {} : { tsconfigPath: projection.tsconfigPath }),
    ...(metadata && Object.keys(metadata).length ? { metadata: Object.freeze(metadata) } : {})
  });
};

const normalizeVirtualMatches = (service, known, matches) => asArray(matches)
  .map((match) => {
    const projection = match?.projection ?? service.getProjection(projectionIdFor(match));
    if (!projection) return null;
    known.set(projection.uri, projection);
    return {
      match,
      projection,
      offset: virtualOffsetFor(match),
      mappingKind: mappingKind(match),
      occurrenceId: occurrenceIdFor(match),
      targetId: targetIdFor(match, projection),
      artifactId: artifactIdFor(match, projection),
      stage: projection.stage
    };
  })
  .filter(({ offset } = {}) => Number.isInteger(offset));

const emitTrace = (sink, event) => {
  if (typeof sink === "function") sink(event);
  else sink?.event?.(event);
};

export const createLanguageRouter = (options = {}) => {
  const projectionService = options.projectionService;
  if (!projectionService) throw new TypeError("createLanguageRouter requires a projectionService.");
  const bridges = [...(options.bridges ?? [])];
  const knownProjections = new Map();
  // Bridge objects are the stable identity here. Array indexes are not: removing
  // one registered bridge shifts every later index and can alias document state.
  const openDocuments = new Map();
  const documentOperations = new Map();
  let routerOperationTail = Promise.resolve();
  let disposePromise;
  let disposed = false;

  const ensureActive = () => {
    if (disposed) throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.DISPOSED,
      "The Ravel language router is disposed."
    );
  };

  const waitForOperationOrAbort = (operation, signal) => {
    if (!signal) return operation;
    let removeAbortListener = () => {};
    const cancellation = new Promise((_resolve, reject) => {
      const abort = () => {
        try {
          throwIfAborted(signal);
        } catch (error) {
          reject(error);
        }
      };
      if (signal.aborted) abort();
      else {
        signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abort);
      }
    });
    return Promise.race([operation, cancellation]).finally(removeAbortListener);
  };

  const enqueueRouterOperation = (operation, signal) => {
    try {
      ensureActive();
    } catch (error) {
      return Promise.reject(error);
    }
    const result = routerOperationTail.catch(() => undefined).then(operation);
    routerOperationTail = result.catch(() => undefined);
    // Cancellation settles this caller promptly, while `result` remains in the
    // serialized tail and observes the same signal before doing any work.
    return waitForOperationOrAbort(result, signal);
  };

  const enqueueDocumentOperation = (bridge, uri, operation) => {
    let operations = documentOperations.get(bridge);
    if (!operations) {
      operations = new Map();
      documentOperations.set(bridge, operations);
    }
    const previous = operations.get(uri) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.catch(() => undefined);
    operations.set(uri, settled);
    void settled.then(() => {
      if (operations.get(uri) !== settled) return;
      operations.delete(uri);
      if (operations.size === 0) documentOperations.delete(bridge);
    });
    return result;
  };

  const staleSynchronization = (projection, detail) => new LanguageBridgeError(
    BRIDGE_ERROR_CODES.STALE_DOCUMENT,
    `Cannot synchronize stale Ravel projection ${projection.uri}: ${detail}`,
    { retryable: true }
  );

  const requireCurrentProjection = (projection) => {
    if (typeof projectionService.getProjection !== "function") return;
    const current = projectionService.getProjection(projection.id);
    if (!current || current.uri !== projection.uri ||
        current.version !== projection.version || current.text !== projection.text ||
        current.snapshotId !== projection.snapshotId) {
      throw staleSynchronization(projection, "the projection changed before synchronization");
    }
  };

  const syncDocument = (bridge, projection, signal) => enqueueDocumentOperation(
    bridge,
    projection.uri,
    async () => {
      throwIfAborted(signal);
      requireCurrentProjection(projection);
      let documents = openDocuments.get(bridge);
      if (!documents) {
        documents = new Map();
        openDocuments.set(bridge, documents);
      }
      const previous = documents.get(projection.uri);
      const document = bridgeDocumentFor(projection);
      if (previous && document.version < previous.version) {
        throw staleSynchronization(
          projection,
          `version ${document.version} is older than open version ${previous.version}`
        );
      }
      if (previous && document.version === previous.version) {
        if (previous.id !== document.id || previous.text !== document.text) {
          throw staleSynchronization(
            projection,
            `version ${document.version} has conflicting identity or content`
          );
        }
        return previous;
      }
      if (!previous) await bridge.open(document, signal);
      else {
        await bridge.change(previous, document, fullTextChange(previous, document), signal);
      }
      // Once a bridge mutation succeeds, record it even if cancellation arrived
      // while the bridge was settling; otherwise router and bridge state diverge.
      documents.set(projection.uri, document);
      throwIfAborted(signal);
      requireCurrentProjection(projection);
      return document;
    }
  );

  const syncTargetDocuments = async (bridge, selected, signal) => {
    const listed = projectionService.listProjections?.() ?? [...knownProjections.values()];
    const byUri = new Map();
    for (const projection of [...listed, selected.projection]) {
      if (!projection || projection.targetId !== selected.targetId ||
          projection.stage !== selected.projection.stage ||
          !bridge.languageIds.includes(projection.languageId)) continue;
      byUri.set(projection.uri, projection);
    }
    const compatible = [...byUri.values()].sort((left, right) =>
      String(left.artifactId).localeCompare(String(right.artifactId)) ||
      String(left.id).localeCompare(String(right.id))
    );
    for (const projection of compatible) {
      throwIfAborted(signal);
      await syncDocument(bridge, projection, signal);
    }
  };

  const closeProjection = async (projection) => {
    const tasks = [];
    for (const bridge of bridges) {
      tasks.push(enqueueDocumentOperation(bridge, projection.uri, async () => {
        const documents = openDocuments.get(bridge);
        const current = documents?.get(projection.uri);
        if (!current) return;
        await bridge.close(current);
        documents.delete(projection.uri);
        if (documents.size === 0) openDocuments.delete(bridge);
      }));
    }
    await Promise.all(tasks);
    knownProjections.delete(projection.uri);
  };

  const performUpdate = async (snapshot, signal) => {
    const delta = await projectionService.update(snapshot, signal);
    for (const projection of projectionService.listProjections?.() ?? []) {
      knownProjections.set(projection.uri, projection);
    }
    for (const closed of delta?.closed ?? delta?.removed ?? []) {
      const projection = typeof closed === "string"
        ? projectionService.getProjection(closed) ?? knownProjections.get(closed)
        : closed;
      if (projection) await closeProjection(projection);
    }
    return delta;
  };

  const update = (snapshot, signal) => enqueueRouterOperation(
    () => performUpdate(snapshot, signal),
    signal
  );

  const performRequest = async (kind, source, requestOptions = {}, signal) => {
    throwIfAborted(signal);
    const started = Date.now();
    const matches = normalizeVirtualMatches(
      projectionService,
      knownProjections,
      projectionService.toVirtual(source, requestOptions)
    );
    const selection = selectCandidates(matches, requestOptions);
    if (selection.status !== "selected") {
      emitTrace(options.trace, {
        kind: "language-request-unrouted",
        requestKind: kind,
        status: selection.status,
        ambiguityKind: selection.ambiguityKind,
        candidates: selection.candidates.map(({ match, projection }) =>
          targetSummary(match, projection)
        )
      });
      return {
        status: selection.status,
        ...(selection.ambiguityKind
          ? { ambiguityKind: selection.ambiguityKind }
          : {}),
        candidates: selection.candidates.map(({ match, projection }) =>
          targetSummary(match, projection)
        )
      };
    }
    const selected = selection.candidate;
    if (exactCursorRequestKinds.has(kind) && !exactKinds.has(selected.mappingKind)) {
      return {
        status: "exact-mapping-required",
        candidate: targetSummary(selected.match, selected.projection),
        mappingKind: selected.mappingKind
      };
    }
    const bridge = bridgeForLanguage(bridges, selected.projection.languageId);
    if (!bridge) {
      return {
        status: "bridge-unavailable",
        languageId: selected.projection.languageId,
        candidate: targetSummary(selected.match, selected.projection)
      };
    }
    if (!supportsLanguageRequest(bridge.capabilities, kind, selected.projection.stage)) {
      return {
        status: "capability-unavailable",
        languageId: selected.projection.languageId,
        requestKind: kind,
        stage: selected.projection.stage
      };
    }

    await syncTargetDocuments(bridge, selected, signal);
    const bridgeRequest = {
      ...requestOptions.request,
      kind,
      documentUri: selected.projection.uri,
      position: selected.offset
    };
    const { raw, retries } = await enqueueDocumentOperation(
      bridge,
      selected.projection.uri,
      async () => {
        throwIfAborted(signal);
        const bridgeDocument = openDocuments.get(bridge)?.get(selected.projection.uri);
        if (!bridgeDocument || bridgeDocument.version !== selected.projection.version ||
            bridgeDocument.text !== selected.projection.text) {
          throw staleSynchronization(
            selected.projection,
            "the selected bridge document is no longer current"
          );
        }
        requireLanguageRequestSupport(bridge, bridgeRequest, {
          document: bridgeDocument,
          version: bridgeDocument.version
        });

        let raw;
        let retries = 0;
        while (true) {
          try {
            raw = await bridge.request(bridgeRequest, {
              document: bridgeDocument,
              version: bridgeDocument.version,
              occurrenceId: selected.occurrenceId,
              targetId: selected.targetId,
              artifactId: selected.artifactId
            }, signal);
            break;
          } catch (error) {
            if (signal?.aborted || error?.code === BRIDGE_ERROR_CODES.ABORTED) {
              throw error;
            }
            if (!error?.retryable || !bridge.restart ||
                retries >= (requestOptions.maximumRetries ?? 1)) {
              throw error;
            }
            retries += 1;
            await bridge.restart();
          }
        }
        return { raw, retries };
      }
    );
    throwIfAborted(signal);
    const current = projectionService.getProjection(selected.projection.id);
    if (!current || current.version !== selected.projection.version) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.STALE_DOCUMENT,
        "The target-language result belongs to a stale Ravel projection.",
        { retryable: true }
      );
    }
    const mapped = mapResponse(
      projectionService,
      knownProjections,
      kind,
      selected,
      raw,
      requestOptions
    );
    emitTrace(options.trace, {
      kind: "language-request-completed",
      requestKind: kind,
      projectionId: selected.projection.id,
      targetId: selected.targetId,
      artifactId: selected.artifactId,
      occurrenceId: selected.occurrenceId,
      version: selected.projection.version,
      retries,
      durationMs: Date.now() - started
    });
    return {
      status: "ok",
      result: mapped,
      context: {
        projectionId: selected.projection.id,
        projectionUri: selected.projection.uri,
        projectionVersion: selected.projection.version,
        targetId: selected.targetId,
        artifactId: selected.artifactId,
        occurrenceId: selected.occurrenceId,
        mappingKind: selected.mappingKind,
        retries
      }
    };
  };

  const request = (kind, source, requestOptions = {}, signal) =>
    enqueueRouterOperation(
      () => performRequest(kind, source, requestOptions, signal),
      signal
    );

  const dispose = () => {
    if (disposePromise) return disposePromise;
    disposed = true;
    const bridgesToDispose = [...new Set(bridges)];
    disposePromise = (async () => {
      await routerOperationTail.catch(() => undefined);
      const pendingDocumentOperations = [];
      for (const operations of documentOperations.values()) {
        pendingDocumentOperations.push(...operations.values());
      }
      await Promise.all(pendingDocumentOperations.map((operation) =>
        operation.catch(() => undefined)
      ));
      try {
        await Promise.all(bridgesToDispose.map((bridge) => bridge.dispose?.()));
      } finally {
        openDocuments.clear();
        documentOperations.clear();
        knownProjections.clear();
      }
    })();
    return disposePromise;
  };

  return Object.freeze({
    update,
    request,
    dispose,
    registerBridge(bridge) {
      ensureActive();
      bridges.push(bridge);
      return () => {
        const index = bridges.indexOf(bridge);
        if (index !== -1) bridges.splice(index, 1);
      };
    },
    listTargets(source, selection = {}) {
      return normalizeVirtualMatches(
        projectionService,
        knownProjections,
        projectionService.toVirtual(source, selection)
      ).map(({ match, projection }) => targetSummary(match, projection));
    },
    validateSourceEditVersions,
    get disposed() { return disposed; }
  });
};

export {
  classifyWorkspaceEdit,
  validateSourceEditVersions
} from "./edits.js";
export { createRavelSemanticIndex } from "./ravel-index.js";
