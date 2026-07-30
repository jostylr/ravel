import ravelMapSchema from "../schema/ravel-map.schema.json" with { type: "json" };

const componentPattern = /^[a-z][a-z0-9-]*$/;
const chunkPathPattern = /^[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*)?)*$/;
const addressPattern = /^(?:[a-z][a-z0-9-]*::(?:[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*)?)*)?(?::[a-z][a-z0-9-]*)?(?:\.[a-z][a-z0-9-]*)?|[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*)?)*(?::[a-z][a-z0-9-]*)?(?:\.[a-z][a-z0-9-]*)?)$/;
const mapKeys = new Set(["version", "document", "chunks", "directives", "metadata"]);
const documentKeys = new Set(["id", "uri", "format"]);
const chunkKeys = new Set(["id", "identity", "name", "body", "definitionPipeline", "metadata", "source", "fragments"]);
const identityKeys = new Set(["document", "chunk", "minor", "type"]);
const directiveKeys = new Set(["kind", "name", "from", "target", "arguments", "metadata", "source", "document", "compose", "reference", "body"]);
const directiveKinds = new Set(["in", "out", "create", "alias"]);

export const RAVEL_MAP_VERSION = 1;
export const RAVEL_MAP_SCHEMA_ID = "https://ravel.dev/schema/ravel-map-v1.json";
/** The complete JSON Schema 2020-12 artifact shipped with this package. */
export const RAVEL_MAP_SCHEMA = ravelMapSchema;

const zeroPosition = () => ({ line: 0, column: 0, offset: 0 });

const sourceFor = (uri) => ({
  uri: typeof uri === "string" && uri.length ? uri : "<ravel-map>",
  range: { start: zeroPosition(), end: zeroPosition() }
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const formatIdentity = (identity) =>
  (identity.document === null ? "" : identity.document + "::") +
  (identity.chunk ?? "") +
  (identity.minor === null ? "" : ":" + identity.minor) +
  (identity.type === null ? "" : "." + identity.type);

const validPosition = (value) => isObject(value) &&
  Number.isInteger(value.line) && value.line >= 0 &&
  Number.isInteger(value.column) && value.column >= 0 &&
  Number.isInteger(value.offset) && value.offset >= 0;

const validRange = (value) => isObject(value) && validPosition(value.start) && validPosition(value.end) &&
  value.end.offset >= value.start.offset;

const validSource = (value) => isObject(value) && typeof value.uri === "string" && value.uri.length > 0 && validRange(value.range);

const describe = (path, message) => path ? path + " " + message : message;

/**
 * Validate one Ravel Map at the adapter/host boundary.
 *
 * The result is deliberately data, so browsers, Bun, Node hosts, and editors
 * can present the same diagnostics without sharing an exception type.
 */
export const validateRavelMap = (map, { uri } = {}) => {
  const diagnostics = [];
  const report = (path, message) => diagnostics.push({
    code: "RM200",
    severity: "error",
    message: describe(path, message),
    source: sourceFor(uri ?? map?.document?.uri)
  });

  if (!isObject(map)) {
    report("map", "must be an object.");
    return diagnostics;
  }
  for (const key of Object.keys(map)) if (!mapKeys.has(key)) report(key, "is not a recognized Ravel Map field.");
  if (map.version !== RAVEL_MAP_VERSION) report("version", "must be 1.");

  if (!isObject(map.document)) {
    report("document", "must be an object.");
  } else {
    for (const key of Object.keys(map.document)) if (!documentKeys.has(key)) report("document." + key, "is not a recognized document field.");
    if (!componentPattern.test(map.document.id ?? "")) report("document.id", "must be a lowercase Ravel identifier.");
    if (typeof map.document.uri !== "string" || map.document.uri.length === 0) report("document.uri", "must be a non-empty URI reference.");
    if (typeof map.document.format !== "string" || map.document.format.length === 0) report("document.format", "must be a non-empty string.");
  }

  if (!Array.isArray(map.chunks)) {
    report("chunks", "must be an array.");
  } else {
    const ids = new Set();
    for (const [index, chunk] of map.chunks.entries()) {
      const path = "chunks[" + index + "]";
      if (!isObject(chunk)) {
        report(path, "must be an object.");
        continue;
      }
      for (const key of Object.keys(chunk)) if (!chunkKeys.has(key)) report(path + "." + key, "is not a recognized chunk field.");
      for (const key of ["id", "identity", "body", "source"]) if (!Object.hasOwn(chunk, key)) report(path + "." + key, "is required.");
      if (typeof chunk.id !== "string" || !addressPattern.test(chunk.id)) report(path + ".id", "must be a canonical Ravel address.");
      if (ids.has(chunk.id)) report(path + ".id", "duplicates chunk " + chunk.id + ".");
      ids.add(chunk.id);
      if (typeof chunk.body !== "string") report(path + ".body", "must be a string.");
      if (!validSource(chunk.source)) report(path + ".source", "must contain a URI and a valid source range.");
      if (chunk.name !== undefined && (typeof chunk.name !== "string" || chunk.name.length === 0)) report(path + ".name", "must be a non-empty string when present.");

      const identity = chunk.identity;
      if (!isObject(identity)) {
        report(path + ".identity", "must be an object with document, chunk, minor, and type fields.");
      } else {
        for (const key of Object.keys(identity)) if (!identityKeys.has(key)) report(path + ".identity." + key, "is not a recognized identity field.");
        for (const key of identityKeys) {
          if (!Object.hasOwn(identity, key)) report(path + ".identity." + key, "is required.");
          else if (key === "chunk" && identity[key] !== null && !chunkPathPattern.test(identity[key] ?? "")) {
            report(path + ".identity.chunk", "must be null or a slash-separated lowercase Ravel path.");
          } else if (key !== "chunk" && identity[key] !== null && !componentPattern.test(identity[key] ?? "")) {
            report(path + ".identity." + key, "must be null or a lowercase Ravel identifier.");
          }
        }
        if (identity.document === null && identity.chunk === null) report(path + ".identity", "must have a document or chunk component.");
        if (typeof map.document?.id === "string" && identity.document !== map.document.id) report(path + ".identity.document", "must match document.id.");
        if (typeof chunk.id === "string" && chunk.id !== formatIdentity(identity)) report(path + ".id", "must equal the canonical identity address " + formatIdentity(identity) + ".");
      }

      if (chunk.definitionPipeline !== undefined) validateTransforms(chunk.definitionPipeline, path + ".definitionPipeline", report);
      if (chunk.metadata !== undefined) validateMetadata(chunk.metadata, path + ".metadata", report);
      if (chunk.fragments !== undefined) {
        if (!Array.isArray(chunk.fragments)) report(path + ".fragments", "must be an array.");
        else for (const [fragmentIndex, fragment] of chunk.fragments.entries()) {
          if (!isObject(fragment) || typeof fragment.body !== "string" || !validSource(fragment.source)) report(path + ".fragments[" + fragmentIndex + "]", "must contain a string body and valid source.");
        }
      }
    }
  }

  if (map.directives !== undefined) {
    if (!Array.isArray(map.directives)) report("directives", "must be an array.");
    else for (const [index, directive] of map.directives.entries()) {
      const path = "directives[" + index + "]";
      if (!isObject(directive)) {
        report(path, "must be an object.");
        continue;
      }
      for (const key of Object.keys(directive)) if (!directiveKeys.has(key)) report(path + "." + key, "is not a recognized directive field.");
      if (typeof directive.kind !== "string" || !directiveKinds.has(directive.kind)) report(path + ".kind", "must be one of in, out, create, or alias.");
      if (!validSource(directive.source)) report(path + ".source", "must contain a URI and a valid source range.");
      if (directive.name !== undefined && (typeof directive.name !== "string" || directive.name.length === 0)) report(path + ".name", "must be a non-empty string when present.");
      if (directive.from !== undefined && (typeof directive.from !== "string" || !addressPattern.test(directive.from))) report(path + ".from", "must be a canonical Ravel address when present.");
      if (directive.target !== undefined && (typeof directive.target !== "string" || directive.target.length === 0)) report(path + ".target", "must be a non-empty string when present.");
      if (directive.document !== undefined && !componentPattern.test(directive.document ?? "")) report(path + ".document", "must be a lowercase Ravel identifier when present.");
      if (directive.arguments !== undefined && !Array.isArray(directive.arguments)) report(path + ".arguments", "must be an array when present.");
      if (directive.metadata !== undefined && !isObject(directive.metadata)) report(path + ".metadata", "must be an object when present.");
      if (directive.compose !== undefined && !Array.isArray(directive.compose)) report(path + ".compose", "must be an array when present.");
      if (directive.reference !== undefined && typeof directive.reference !== "string") report(path + ".reference", "must be a string when present.");
      if (directive.body !== undefined && typeof directive.body !== "string") report(path + ".body", "must be a string when present.");
      if (directive.kind === "in" && (typeof directive.target !== "string" || directive.target.length === 0)) report(path + ".target", "is required for an in directive.");
      if (directive.kind === "out") {
        if (typeof directive.name !== "string" || directive.name.length === 0) report(path + ".name", "is required for an out directive.");
        if (typeof directive.from !== "string" || !addressPattern.test(directive.from)) report(path + ".from", "is required for an out directive.");
      }
      if (directive.kind === "create") {
        if (!componentPattern.test(directive.document ?? "")) report(path + ".document", "is required for a create directive.");
        if (typeof directive.name !== "string" || directive.name.length === 0) report(path + ".name", "is required for a create directive.");
        if (!Array.isArray(directive.compose)) report(path + ".compose", "is required for a create directive.");
      }
      if (directive.kind === "alias") {
        if (!componentPattern.test(directive.document ?? "")) report(path + ".document", "is required for an alias directive.");
        if (typeof directive.name !== "string" || directive.name.length === 0) report(path + ".name", "is required for an alias directive.");
        if (typeof directive.reference !== "string" || directive.reference.length === 0) report(path + ".reference", "is required for an alias directive.");
      }
    }
  }
  if (map.metadata !== undefined && !isObject(map.metadata)) report("metadata", "must be an object when present.");
  return diagnostics;
};

const validateTransforms = (value, path, report) => {
  if (!Array.isArray(value)) {
    report(path, "must be an array.");
    return;
  }
  for (const [index, transform] of value.entries()) {
    if (!isObject(transform) || !componentPattern.test(transform.name ?? "") || (transform.arguments !== undefined && !Array.isArray(transform.arguments))) {
      report(path + "[" + index + "]", "must contain a lowercase name and optional arguments array.");
    }
  }
};

const validateMetadata = (value, path, report) => {
  if (!isObject(value)) {
    report(path, "must be an object.");
    return;
  }
  if (value.language !== undefined && typeof value.language !== "string") report(path + ".language", "must be a string when present.");
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string"))) report(path + ".tags", "must be an array of strings when present.");
  if (value.data !== undefined && !isObject(value.data)) report(path + ".data", "must be an object when present.");
  const ravel = value.data?.ravel;
  if (ravel !== undefined && !isObject(ravel)) {
    report(path + ".data.ravel", "must be an object when present.");
  } else if (ravel?.run !== undefined && typeof ravel.run !== "boolean") {
    report(path + ".data.ravel.run", "must be a boolean when present.");
  } else if (ravel?.provider !== undefined &&
      (typeof ravel.provider !== "string" || !ravel.provider)) {
    report(path + ".data.ravel.provider", "must be a non-empty string when present.");
  }
};

export class RavelMapValidationError extends Error {
  constructor(diagnostics) {
    super("Invalid Ravel Map: " + diagnostics.map((entry) => entry.message).join(" "));
    this.name = "RavelMapValidationError";
    this.diagnostics = diagnostics;
  }
}

export const assertRavelMap = (map, options = {}) => {
  const diagnostics = validateRavelMap(map, options);
  if (diagnostics.length) throw new RavelMapValidationError(diagnostics);
  return map;
};
