const idPattern = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

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

  const id = argumentsValue[0];
  const metadata = argumentsValue.length > 1 ? argumentsValue[1] : {};
  if (typeof id !== "string" || !idPattern.test(id)) {
    diagnostics.push(diagnostic("RV131", "emit requires a valid static chunk ID.", location));
    return null;
  }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    diagnostics.push(diagnostic("RV131", "emit metadata must be an object.", location));
    return null;
  }
  return { type: "emit", id, metadata, source: location };
};

const parseExpression = (expression, source, expressionOffset, diagnostics) => {
  const parts = splitTopLevel(expression, "|");
  const reference = parts.shift();
  if (!reference || !idPattern.test(reference.value.replace(/^([a-z][a-z0-9-]*)::/, ""))) {
    diagnostics.push(diagnostic("RV110", "Malformed chunk reference: " + (reference?.value ?? ""), span(source, expression, expressionOffset, expressionOffset + expression.length)));
    return null;
  }

  const pipeline = parts
    .map((part) => parsePipeStep(part, expression, source, expressionOffset, diagnostics))
    .filter(Boolean);

  return {
    type: "reference",
    reference: reference.value,
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

export const combineMaps = (maps) => {
  const diagnostics = [];
  const chunks = [];
  const directives = [];
  const documents = [];
  const ids = new Set();

  for (const map of maps) {
    documents.push(clone(map.document));
    for (const chunk of map.chunks ?? []) {
      if (ids.has(chunk.id)) {
        diagnostics.push(diagnostic("RV101", "Duplicate chunk ID: " + chunk.id, chunk.source));
      } else {
        ids.add(chunk.id);
        chunks.push(clone(chunk));
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

const definitionFromEmission = (owner, reference, prefix, emit) => ({
  id: emit.id,
  name: typeof emit.metadata.name === "string" ? emit.metadata.name : emit.id,
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
    pipeline: clone(prefix),
    source: reference.source
  }]
});

export const transformGraph = (pretransform) => {
  const diagnostics = [...(pretransform.diagnostics ?? [])];
  const definitions = new Map();

  for (const raw of pretransform.chunks ?? []) {
    const parsed = parseChunk(raw.body, raw.source);
    diagnostics.push(...parsed.diagnostics);
    definitions.set(raw.id, {
      id: raw.id,
      name: raw.name ?? raw.id,
      metadata: raw.metadata ?? {},
      source: raw.source,
      generated: false,
      origin: { kind: "source", source: raw.source },
      ast: parsed.nodes
    });
  }

  for (const definition of [...definitions.values()]) {
    for (const node of definition.ast) {
      if (node.type !== "reference") continue;
      const prefix = [];
      const retained = [];
      for (const step of node.pipeline) {
        if (step.type === "emit") {
          if (definitions.has(step.id)) {
            diagnostics.push(diagnostic("RV101", "emit creates duplicate chunk ID: " + step.id, step.source));
          } else {
            definitions.set(step.id, definitionFromEmission(definition, node, prefix, step));
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
    const dependency = evaluate(node.reference, node.source);
    owner.dependencies.add(node.reference);
    owner.references.push({ chunk: node.reference, source: node.source });
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
    const owner = { dependencies: new Set(), references: [] };
    let value = "";
    for (const node of definition.ast) {
      value += node.type === "literal" ? node.value : evaluateReference(node, owner);
    }
    evaluating.pop();

    const completed = {
      id,
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
    if (typeof directive.from !== "string") {
      diagnostics.push(diagnostic("RV130", "out requires a source chunk ID.", directive.source));
      continue;
    }
    const chunk = evaluate(directive.from, directive.source);
    if (deliverables[name]) {
      diagnostics.push(diagnostic("RV101", "Duplicate out deliverable: " + name, directive.source));
      continue;
    }
    deliverables[name] = {
      name,
      from: directive.from,
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

