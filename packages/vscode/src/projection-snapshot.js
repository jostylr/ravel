const requireEntry = (entry) => {
  if (!entry || typeof entry.uri !== "string" || !entry.uri) {
    throw new TypeError("Editor snapshot entries require a source URI.");
  }
  if (typeof entry.path !== "string" || !entry.path) {
    throw new TypeError("Editor snapshot entries require an absolute path.");
  }
  if (!Number.isInteger(entry.version) || entry.version < 0) {
    throw new TypeError("Editor snapshot versions must be nonnegative integers.");
  }
  if (typeof entry.text !== "string") {
    throw new TypeError("Editor snapshot text must be a string.");
  }
  return Object.freeze({
    uri: entry.uri,
    path: entry.path,
    version: entry.version,
    text: entry.text,
    dirty: entry.dirty === true
  });
};

/**
 * Capture one immutable logical view of all open editor documents in a project.
 * The overlay map and later projection source state are both derived from this
 * same capture, so a projection can never mix text from one editor revision
 * with version metadata from another.
 */
export const createEditorSnapshot = (entries = []) => {
  const documents = new Map();
  const overlays = new Map();
  for (const candidate of entries) {
    const entry = requireEntry(candidate);
    documents.set(entry.uri, entry);
    // All open buffers participate in evaluation, including clean ones. This
    // closes the race where a save lands after the disk baseline was read but
    // before editor state was captured.
    overlays.set(entry.path, Object.freeze({
      text: entry.text,
      version: entry.version
    }));
  }
  return Object.freeze({ documents, overlays });
};

export const projectionSourceState = (snapshot, authoredSourceUris = []) => {
  const sourceTexts = {};
  const sourceVersions = {};
  for (const uri of new Set(authoredSourceUris)) {
    const entry = snapshot?.documents?.get(uri);
    if (!entry) continue;
    sourceTexts[uri] = entry.text;
    sourceVersions[uri] = entry.version;
  }
  return Object.freeze({
    sourceTexts: Object.freeze(sourceTexts),
    sourceVersions: Object.freeze(sourceVersions)
  });
};

const equivalentDocumentState = (captured, current) => {
  if (!captured && !current) return true;
  if (!captured || !current) return false;
  if (captured.dirty !== current.dirty) return false;
  if (captured.text !== current.text) return false;
  return captured.version === current.version;
};

export const sameRelevantEditorState = (
  captured,
  current,
  relevantSourceUris = []
) => {
  for (const uri of new Set(relevantSourceUris)) {
    if (!equivalentDocumentState(
      captured?.documents?.get(uri),
      current?.documents?.get(uri)
    )) return false;
  }
  return true;
};

const equivalentReadDocumentState = (captured, current, evaluatedText) => {
  if (equivalentDocumentState(captured, current)) return true;
  if (typeof evaluatedText !== "string") return false;
  if (!captured && current) {
    return current.dirty !== true && current.text === evaluatedText;
  }
  if (captured && !current) {
    return captured.dirty !== true && captured.text === evaluatedText;
  }
  return current?.text === evaluatedText;
};

/**
 * Read-only navigation may adopt a newly opened clean source when its exact
 * bytes equal the text consumed by project evaluation. Write-capable features
 * must continue to use sameRelevantEditorState and captured versions.
 */
export const sameRelevantReadState = (
  captured,
  current,
  relevantSourceUris = [],
  evaluatedSourceTexts = {}
) => {
  for (const uri of new Set(relevantSourceUris)) {
    if (!equivalentReadDocumentState(
      captured?.documents?.get(uri),
      current?.documents?.get(uri),
      evaluatedSourceTexts?.[uri]
    )) return false;
  }
  return true;
};

export const sourceStateMismatch = () => {
  const error = new DOMException(
    "Ravel source changed while the projection snapshot was being prepared.",
    "AbortError"
  );
  Object.defineProperty(error, "code", {
    value: "RAVEL_SOURCE_STATE_MISMATCH",
    enumerable: true
  });
  return error;
};

/**
 * Re-evaluate until the open-editor snapshot contains every input discovered
 * by the preceding evaluation. This handles a dirty config/source that adds a
 * newly loaded custom-extension file without mixing that file's disk bytes
 * with the editor overlay set.
 */
export const stabilizeEditorSnapshot = async ({
  initialSnapshot,
  evaluate,
  captureNext,
  maxAttempts = 4
}) => {
  if (!initialSnapshot?.documents || typeof evaluate !== "function" ||
      typeof captureNext !== "function" || !Number.isInteger(maxAttempts) ||
      maxAttempts < 1) {
    throw new TypeError("Editor snapshot stabilization requires a snapshot, evaluators, and positive attempt bound.");
  }
  let snapshot = initialSnapshot;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const value = await evaluate(snapshot, attempt);
    const next = await captureNext(value, snapshot, attempt);
    const uris = new Set([
      ...snapshot.documents.keys(),
      ...next.documents.keys()
    ]);
    if (sameRelevantEditorState(snapshot, next, uris)) {
      return Object.freeze({ snapshot: next, value, attempts: attempt + 1 });
    }
    snapshot = next;
  }
  throw sourceStateMismatch();
};

export const assertRelevantEditorState = (
  captured,
  current,
  relevantSourceUris
) => {
  if (!sameRelevantEditorState(captured, current, relevantSourceUris)) {
    throw sourceStateMismatch();
  }
};

export const isSourceStateMismatch = (error) =>
  error?.code === "RAVEL_SOURCE_STATE_MISMATCH";
