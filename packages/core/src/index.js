const componentPattern = /^[a-z][a-z0-9-]*$/;

export { directiveKinds, compose, append, newline, pipe, pass, createDirective, aliasDirective } from "./directives.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const advance = (start, text, index) => {
  let line = start.line;
  let column = start.column;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column, offset: start.offset + index };
};

const span = (source, text, start, end) => ({
  uri: source.uri,
  range: {
    start: advance(source.range.start, text, start),
    end: advance(source.range.start, text, end)
  }
});

const diagnostic = (code, message, source, related = []) => ({
  code,
  severity: "error",
  message,
  source,
  related
});

const validComponent = (value) => value === null || (typeof value === "string" && componentPattern.test(value));

export const formatChunkId = (identity) => {
  const prefix = identity.document === null ? "" : identity.document + "::";
  return prefix +
    (identity.chunk ?? "") +
    (identity.minor === null ? "" : ":" + identity.minor) +
    (identity.type === null ? "" : "." + identity.type);
};

export const parseChunkId = (input, { reference = false } = {}) => {
  if (typeof input !== "string" || input.length === 0) return null;

  const delimiter = input.indexOf("::");
  const explicitDocument = delimiter !== -1;
  let document = null;
  let remainder = input;

  if (explicitDocument) {
    document = input.slice(0, delimiter);
    remainder = input.slice(delimiter + 2);
    if (!componentPattern.test(document)) return null;
  }

  let type = null;
  const typeIndex = remainder.lastIndexOf(".");
  if (typeIndex !== -1) {
    type = remainder.slice(typeIndex + 1);
    remainder = remainder.slice(0, typeIndex);
    if (!componentPattern.test(type)) return null;
  }

  let chunk = remainder;
  let minor = null;
  const minorIndex = remainder.indexOf(":");
  if (minorIndex !== -1) {
    chunk = remainder.slice(0, minorIndex);
    minor = remainder.slice(minorIndex + 1);
    if (!componentPattern.test(minor)) return null;
  }

  if (chunk === "") chunk = null;
  if (!validComponent(chunk)) return null;
  if (!validComponent(document) || !validComponent(minor) || !validComponent(type)) return null;

  if (!reference && document === null && chunk === null) return null;
  if (!reference && document === null && chunk !== null && input.includes("::")) return null;
  if (!reference && document === null && chunk !== null) return null;
  if (!reference && document !== null && chunk === null && (minor !== null || type !== null)) {
    return { document, chunk, minor, type, explicitDocument };
  }
  if (!reference && document !== null && chunk === null) {
    return { document, chunk, minor, type, explicitDocument };
  }
  if (reference && !explicitDocument && chunk === null && minor === null && type === null) return null;

  return { document, chunk, minor, type, explicitDocument };
};

const validateIdentity = (identity) => {
  if (!identity || typeof identity !== "object") return null;
  const required = ["document", "chunk", "minor", "type"];
  if (!required.every((key) => Object.hasOwn(identity, key))) return null;
  const result = {
    document: identity.document,
    chunk: identity.chunk,
    minor: identity.minor,
    type: identity.type,
    explicitDocument: identity.document !== null
  };
  if (!validComponent(result.document) || !validComponent(result.chunk) ||
      !validComponent(result.minor) || !validComponent(result.type)) {
    return null;
  }
  if (result.document === null && result.chunk === null) return null;
  return result;
};

const splitTopLevel = (text, separator) => {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push({ value: text.slice(start, index).trim(), start, end: index });
      start = index + 1;
    }
  }
  parts.push({ value: text.slice(start).trim(), start, end: text.length });
  return parts;
};

const parseString = (value) => {
  if (value.startsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return undefined;
};

const parseValue = (value) => {
  const trimmed = value.trim();
  const string = parseString(trimmed);
  if (typeof string === "string") return string;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const parseEmitSuffix = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.includes(":")) return null;

  if (value.startsWith(".")) {
    const type = value.slice(1);
    return componentPattern.test(type)
      ? { minor: null, type, inheritMinor: true }
      : null;
  }

  const typeIndex = value.lastIndexOf(".");
  const minor = typeIndex === -1 ? value : value.slice(0, typeIndex);
  const type = typeIndex === -1 ? null : value.slice(typeIndex + 1);
  if (!componentPattern.test(minor) || !validComponent(type)) return null;
  return { minor, type, inheritMinor: false };
};

const parsePipeStep = (part, expression, source, expressionOffset, diagnostics) => {
  const match = /^([a-z][a-z0-9-]*)\s*(?:\((.*)\))?$/s.exec(part.value);
  const location = span(source, expression, expressionOffset + part.start, expressionOffset + part.end);
  if (!match) {
    diagnostics.push(diagnostic("RV110", "Malformed pipeline step: " + part.value, location));
    return null;
  }

  const name = match[1];
  const rawArguments = typeof match[2] === "undefined" || match[2].trim() === ""
    ? []
    : splitTopLevel(match[2], ",");
  const argumentsValue = rawArguments.map((argument) => parseValue(argument.value));

  if (argumentsValue.some((argument) => typeof argument === "undefined")) {
    diagnostics.push(diagnostic("RV120", "Pipeline arguments must be JSON-like literals.", location));
    return null;
  }

  if (name !== "emit") {
    return { type: "transform", name, arguments: argumentsValue, source: location };
  }

  const rawSuffix = argumentsValue[0];
  const metadata = argumentsValue.length > 1 ? argumentsValue[1] : {};
  const suffix = parseEmitSuffix(rawSuffix);
  if (!suffix) {
    diagnostics.push(diagnostic("RV131", "emit requires a local minor/type suffix such as 'cool', 'cool.js', or '.js'.", location));
    return null;
  }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    diagnostics.push(diagnostic("RV131", "emit metadata must be an object.", location));
    return null;
  }
  return { type: "emit", suffix, metadata, source: location };
};

const parseExpression = (expression, source, expressionOffset, diagnostics) => {
  const parts = splitTopLevel(expression, "|");
  const reference = parts.shift();
  const target = parseChunkId(reference?.value, { reference: true });
  if (!reference || !target) {
    diagnostics.push(diagnostic("RV110", "Malformed chunk reference: " + (reference?.value ?? ""), span(source, expression, expressionOffset, expressionOffset + expression.length)));
    return null;
  }

  const pipeline = parts
    .map((part) => parsePipeStep(part, expression, source, expressionOffset, diagnostics))
    .filter(Boolean);

  return {
    type: "reference",
    reference: reference.value,
    target,
    pipeline,
    source: span(source, expression, expressionOffset, expressionOffset + expression.length)
  };
};

export const parseChunk = (body, source) => {
  const nodes = [];
  const diagnostics = [];
  let literalStart = 0;
  let index = 0;

  while (index < body.length) {
    if (body[index] === "\\" && body[index + 1] === "_" && ["\"", "'", "`"].includes(body[index + 2])) {
      index += 3;
      continue;
    }
    if (body[index] !== "_" || !["\"", "'", "`"].includes(body[index + 1])) {
      index += 1;
      continue;
    }

    const quote = body[index + 1];
    let end = index + 2;
    let escaped = false;
    while (end < body.length) {
      if (escaped) {
        escaped = false;
      } else if (body[end] === "\\") {
        escaped = true;
      } else if (body[end] === quote) {
        break;
      }
      end += 1;
    }

    if (end >= body.length) {
      diagnostics.push(diagnostic("RV110", "Unterminated quoted chunk reference.", span(source, body, index, body.length)));
      break;
    }

    if (literalStart < index) {
      nodes.push({ type: "literal", value: body.slice(literalStart, index), source: span(source, body, literalStart, index) });
    }
    const expression = body.slice(index + 2, end);
    const parsed = parseExpression(expression, source, index + 2, diagnostics);
    if (parsed) nodes.push(parsed);
    index = end + 1;
    literalStart = index;
  }

  if (literalStart < body.length) {
    nodes.push({ type: "literal", value: body.slice(literalStart), source: span(source, body, literalStart, body.length) });
  }
  return { nodes, diagnostics };
};

const normalizeChunk = (raw, document, diagnostics) => {
  const identity = validateIdentity(raw.identity);
  if (!identity) {
    diagnostics.push(diagnostic("RV100", "Chunks require explicit document, chunk, minor, and type identity fields.", raw.source));
    return null;
  }
  if (identity.document !== null && identity.document !== document.id) {
    diagnostics.push(diagnostic("RV100", "Chunk identity document must match its source map document.", raw.source));
    return null;
  }
  const id = formatChunkId(identity);
  if (raw.id !== id) {
    diagnostics.push(diagnostic("RV100", "Chunk id must equal its canonical identity form: " + id, raw.source));
    return null;
  }
  return { ...clone(raw), id, identity };
};

export const combineMaps = (maps) => {
  const diagnostics = [];
  const chunks = [];
  const directives = [];
  const documents = [];
  const ids = new Set();

  for (const map of maps) {
    documents.push(clone(map.document));
    for (const raw of map.chunks ?? []) {
      const chunk = normalizeChunk(raw, map.document, diagnostics);
      if (!chunk) continue;
      if (ids.has(chunk.id)) {
        diagnostics.push(diagnostic("RV101", "Duplicate chunk ID: " + chunk.id, chunk.source));
      } else {
        ids.add(chunk.id);
        chunks.push(chunk);
      }
    }
    for (const directive of map.directives ?? []) directives.push(clone(directive));
  }

  return { version: 1, documents, chunks, directives, diagnostics };
};

const applyTransform = (value, step, diagnostics) => {
  if (step.name === "concat") return value;
  if (step.name === "trim") return value.trim();
  if (step.name === "normalize-eol") return value.replace(/\r\n?/g, "\n");
  if (step.name === "indent") {
    const count = step.arguments[0];
    if (!Number.isInteger(count) || count < 0) {
      diagnostics.push(diagnostic("RV120", "indent requires a non-negative integer.", step.source));
      return value;
    }
    const padding = " ".repeat(count);
    return value.split("\n").map((line) => line ? padding + line : line).join("\n");
  }
  if (step.name === "dedent") {
    const lines = value.split("\n");
    const indents = lines.filter((line) => /\S/.test(line)).map((line) => /^\s*/.exec(line)[0].length);
    const amount = indents.length ? Math.min(...indents) : 0;
    return lines.map((line) => line.slice(amount)).join("\n");
  }
  if (step.name === "replace") {
    const search = step.arguments[0];
    const replacement = step.arguments[1];
    if (typeof search !== "string" || typeof replacement !== "string") {
      diagnostics.push(diagnostic("RV120", "replace requires string search and replacement arguments.", step.source));
      return value;
    }
    return value.split(search).join(replacement);
  }
  if (step.name === "quote-reference") {
    return value.replace(/_(["'\x60])/g, "\\_$1");
  }

  diagnostics.push(diagnostic("RV120", "Unknown transform: " + step.name, step.source));
  return value;
};

const definitionFromEmission = (owner, reference, prefix, emit) => {
  const identity = {
    document: owner.identity.document,
    chunk: owner.identity.chunk,
    minor: emit.suffix.inheritMinor ? owner.identity.minor : emit.suffix.minor,
    type: emit.suffix.type,
    explicitDocument: true
  };
  const id = formatChunkId(identity);
  return {
  id,
  identity,
  name: typeof emit.metadata.name === "string" ? emit.metadata.name : id,
  metadata: {
    language: emit.metadata.language,
    tags: Array.isArray(emit.metadata.tags) ? emit.metadata.tags : [],
    data: emit.metadata.data && typeof emit.metadata.data === "object" ? emit.metadata.data : {}
  },
  source: emit.source,
  generated: true,
  origin: {
    kind: "emit",
    owner: owner.id,
    source: emit.source,
    reference: reference.reference,
    pipeline: clone(prefix)
  },
  ast: [{
    type: "reference",
    reference: reference.reference,
    target: clone(reference.target),
    pipeline: clone(prefix),
    source: reference.source
  }]
  };
};

const resolveTarget = (target, owner, definitions) => {
  const withOwnerChunk = target.chunk === null && !target.explicitDocument
    ? owner.identity.chunk
    : target.chunk;
  const parts = {
    chunk: withOwnerChunk,
    minor: target.minor,
    type: target.type
  };

  if (target.explicitDocument) {
    const id = formatChunkId({ document: target.document, ...parts });
    return definitions.has(id) ? id : null;
  }

  if (owner.identity.document !== null) {
    const local = formatChunkId({ document: owner.identity.document, ...parts });
    if (definitions.has(local)) return local;
  }

  const global = formatChunkId({ document: null, ...parts });
  return definitions.has(global) ? global : null;
};

export const transformGraph = (pretransform) => {
  const diagnostics = [...(pretransform.diagnostics ?? [])];
  const definitions = new Map();

  for (const raw of pretransform.chunks ?? []) {
    const parsed = parseChunk(raw.body, raw.source);
    diagnostics.push(...parsed.diagnostics);
    definitions.set(raw.id, {
      id: raw.id,
      identity: raw.identity,
      name: raw.name ?? raw.id,
      metadata: raw.metadata ?? {},
      source: raw.source,
      generated: false,
      origin: { kind: "source", source: raw.source },
      ast: parsed.nodes
    });
  }

  const directiveIdentity = (directive) => {
    const document = directive.document;
    if (typeof document !== "string" || typeof directive.name !== "string" || directive.name.includes("::")) return null;
    const parsed = parseChunkId(document + "::" + directive.name, { reference: true });
    return parsed?.chunk === null ? null : parsed;
  };

  const composeBody = (steps, source) => {
    if (!Array.isArray(steps)) return null;
    let body = "";
    let pendingNewlines = 1;
    let hasAppend = false;
    for (const step of steps) {
      if (step?.kind === "newline") {
        if (!Number.isInteger(step.count) || step.count < 0) {
          diagnostics.push(diagnostic("RV130", "newline requires a non-negative integer.", step.source ?? source));
          return null;
        }
        pendingNewlines = step.count;
      } else if (step?.kind === "append" && typeof step.reference === "string") {
        if (hasAppend) body += "\n".repeat(pendingNewlines);
        body += "_\"" + step.reference.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"";
        hasAppend = true;
        pendingNewlines = 1;
      } else {
        diagnostics.push(diagnostic("RV130", "create compose currently requires append references and newline steps.", step?.source ?? source));
        return null;
      }
    }
    return body;
  };

  for (const directive of pretransform.directives ?? []) {
    if (directive.kind !== "create" && directive.kind !== "alias") continue;
    const identity = directiveIdentity(directive);
    if (!identity) {
      diagnostics.push(diagnostic("RV130", directive.kind + " requires a current document and local chunk:minor.type name.", directive.source));
      continue;
    }
    const id = formatChunkId(identity);
    if (definitions.has(id)) {
      diagnostics.push(diagnostic("RV101", "Duplicate directive chunk ID: " + id, directive.source));
      continue;
    }
    const source = directive.source;
    if (directive.kind === "create") {
      const body = directive.compose ? composeBody(directive.compose, source) : directive.body;
      if (body === null) continue;
      const parsed = parseChunk(typeof body === "string" ? body : "", source);
      diagnostics.push(...parsed.diagnostics);
      definitions.set(id, {
        id, identity, name: directive.name, metadata: directive.metadata ?? {}, source,
        generated: true, origin: { kind: "create", source }, ast: parsed.nodes
      });
    } else {
      const reference = parseExpression(directive.reference, source, 0, diagnostics);
      if (!reference) continue;
      definitions.set(id, {
        id, identity, name: directive.name, metadata: directive.metadata ?? {}, source,
        generated: true, origin: { kind: "alias", source, target: directive.reference }, ast: [reference]
      });
    }
  }

  for (const definition of [...definitions.values()]) {
    for (const node of definition.ast) {
      if (node.type !== "reference") continue;
      const prefix = [];
      const retained = [];
      for (const step of node.pipeline) {
        if (step.type === "emit") {
          if (definition.identity.document === null) {
            diagnostics.push(diagnostic("RV131", "emit is unavailable from a document-less global chunk.", step.source));
            continue;
          }
          const emitted = definitionFromEmission(definition, node, prefix, step);
          if (definitions.has(emitted.id)) {
            diagnostics.push(diagnostic("RV101", "emit creates duplicate chunk ID: " + emitted.id, step.source));
          } else {
            definitions.set(emitted.id, emitted);
          }
        } else {
          prefix.push(step);
          retained.push(step);
        }
      }
      node.pipeline = retained;
    }
  }

  const values = new Map();
  const evaluating = [];
  const resultChunks = {};

  const evaluateReference = (node, owner) => {
    const resolved = resolveTarget(node.target, owner.definition, definitions);
    if (!resolved) {
      diagnostics.push(diagnostic("RV111", "Unknown chunk reference: " + node.reference, node.source));
      return "";
    }
    const dependency = evaluate(resolved, node.source);
    owner.dependencies.add(resolved);
    owner.references.push({ chunk: resolved, requested: node.reference, source: node.source });
    let value = dependency.value;
    for (const step of node.pipeline) value = applyTransform(value, step, diagnostics);
    return value;
  };

  const evaluate = (id, requestedFrom) => {
    if (values.has(id)) return values.get(id);
    const definition = definitions.get(id);
    if (!definition) {
      diagnostics.push(diagnostic("RV111", "Unknown chunk reference: " + id, requestedFrom));
      return { value: "", dependencies: [], provenance: [] };
    }

    const cycleIndex = evaluating.indexOf(id);
    if (cycleIndex !== -1) {
      const cycle = [...evaluating.slice(cycleIndex), id];
      diagnostics.push(diagnostic("RV112", "Chunk reference cycle: " + cycle.join(" → "), requestedFrom));
      return { value: "", dependencies: [], provenance: [] };
    }

    evaluating.push(id);
    const owner = { definition, dependencies: new Set(), references: [] };
    let value = "";
    for (const node of definition.ast) {
      value += node.type === "literal" ? node.value : evaluateReference(node, owner);
    }
    evaluating.pop();

    const completed = {
      id,
      identity: definition.identity,
      name: definition.name,
      value,
      metadata: definition.metadata,
      dependencies: [...owner.dependencies].sort(),
      references: owner.references,
      provenance: [definition.origin],
      generated: definition.generated
    };
    values.set(id, completed);
    resultChunks[id] = completed;
    return completed;
  };

  for (const id of definitions.keys()) evaluate(id, definitions.get(id).source);

  const deliverables = {};
  for (const directive of pretransform.directives ?? []) {
    if (directive.kind !== "out") continue;
    const name = directive.name ?? directive.target;
    if (typeof name !== "string" || !name) {
      diagnostics.push(diagnostic("RV130", "out requires a file-like name.", directive.source));
      continue;
    }
    const target = parseChunkId(directive.from);
    const id = target && target.explicitDocument
      ? formatChunkId(target)
      : null;
    if (!id || !definitions.has(id)) {
      diagnostics.push(diagnostic("RV130", "out requires a fully qualified existing source chunk ID.", directive.source));
      continue;
    }
    const chunk = evaluate(id, directive.source);
    if (deliverables[name]) {
      diagnostics.push(diagnostic("RV101", "Duplicate out deliverable: " + name, directive.source));
      continue;
    }
    deliverables[name] = {
      name,
      from: id,
      value: chunk.value,
      dependencies: chunk.dependencies,
      provenance: chunk.provenance,
      source: directive.source
    };
  }

  return {
    version: 1,
    documents: pretransform.documents,
    chunks: resultChunks,
    deliverables,
    diagnostics
  };
};
