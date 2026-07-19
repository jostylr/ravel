import { fromMarkdown } from "mdast-util-from-markdown";
import { parse as parseYaml } from "yaml";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const controlClasses = new Set(["ravel", "no-ravel", "greedy", "end"]);

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
    source: rangeAt(uri, starts, bodyStart, bodyEnd),
    fenceSource: rangeAt(uri, starts, start, end)
  };
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

const newChunk = (identity, body, attributes, language) => {
  const tags = attributes.classes.filter((entry) => !controlClasses.has(entry));
  const metadata = {
    language: language ?? undefined,
    tags,
    data: {}
  };
  if (attributes.values.pipe) metadata.data.ravel = { definitionPipe: attributes.values.pipe };
  return {
    id: formatId(identity),
    identity,
    name: identity.chunk,
    body: body.body,
    definitionPipeline: [],
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
  let activeGreedy = null;
  const tree = fromMarkdown(text);
  for (const node of codeNodes(tree)) {
    const block = fenceBody(text, node, starts, uri);
    const attributes = parseAttributes(node.meta, block.fenceSource);
    diagnostics.push(...attributes.diagnostics);
    const classes = new Set(attributes.classes);
    const excluded = classes.has("no-ravel");
    const explicit = attributes.id !== null || classes.has("ravel") || Object.hasOwn(attributes.values, "chunk");
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
      diagnostics.push(diagnostic("RM103", "A .ravel fence requires #chunk or chunk=name.", block.fenceSource));
      continue;
    }
    if (classes.has("greedy") && !classes.has("ravel")) {
      diagnostics.push(diagnostic("RM103", ".greedy requires the explicit .ravel class.", block.fenceSource));
      continue;
    }

    const identity = identityFor(documentId, attributes, node.lang, block.fenceSource, diagnostics);
    if (!identity) continue;
    const chunk = newChunk(identity, block, attributes, node.lang);
    chunks.push(chunk);
    if (classes.has("greedy")) activeGreedy = { chunk, language: node.lang };
  }

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: "markdown+ravel-fences-v1" },
      chunks: chunks.map(cleanChunk),
      directives: []
    },
    diagnostics
  };
};
