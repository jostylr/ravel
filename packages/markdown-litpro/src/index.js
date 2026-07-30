import { parseDefinitionPipeline } from "@pieceful/ravel-core";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parse as parseYaml } from "yaml";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const dialects = new Set(["litpro-2017", "pieceful-2020", "litpro-plus"]);
const headingModes = new Set(["legacy", "flat", "none"]);

const diagnostic = (code, message, source, severity = "error") => ({
  code, severity, message, source
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

const advanceRange = (source, text, start, end) => {
  const starts = lineStarts(text);
  const base = source.range.start;
  const position = (offset) => {
    const local = positionAt(starts, offset);
    return {
      line: base.line + local.line,
      column: local.line === 0 ? base.column + local.column : local.column,
      offset: base.offset + offset
    };
  };
  return { uri: source.uri, range: { start: position(start), end: position(end) } };
};

const frontMatter = (text) => {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { data: undefined, end: 0 };
  const firstEnd = text.indexOf("\n");
  const close = /^---\s*\r?$/m.exec(text.slice(firstEnd + 1));
  if (!close) return { data: undefined, end: 0 };
  try {
    return {
      data: parseYaml(text.slice(firstEnd + 1, firstEnd + 1 + close.index)),
      end: firstEnd + 1 + close.index + close[0].length
    };
  } catch {
    return { data: undefined, end: 0 };
  }
};

const defaultDocumentId = (uri) => {
  const base = uri.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return componentPattern.test(id) ? id : null;
};

const displayText = (node) => {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image") return node.alt ?? "";
  return (node.children ?? []).map(displayText).join("");
};

const splitNamePipeline = (text) => {
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    if (escaped) escaped = false;
    else if (text[index] === "\\") escaped = true;
    else if (text[index] === "|") {
      return {
        name: text.slice(0, index).trim().replace(/\\\|/g, "|"),
        pipe: text.slice(index + 1).trim()
      };
    }
  }
  return { name: text.trim().replace(/\\\|/g, "|"), pipe: null };
};

const legacyName = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");

const semanticComponent = (value) => {
  const normalized = legacyName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return componentPattern.test(normalized) ? normalized : null;
};

const structuralEvents = (node, found = [], inHeading = false) => {
  if (node.type === "heading") {
    found.push(node);
    return found;
  }
  if (node.type === "code" || node.type === "link" ||
      (node.type === "html" && /^\s*<!--\+/.test(node.value ?? ""))) {
    found.push(node);
    if (node.type !== "link") return found;
  }
  for (const child of node.children ?? []) structuralEvents(child, found, inHeading);
  return found;
};

const codeFragment = (text, node, starts, uri) => {
  const start = node.position.start.offset;
  const end = node.position.end.offset;
  const raw = text.slice(start, end);
  const firstLineEnd = raw.search(/\r?\n/);
  const opening = firstLineEnd === -1 ? raw : raw.slice(0, firstLineEnd);
  const fenced = /^[ \t]{0,3}(?:`{3,}|~{3,})/.test(opening);
  if (!fenced) {
    return {
      body: node.value ?? "",
      language: node.lang || null,
      infoString: node.lang ?? "",
      source: rangeAt(uri, starts, start, end),
      declaration: rangeAt(uri, starts, start, end),
      exact: false
    };
  }
  const newlineLength = raw[firstLineEnd] === "\r" ? 2 : 1;
  const bodyStart = start + firstLineEnd + newlineLength;
  const closingStartInRaw = raw.lastIndexOf("\n") + 1;
  let bodyEnd = closingStartInRaw === 0 ? bodyStart : start + closingStartInRaw;
  if (text[bodyEnd - 1] === "\n") bodyEnd -= 1;
  if (text[bodyEnd - 1] === "\r") bodyEnd -= 1;
  return {
    body: text.slice(bodyStart, bodyEnd),
    language: node.lang || null,
    infoString: opening.replace(/^[ \t]{0,3}(?:`{3,}|~{3,})/, "").trim(),
    source: rangeAt(uri, starts, bodyStart, bodyEnd),
    declaration: rangeAt(uri, starts, start, end),
    exact: true
  };
};

const parseFenceMetadata = (fragment) => {
  const result = {
    language: fragment.infoString.startsWith("{") ? null : fragment.language,
    name: null,
    title: null,
    pipe: null,
    run: false,
    provider: null,
    tags: []
  };
  const info = fragment.infoString;
  if (info.startsWith("{") && info.endsWith("}")) {
    const tokens = info.slice(1, -1).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith("#lp-")) result.name = token.slice(4);
      else if (token === ".lp-piece") result.declared = true;
      else if (token === ".run") result.run = true;
      else if (token.startsWith(".") && !result.language) result.language = token.slice(1);
      else if (token.startsWith(".") && ![".ravel", ".lp-fragment"].includes(token)) result.tags.push(token.slice(1));
      else {
        const separator = token.indexOf("=");
        if (separator === -1) continue;
        const key = token.slice(0, separator);
        let value = token.slice(separator + 1);
        if ((value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (key === "lp-pipe") result.pipe = value;
        else if (key === "lp-title") result.title = value;
        else if (key === "provider") result.provider = value;
      }
    }
  } else {
    const compact = /^\S+\s+lp:([^|\s]+)(?:\s*\|(.*))?$/.exec(info);
    if (compact) {
      result.name = compact[1];
      result.declared = true;
      result.pipe = compact[2]?.trim() ?? null;
    }
    const attributes = /\{([^{}]*)\}\s*$/.exec(info);
    if (attributes) {
      result.run = /(?:^|\s)\.run(?:\s|$)/.test(attributes[1]);
      const provider = /(?:^|\s)provider=(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(attributes[1]);
      result.provider = provider?.[1] ?? provider?.[2] ?? provider?.[3] ?? null;
      result.tags.push(...[...attributes[1].matchAll(/(?:^|\s)\.([a-z][a-z0-9-]*)/g)]
        .map((match) => match[1])
        .filter((tag) => !["run", "ravel"].includes(tag)));
    }
  }
  return result;
};

const formatId = (document, path, minor = null) =>
  document + "::" + path + (minor === null ? "" : ":" + minor);

const headingConfiguration = (data, options, dialect) => {
  const raw = options.headings ?? data?.lp?.headings;
  const object = raw && typeof raw === "object" ? raw : {};
  const mode = typeof raw === "string" ? raw : object.mode ?? "legacy";
  if (!headingModes.has(mode)) throw new Error("LitPro heading mode must be legacy, flat, or none: " + mode);
  const major = Array.isArray(object.major) ? object.major : [1, 2, 3, 4];
  const child = Number.isInteger(object.child) ? object.child : 5;
  const grandchild = Number.isInteger(object.grandchild) ? object.grandchild : 6;
  return {
    mode,
    major: new Set(major),
    child,
    grandchild,
    levels: new Set([...major, child, grandchild]),
    pipelines: object.pipelines ?? dialect !== "litpro-2017"
  };
};

const pipelineFor = (text, source, diagnostics) => {
  if (text === null || text === "") return [];
  const parsed = parseDefinitionPipeline(text, source);
  diagnostics.push(...parsed.diagnostics);
  return parsed.pipeline;
};

const pipelineKey = (pipeline) => JSON.stringify(pipeline.map(({ name, arguments: args }) => [name, args ?? []]));

const referenceSurfaces = (body, source, ownerPieceId) => {
  const references = [];
  const pattern = /(?:\\[1-9][0-9]*)?_(["'`])([\s\S]*?)\1/g;
  for (const match of body.matchAll(pattern)) {
    const prefix = match[0].indexOf("_");
    references.push({
      ownerPieceId,
      targetText: match[2],
      source: advanceRange(source, body, match.index + prefix, match.index + match[0].length)
    });
  }
  return references;
};

const cleanChunk = ({ _languages, _pipelineKey, _basePath, ...chunk }) => chunk;

/** Return true when YAML front matter explicitly selects this adapter. */
export const isLitproMarkdown = (text) => frontMatter(text).data?.lp?.adapter === "markdown-litpro";

export const litproMarkdownToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.md";
  const starts = lineStarts(text);
  const front = frontMatter(text);
  const data = front.data;
  const dialect = options.dialect ?? data?.lp?.dialect ?? "litpro-plus";
  if (!dialects.has(dialect)) throw new Error("Unknown LitPro Markdown dialect: " + dialect);
  const headings = headingConfiguration(data, options, dialect);
  const documentId = options.document ?? data?.lp?.document ?? data?.ravel?.document ?? defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error("LitPro Markdown document identity must be a lowercase identifier: " + String(documentId));
  }

  const diagnostics = [];
  const chunks = [];
  const chunksById = new Map();
  const directives = [];
  const plannedEffects = [];
  const legacyComments = [];
  const surface = { definitions: [], references: [], directives: [] };
  let major = null;
  let child = null;
  let grandchild = null;
  let basePath = null;
  let ambient = null;

  const declare = ({ path, minor = null, displayName, legacyPath, pipe, source, level, anchor = null }) => {
    const id = formatId(documentId, path, minor);
    const parsedPipeline = pipelineFor(pipe, source, diagnostics);
    const key = pipelineKey(parsedPipeline);
    let chunk = chunksById.get(id);
    if (!chunk) {
      chunk = {
        id,
        identity: { document: documentId, chunk: path, minor, type: null },
        name: displayName,
        body: "",
        definitionPipeline: parsedPipeline,
        metadata: {
          tags: [],
          data: {
            ravel: {
              adapter: "markdown-litpro",
              dialect,
              displayName,
              legacyPath,
              headingLevel: level,
              ...(anchor ? { renderedAnchor: anchor } : {}),
              declarations: [source]
            }
          }
        },
        source,
        fragments: [],
        _languages: [],
        _pipelineKey: key,
        _basePath: path
      };
      chunks.push(chunk);
      chunksById.set(id, chunk);
    } else {
      chunk.metadata.data.ravel.declarations.push(source);
      if (parsedPipeline.length) {
        if (dialect === "pieceful-2020") {
          chunk.definitionPipeline.push(...parsedPipeline);
          chunk._pipelineKey = pipelineKey(chunk.definitionPipeline);
        } else if (chunk.definitionPipeline.length === 0) {
          chunk.definitionPipeline = parsedPipeline;
          chunk._pipelineKey = key;
        } else if (chunk._pipelineKey !== key) {
          diagnostics.push(diagnostic("LPA113", "Repeated LitPro declarations have conflicting definition pipelines for " + id + ".", source));
        }
      }
    }
    surface.definitions.push({
      pieceId: id,
      declaration: source,
      fragments: [],
      displayName,
      ...(anchor ? { renderedAnchor: anchor } : {})
    });
    return chunk;
  };

  const appendFragment = (chunk, fragment, metadata) => {
    const separator = chunk.fragments.length ? "\n" : "";
    const body = separator + fragment.body;
    chunk.body += body;
    chunk.fragments.push({ body, source: fragment.source });
    chunk._languages.push(metadata.language);
    const languages = [...new Set(chunk._languages.filter(Boolean))];
    if (languages.length === 1) chunk.metadata.language = languages[0];
    else if (languages.length > 1) {
      delete chunk.metadata.language;
      diagnostics.push(diagnostic("LPA110", "LitPro fragments use incompatible languages in " + chunk.id + ": " + languages.join(", ") + ".", fragment.declaration));
    }
    const ravel = chunk.metadata.data.ravel;
    ravel.fragmentInfo = [
      ...(ravel.fragmentInfo ?? []),
      { language: metadata.language, infoString: fragment.infoString, exact: fragment.exact }
    ];
    if (metadata.run) {
      if (!metadata.language) diagnostics.push(diagnostic("LPA110", "A LitPro .run fence requires a language.", fragment.declaration));
      else ravel.run = true;
    }
    if (metadata.provider) {
      if (ravel.provider && ravel.provider !== metadata.provider) {
        diagnostics.push(diagnostic("LPA113", "LitPro fragments cannot select conflicting live providers.", fragment.declaration));
      } else ravel.provider = metadata.provider;
    }
    chunk.metadata.tags = [...new Set([...chunk.metadata.tags, ...metadata.tags])];
    surface.references.push(...referenceSurfaces(fragment.body, fragment.source, chunk.id));
    const definition = surface.definitions.findLast((entry) => entry.pieceId === chunk.id);
    if (definition) definition.fragments.push(fragment.source);
  };

  const targetFromHref = (href, current) => {
    if (!href || href === "#") return current?.id ?? null;
    if (!href.startsWith("#")) return href;
    let target = decodeURIComponent(href.slice(1));
    if (target === "^") return basePath ? formatId(documentId, basePath) : null;
    if (target.startsWith(":")) {
      const minor = semanticComponent(target.slice(1));
      return basePath && minor ? formatId(documentId, basePath, minor) : null;
    }
    if (target.includes("::")) return target;
    const colon = target.indexOf(":");
    const pathText = colon === -1 ? target : target.slice(0, colon);
    const minorText = colon === -1 ? null : target.slice(colon + 1);
    const path = pathText.split("/").map(semanticComponent).filter(Boolean).join("/");
    const minor = minorText === null ? null : semanticComponent(minorText);
    return path ? formatId(documentId, path, minor) : null;
  };

  const tree = fromMarkdown(text);
  const events = structuralEvents(tree)
    .filter((node) => node.position.start.offset >= front.end)
    .sort((left, right) => left.position.start.offset - right.position.start.offset);

  for (const node of events) {
    const nodeSource = rangeAt(uri, starts, node.position.start.offset, node.position.end.offset);
    if (node.type === "heading") {
      if (headings.mode === "none" || !headings.levels.has(node.depth)) continue;
      const raw = displayText(node).trim();
      const split = splitNamePipeline(raw);
      if (split.pipe !== null && !headings.pipelines) {
        diagnostics.push(diagnostic("LPA113", dialect + " does not allow definition pipelines in headings.", nodeSource));
      }
      const component = semanticComponent(split.name);
      if (!component) {
        diagnostics.push(diagnostic("LPA101", "LitPro heading does not produce a usable piece name.", nodeSource));
        ambient = null;
        continue;
      }
      let path;
      if (headings.mode === "flat" || headings.major.has(node.depth)) {
        major = component;
        child = null;
        grandchild = null;
        path = major;
      } else if (node.depth === headings.child) {
        if (!major) {
          diagnostics.push(diagnostic("LPA110", "A LitPro child heading requires a preceding major heading.", nodeSource));
          ambient = null;
          continue;
        }
        child = component;
        grandchild = null;
        path = major + "/" + child;
      } else if (node.depth === headings.grandchild) {
        if (!major) {
          diagnostics.push(diagnostic("LPA110", "A LitPro grandchild heading requires a preceding major heading.", nodeSource));
          ambient = null;
          continue;
        }
        grandchild = component;
        path = major + "/" + (child ?? "") + "/" + grandchild;
      } else {
        continue;
      }
      basePath = path;
      ambient = declare({
        path,
        displayName: split.name,
        legacyPath: path,
        pipe: headings.pipelines ? split.pipe : null,
        source: nodeSource,
        level: node.depth
      });
      continue;
    }

    if (node.type === "code") {
      const fragment = codeFragment(text, node, starts, uri);
      const metadata = parseFenceMetadata(fragment);
      if (metadata.declared || metadata.name) {
        const path = semanticComponent(metadata.name);
        if (!path) {
          diagnostics.push(diagnostic("LPA101", "A named LitPro fence requires a lowercase-compatible name.", fragment.declaration));
          continue;
        }
        const named = declare({
          path,
          displayName: metadata.title ?? metadata.name,
          legacyPath: metadata.name,
          pipe: metadata.pipe,
          source: fragment.declaration,
          level: 0,
          anchor: "lp-" + path
        });
        appendFragment(named, fragment, metadata);
      } else if (ambient) {
        appendFragment(ambient, fragment, metadata);
      }
      continue;
    }

    if (node.type === "html") {
      legacyComments.push({ body: node.value, source: nodeSource });
      continue;
    }

    const linkText = displayText(node).trim();
    const href = node.url ?? "";
    const title = node.title ?? "";
    const switchMinor = (!href && !title) || title.startsWith(":");
    if (switchMinor) {
      if (!basePath) {
        diagnostics.push(diagnostic("LPA110", "A LitPro minor switch requires a preceding heading.", nodeSource));
        continue;
      }
      if (linkText === "^") {
        ambient = chunksById.get(formatId(documentId, basePath)) ?? null;
        continue;
      }
      if (title.startsWith(":") && (!linkText || linkText.includes("|"))) {
        plannedEffects.push({
          kind: "legacy-transform",
          owner: ambient?.id ?? null,
          target: linkText,
          arguments: title.slice(1),
          source: nodeSource
        });
        continue;
      }
      const split = splitNamePipeline(linkText);
      const minor = semanticComponent(split.name);
      if (!minor) {
        diagnostics.push(diagnostic("LPA101", "A LitPro minor switch requires a visible name.", nodeSource));
        continue;
      }
      const pipe = title.startsWith(":") ? title.slice(1).trim() || split.pipe : split.pipe;
      ambient = declare({
        path: basePath,
        minor,
        displayName: split.name,
        legacyPath: basePath + ":" + legacyName(split.name),
        pipe,
        source: nodeSource,
        level: 0
      });
      continue;
    }

    const separator = title.indexOf(":");
    if (separator === -1) continue;
    const directiveName = legacyName(title.slice(0, separator));
    const argumentsText = title.slice(separator + 1).trim();
    if (directiveName === "load") {
      const directive = {
        kind: "in",
        target: href,
        metadata: {
          adapter: "markdown-litpro",
          dialect,
          legacy: { directive: directiveName, alias: linkText || null, arguments: argumentsText }
        },
        source: nodeSource
      };
      directives.push(directive);
      surface.directives.push({ kind: "in", source: nodeSource, target: href });
    } else if (directiveName === "save" || directiveName === "out") {
      const from = targetFromHref(href, ambient);
      if (!from) {
        diagnostics.push(diagnostic("LPA110", "A LitPro " + directiveName + " directive has no resolvable source piece.", nodeSource));
        continue;
      }
      const directive = {
        kind: "out",
        name: linkText,
        from,
        metadata: { legacy: { directive: directiveName, arguments: argumentsText } },
        source: nodeSource
      };
      directives.push(directive);
      surface.directives.push({ kind: "out", source: nodeSource, target: linkText });
    } else {
      plannedEffects.push({
        kind: "legacy-directive",
        directive: directiveName,
        owner: ambient?.id ?? null,
        target: linkText,
        source: href,
        arguments: argumentsText,
        declaration: nodeSource
      });
    }
  }

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: "markdown+litpro-" + dialect + "-v1" },
      chunks: chunks.map(cleanChunk),
      directives,
      metadata: {
        adapter: "markdown-litpro",
        dialect,
        headings: {
          mode: headings.mode,
          major: [...headings.major],
          child: headings.child,
          grandchild: headings.grandchild,
          pipelines: headings.pipelines
        },
        plannedEffects,
        legacyComments
      }
    },
    diagnostics,
    surface
  };
};
