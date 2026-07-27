import { fromMarkdown } from "mdast-util-from-markdown";
import { parse as parseYaml } from "yaml";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const controlClasses = new Set(["ravel", "no-ravel", "greedy", "end", "run"]);

const diagnostic = (code, message, source) => ({
  code,
  severity: "error",
  message,
  source
});

const lineStarts = (text) => {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const positionAt = (starts, offset) => {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low, column: offset - starts[low], offset };
};

const rangeAt = (uri, starts, start, end) => ({
  uri,
  range: { start: positionAt(starts, start), end: positionAt(starts, end) }
});

const defaultDocumentId = (uri) => {
  const base = uri.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return componentPattern.test(id) ? id : null;
};

const documentFromFrontMatter = (text) => {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return undefined;
  const firstEnd = text.indexOf("\n");
  const close = /^---\s*\r?$/m.exec(text.slice(firstEnd + 1));
  if (!close) return undefined;
  try {
    const data = parseYaml(text.slice(firstEnd + 1, firstEnd + 1 + close.index));
    return data?.ravel?.document;
  } catch {
    return undefined;
  }
};

const tokens = (text) => {
  const result = [];
  let index = 0;
  while (index < text.length) {
    while (/\s/.test(text[index] ?? "")) index += 1;
    if (index >= text.length) break;
    const start = index;
    let quote = "";
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
      } else if (character === "\"" || character === "'") {
        quote = character;
      } else if (/\s/.test(character)) {
        break;
      }
      index += 1;
    }
    if (quote) return null;
    result.push(text.slice(start, index));
  }
  return result;
};

const stringValue = (value) => {
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
  return value;
};

const parseAttributes = (meta, source) => {
  const empty = { id: null, classes: [], values: {}, diagnostics: [] };
  if (!meta?.trim()) return empty;
  const trimmed = meta.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return empty;
  const parts = tokens(trimmed.slice(1, -1));
  if (!parts) {
    return { ...empty, diagnostics: [diagnostic("RM101", "Unterminated quoted fenced-block attribute.", source)] };
  }

  const result = { ...empty };
  for (const part of parts) {
    if (part.startsWith("#")) {
      if (result.id !== null || part.length === 1) {
        result.diagnostics.push(diagnostic("RM101", "A Ravel fence may have only one #chunk identifier.", source));
      } else {
        result.id = part.slice(1);
      }
      continue;
    }
    if (part.startsWith(".")) {
      if (part.length === 1) result.diagnostics.push(diagnostic("RM101", "Empty fenced-block class.", source));
      else result.classes.push(part.slice(1));
      continue;
    }
    const separator = part.indexOf("=");
    if (separator <= 0) {
      result.diagnostics.push(diagnostic("RM101", "Fenced-block attributes must be #id, .class, or key=value.", source));
      continue;
    }
    const key = part.slice(0, separator);
    const value = stringValue(part.slice(separator + 1));
    if (!componentPattern.test(key) || typeof value !== "string" || Object.hasOwn(result.values, key)) {
      result.diagnostics.push(diagnostic("RM101", "Malformed or duplicate fenced-block attribute: " + part, source));
    } else {
      result.values[key] = value;
    }
  }
  return result;
};

const codeNodes = (node, found = []) => {
  if (node.type === "code") found.push(node);
  for (const child of node.children ?? []) codeNodes(child, found);
  return found;
};

const fenceBody = (text, node, starts, uri) => {
  const start = node.position.start.offset;
  const end = node.position.end.offset;
  const block = text.slice(start, end);
  const openingEnd = block.indexOf("\n");
  const closingStart = block.lastIndexOf("\n") + 1;
  const bodyStart = openingEnd === -1 ? end : start + openingEnd + 1;
  const bodyEnd = closingStart === 0 ? bodyStart : start + closingStart;
  return {
    body: text.slice(bodyStart, bodyEnd),
    start: bodyStart,
    end: bodyEnd,
    source: rangeAt(uri, starts, bodyStart, bodyEnd),
    fenceSource: rangeAt(uri, starts, start, end)
  };
};

const directiveTokenize = (text, sourceAt, diagnostics) => {
  const result = [];
  let index = 0;
  const add = (type, value, start, end) => result.push({ type, value, start, end, source: sourceAt(start, end) });
  const readString = (start, reference = false) => {
    const quote = text[index];
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) break;
      index += 1;
    }
    if (index >= text.length) {
      diagnostics.push(diagnostic("RM104", "Unterminated directive string.", sourceAt(start, text.length)));
      return;
    }
    const raw = text.slice(start + (reference ? 1 : 0), index + 1);
    const value = stringValue(raw);
    if (typeof value !== "string") {
      diagnostics.push(diagnostic("RM104", "Malformed directive string.", sourceAt(start, index + 1)));
    } else {
      add(reference ? "reference" : "string", value, start, index + 1);
    }
    index += 1;
  };

  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "_" && (text[index + 1] === "\"" || text[index + 1] === "'")) {
      const start = index;
      index += 1;
      readString(start, true);
    } else if (character === "\"" || character === "'") {
      const start = index;
      readString(start);
    } else if (/[a-z]/.test(character)) {
      const start = index;
      index += 1;
      while (/[a-z0-9-]/.test(text[index] ?? "")) index += 1;
      add("identifier", text.slice(start, index), start, index);
    } else if (/[0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (/[0-9]/.test(text[index] ?? "")) index += 1;
      add("number", Number(text.slice(start, index)), start, index);
    } else if (character === "(" || character === ")" || character === "," || character === ";") {
      add(character, character, index, index + 1);
      index += 1;
    } else {
      diagnostics.push(diagnostic("RM104", "Unexpected directive character: " + character, sourceAt(index, index + 1)));
      index += 1;
    }
  }
  return result;
};

const parseDirectiveCommands = (text, sourceAt, diagnostics) => {
  const tokens = directiveTokenize(text, sourceAt, diagnostics);
  let index = 0;
  const current = () => tokens[index];
  const take = (type) => {
    if (current()?.type === type) return tokens[index++];
    return null;
  };
  const error = (message, token = current()) => diagnostics.push(diagnostic("RM104", message, token?.source ?? sourceAt(text.length, text.length)));

  const expression = () => {
    const token = current();
    if (!token) return null;
    if (token.type === "string" || token.type === "reference" || token.type === "number") {
      index += 1;
      return { type: token.type, value: token.value, source: token.source };
    }
    if (token.type !== "identifier") {
      error("Expected a directive value.");
      return null;
    }
    index += 1;
    const name = token.value;
    if (!take("(")) {
      error("Directive names must be followed by (...).", current() ?? token);
      return null;
    }
    const argumentsValue = [];
    if (!take(")")) {
      while (true) {
        const value = expression();
        if (!value) return null;
        argumentsValue.push(value);
        if (take(")")) break;
        if (!take(",")) {
          error("Expected , or ) in directive call.");
          return null;
        }
      }
    }
    const end = tokens[index - 1]?.end ?? token.end;
    return { type: "call", name, arguments: argumentsValue, source: sourceAt(token.start, end) };
  };

  const commands = [];
  while (index < tokens.length) {
    const command = expression();
    if (!command) {
      index += 1;
      continue;
    }
    if (command.type !== "call") error("Top-level directive entries must be calls.", command);
    else commands.push(command);
    take(";");
  }
  return commands;
};

const callPipeline = (call, diagnostics) => {
  if (call.type !== "call") {
    diagnostics.push(diagnostic("RM104", "pipe and pass accept command calls only.", call.source));
    return null;
  }
  if (call.name === "emit") {
    if (call.arguments.length !== 1 || call.arguments[0].type !== "string") {
      diagnostics.push(diagnostic("RM104", "emit requires one string suffix.", call.source));
      return null;
    }
    return { type: "emit", suffix: call.arguments[0].value, metadata: {}, source: call.source };
  }
  if (call.arguments.some((argument) => argument.type !== "string" && argument.type !== "number")) {
    diagnostics.push(diagnostic("RM104", "Transform arguments must be strings or numbers.", call.source));
    return null;
  }
  return { type: "transform", name: call.name, arguments: call.arguments.map((argument) => argument.value), source: call.source };
};

const composeStep = (value, diagnostics) => {
  if (value.type === "reference") return { kind: "append", reference: value.value, source: value.source };
  if (value.type !== "call") {
    diagnostics.push(diagnostic("RM104", "compose accepts references or directive calls.", value.source));
    return null;
  }
  if (value.name === "newline") {
    if (value.arguments.length !== 1 || value.arguments[0].type !== "number" || value.arguments[0].value < 0) {
      diagnostics.push(diagnostic("RM104", "newline requires one non-negative integer.", value.source));
      return null;
    }
    return { kind: "newline", count: value.arguments[0].value, source: value.source };
  }
  if (value.name === "append") {
    if (value.arguments.length !== 1 || value.arguments[0].type !== "reference") {
      diagnostics.push(diagnostic("RM104", "append requires one quoted reference.", value.source));
      return null;
    }
    return { kind: "append", reference: value.arguments[0].value, source: value.source };
  }
  if (value.name === "pipe" || value.name === "pass") {
    const steps = value.arguments.map((argument) => callPipeline(argument, diagnostics));
    return steps.some((step) => !step) ? null : { kind: value.name, steps, source: value.source };
  }
  diagnostics.push(diagnostic("RM104", "Unknown compose step: " + value.name, value.source));
  return null;
};

const directiveFromCommand = (command, document, diagnostics) => {
  const args = command.arguments;
  if (command.name === "create") {
    if (args.length !== 2 || args[0].type !== "string" || args[1].type !== "call" || args[1].name !== "compose") {
      diagnostics.push(diagnostic("RM104", "create requires a local name and compose(...).", command.source));
      return null;
    }
    const steps = args[1].arguments.map((value) => composeStep(value, diagnostics));
    return steps.some((step) => !step) ? null : { kind: "create", document, name: args[0].value, compose: steps, source: command.source };
  }
  if (command.name === "alias") {
    if (args.length !== 2 || args[0].type !== "string" || args[1].type !== "reference") {
      diagnostics.push(diagnostic("RM104", "alias requires a local name and quoted reference.", command.source));
      return null;
    }
    return { kind: "alias", document, name: args[0].value, reference: args[1].value, source: command.source };
  }
  if (command.name === "in") {
    if (args.length !== 1 || args[0].type !== "string") {
      diagnostics.push(diagnostic("RM104", "in requires one file path string.", command.source));
      return null;
    }
    return { kind: "in", target: args[0].value, source: command.source };
  }
  if (command.name === "out") {
    if (args.length !== 2 || args[0].type !== "string" || args[1].type !== "reference") {
      diagnostics.push(diagnostic("RM104", "out requires a file name and quoted reference.", command.source));
      return null;
    }
    const from = args[1].value.includes("::") ? args[1].value : document + "::" + args[1].value;
    return { kind: "out", name: args[0].value, from, source: command.source };
  }
  diagnostics.push(diagnostic("RM104", "Unknown Ravel directive: " + command.name, command.source));
  return null;
};

const parseDirectiveFence = (block, document, starts, uri, diagnostics) => {
  const sourceAt = (start, end) => rangeAt(uri, starts, block.start + start, block.start + end);
  const commands = parseDirectiveCommands(block.body, sourceAt, diagnostics);
  return commands.map((command) => directiveFromCommand(command, document, diagnostics)).filter(Boolean);
};

const identityFor = (document, attributes, language, source, diagnostics) => {
  const shorthand = attributes.id;
  const split = shorthand?.indexOf("--") ?? -1;
  const shortChunk = split === -1 ? shorthand : shorthand.slice(0, split);
  const shortMinor = split === -1 ? null : shorthand.slice(split + 2);
  const chunk = attributes.values.chunk ?? shortChunk;
  const minor = attributes.values.minor ?? shortMinor;
  const type = attributes.values.type ?? language ?? null;

  if (!componentPattern.test(chunk ?? "") ||
      (minor !== null && !componentPattern.test(minor)) ||
      (type !== null && !componentPattern.test(type))) {
    diagnostics.push(diagnostic("RM102", "Chunk, minor, and type names must be lowercase Ravel identifiers.", source));
    return null;
  }
  return { document, chunk, minor, type };
};

const formatId = (identity) => identity.document + "::" + identity.chunk +
  (identity.minor === null ? "" : ":" + identity.minor) +
  (identity.type === null ? "" : "." + identity.type);

const splitDefinitionPipeline = (text, separator = "|") => {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
};

const definitionValue = (text) => {
  const value = text.trim();
  const string = stringValue(value);
  if (value.startsWith("\"") || value.startsWith("'")) return typeof string === "string" ? string : undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (value.startsWith("{") || value.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const definitionPipeline = (text, source, diagnostics) => {
  if (!text?.trim()) return [];
  const steps = [];
  for (const part of splitDefinitionPipeline(text)) {
    const match = /^([a-z][a-z0-9-]*)\s*(?:\((.*)\))?$/s.exec(part);
    if (!match) {
      diagnostics.push(diagnostic("RM101", "Definition pipes accept transform calls only: " + part, source));
      return [];
    }
    // Definition-time emit remains a graph-expansion feature for a later
    // phase. Keep the authored pipe metadata, but do not execute it here.
    if (match[1] === "emit") continue;
    const argumentsValue = match[2]?.trim() ? splitDefinitionPipeline(match[2], ",") : [];
    const argumentsParsed = argumentsValue.map(definitionValue);
    if (argumentsParsed.some((argument) => typeof argument === "undefined")) {
      diagnostics.push(diagnostic("RM101", "Definition transform arguments must be JSON-like literals.", source));
      return [];
    }
    steps.push({ name: match[1], arguments: argumentsParsed });
  }
  return steps;
};

const newChunk = (identity, body, attributes, language, diagnostics) => {
  const tags = attributes.classes.filter((entry) => !controlClasses.has(entry));
  const metadata = {
    language: language ?? undefined,
    tags,
    data: {}
  };
  const ravel = {};
  if (attributes.values.pipe) ravel.definitionPipe = attributes.values.pipe;
  if (attributes.classes.includes("run")) ravel.run = true;
  if (attributes.values.provider) ravel.provider = attributes.values.provider;
  if (Object.keys(ravel).length) metadata.data.ravel = ravel;
  return {
    id: formatId(identity),
    identity,
    name: identity.chunk,
    body: body.body,
    definitionPipeline: definitionPipeline(attributes.values.pipe, body.fenceSource ?? body.source, diagnostics),
    metadata,
    source: body.source,
    fragments: undefined,
    _fragments: [{ body: body.body, source: body.source }]
  };
};

const appendToChunk = (chunk, body) => {
  chunk.body += body.body;
  chunk._fragments.push({ body: body.body, source: body.source });
  chunk.fragments = chunk._fragments.map(({ body: value, source }) => ({ body: value, source }));
};

const cleanChunk = ({ _fragments, fragments, ...chunk }) => ({
  ...chunk,
  ...(fragments ? { fragments } : {})
});

/**
 * Convert the Ravel fenced-code Markdown profile into a format-neutral map.
 * `mode` is `opt-in` or `primary`; in primary mode every non-excluded code
 * fence must be a named Ravel chunk or a valid greedy continuation.
 */
export const markdownToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.md";
  const mode = options.mode ?? "opt-in";
  const starts = lineStarts(text);
  const diagnostics = [];
  const frontMatterDocument = documentFromFrontMatter(text);
  const documentId = options.document ?? frontMatterDocument ?? defaultDocumentId(uri);

  if (!componentPattern.test(documentId ?? "")) {
    throw new Error("Ravel Markdown document identity must be a lowercase identifier: " + String(documentId));
  }
  if (mode !== "opt-in" && mode !== "primary") {
    throw new Error("Ravel Markdown mode must be opt-in or primary: " + mode);
  }

  const chunks = [];
  const directives = [];
  let activeGreedy = null;
  const tree = fromMarkdown(text);
  for (const node of codeNodes(tree)) {
    const block = fenceBody(text, node, starts, uri);
    if (node.lang === "ravel") {
      activeGreedy = null;
      directives.push(...parseDirectiveFence(block, documentId, starts, uri, diagnostics));
      continue;
    }
    const attributes = parseAttributes(node.meta, block.fenceSource);
    diagnostics.push(...attributes.diagnostics);
    const classes = new Set(attributes.classes);
    const excluded = classes.has("no-ravel");
    const explicit = attributes.id !== null || classes.has("ravel") || classes.has("run") ||
      Object.hasOwn(attributes.values, "chunk");
    const continuation = !excluded && attributes.id === null && !classes.has("ravel") &&
      !classes.has("greedy") && !classes.has("end") && Object.keys(attributes.values).length === 0 &&
      !node.meta?.trim();
    const ending = !excluded && classes.has("end") && attributes.id === null &&
      !classes.has("ravel") && !classes.has("greedy") && Object.keys(attributes.values).length === 0;

    if (activeGreedy && continuation && node.lang === activeGreedy.language) {
      appendToChunk(activeGreedy.chunk, block);
      continue;
    }
    if (activeGreedy && ending && node.lang === activeGreedy.language) {
      appendToChunk(activeGreedy.chunk, block);
      activeGreedy = null;
      continue;
    }
    if (activeGreedy) activeGreedy = null;

    if (excluded && classes.has("run")) {
      diagnostics.push(diagnostic("RM103", ".run cannot be combined with .no-ravel.", block.fenceSource));
      continue;
    }
    if (excluded) continue;
    if (!explicit) {
      if (mode === "primary") {
        diagnostics.push(diagnostic("RM103", "Primary Ravel mode requires #chunk, a greedy continuation, or .no-ravel.", block.fenceSource));
      }
      continue;
    }
    if (classes.has("end")) {
      diagnostics.push(diagnostic("RM103", ".end may only close an active matching .greedy chunk.", block.fenceSource));
      continue;
    }
    if (attributes.id === null && !Object.hasOwn(attributes.values, "chunk")) {
      diagnostics.push(diagnostic(
        "RM103",
        (classes.has("run") ? "A .run fence" : "A .ravel fence") + " requires #chunk or chunk=name.",
        block.fenceSource
      ));
      continue;
    }
    if (classes.has("run") && !node.lang) {
      diagnostics.push(diagnostic("RM103", "A .run fence requires a language.", block.fenceSource));
      continue;
    }
    if (classes.has("greedy") && !classes.has("ravel")) {
      diagnostics.push(diagnostic("RM103", ".greedy requires the explicit .ravel class.", block.fenceSource));
      continue;
    }

    const identity = identityFor(documentId, attributes, node.lang, block.fenceSource, diagnostics);
    if (!identity) continue;
    const chunk = newChunk(identity, block, attributes, node.lang, diagnostics);
    chunks.push(chunk);
    if (classes.has("greedy")) activeGreedy = { chunk, language: node.lang };
  }

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: "markdown+ravel-fences-v1" },
      chunks: chunks.map(cleanChunk),
      directives
    },
    diagnostics
  };
};
