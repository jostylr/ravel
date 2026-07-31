export const GENERATED_DOCUMENT_SCHEME = "pieceful-virtual";

const CONTENT_POLICIES = new Set(["last-good", "reject"]);

const requireDependency = (value, name) => {
  if (value === undefined || value === null) {
    throw new TypeError(name + " is required.");
  }
  return value;
};

const requirePolicy = (value, name) => {
  if (!CONTENT_POLICIES.has(value)) {
    throw new TypeError(name + " must be \"last-good\" or \"reject\".");
  }
  return value;
};

const uriString = (uri) => {
  const value = typeof uri === "string" ? uri : uri?.toString?.();
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Generated document URI must be a nonempty string or URI.");
  }
  return value;
};

const asUri = (vscode, uri) => typeof uri === "string"
  ? vscode.Uri.parse(uri)
  : uri;

const freshnessFor = (document) => document.invalidated
  ? "invalidated"
  : document.state;

/**
 * Describe a generated document without inserting a comment into its content.
 * Keeping this metadata out of band preserves projection offsets and lets the
 * target language extension see the exact assembled program.
 */
export const generatedDocumentMetadata = (document) => {
  if (!document) return undefined;
  const freshness = freshnessFor(document);
  const targetSelection = Object.freeze({
    targetId: document.targetId,
    artifactId: document.artifactId
  });
  const freshnessLabel = freshness === "current"
    ? "current"
    : document.staleReason
      ? freshness + ": " + document.staleReason
      : freshness;
  return Object.freeze({
    uri: document.uri,
    title: document.artifactId + " [" + document.targetId + "]",
    header: [
      "Target: " + document.targetId,
      "Artifact: " + document.artifactId,
      "Stage: " + document.stage,
      "Freshness: " + freshnessLabel
    ].join(" · "),
    targetId: document.targetId,
    artifactId: document.artifactId,
    targetSelection,
    stage: document.stage,
    languageId: document.languageId,
    snapshotId: document.snapshotId,
    version: document.version,
    freshness,
    staleReason: document.staleReason,
    readOnly: true
  });
};

export class GeneratedDocumentProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GeneratedDocumentProviderError";
    this.code = code;
    Object.assign(this, details);
  }
}

const providerError = (code, message, details) =>
  new GeneratedDocumentProviderError(code, message, details);

const rangeOffsets = (occurrence) => occurrence?.virtual;

export const generatedTextDocumentIsCurrent = (generated, textDocument) =>
  Boolean(
    generated &&
    typeof generated.text === "string" &&
    typeof textDocument?.getText === "function" &&
    textDocument.getText() === generated.text
  );

const sourceDestinationKey = (match) => JSON.stringify([
  match?.source?.uri,
  match?.sourceOffset ?? match?.source?.range?.start?.offset,
  match?.source?.range?.end?.offset
]);

const returnQuality = (match) => ({
  exact: 0,
  transformed: 1,
  anchored: 2,
  opaque: 3,
  synthetic: 4
})[match?.quality] ?? 5;

/** Select one best source destination without silently crossing ambiguity. */
export const selectReturnToSourceMatch = (matches = []) => {
  const sourced = matches.filter((match) => match?.source?.uri);
  if (sourced.length === 0) return Object.freeze({ status: "unmapped" });
  const bestQuality = Math.min(...sourced.map(returnQuality));
  const best = sourced.filter((match) => returnQuality(match) === bestQuality);
  const destinations = new Map();
  for (const match of best) {
    const key = sourceDestinationKey(match);
    if (!destinations.has(key)) destinations.set(key, match);
  }
  if (destinations.size !== 1) {
    return Object.freeze({
      status: "ambiguous",
      matches: Object.freeze([...destinations.values()])
    });
  }
  return Object.freeze({ status: "selected", match: [...destinations.values()][0] });
};

/** Convert a registry occurrence's half-open offsets into a VS Code range. */
export const generatedOccurrenceRange = (vscode, textDocument, occurrence) => {
  requireDependency(vscode?.Range, "VS Code Range constructor");
  requireDependency(textDocument?.positionAt, "Text document positionAt function");
  const range = rangeOffsets(occurrence);
  if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end) ||
      range.start < 0 || range.end < range.start) {
    throw new TypeError("Generated occurrence must have a valid half-open virtual range.");
  }
  if (typeof textDocument.getText === "function" && range.end > textDocument.getText().length) {
    throw providerError(
      "content-mismatch",
      "The open generated document does not match the selected projection version."
    );
  }
  return new vscode.Range(
    textDocument.positionAt(range.start),
    textDocument.positionAt(range.end)
  );
};

const versionExpectation = (document, options = {}) => ({
  projectionId: options.expectedProjectionId ?? document.projectionId,
  snapshotId: options.expectedSnapshotId ?? document.snapshotId,
  version: options.expectedVersion ?? document.version
});

const matchesExpectation = (document, expected) => Boolean(
  document &&
  document.projectionId === expected.projectionId &&
  document.snapshotId === expected.snapshotId &&
  document.version === expected.version
);

const showOptionsFor = (options, selection) => ({
  preview: options.preview ?? true,
  preserveFocus: options.preserveFocus ?? false,
  ...(options.viewColumn === undefined ? {} : { viewColumn: options.viewColumn }),
  ...(selection === undefined ? {} : { selection })
});

const occurrenceById = (document, occurrenceId) =>
  document.occurrences.find((occurrence) => occurrence.id === occurrenceId);

/**
 * Adapt a generated-document registry to VS Code's TextDocumentContentProvider
 * contract. VS Code is injected so the module remains directly testable in
 * Node and does not load the editor runtime outside an extension host.
 */
export const createGeneratedDocumentProvider = ({
  vscode,
  registry,
  scheme = GENERATED_DOCUMENT_SCHEME,
  stalePolicy = "last-good",
  invalidatedPolicy = "last-good",
  register = true,
  presentMetadata
}) => {
  requireDependency(vscode, "VS Code API");
  requireDependency(vscode.Uri?.parse, "VS Code URI parser");
  requireDependency(vscode.EventEmitter, "VS Code EventEmitter constructor");
  requireDependency(registry?.get, "Generated document registry");
  requireDependency(registry?.onDidChange, "Generated document registry change event");
  requirePolicy(stalePolicy, "Stale content policy");
  requirePolicy(invalidatedPolicy, "Invalidated content policy");
  if (typeof scheme !== "string" || scheme.length === 0) {
    throw new TypeError("Generated document scheme must be a nonempty string.");
  }
  if (presentMetadata !== undefined && typeof presentMetadata !== "function") {
    throw new TypeError("Generated document metadata presenter must be a function.");
  }

  const changeEmitter = new vscode.EventEmitter();
  let disposed = false;
  let registration;

  const requireActive = () => {
    if (disposed) {
      throw providerError("disposed", "Generated document provider has been disposed.");
    }
  };

  const read = (uri) => {
    requireActive();
    const key = uriString(uri);
    const document = registry.get(key);
    if (!document) {
      throw providerError("not-found", "Generated document is not available: " + key, {
        uri: key
      });
    }
    if (document.invalidated && invalidatedPolicy === "reject") {
      throw providerError(
        "invalidated",
        document.staleReason ?? "Generated document is no longer available.",
        { uri: key, document }
      );
    }
    if (!document.invalidated && document.state !== "current" && stalePolicy === "reject") {
      throw providerError(
        "stale",
        document.staleReason ?? "Generated document is being recomputed.",
        { uri: key, document }
      );
    }
    return document;
  };

  const check = (uri, expected, original) => {
    requireActive();
    const key = uriString(uri);
    const actual = registry.get(key);
    if (!matchesExpectation(actual, expected) || (original && actual !== original)) {
      throw providerError(
        "version-mismatch",
        "Generated document changed while the editor operation was in progress.",
        { uri: key, expected: Object.freeze({ ...expected }), actual }
      );
    }
    return actual;
  };

  const resolve = (uri, options = {}) => {
    const document = read(uri);
    const expected = versionExpectation(document, options);
    if (!matchesExpectation(document, expected)) {
      throw providerError(
        "version-mismatch",
        "Generated document does not match the requested projection version.",
        { uri: uriString(uri), expected: Object.freeze(expected), actual: document }
      );
    }
    return { document, expected };
  };

  const provideTextDocumentContent = (uri) => read(uri).text;

  const registrySubscription = registry.onDidChange((change) => {
    if (!disposed) changeEmitter.fire(vscode.Uri.parse(change.uri));
  });

  const metadata = (uri) => generatedDocumentMetadata(read(uri));

  const openGeneratedDocument = async (uri, options = {}) => {
    requireDependency(vscode.workspace?.openTextDocument, "VS Code openTextDocument function");
    requireDependency(vscode.languages?.setTextDocumentLanguage, "VS Code language setter");
    requireDependency(vscode.window?.showTextDocument, "VS Code showTextDocument function");
    const editorUri = asUri(vscode, uri);
    const key = uriString(editorUri);
    const { document: generated, expected } = resolve(key, options);
    const occurrence = options.occurrenceId === undefined
      ? undefined
      : occurrenceById(generated, options.occurrenceId);
    if (options.occurrenceId !== undefined && !occurrence) {
      throw providerError(
        "occurrence-not-found",
        "Generated occurrence is not available: " + options.occurrenceId,
        { uri: key, occurrenceId: options.occurrenceId }
      );
    }

    let textDocument = await vscode.workspace.openTextDocument(editorUri);
    check(key, expected, generated);
    if (!generatedTextDocumentIsCurrent(generated, textDocument)) {
      throw providerError(
        "content-mismatch",
        "The editor has not loaded the requested generated document version.",
        { uri: key, expected: Object.freeze({ ...expected }) }
      );
    }
    if (textDocument.languageId !== generated.languageId) {
      textDocument = await vscode.languages.setTextDocumentLanguage(
        textDocument,
        generated.languageId
      );
      check(key, expected, generated);
    }

    const selection = occurrence === undefined
      ? undefined
      : generatedOccurrenceRange(vscode, textDocument, occurrence);
    const editor = await vscode.window.showTextDocument(
      textDocument,
      showOptionsFor(options, selection)
    );
    check(key, expected, generated);

    if (selection !== undefined) {
      editor.selection = new vscode.Selection(selection.start, selection.end);
      editor.revealRange(
        selection,
        options.revealType ?? vscode.TextEditorRevealType?.InCenterIfOutsideViewport
      );
    }

    const documentMetadata = generatedDocumentMetadata(generated);
    if (presentMetadata) {
      await presentMetadata(documentMetadata, {
        editor,
        textDocument,
        occurrence,
        sourceSelection: options.sourceSelection
      });
      check(key, expected, generated);
    }
    return Object.freeze({
      editor,
      textDocument,
      generatedDocument: generated,
      metadata: documentMetadata,
      ...(occurrence === undefined ? {} : { occurrence, range: selection })
    });
  };

  const revealOccurrence = (uri, occurrenceId, options = {}) =>
    openGeneratedDocument(uri, { ...options, occurrenceId });

  const adjacent = async (direction, uri, currentOccurrenceId, options = {}) => {
    const key = uriString(uri);
    const { document, expected } = resolve(key, options);
    const occurrenceOptions = {
      ...(options.pieceId === undefined ? {} : { pieceId: options.pieceId }),
      ...(options.wrap === undefined ? {} : { wrap: options.wrap })
    };
    const occurrence = direction > 0
      ? registry.nextOccurrence(key, currentOccurrenceId, occurrenceOptions)
      : registry.previousOccurrence(key, currentOccurrenceId, occurrenceOptions);
    if (!occurrence) return undefined;
    check(key, expected, document);
    return revealOccurrence(key, occurrence.id, {
      ...options,
      expectedProjectionId: expected.projectionId,
      expectedSnapshotId: expected.snapshotId,
      expectedVersion: expected.version
    });
  };

  const provider = {
    scheme,
    onDidChange: changeEmitter.event,
    provideTextDocumentContent,
    metadata,
    openGeneratedDocument,
    revealOccurrence,
    nextOccurrence: (uri, currentOccurrenceId, options) =>
      adjacent(1, uri, currentOccurrenceId, options),
    previousOccurrence: (uri, currentOccurrenceId, options) =>
      adjacent(-1, uri, currentOccurrenceId, options),
    dispose() {
      if (disposed) return;
      disposed = true;
      registrySubscription.dispose();
      registration?.dispose();
      changeEmitter.dispose();
    }
  };

  if (register) {
    requireDependency(
      vscode.workspace?.registerTextDocumentContentProvider,
      "VS Code content-provider registration function"
    );
    registration = vscode.workspace.registerTextDocumentContentProvider(scheme, provider);
  }

  return Object.freeze(provider);
};
