const componentPattern = /^[a-z][a-z0-9-]*$/;
const chunkPathPattern = /^[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*)?)*$/;
const relativeChunkPathPattern = /^(?:\.\.?)(?:\/(?:\.\.?|[a-z][a-z0-9-]*))*$/;

export { directiveKinds, compose, append, newline, pipe, pass, createDirective, aliasDirective } from "./directives.js";
export { parseRavelDirectiveBlock } from "./directive-syntax.js";
export {
  cloneRavelValue,
  executeLiveProgram,
  planLiveExecutions,
  ravelValueIssue,
  serializeRavelValue
} from "./live.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const mappedValue = (text = "", segments = []) => ({ text, segments });

const sourceSegment = (text, source, chunk, kind, precision = "exact", via = []) => mappedValue(
  text,
  text.length === 0 ? [] : [{
    generated: { start: 0, end: text.length },
    source: source ? clone(source) : null,
    chunk,
    kind,
    precision,
    via: clone(via)
  }]
);

const concatMapped = (...values) => {
  let text = "";
  const segments = [];
  for (const value of values) {
    const offset = text.length;
    text += value.text;
    for (const segment of value.segments) {
      segments.push({
        ...segment,
        generated: {
          start: segment.generated.start + offset,
          end: segment.generated.end + offset
        }
      });
    }
  }
  return mappedValue(text, segments);
};

const sliceMapped = (value, start, end = value.text.length) => {
  const text = value.text.slice(start, end);
  const segments = [];
  for (const segment of value.segments) {
    const overlapStart = Math.max(start, segment.generated.start);
    const overlapEnd = Math.min(end, segment.generated.end);
    if (overlapStart >= overlapEnd) continue;
    let source = segment.source;
    const segmentLength = segment.generated.end - segment.generated.start;
    const sourceStart = segment.source?.range?.start;
    const sourceEnd = segment.source?.range?.end;
    if (segment.precision === "exact" && sourceStart && sourceEnd &&
        sourceEnd.offset - sourceStart.offset === segmentLength) {
      const segmentText = value.text.slice(segment.generated.start, segment.generated.end);
      source = {
        uri: segment.source.uri,
        range: {
          start: advance(sourceStart, segmentText, overlapStart - segment.generated.start),
          end: advance(sourceStart, segmentText, overlapEnd - segment.generated.start)
        }
      };
    }
    segments.push({
      ...segment,
      source,
      generated: {
        start: overlapStart - start,
        end: overlapEnd - start
      }
    });
  }
  return mappedValue(text, segments);
};

const coarseMapped = (text, source, chunk, kind, via = []) =>
  sourceSegment(text, source, chunk, kind, "coarse", via);

const segmentOrigins = (value) => {
  const origins = [];
  const seen = new Set();
  for (const segment of value.segments) {
    const candidates = segment.origins ?? [{
      source: segment.source,
      chunk: segment.chunk,
      kind: segment.kind,
      precision: segment.precision,
      via: segment.via ?? []
    }];
    for (const candidate of candidates) {
      const key = JSON.stringify(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      origins.push(clone(candidate));
    }
  }
  return origins;
};

const coarseDerivedMapped = (text, source, chunk, kind, via, input) => {
  const result = coarseMapped(text, source, chunk, kind, via);
  if (result.segments.length) result.segments[0].origins = segmentOrigins(input);
  return result;
};

const withMappedDerivation = (value, derivation) => mappedValue(
  value.text,
  value.segments.map((segment) => ({
    ...segment,
    via: [...(segment.via ?? []), clone(derivation)]
  }))
);

const mapBuiltinTransform = (input, output, step, chunk) => {
  const derivation = { kind: "transform", name: step.name, source: clone(step.source) };
  if (step.name === "concat") return withMappedDerivation(input, derivation);
  if (step.name === "trim") {
    const start = input.text.length - input.text.trimStart().length;
    const end = input.text.trimEnd().length;
    return withMappedDerivation(sliceMapped(input, start, Math.max(start, end)), derivation);
  }
  if (step.name === "indent" && Number.isInteger(step.arguments[0]) && step.arguments[0] >= 0) {
    const padding = " ".repeat(step.arguments[0]);
    const parts = [];
    const lines = input.text.split("\n");
    let cursor = 0;
    for (const line of lines) {
      if (line.length) {
        parts.push(coarseMapped(padding, step.source, chunk, "transform-insert", [derivation]));
        parts.push(withMappedDerivation(sliceMapped(input, cursor, cursor + line.length), derivation));
      }
      cursor += line.length;
      if (cursor < input.text.length) {
        parts.push(withMappedDerivation(sliceMapped(input, cursor, cursor + 1), derivation));
        cursor += 1;
      }
    }
    const result = concatMapped(...parts);
    return result.text === output ? result : null;
  }
  if (step.name === "dedent") {
    const lines = input.text.split("\n");
    const indents = lines.filter((line) => /\S/.test(line)).map((line) => /^\s*/.exec(line)[0].length);
    const amount = indents.length ? Math.min(...indents) : 0;
    const parts = [];
    let cursor = 0;
    for (const line of lines) {
      const end = cursor + line.length;
      parts.push(withMappedDerivation(sliceMapped(input, Math.min(end, cursor + amount), end), derivation));
      cursor = end;
      if (cursor < input.text.length) {
        parts.push(withMappedDerivation(sliceMapped(input, cursor, cursor + 1), derivation));
        cursor += 1;
      }
    }
    const result = concatMapped(...parts);
    return result.text === output ? result : null;
  }
  return null;
};

const replaceMappedOnce = (value, search, replacement) => {
  const index = value.text.indexOf(search);
  if (index === -1 || value.text.indexOf(search, index + search.length) !== -1) return null;
  return concatMapped(
    sliceMapped(value, 0, index),
    replacement,
    sliceMapped(value, index + search.length)
  );
};

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
const validChunkPath = (value) => value === null || (typeof value === "string" && chunkPathPattern.test(value));

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
  const pathIndex = remainder.lastIndexOf("/");
  if (typeIndex > pathIndex) {
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
    if (chunk.endsWith("/") && /^\.{1,2}(?:\/|$)/.test(chunk)) chunk = chunk.slice(0, -1);
  }

  if (chunk === "") chunk = null;
  const relativePath = reference && typeof chunk === "string" && relativeChunkPathPattern.test(chunk)
    ? chunk
    : null;
  if (relativePath === null && !validChunkPath(chunk)) return null;
  if (!validComponent(document) || !validComponent(minor) || !validComponent(type)) return null;
  if (relativePath !== null && explicitDocument) return null;

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

  return {
    document,
    chunk,
    minor,
    type,
    explicitDocument,
    ...(relativePath === null ? {} : { relativePath })
  };
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
  if (!validComponent(result.document) || !validChunkPath(result.chunk) ||
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

  if (name === "emit") {
    if (argumentsValue.some((argument) => typeof argument === "undefined")) {
      diagnostics.push(diagnostic("RV120", "emit arguments must be JSON-like literals.", location));
      return null;
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
  }

  const textArgument = () => {
    if (argumentsValue.length > 1 || argumentsValue.some((argument) => typeof argument !== "string")) {
      diagnostics.push(diagnostic("RV121", "text accepts zero or one string argument.", location));
      return null;
    }
    return { type: "text", value: argumentsValue[0] ?? "", source: location };
  };
  if (name === "text") return textArgument();

  if (name === "ch") {
    if (argumentsValue.length !== 1 || typeof argumentsValue[0] !== "string") {
      diagnostics.push(diagnostic("RV121", "ch requires one quoted chunk expression.", location));
      return null;
    }
    const parsed = parseExpression(argumentsValue[0], source, expressionOffset + part.start, diagnostics, { allowDelay: false });
    if (!parsed) return null;
    return { type: "chunk", expression: argumentsValue[0], value: parsed, source: location };
  }

  const argumentsParsed = rawArguments.map((argument) => {
    const value = parseValue(argument.value);
    if (typeof value !== "undefined") return value;
    const nested = parsePipeStep({ value: argument.value, start: part.start + argument.start, end: part.start + argument.end }, expression, source, expressionOffset, diagnostics);
    return nested?.type === "text" || nested?.type === "chunk"
      ? { kind: "ravel-command-argument", command: nested }
      : undefined;
  });
  if (argumentsParsed.some((argument) => typeof argument === "undefined")) {
    diagnostics.push(diagnostic("RV120", "Pipeline arguments must be JSON-like literals, text(...), or ch(...).", location));
    return null;
  }
  return { type: name === "delay" ? "delay" : "transform", name, arguments: argumentsParsed, source: location };
};

const parseExpression = (expression, source, expressionOffset, diagnostics, { allowDelay = true } = {}) => {
  const parts = splitTopLevel(expression, "|");
  const reference = parts.shift();
  const target = parseChunkId(reference?.value, { reference: true });
  const pipeline = parts
    .map((part) => parsePipeStep(part, expression, source, expressionOffset, diagnostics))
    .filter(Boolean);
  if (!reference || !target) {
    const delay = pipeline.length === 1 && pipeline[0].type === "delay" ? pipeline[0] : null;
    if (reference?.value === "" && delay && allowDelay) {
      const [value, phase = 1, safeSymbol] = delay.arguments;
      const command = value?.kind === "ravel-command-argument" ? value.command : null;
      if ((typeof value !== "string" && command?.type !== "text" && command?.type !== "chunk") ||
          !Number.isInteger(phase) || phase < 1 ||
          (safeSymbol !== undefined && (typeof safeSymbol !== "string" || !/^[A-Za-z0-9]+$/.test(safeSymbol)))) {
        diagnostics.push(diagnostic("RV121", "delay requires text(...), ch(...), or a string, then an optional positive phase and safe symbol.", delay.source));
        return null;
      }
      return {
        type: "delay",
        value,
        expression: typeof value === "string" ? value : command.expression ?? command.value,
        phase,
        safeSymbol,
        source: span(source, expression, expressionOffset, expressionOffset + expression.length)
      };
    }
    if (reference?.value === "" && pipeline.length && pipeline[0].type !== "delay" &&
        (pipeline[0].type === "text" || pipeline[0].type === "chunk")) {
      if (pipeline.some((step) => step.type === "delay")) {
        diagnostics.push(diagnostic("RV121", "delay may only appear as the sole command in _\"|delay(...)\".", pipeline.find((step) => step.type === "delay").source));
        return null;
      }
      return { type: "pipeline", pipeline, source: span(source, expression, expressionOffset, expressionOffset + expression.length) };
    }
    if (pipeline.some((step) => step.type === "delay")) {
      diagnostics.push(diagnostic("RV121", "delay may only appear as the sole command in _\"|delay(...)\".", pipeline.find((step) => step.type === "delay").source));
      return null;
    }
    diagnostics.push(diagnostic("RV110", "Malformed chunk reference: " + (reference?.value ?? ""), span(source, expression, expressionOffset, expressionOffset + expression.length)));
    return null;
  }

  if (pipeline.some((step) => step.type === "delay")) {
    diagnostics.push(diagnostic("RV121", "delay may only appear as the sole command in _\"|delay(...)\".", pipeline.find((step) => step.type === "delay").source));
    return null;
  }

  return {
    type: "reference",
    reference: reference.value,
    target,
    pipeline,
    source: span(source, expression, expressionOffset, expressionOffset + expression.length)
  };
};

/**
 * Parse a definition-time transform pipeline without executing it.
 * Adapters use this entry point so every markup dialect shares one grammar.
 */
export const parseDefinitionPipeline = (text, source) => {
  const diagnostics = [];
  if (typeof text !== "string" || !text.trim()) return { pipeline: [], diagnostics };
  const expression = text.trim();
  const pipeline = [];
  for (const part of splitTopLevel(expression, "|")) {
    const step = parsePipeStep(part, expression, source, 0, diagnostics);
    if (!step) continue;
    if (step.type !== "transform") {
      diagnostics.push(diagnostic("RV120", "Definition pipelines accept transform calls only.", step.source ?? source));
      continue;
    }
    pipeline.push({ name: step.name, arguments: step.arguments });
  }
  return { pipeline, diagnostics };
};

// An embedded reference inherits the indentation of its containing source line
// on continuation lines. The first line is already positioned by the literal
// text before the reference, so it deliberately remains untouched.
const continuationIndentAt = (body, index) => {
  const lineStart = Math.max(body.lastIndexOf("\n", index - 1), body.lastIndexOf("\r", index - 1)) + 1;
  return /^[\t ]*/.exec(body.slice(lineStart, index))[0];
};

const applyContinuationIndentMapped = (value, indentation, source, chunk) => {
  if (!indentation || !/[\r\n]/.test(value.text)) return value;
  const parts = [];
  const pattern = /(\r\n|\n|\r)([^\r\n]*)/g;
  let cursor = 0;
  for (const match of value.text.matchAll(pattern)) {
    if (!/\S/.test(match[2])) continue;
    const insertion = match.index + match[1].length;
    parts.push(sliceMapped(value, cursor, insertion));
    parts.push(coarseMapped(
      indentation,
      source,
      chunk,
      "continuation-indent",
      [{ kind: "indent", value: indentation, source: clone(source) }]
    ));
    cursor = insertion;
  }
  parts.push(sliceMapped(value, cursor));
  return concatMapped(...parts);
};

const firstUnescapedPipe = (value) => {
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    if (escaped) escaped = false;
    else if (value[index] === "\\") escaped = true;
    else if (value[index] === "|") return index;
  }
  return -1;
};

const nowebExpression = (value, options) => {
  const pipe = options.nowebPlus ? firstUnescapedPipe(value) : -1;
  const authoredName = (pipe === -1 ? value : value.slice(0, pipe)).trim().replace(/\\\|/g, "|");
  const canonicalName = options.referenceAliases?.[authoredName] ?? authoredName;
  return pipe === -1
    ? canonicalName
    : canonicalName + " | " + value.slice(pipe + 1).trim();
};

export const parseChunk = (body, source, options = {}) => {
  const nodes = [];
  const diagnostics = [];
  let literalStart = 0;
  let index = 0;

  while (index < body.length) {
    if (options.nowebReferences && body.startsWith("<<", index)) {
      const end = body.indexOf(">>", index + 2);
      if (end === -1) {
        diagnostics.push(diagnostic("RV110", "Unterminated noweb chunk reference.", span(source, body, index, body.length)));
        break;
      }
      if (literalStart < index) {
        nodes.push({ type: "literal", value: body.slice(literalStart, index), source: span(source, body, literalStart, index) });
      }
      const authored = body.slice(index + 2, end);
      const expression = nowebExpression(authored, options);
      const parsed = parseExpression(expression, source, index + 2, diagnostics);
      if (parsed) {
        nodes.push({
          ...parsed,
          authoredReference: authored,
          source: span(source, body, index + 2, end),
          continuationIndent: continuationIndentAt(body, index)
        });
      }
      index = end + 2;
      literalStart = index;
      continue;
    }
    const counted = options.underscoreReferences !== false && body[index] === "\\"
      ? /^\\([1-9][0-9]*)_(["'`])/.exec(body.slice(index))
      : null;
    if (counted) {
      const quote = counted[2];
      const expressionStart = index + counted[0].length;
      let end = expressionStart;
      let escaped = false;
      while (end < body.length) {
        if (escaped) escaped = false;
        else if (body[end] === "\\") escaped = true;
        else if (body[end] === quote) break;
        end += 1;
      }
      if (end >= body.length) {
        diagnostics.push(diagnostic("RV110", "Unterminated counted chunk reference.", span(source, body, index, body.length)));
        break;
      }
      if (literalStart < index) {
        nodes.push({ type: "literal", value: body.slice(literalStart, index), source: span(source, body, literalStart, index) });
      }
      const expression = body.slice(expressionStart, end);
      const parsed = parseExpression(expression, source, expressionStart, diagnostics, { allowDelay: false });
      if (parsed) {
        nodes.push({
          type: "delay",
          value: {
            kind: "ravel-command-argument",
            command: { type: "chunk", expression, value: parsed, source: span(source, body, expressionStart, end) }
          },
          expression,
          phase: Number(counted[1]),
          safeSymbol: undefined,
          source: span(source, body, index, end + 1),
          continuationIndent: continuationIndentAt(body, index)
        });
      }
      index = end + 1;
      literalStart = index;
      continue;
    }
    if (body[index] === "\\" && body[index + 1] === "_" && ["\"", "'", "`"].includes(body[index + 2])) {
      index += 3;
      continue;
    }
    if (options.underscoreReferences === false ||
        body[index] !== "_" || !["\"", "'", "`"].includes(body[index + 1])) {
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
    if (parsed) nodes.push({ ...parsed, continuationIndent: continuationIndentAt(body, index) });
    index = end + 1;
    literalStart = index;
  }

  if (literalStart < body.length) {
    nodes.push({ type: "literal", value: body.slice(literalStart), source: span(source, body, literalStart, body.length) });
  }
  return { nodes, diagnostics };
};

const parseChunkFragments = (raw) => {
  const referenceSyntax = raw.metadata?.data?.ravel?.referenceSyntax;
  const parsed = parseChunk(raw.body, raw.source, referenceSyntax && typeof referenceSyntax === "object"
    ? {
        nowebReferences: referenceSyntax.noweb === true,
        nowebPlus: referenceSyntax.dialect === "noweb-plus",
        underscoreReferences: referenceSyntax.underscore !== false,
        referenceAliases: referenceSyntax.aliases
      }
    : {});
  if (!Array.isArray(raw.fragments) || raw.fragments.length < 2 ||
      raw.fragments.some((fragment) => typeof fragment?.body !== "string" || !fragment.source) ||
      raw.fragments.map((fragment) => fragment.body).join("") !== raw.body) {
    return parsed;
  }

  let bodyOffset = 0;
  const fragments = raw.fragments.map((fragment) => {
    const start = bodyOffset;
    bodyOffset += fragment.body.length;
    return { ...fragment, start, end: bodyOffset };
  });
  const syntheticStart = raw.source.range.start.offset;
  const relativeRange = (source) => ({
    start: source.range.start.offset - syntheticStart,
    end: source.range.end.offset - syntheticStart
  });
  const remapLocation = (source) => {
    const range = relativeRange(source);
    const fragment = fragments.find((entry) => range.start >= entry.start && range.end <= entry.end);
    if (!fragment) return source;
    return span(
      fragment.source,
      fragment.body,
      range.start - fragment.start,
      range.end - fragment.start
    );
  };
  const remapSources = (value) => {
    if (!value || typeof value !== "object") return value;
    if (typeof value.uri === "string" && value.range?.start && value.range?.end) {
      return remapLocation(value);
    }
    if (Array.isArray(value)) return value.map(remapSources);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapSources(child)]));
  };

  const nodes = [];
  for (const node of parsed.nodes) {
    if (node.type !== "literal") {
      nodes.push(remapSources(node));
      continue;
    }
    const range = relativeRange(node.source);
    for (const fragment of fragments) {
      const start = Math.max(range.start, fragment.start);
      const end = Math.min(range.end, fragment.end);
      if (start >= end) continue;
      nodes.push({
        type: "literal",
        value: raw.body.slice(start, end),
        source: span(fragment.source, fragment.body, start - fragment.start, end - fragment.start)
      });
    }
  }
  return { nodes, diagnostics: remapSources(parsed.diagnostics) };
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
  const documentIds = new Set();

  for (const map of maps) {
    if (documentIds.has(map.document.id)) {
      diagnostics.push(diagnostic("RV102", "Duplicate document ID: " + map.document.id, {
        uri: map.document.uri,
        range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } }
      }));
      continue;
    }
    documentIds.add(map.document.id);
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

const customTransform = (transforms, name) => transforms instanceof Map ? transforms.get(name) : transforms?.[name];

const applyTransform = (value, step, diagnostics, transforms, context = {}) => {
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
  if (step.name === "jsontext") {
    if (step.arguments.length > 1 ||
        (step.arguments.length === 1 && typeof step.arguments[0] !== "string")) {
      diagnostics.push(diagnostic("RV120", "jsontext accepts no arguments or one string key.", step.source));
      return value;
    }
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      diagnostics.push(diagnostic("RV120", "jsontext requires a live-result JSON value.", step.source));
      return value;
    }
    if (step.arguments.length === 0) return JSON.stringify(parsed);

    const key = step.arguments[0];
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
        !Object.hasOwn(parsed, key)) {
      diagnostics.push(diagnostic("RV120", "jsontext could not find object key " + JSON.stringify(key) + ".", step.source));
      return value;
    }
    const selected = parsed[key];
    return typeof selected === "string" ? selected : JSON.stringify(selected);
  }

  const transform = customTransform(transforms, step.name);
  if (typeof transform === "function") {
    try {
      const result = transform(value, { ...context, arguments: clone(step.arguments), transform: step.name });
      if (typeof result === "string") return result;
      diagnostics.push(diagnostic("RV121", "Transform " + step.name + " must return a string.", step.source));
    } catch (error) {
      diagnostics.push(diagnostic("RV121", "Transform " + step.name + " failed: " + (error?.message ?? String(error)), step.source));
    }
    return value;
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
  definitionPipeline: [],
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
    continuationIndent: "",
    source: reference.source
  }]
  };
};

const definitionFromComposeEmission = (owner, capture, emit) => {
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
    definitionPipeline: [],
    generated: true,
    origin: {
      kind: "emit",
      owner: owner.id,
      source: emit.source,
      compose: clone(capture)
    },
    composeCapture: { owner: owner.id, ...clone(capture) }
  };
};

const resolveTarget = (target, owner, definitions) => {
  let withOwnerChunk;
  if (target.relativePath) {
    const segments = (owner.identity.chunk ?? "").split("/").filter((segment, index, entries) =>
      segment || (index > 0 && index < entries.length - 1)
    );
    for (const segment of target.relativePath.split("/")) {
      if (segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    withOwnerChunk = segments.join("/");
  } else {
    withOwnerChunk = target.chunk === null && !target.explicitDocument
      ? owner.identity.chunk
      : target.chunk;
  }
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

export const transformGraph = (pretransform, options = {}) => {
  const diagnostics = [...(pretransform.diagnostics ?? [])];
  const definitions = new Map();
  // An automatically generated delay marker must not vary between equivalent
  // builds. Keep the authored input as a collision corpus so a marker cannot
  // accidentally replace a literal already present in the project.
  const delayTokenCorpus = JSON.stringify(pretransform);
  const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const orderedEntries = (value) => Object.entries(value).sort(([left], [right]) => compareText(left, right));
  const liveExecutions = options.liveResults?.executions ?? options.liveResults;
  const liveExecution = (id) => liveExecutions instanceof Map
    ? liveExecutions.get(id)
    : liveExecutions?.[id];
  const isExecutable = (definition) => definition?.metadata?.data?.ravel?.run === true;

  const normalizeDefinitionPipeline = (steps, source) => {
    if (steps === undefined) return [];
    if (!Array.isArray(steps)) {
      diagnostics.push(diagnostic("RV121", "definitionPipeline must be an ordered array of transform calls.", source));
      return [];
    }
    const normalized = [];
    for (const step of steps) {
      if (step?.type !== undefined && step.type !== "transform" || typeof step?.name !== "string" || !Array.isArray(step?.arguments ?? [])) {
        diagnostics.push(diagnostic("RV121", "definitionPipeline accepts transform calls only.", step?.source ?? source));
        continue;
      }
      normalized.push({ type: "transform", name: step.name, arguments: clone(step.arguments ?? []), source: step.source ?? source });
    }
    return normalized;
  };

  for (const raw of pretransform.chunks ?? []) {
    const parsed = parseChunkFragments(raw);
    diagnostics.push(...parsed.diagnostics);
    definitions.set(raw.id, {
      id: raw.id,
      identity: raw.identity,
      name: raw.name ?? raw.id,
      metadata: raw.metadata ?? {},
      source: raw.source,
      definitionPipeline: normalizeDefinitionPipeline(raw.definitionPipeline, raw.source),
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

  const normalizeComposePipeline = (steps, source) => {
    if (!Array.isArray(steps)) return null;
    const normalized = [];
    for (const step of steps) {
      if (step?.type === "transform" && typeof step.name === "string" && Array.isArray(step.arguments)) {
        normalized.push({ type: "transform", name: step.name, arguments: clone(step.arguments), source: step.source ?? source });
      } else if (step?.type === "emit" && typeof step.metadata === "object" && step.metadata !== null) {
        const suffix = typeof step.suffix === "string" ? parseEmitSuffix(step.suffix) : step.suffix;
        if (!suffix || !validComponent(suffix.minor) || !validComponent(suffix.type) ||
            typeof suffix.inheritMinor !== "boolean") {
          diagnostics.push(diagnostic("RV131", "emit requires a local minor/type suffix such as 'cool', 'cool.js', or '.js'.", step.source ?? source));
          return null;
        }
        normalized.push({ type: "emit", suffix: clone(suffix), metadata: clone(step.metadata), source: step.source ?? source });
      } else {
        diagnostics.push(diagnostic("RV130", "pipe and pass require transform or emit pipeline steps.", step?.source ?? source));
        return null;
      }
    }
    return normalized;
  };

  const parseCompose = (steps, source) => {
    if (!Array.isArray(steps)) {
      diagnostics.push(diagnostic("RV130", "create compose requires an ordered step list.", source));
      return null;
    }
    const parsed = [];
    for (const step of steps) {
      if (step?.kind === "newline") {
        if (!Number.isInteger(step.count) || step.count < 0) {
          diagnostics.push(diagnostic("RV130", "newline requires a non-negative integer.", step.source ?? source));
          return null;
        }
        parsed.push({ kind: "newline", count: step.count, source: step.source ?? source });
      } else if (step?.kind === "append" && typeof step.reference === "string") {
        const reference = parseExpression(step.reference, step.source ?? source, 0, diagnostics);
        if (!reference) return null;
        parsed.push({ kind: "append", reference, source: step.source ?? source });
      } else if (step?.kind === "pipe" || step?.kind === "pass") {
        const pipeline = normalizeComposePipeline(step.steps, step.source ?? source);
        if (!pipeline) return null;
        parsed.push({ kind: step.kind, pipeline, source: step.source ?? source });
      } else {
        diagnostics.push(diagnostic("RV130", "compose accepts append, newline, pipe, and pass steps.", step?.source ?? source));
        return null;
      }
    }
    return parsed;
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
      const compose = directive.compose ? parseCompose(directive.compose, source) : null;
      if (directive.compose && !compose) continue;
      const parsed = compose ? { nodes: [], diagnostics: [] } : parseChunk(typeof directive.body === "string" ? directive.body : "", source);
      diagnostics.push(...parsed.diagnostics);
      definitions.set(id, {
        id, identity, name: directive.name, metadata: directive.metadata ?? {}, source,
        definitionPipeline: [], generated: true, origin: { kind: "create", source }, ast: parsed.nodes, compose
      });
    } else {
      const reference = parseExpression(directive.reference, source, 0, diagnostics);
      if (!reference) continue;
      definitions.set(id, {
        id, identity, name: directive.name, metadata: directive.metadata ?? {}, source,
        definitionPipeline: [], generated: true, origin: { kind: "alias", source, target: directive.reference }, ast: [reference]
      });
    }
  }

  const addEmission = (emitted, source) => {
    if (definitions.has(emitted.id)) {
      diagnostics.push(diagnostic("RV101", "emit creates duplicate chunk ID: " + emitted.id, source));
    } else {
      definitions.set(emitted.id, emitted);
    }
  };

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
          addEmission(emitted, step.source);
        } else {
          prefix.push(step);
          retained.push(step);
        }
      }
      node.pipeline = retained;
    }
    for (const [stepIndex, step] of (definition.compose ?? []).entries()) {
      if (step.kind === "append") {
        const prefix = [];
        const retained = [];
        for (const pipelineStep of step.reference.pipeline) {
          if (pipelineStep.type === "emit") {
            if (definition.identity.document === null) {
              diagnostics.push(diagnostic("RV131", "emit is unavailable from a document-less global chunk.", pipelineStep.source));
            } else {
              addEmission(definitionFromEmission(definition, step.reference, prefix, pipelineStep), pipelineStep.source);
            }
          } else {
            prefix.push(pipelineStep);
            retained.push(pipelineStep);
          }
        }
        step.reference.pipeline = retained;
      }
      if (step.kind !== "pipe" && step.kind !== "pass") continue;
      for (const [pipelineIndex, pipelineStep] of step.pipeline.entries()) {
        if (pipelineStep.type !== "emit") continue;
        if (definition.identity.document === null) {
          diagnostics.push(diagnostic("RV131", "emit is unavailable from a document-less global chunk.", pipelineStep.source));
          continue;
        }
        addEmission(definitionFromComposeEmission(definition, {
          stepIndex,
          pipelineIndex,
          stepKind: step.kind
        }, pipelineStep), pipelineStep.source);
      }
    }
  }

  const values = new Map();
  const evaluating = [];
  const resultChunks = {};
  const traceChunks = {};

  const stableTokenHash = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).toUpperCase();
  };

  const evaluateTransformMapped = (input, step, definition, context = {}) => {
    const output = applyTransform(
      input.text,
      step,
      diagnostics,
      options.transforms,
      { chunk: definition, ...context }
    );
    return mapBuiltinTransform(input, output, step, definition.id) ?? coarseDerivedMapped(
      output,
      step.source,
      definition.id,
      "transform",
      [{
        kind: "transform",
        name: step.name,
        ...(context.phase ? { phase: context.phase } : {}),
        source: clone(step.source)
      }],
      input
    );
  };

  const evaluateReference = (node, owner) => {
    const resolved = resolveTarget(node.target, owner.definition, definitions);
    if (!resolved) {
      diagnostics.push(diagnostic("RV111", "Unknown chunk reference: " + node.reference, node.source));
      return mappedValue();
    }
    const dependency = evaluate(resolved, node.source);
    owner.dependencies.add(resolved);
    owner.references.push({ chunk: resolved, requested: node.reference, source: node.source });
    const reference = {
      kind: "reference",
      from: owner.definition.id,
      to: resolved,
      source: clone(node.source)
    };
    const resolvedDefinition = definitions.get(resolved);
    const ownerIsExecutable = isExecutable(owner.definition);
    const shouldUseLiveResult = isExecutable(resolvedDefinition) && !ownerIsExecutable;
    if (shouldUseLiveResult && options.deferLiveResults && !liveExecutions) {
      return mappedValue();
    }
    let value;
    if (shouldUseLiveResult && liveExecutions) {
      const execution = liveExecution(resolved);
      if (execution?.status !== "succeeded") {
        diagnostics.push(diagnostic("RV140", "Live result is unavailable for reference " + node.reference + ".", node.source));
        return mappedValue();
      }
      const first = node.pipeline[0];
      const hasJsonTextBoundary = first?.type === "transform" && first.name === "jsontext";
      const serializeWholeValue = hasJsonTextBoundary && first.arguments.length === 0;
      if (typeof execution.value === "string" && !serializeWholeValue) {
        value = coarseMapped(execution.value, resolvedDefinition.source, resolved, "live-result", [reference]);
      } else if (hasJsonTextBoundary) {
        value = coarseMapped(
          execution.serialized ?? JSON.stringify(execution.value),
          resolvedDefinition.source,
          resolved,
          "live-result",
          [reference]
        );
      } else {
        diagnostics.push(diagnostic(
          "RV140",
          "Non-string live result " + resolved +
            " requires jsontext() or jsontext(\"key\") before ordinary Ravel processing.",
          node.source
        ));
        return mappedValue();
      }
    } else {
      value = mappedValue(dependency.value, dependency.segments.map((segment) => ({
        ...clone(segment),
        via: [...(segment.via ?? []), reference]
      })));
    }
    return evaluatePipeline(value, node.pipeline, owner);
  };

  const delayToken = (node, owner) => {
    const safeSymbol = node.safeSymbol;
    if (safeSymbol) return safeSymbol;
    const source = node.source ?? {};
    const start = source.range?.start ?? {};
    const identity = owner.definition.id + "\u0000" + (source.uri ?? "") + "\u0000" +
      (start.offset ?? "") + "\u0000" + (node.expression ?? "");
    let attempt = 0;
    while (true) {
      const token = "RAVELDELAY" + stableTokenHash(identity + "\u0000" + attempt) +
        (attempt === 0 ? "" : "X" + attempt.toString(36).toUpperCase());
      if (!delayTokenCorpus.includes(token) && !owner.delays.some((delay) => delay.token === token)) return token;
      attempt += 1;
    }
  };

  const evaluateDelay = (node, owner) => {
    const token = delayToken(node, owner);
    if (owner.delays.some((delay) => delay.token === token)) {
      diagnostics.push(diagnostic("RV121", "Each delay safe symbol must be unique within a chunk.", node.source));
      return mappedValue();
    }
    owner.delays.push({ ...node, token });
    return coarseMapped(token, node.source, owner.definition.id, "delay-placeholder");
  };

  const evaluateArgument = (argument, owner) => {
    const command = argument?.kind === "ravel-command-argument" ? argument.command : null;
    if (command?.type === "text") return command.value;
    if (command?.type === "chunk") return evaluateExpression(command.value, owner).text;
    return argument;
  };

  const evaluatePipeline = (initial, pipeline, owner) => {
    let value = initial;
    for (const step of pipeline) {
      if (step.type === "text") {
        value = coarseMapped(step.value, step.source, owner.definition.id, "text");
      } else if (step.type === "chunk") {
        value = evaluateExpression(step.value, owner);
      } else if (step.type === "transform") {
        const argumentsValue = step.arguments.map((argument) => evaluateArgument(argument, owner));
        value = evaluateTransformMapped(value, { ...step, arguments: argumentsValue }, owner.definition);
      }
    }
    return value;
  };

  const evaluateExpression = (node, owner) => node.type === "pipeline"
    ? evaluatePipeline(mappedValue(), node.pipeline, owner)
    : evaluateReference(node, owner);

  const evaluateDelayValue = (value, owner, source) => {
    const command = value?.kind === "ravel-command-argument" ? value.command : null;
    if (command?.type === "text") return coarseMapped(command.value, command.source ?? source, owner.definition.id, "text");
    if (command?.type === "chunk") return evaluateExpression(command.value, owner);
    const text = typeof value === "string" ? value : String(value ?? "");
    return sourceSegment(text, source, owner.definition.id, "delay-value");
  };

  const evaluateNode = (node, owner) => {
    if (node.type === "literal") {
      return sourceSegment(node.value, node.source, owner.definition.id, "literal");
    }
    if (node.type === "delay") return evaluateDelay(node, owner);
    const value = evaluateExpression(node, owner);
    if (!node.continuationIndent) return value;
    return applyContinuationIndentMapped(
      value,
      node.continuationIndent,
      node.source,
      owner.definition.id
    );
  };

  const evaluateCompose = (definition, owner, capture = null) => {
    let value = mappedValue();
    let pendingNewlines = 1;
    let pendingNewlineSource = definition.source;
    let hasAppend = false;
    const composeOwner = { ...owner, definition };

    for (const [stepIndex, step] of definition.compose.entries()) {
      if (step.kind === "newline") {
        pendingNewlines = step.count;
        pendingNewlineSource = step.source;
        continue;
      }
      if (step.kind === "append") {
        if (hasAppend) {
          value = concatMapped(value, coarseMapped(
            "\n".repeat(pendingNewlines),
            pendingNewlineSource,
            definition.id,
            "compose-newline"
          ));
        }
        value = concatMapped(value, evaluateNode(step.reference, composeOwner));
        hasAppend = true;
        pendingNewlines = 1;
        pendingNewlineSource = step.source;
        continue;
      }

      const input = value;
      let transformed = value;
      for (const [pipelineIndex, pipelineStep] of step.pipeline.entries()) {
        if (pipelineStep.type === "transform") {
          transformed = evaluateTransformMapped(transformed, pipelineStep, definition);
        }
        if (capture && capture.stepIndex === stepIndex && capture.pipelineIndex === pipelineIndex) {
          return transformed;
        }
      }
      value = step.kind === "pipe" ? transformed : input;
    }
    return value;
  };

  const evaluate = (id, requestedFrom) => {
    if (values.has(id)) return values.get(id);
    const definition = definitions.get(id);
    if (!definition) {
      diagnostics.push(diagnostic("RV111", "Unknown chunk reference: " + id, requestedFrom));
      return { value: "", segments: [], dependencies: [], provenance: [] };
    }

    const cycleIndex = evaluating.indexOf(id);
    if (cycleIndex !== -1) {
      const cycle = [...evaluating.slice(cycleIndex), id];
      diagnostics.push(diagnostic("RV112", "Chunk reference cycle: " + cycle.join(" → "), requestedFrom));
      return { value: "", segments: [], dependencies: [], provenance: [] };
    }

    evaluating.push(id);
    const owner = { definition, dependencies: new Set(), references: [], delays: [], trace: [] };
    let value = mappedValue();
    if (definition.composeCapture) {
      const sourceDefinition = definitions.get(definition.composeCapture.owner);
      if (!sourceDefinition?.compose) {
        diagnostics.push(diagnostic("RV130", "emit capture has no compose source.", definition.source));
      } else {
        value = evaluateCompose(sourceDefinition, owner, definition.composeCapture);
      }
    } else if (definition.compose) {
      value = evaluateCompose(definition, owner);
    } else {
      for (const node of definition.ast) {
        value = concatMapped(value, evaluateNode(node, owner));
      }
    }

    const phaseCount = Math.max(1, definition.definitionPipeline.length);
    for (let phase = 1; phase <= phaseCount; phase += 1) {
      owner.trace.push({ phase, stage: "protected-input", value: value.text });
      const step = definition.definitionPipeline[phase - 1];
      if (step) {
        value = evaluateTransformMapped(value, step, definition, { phase });
        owner.trace.push({
          phase,
          stage: "transform-output",
          transform: { name: step.name, arguments: clone(step.arguments) },
          value: value.text
        });
      }
      const due = owner.delays.filter((delay) => delay.phase === phase);
      if (due.length) {
        for (const delay of due) {
          const occurrences = value.text.split(delay.token).length - 1;
          if (occurrences !== 1) {
            diagnostics.push(diagnostic("RV123", "Delay safe symbol was " + (occurrences ? "duplicated" : "removed") + " by a transform: " + delay.token, delay.source));
          }
          const replacement = evaluateDelayValue(delay.value, owner, delay.source);
          const exactReplacement = occurrences === 1
            ? replaceMappedOnce(value, delay.token, replacement)
            : null;
          value = exactReplacement ?? coarseMapped(
            value.text.split(delay.token).join(replacement.text),
            delay.source,
            definition.id,
            "delay-fulfillment"
          );
        }
        owner.trace.push({
          phase,
          stage: "fulfilled-output",
          delays: due.map((delay) => ({ expression: delay.expression, safeSymbol: delay.token, source: delay.source })),
          value: value.text
        });
      }
    }
    for (const delay of owner.delays.filter((entry) => entry.phase > phaseCount)) {
      diagnostics.push(diagnostic("RV122", "delay requests phase " + delay.phase + ", but this chunk has only " + definition.definitionPipeline.length + " definition transform phases.", delay.source));
      value = coarseMapped(
        value.text.split(delay.token).join(""),
        delay.source,
        definition.id,
        "delay-removal"
      );
    }
    if (definition.generated) {
      const derivation = {
        kind: definition.origin.kind,
        source: clone(definition.origin.source),
        ...(definition.origin.owner ? { owner: definition.origin.owner } : {}),
        ...(definition.origin.target ? { target: definition.origin.target } : {})
      };
      value = mappedValue(value.text, value.segments.map((segment) => ({
        ...segment,
        via: [...(segment.via ?? []), derivation]
      })));
    }
    evaluating.pop();

    const completed = {
      id,
      identity: definition.identity,
      name: definition.name,
      value: value.text,
      segments: value.segments,
      metadata: definition.metadata,
      source: definition.source,
      dependencies: [...owner.dependencies].sort(),
      // References retain authored source order, which is deterministic and is
      // more useful for explaining a chunk than lexical target order.
      references: owner.references,
      trace: owner.trace,
      provenance: [definition.origin],
      generated: definition.generated
    };
    values.set(id, completed);
    resultChunks[id] = completed;
    if (owner.trace.length) traceChunks[id] = owner.trace;
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
    let chunk = evaluate(id, directive.source);
    const definition = definitions.get(id);
    if (isExecutable(definition) && liveExecutions) {
      const execution = liveExecution(id);
      if (execution?.status !== "succeeded") {
        diagnostics.push(diagnostic("RV140", "Live result is unavailable for output " + name + ".", directive.source));
        continue;
      }
      if (typeof execution.value !== "string") {
        diagnostics.push(diagnostic(
          "RV140",
          "Output " + name +
            " requires a live string; use jsontext() or jsontext(\"key\") in a derived chunk.",
          directive.source
        ));
        continue;
      }
      const mapped = coarseMapped(execution.value, definition.source, id, "live-result");
      chunk = { ...chunk, value: mapped.text, segments: mapped.segments };
    }
    if (deliverables[name]) {
      diagnostics.push(diagnostic("RV101", "Duplicate out deliverable: " + name, directive.source));
      continue;
    }
    deliverables[name] = {
      name,
      from: id,
      value: chunk.value,
      segments: chunk.segments,
      dependencies: chunk.dependencies,
      provenance: chunk.provenance,
      source: directive.source
    };
  }

  return {
    version: 1,
    documents: (pretransform.documents ?? []).slice().sort((left, right) =>
      compareText(left.id ?? "", right.id ?? "") || compareText(left.uri ?? "", right.uri ?? "")
    ),
    chunks: Object.fromEntries(orderedEntries(resultChunks)),
    trace: { chunks: Object.fromEntries(orderedEntries(traceChunks)) },
    deliverables: Object.fromEntries(orderedEntries(deliverables)),
    // Diagnostics retain parse/evaluation order so related failures read in
    // the order their authored constructs are encountered.
    diagnostics
  };
};

export const provenanceMapVersion = 1;

/**
 * Create the portable sidecar representation for one generated deliverable.
 * Offsets use JavaScript/JSON's native UTF-16 code-unit indexing.
 */
export const createDeliverableProvenanceMap = (deliverable) => ({
  version: provenanceMapVersion,
  kind: "ravel-provenance-map",
  generated: {
    uri: deliverable.name,
    length: deliverable.value.length,
    offsetEncoding: "utf-16"
  },
  from: deliverable.from,
  segments: clone(deliverable.segments ?? [])
});

/** Create a deterministic aggregate containing every deliverable sidecar map. */
export const createBuildProvenanceMap = (program) => ({
  version: provenanceMapVersion,
  kind: "ravel-provenance-bundle",
  maps: Object.values(program.deliverables ?? {})
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(createDeliverableProvenanceMap)
});

/** Resolve a generated offset to its source segment and exact source offset when possible. */
export const sourceAtGeneratedOffset = (map, offset) => {
  if (!Number.isInteger(offset) || offset < 0) return null;
  const segment = map?.segments?.find((entry) =>
    offset >= entry.generated.start && offset < entry.generated.end
  );
  if (!segment) return null;
  const result = clone(segment);
  const sourceStart = segment.source?.range?.start?.offset;
  const sourceEnd = segment.source?.range?.end?.offset;
  const generatedLength = segment.generated.end - segment.generated.start;
  if (segment.precision === "exact" && Number.isInteger(sourceStart) &&
      sourceEnd - sourceStart === generatedLength) {
    result.sourceOffset = sourceStart + offset - segment.generated.start;
  }
  return result;
};

const sourceOffsetValue = (position) => Number.isInteger(position)
  ? position
  : position?.offset;

const sourceCandidates = (segment) => [
  {
    source: segment.source,
    chunk: segment.chunk,
    kind: segment.kind,
    precision: segment.precision,
    via: segment.via ?? [],
    through: "segment"
  },
  ...(segment.origins ?? []).map((origin) => ({ ...origin, through: "origin" }))
];

/**
 * Resolve a source offset to generated ranges. Exact segments return a single
 * corresponding offset; coarse segments return the containing generated range.
 */
export const generatedRangesForSource = (map, uri, offset) => {
  if (typeof uri !== "string" || !Number.isInteger(offset) || offset < 0) return [];
  const matches = [];
  const seen = new Set();
  for (const segment of map?.segments ?? []) {
    for (const candidate of sourceCandidates(segment)) {
      const start = candidate.source?.range?.start?.offset;
      const end = candidate.source?.range?.end?.offset;
      if (candidate.source?.uri !== uri || !Number.isInteger(start) || offset < start || offset >= end) continue;
      const generatedLength = segment.generated.end - segment.generated.start;
      const exact = candidate.through === "segment" && candidate.precision === "exact" &&
        end - start === generatedLength;
      const match = {
        generated: clone(segment.generated),
        ...(exact ? { generatedOffset: segment.generated.start + offset - start } : {}),
        precision: exact ? "exact" : "coarse",
        chunk: candidate.chunk,
        kind: candidate.kind,
        via: clone([...(candidate.via ?? []), ...(candidate.through === "origin" ? segment.via ?? [] : [])]),
        ...(candidate.through === "origin" ? { through: "transform-origin" } : {})
      };
      const key = JSON.stringify(match);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
    }
  }
  return matches;
};

/**
 * Resolve a half-open source range to generated ranges. The range may use
 * integer offsets or SourcePosition-like objects with an `offset` field.
 */
export const generatedRangesForSourceRange = (map, uri, range) => {
  const queryStart = sourceOffsetValue(range?.start);
  const queryEnd = sourceOffsetValue(range?.end);
  if (typeof uri !== "string" || !Number.isInteger(queryStart) ||
      !Number.isInteger(queryEnd) || queryStart < 0 || queryEnd <= queryStart) {
    return [];
  }
  const matches = [];
  const seen = new Set();
  for (const segment of map?.segments ?? []) {
    for (const candidate of sourceCandidates(segment)) {
      const sourceStart = candidate.source?.range?.start?.offset;
      const sourceEnd = candidate.source?.range?.end?.offset;
      const overlapStart = Math.max(queryStart, sourceStart ?? Number.POSITIVE_INFINITY);
      const overlapEnd = Math.min(queryEnd, sourceEnd ?? Number.NEGATIVE_INFINITY);
      if (candidate.source?.uri !== uri || overlapStart >= overlapEnd) continue;
      const generatedLength = segment.generated.end - segment.generated.start;
      const exact = candidate.through === "segment" && candidate.precision === "exact" &&
        sourceEnd - sourceStart === generatedLength;
      const generated = exact ? {
        start: segment.generated.start + overlapStart - sourceStart,
        end: segment.generated.start + overlapEnd - sourceStart
      } : clone(segment.generated);
      const match = {
        generated,
        source: { start: overlapStart, end: overlapEnd },
        precision: exact ? "exact" : "coarse",
        chunk: candidate.chunk,
        kind: candidate.kind,
        via: clone([...(candidate.via ?? []), ...(candidate.through === "origin" ? segment.via ?? [] : [])]),
        ...(candidate.through === "origin" ? { through: "transform-origin" } : {})
      };
      const key = JSON.stringify(match);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
    }
  }
  return matches;
};

/** Explain one generated offset using the evaluated program and its graph. */
export const explainGeneratedOffset = (program, deliverableName, offset) => {
  const deliverable = program?.deliverables?.[deliverableName];
  if (!deliverable) return null;
  const segment = sourceAtGeneratedOffset(createDeliverableProvenanceMap(deliverable), offset);
  if (!segment) return null;
  const references = (segment.via ?? []).filter((step) => step.kind === "reference");
  const dependencyPath = [deliverable.from];
  for (const reference of references.slice().reverse()) {
    if (reference.from === dependencyPath[dependencyPath.length - 1]) dependencyPath.push(reference.to);
  }
  const definition = program.chunks?.[segment.chunk];
  return {
    deliverable: { name: deliverable.name, from: deliverable.from },
    generatedOffset: offset,
    segment,
    definition: definition ? {
      id: definition.id,
      identity: clone(definition.identity),
      metadata: clone(definition.metadata),
      generated: definition.generated
    } : null,
    references: clone(references),
    dependencyPath
  };
};
