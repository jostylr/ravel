import { fromMarkdown } from "mdast-util-from-markdown";
import { parse as parseYaml } from "yaml";
import { parseRavelDirectiveBlock } from "@pieceful/ravel-core";

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

const frontMatterFrom = (text) => {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return undefined;
  const firstEnd = text.indexOf("\n");
  const close = /^---\s*\r?$/m.exec(text.slice(firstEnd + 1));
  if (!close) return undefined;
  try {
    return parseYaml(text.slice(firstEnd + 1, firstEnd + 1 + close.index));
  } catch {
    return undefined;
  }
};

const frontMatterEndOffset = (text) => {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return 0;
  const firstEnd = text.indexOf("\n");
  const close = /^---\s*\r?$/m.exec(text.slice(firstEnd + 1));
  if (!close) return 0;
  return firstEnd + 1 + close.index + close[0].length;
};

const documentFromFrontMatter = (text) => {
  const data = frontMatterFrom(text);
  return data?.lp?.document ?? data?.ravel?.document;
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

const structuralNodes = (node, found = []) => {
  if (node.type === "heading" || node.type === "code") found.push(node);
  for (const child of node.children ?? []) structuralNodes(child, found);
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
  const opening = openingEnd === -1 ? block : block.slice(0, openingEnd);
  const infoString = /^(?:`{3,}|~{3,})(.*)$/.exec(opening)?.[1].trim() ?? "";
  return {
    body: text.slice(bodyStart, bodyEnd),
    start: bodyStart,
    end: bodyEnd,
    infoString,
    source: rangeAt(uri, starts, bodyStart, bodyEnd),
    fenceSource: rangeAt(uri, starts, start, end)
  };
};

const parseDirectiveFence = (block, document, starts, uri, diagnostics) => {
  const sourceAt = (start, end) => rangeAt(uri, starts, block.start + start, block.start + end);
  const parsed = parseRavelDirectiveBlock(block.body, { document, sourceAt });
  diagnostics.push(...parsed.diagnostics);
  return parsed.directives;
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
const fencedMarkdownToMap = (text, options = {}) => {
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

const plainText = (node) => {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image") return node.alt ?? "";
  return (node.children ?? []).map(plainText).join("");
};

const splitNameAndPipeline = (text) => {
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      return {
        name: text.slice(0, index).trim().replace(/\\\|/g, "|"),
        pipe: text.slice(index + 1).trim()
      };
    }
  }
  return { name: text.trim().replace(/\\\|/g, "|"), pipe: null };
};

const semanticName = (value) => {
  const normalized = value.toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return componentPattern.test(normalized) ? normalized : null;
};

const modernControlClasses = new Set([...controlClasses, "lp-piece", "lp-fragment"]);

const modernFence = (node, source) => {
  let language = node.lang ?? null;
  let attributes = { id: null, classes: [], values: {}, diagnostics: [] };
  let compactPipe = null;

  if (node.lang?.startsWith("{")) {
    const spelling = node.lang + (node.meta ? " " + node.meta : "");
    attributes = parseAttributes(spelling, source);
    const languageIndex = attributes.classes.findIndex((entry) => !modernControlClasses.has(entry));
    if (languageIndex === -1) language = null;
    else {
      language = attributes.classes[languageIndex];
      attributes.classes.splice(languageIndex, 1);
    }
  } else {
    const meta = node.meta?.trim() ?? "";
    if (meta.startsWith("lp:")) {
      const split = splitNameAndPipeline(meta.slice(3));
      attributes.id = split.name;
      attributes.classes.push("lp-piece");
      compactPipe = split.pipe;
    } else if (meta.startsWith("|")) {
      compactPipe = meta.slice(1).trim();
    } else {
      attributes = parseAttributes(node.meta, source);
    }
  }

  const values = attributes.values;
  if (values["lp-pipe"] !== undefined) {
    if (compactPipe !== null && compactPipe !== values["lp-pipe"]) {
      attributes.diagnostics.push(diagnostic("RM105", "Compact and lp-pipe definition pipelines conflict.", source));
    }
    compactPipe = values["lp-pipe"];
  }
  if (compactPipe !== null) values.pipe = compactPipe;
  if (values["lp-for"] !== undefined) values.chunk = values["lp-for"];
  if (attributes.id?.startsWith("lp-")) attributes.id = attributes.id.slice(3);

  return {
    language,
    attributes,
    named: attributes.classes.includes("lp-piece") || attributes.id !== null ||
      Object.hasOwn(values, "chunk"),
    append: attributes.classes.includes("lp-fragment")
  };
};

const headingDeclaration = (node, starts, uri, diagnostics) => {
  const source = rangeAt(uri, starts, node.position.start.offset, node.position.end.offset);
  let text = plainText(node).trim();
  let attributes = { id: null, classes: [], values: {}, diagnostics: [] };
  const attributeMatch = /\s*(\{[^{}]*\})\s*$/.exec(text);
  if (attributeMatch) {
    attributes = parseAttributes(attributeMatch[1], source);
    diagnostics.push(...attributes.diagnostics);
    text = text.slice(0, attributeMatch.index).trim();
  }
  const split = splitNameAndPipeline(text);
  const attributePipe = attributes.values["lp-pipe"];
  if (split.pipe !== null && attributePipe !== undefined && split.pipe !== attributePipe) {
    diagnostics.push(diagnostic("RM105", "Heading and lp-pipe definition pipelines conflict.", source));
  }
  const explicit = attributes.id?.startsWith("lp-") ? attributes.id.slice(3) : attributes.id;
  const chunk = explicit ?? semanticName(split.name);
  if (!componentPattern.test(chunk ?? "")) {
    diagnostics.push(diagnostic("RM102", "A heading piece requires a name that normalizes to a lowercase Ravel identifier.", source));
    return null;
  }
  return {
    chunk,
    displayName: split.name,
    pipe: attributePipe ?? split.pipe,
    anchor: attributes.id,
    source
  };
};

const modernChunk = (document, declaration, diagnostics) => {
  const identity = { document, chunk: declaration.chunk, minor: null, type: null };
  const ravel = {
    displayName: declaration.displayName,
    ...(declaration.anchor ? { renderedAnchor: declaration.anchor } : {})
  };
  if (declaration.pipe) ravel.definitionPipe = declaration.pipe;
  return {
    id: formatId(identity),
    identity,
    name: declaration.displayName,
    body: "",
    definitionPipeline: definitionPipeline(declaration.pipe, declaration.source, diagnostics),
    metadata: { tags: [], data: { ravel } },
    source: declaration.source,
    fragments: [],
    _fragmentLanguages: [],
    _pipe: declaration.pipe ?? null
  };
};

const setModernFenceMetadata = (chunk, attributes, language, source, diagnostics) => {
  chunk.metadata.tags = [...new Set([
    ...chunk.metadata.tags,
    ...attributes.classes.filter((entry) => !modernControlClasses.has(entry))
  ])];
  if (!attributes.classes.includes("run") && attributes.values.provider === undefined) return;
  if (attributes.classes.includes("run") && !language) {
    diagnostics.push(diagnostic("RM103", "A .run fence requires a language.", source));
    return;
  }
  const ravel = chunk.metadata.data.ravel;
  if (attributes.classes.includes("run")) ravel.run = true;
  if (attributes.values.provider !== undefined) {
    if (ravel.provider !== undefined && ravel.provider !== attributes.values.provider) {
      diagnostics.push(diagnostic("RM105", "Fragments of one piece cannot select different live providers.", source));
    } else {
      ravel.provider = attributes.values.provider;
    }
  }
};

const appendModernFragment = (chunk, block, language, source, diagnostics) => {
  chunk.body += block.body;
  chunk.fragments.push({ body: block.body, source: block.source });
  chunk._fragmentLanguages.push(language);
  const languages = [...new Set(chunk._fragmentLanguages.filter(Boolean))];
  if (languages.length === 1) chunk.metadata.language = languages[0];
  else if (languages.length > 1) {
    delete chunk.metadata.language;
    diagnostics.push(diagnostic(
      "RM150",
      "Fragments of " + chunk.id + " use incompatible languages: " + languages.join(", ") + ".",
      source
    ));
  }
  chunk.metadata.data.ravel.fragmentLanguages = [...chunk._fragmentLanguages];
  chunk.metadata.data.ravel.fragmentInfo = [
    ...(chunk.metadata.data.ravel.fragmentInfo ?? []),
    { language, infoString: block.infoString }
  ];
};

const cleanModernChunk = ({ _fragmentLanguages, _pipe, ...chunk }) => chunk;

const modernHeadingOptions = (text, options) => {
  const frontMatter = frontMatterFrom(text);
  const configured = options.headings ?? frontMatter?.lp?.headings;
  if (configured === false || configured === "none" || configured?.enabled === false) {
    return { enabled: false, levels: [] };
  }
  const levels = Array.isArray(configured?.levels) ? configured.levels : [2, 3, 4, 5, 6];
  return {
    enabled: true,
    levels: levels.filter((level) => Number.isInteger(level) && level >= 1 && level <= 6)
  };
};

const modernMarkdownToMapInternal = (text, options = {}) => {
  const uri = options.uri ?? "document.md";
  const mode = options.mode ?? "opt-in";
  if (mode !== "opt-in" && mode !== "primary") {
    throw new Error("Ravel Markdown mode must be opt-in or primary: " + mode);
  }
  const starts = lineStarts(text);
  const diagnostics = [];
  const documentId = options.document ?? documentFromFrontMatter(text) ?? defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error("Ravel Markdown document identity must be a lowercase identifier: " + String(documentId));
  }

  const headingOptions = modernHeadingOptions(text, options);
  const headingLevels = new Set(headingOptions.levels);
  const chunks = [];
  const chunksById = new Map();
  const directives = [];
  let ambient = null;
  const tree = fromMarkdown(text);
  const frontMatterEnd = frontMatterEndOffset(text);

  for (const node of structuralNodes(tree).sort((left, right) => left.position.start.offset - right.position.start.offset)) {
    if (node.position.start.offset < frontMatterEnd) continue;
    if (node.type === "heading") {
      if (!headingOptions.enabled || !headingLevels.has(node.depth)) continue;
      const declaration = headingDeclaration(node, starts, uri, diagnostics);
      if (!declaration) {
        ambient = null;
        continue;
      }
      const candidate = modernChunk(documentId, declaration, diagnostics);
      if (chunksById.has(candidate.id)) {
        diagnostics.push(diagnostic("RM106", "Duplicate modern Markdown heading piece: " + candidate.id + ".", declaration.source));
        ambient = chunksById.get(candidate.id);
      } else {
        chunks.push(candidate);
        chunksById.set(candidate.id, candidate);
        ambient = candidate;
      }
      continue;
    }

    const block = fenceBody(text, node, starts, uri);
    if (node.lang === "ravel") {
      directives.push(...parseDirectiveFence(block, documentId, starts, uri, diagnostics));
      continue;
    }
    const declaration = modernFence(node, block.fenceSource);
    const { attributes, language } = declaration;
    diagnostics.push(...attributes.diagnostics);
    const classes = new Set(attributes.classes);
    const excluded = classes.has("no-ravel");
    if (excluded && classes.has("run")) {
      diagnostics.push(diagnostic("RM103", ".run cannot be combined with .no-ravel.", block.fenceSource));
      continue;
    }
    if (excluded) continue;

    if (declaration.named) {
      if (declaration.append && !Object.hasOwn(attributes.values, "chunk")) {
        diagnostics.push(diagnostic("RM103", ".lp-fragment requires lp-for=name.", block.fenceSource));
        continue;
      }
      const chunkName = attributes.values.chunk ?? attributes.id;
      if (!componentPattern.test(chunkName ?? "")) {
        diagnostics.push(diagnostic("RM102", "A named modern Markdown fence requires a lowercase Ravel identifier.", block.fenceSource));
        continue;
      }
      const id = documentId + "::" + chunkName;
      let chunk = chunksById.get(id);
      if (declaration.append) {
        if (!chunk) {
          diagnostics.push(diagnostic("RM103", ".lp-fragment cannot append to an undeclared piece: " + id + ".", block.fenceSource));
          continue;
        }
        if (attributes.values.pipe) {
          diagnostics.push(diagnostic("RM105", "An appended fragment cannot declare a definition pipeline.", block.fenceSource));
        }
      } else if (chunk) {
        diagnostics.push(diagnostic("RM106", "Duplicate modern Markdown piece declaration: " + id + ".", block.fenceSource));
        continue;
      } else {
        const displayName = attributes.values["lp-title"] ?? chunkName;
        chunk = modernChunk(documentId, {
          chunk: chunkName,
          displayName,
          pipe: attributes.values.pipe ?? null,
          anchor: attributes.id ? "lp-" + attributes.id : null,
          source: block.fenceSource
        }, diagnostics);
        chunks.push(chunk);
        chunksById.set(chunk.id, chunk);
      }
      appendModernFragment(chunk, block, language, block.fenceSource, diagnostics);
      setModernFenceMetadata(chunk, attributes, language, block.fenceSource, diagnostics);
      continue;
    }

    if (!ambient) {
      if (mode === "primary") {
        diagnostics.push(diagnostic("RM103", "An unnamed modern Markdown fence requires an enabled heading owner or .no-ravel.", block.fenceSource));
      }
      continue;
    }
    const pipe = attributes.values.pipe ?? null;
    if (pipe !== null) {
      if (ambient.fragments.length > 0) {
        diagnostics.push(diagnostic("RM105", "Only the first unnamed fence owned by a heading may declare its pipeline.", block.fenceSource));
      } else if (ambient._pipe !== null && ambient._pipe !== pipe) {
        diagnostics.push(diagnostic("RM105", "Heading and first-fence definition pipelines conflict.", block.fenceSource));
      } else if (ambient._pipe === null) {
        ambient._pipe = pipe;
        ambient.metadata.data.ravel.definitionPipe = pipe;
        ambient.definitionPipeline = definitionPipeline(pipe, block.fenceSource, diagnostics);
      }
    }
    appendModernFragment(ambient, block, language, block.fenceSource, diagnostics);
    setModernFenceMetadata(ambient, attributes, language, block.fenceSource, diagnostics);
  }

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: "markdown+ravel-modern-v1" },
      chunks: chunks.map(cleanModernChunk),
      directives
    },
    diagnostics
  };
};

/**
 * Convert modern heading/fence Markdown into a format-neutral map.
 * H2-H6 headings own unnamed fences by default; named fences remain local.
 */
export const modernMarkdownToMap = (text, options = {}) => modernMarkdownToMapInternal(text, options);

/**
 * Convert Markdown into a Ravel Map. Existing calls retain the fenced-block
 * profile. `profile: "modern"` or `lp.adapter: markdown` selects the modern
 * heading/fence profile.
 */
export const markdownToMap = (text, options = {}) => {
  const adapter = frontMatterFrom(text)?.lp?.adapter;
  const modern = options.profile === undefined ? adapter === "markdown" : options.profile === "modern";
  return modern
    ? modernMarkdownToMapInternal(text, options)
    : fencedMarkdownToMap(text, options);
};
