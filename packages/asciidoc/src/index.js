import { parseDefinitionPipeline } from "@pieceful/ravel-core";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const delimiters = new Set(["----", "....", "===="]);

const diagnostic = (code, message, source, severity = "error") => ({
  code,
  severity,
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
  range: {
    start: positionAt(starts, start),
    end: positionAt(starts, end)
  }
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
  return {
    uri: source.uri,
    range: { start: position(start), end: position(end) }
  };
};

const linesOf = (text) => {
  const lines = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    else end += 1;
    const contentEnd = end > start && text[end - 1] === "\n"
      ? end - (end > start + 1 && text[end - 2] === "\r" ? 2 : 1)
      : end;
    lines.push({
      start,
      end,
      contentEnd,
      value: text.slice(start, contentEnd)
    });
    start = end;
  }
  return lines;
};

const defaultDocumentId = (uri) => {
  const base = uri.split(/[\\/]/).at(-1)
    ?.replace(/\.(?:adoc|asciidoc)$/i, "") ?? "";
  const id = base.toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return componentPattern.test(id) ? id : null;
};

const semanticComponent = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return componentPattern.test(normalized) ? normalized : null;
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

const splitNamePipeline = (value) => {
  const pipeIndex = firstUnescapedPipe(value);
  return {
    name: (pipeIndex === -1 ? value : value.slice(0, pipeIndex))
      .trim()
      .replace(/\\\|/g, "|"),
    pipe: pipeIndex === -1 ? null : value.slice(pipeIndex + 1).trim(),
    pipeIndex
  };
};

const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 &&
      ((trimmed[0] === "\"" && trimmed.at(-1) === "\"") ||
       (trimmed[0] === "'" && trimmed.at(-1) === "'"))) {
    return trimmed.slice(1, -1)
      .replace(/\\(["'\\])/g, "$1");
  }
  return trimmed;
};

const splitAttributes = (value) => {
  const entries = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (index === value.length || (character === "," && !quote)) {
      entries.push({
        raw: value.slice(start, index),
        start,
        end: index
      });
      start = index + 1;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    }
  }
  return entries;
};

const equalsOutsideQuotes = (value) => {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "=") {
      return index;
    }
  }
  return -1;
};

const shorthandFrom = (value) => {
  const match = /^([^#.]*)(.*)$/.exec(value.trim());
  const style = match?.[1] || null;
  const suffix = match?.[2] ?? "";
  const id = /#([A-Za-z][A-Za-z0-9_.:-]*)/.exec(suffix)?.[1] ?? null;
  const roles = [...suffix.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)]
    .map((entry) => entry[1]);
  return { style, id, roles };
};

const emptyMetadata = () => ({
  title: null,
  titleSource: null,
  id: null,
  idSource: null,
  style: null,
  positional: [],
  roles: [],
  attributes: {},
  attributeSources: {},
  lines: []
});

const parseAttributeLine = (line, uri, starts, metadata) => {
  const content = line.value.slice(1, -1);
  const entries = splitAttributes(content);
  for (const [index, entry] of entries.entries()) {
    const leading = entry.raw.search(/\S|$/);
    const trailing = entry.raw.length - entry.raw.trimEnd().length;
    const raw = entry.raw.slice(leading, entry.raw.length - trailing);
    if (!raw) continue;
    const equals = equalsOutsideQuotes(raw);
    if (equals !== -1) {
      const key = raw.slice(0, equals).trim().toLowerCase();
      const rawValue = raw.slice(equals + 1).trim();
      const value = unquote(rawValue);
      const rawValueStart = raw.indexOf(rawValue, equals + 1);
      const quoteOffset = rawValue.length >= 2 &&
        ((rawValue[0] === "\"" && rawValue.at(-1) === "\"") ||
         (rawValue[0] === "'" && rawValue.at(-1) === "'"))
        ? 1
        : 0;
      const start = line.start + 1 + entry.start + leading +
        rawValueStart + quoteOffset;
      metadata.attributes[key] = value;
      metadata.attributeSources[key] = rangeAt(
        uri,
        starts,
        start,
        start + value.length
      );
      continue;
    }
    metadata.positional.push(raw);
    if (index === 0) {
      const shorthand = shorthandFrom(raw);
      metadata.style = shorthand.style;
      if (shorthand.id) {
        metadata.id = shorthand.id;
        metadata.idSource = rangeAt(uri, starts, line.start, line.end);
      }
      metadata.roles.push(...shorthand.roles);
    }
  }
  const namedId = metadata.attributes.id;
  if (namedId) {
    metadata.id = namedId;
    metadata.idSource = metadata.attributeSources.id;
  }
  const namedRoles = metadata.attributes.role;
  if (namedRoles) {
    metadata.roles.push(...namedRoles.split(/\s+/).filter(Boolean));
  }
};

const metadataBefore = (lines, index, uri, starts) => {
  const selected = [];
  let cursor = index - 1;
  while (cursor >= 0) {
    const value = lines[cursor].value;
    if (/^\[[^\]]*\]$/.test(value) ||
        /^\[\[[^\]]+\]\]$/.test(value) ||
        /^\.[^. \t].*$/.test(value)) {
      selected.unshift(lines[cursor]);
      cursor -= 1;
      continue;
    }
    break;
  }
  const metadata = emptyMetadata();
  metadata.lines = selected;
  for (const line of selected) {
    const anchor = /^\[\[([^,\]]+)(?:,[^\]]*)?\]\]$/.exec(line.value);
    if (anchor) {
      metadata.id = anchor[1];
      const start = line.start + line.value.indexOf(anchor[1]);
      metadata.idSource = rangeAt(
        uri,
        starts,
        start,
        start + anchor[1].length
      );
      continue;
    }
    if (/^\[[^\]]*\]$/.test(line.value)) {
      parseAttributeLine(line, uri, starts, metadata);
      continue;
    }
    if (line.value.startsWith(".")) {
      metadata.title = line.value.slice(1);
      metadata.titleSource = rangeAt(
        uri,
        starts,
        line.start + 1,
        line.contentEnd
      );
    }
  }
  metadata.roles = [...new Set(metadata.roles)];
  metadata.declarationStart = selected[0]?.start ?? lines[index]?.start ?? 0;
  return metadata;
};

const hasPieceRole = (metadata) =>
  metadata.roles.includes("lp-piece") ||
  metadata.roles.includes("ravel-piece");

const isPieceMetadata = (metadata) =>
  hasPieceRole(metadata) ||
  typeof metadata.attributes["lp-id"] === "string" ||
  typeof metadata.attributes["ravel-id"] === "string" ||
  metadata.id?.startsWith("lp-");

const blockLanguage = (metadata) =>
  metadata.attributes.language ||
  metadata.attributes.lang ||
  (metadata.style === "source" ? metadata.positional[1] : null) ||
  null;

const scanDelimitedBlocks = (text, lines, uri, starts, diagnostics) => {
  const blocks = [];
  const stack = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].value;
    const top = stack.at(-1);
    if (top && (top.marker === "----" || top.marker === "....")) {
      if (marker !== top.marker) continue;
      top.closeIndex = index;
      top.close = rangeAt(uri, starts, lines[index].start, lines[index].end);
      top.body = text.slice(lines[top.openIndex].end, lines[index].start);
      top.bodySource = rangeAt(
        uri,
        starts,
        lines[top.openIndex].end,
        lines[index].start
      );
      stack.pop();
      continue;
    }
    if (!delimiters.has(marker)) continue;
    if (top?.marker === marker) {
      top.closeIndex = index;
      top.close = rangeAt(uri, starts, lines[index].start, lines[index].end);
      top.body = text.slice(lines[top.openIndex].end, lines[index].start);
      top.bodySource = rangeAt(
        uri,
        starts,
        lines[top.openIndex].end,
        lines[index].start
      );
      stack.pop();
      continue;
    }
    const metadata = metadataBefore(lines, index, uri, starts);
    const block = {
      marker,
      openIndex: index,
      closeIndex: null,
      parent: top ?? null,
      metadata,
      declaration: rangeAt(
        uri,
        starts,
        metadata.declarationStart,
        lines[index].end
      ),
      open: rangeAt(uri, starts, lines[index].start, lines[index].end),
      close: null,
      body: "",
      bodySource: rangeAt(
        uri,
        starts,
        lines[index].end,
        lines[index].end
      )
    };
    blocks.push(block);
    stack.push(block);
  }
  for (const block of stack) {
    block.body = text.slice(lines[block.openIndex].end);
    block.bodySource = rangeAt(
      uri,
      starts,
      lines[block.openIndex].end,
      text.length
    );
    diagnostics.push(diagnostic(
      "LPA111",
      "AsciiDoc delimited block is missing its closing " + block.marker + ".",
      block.open
    ));
  }
  return blocks;
};

const pipelineKey = (pipeline) =>
  JSON.stringify(pipeline.map(({ name, arguments: args }) => [name, args ?? []]));

const runSelected = (options, names) =>
  options.run === true ||
  (Array.isArray(options.run) &&
    names.some((name) => options.run.includes(name)));

const truthyAttribute = (value) =>
  value === "" || /^(?:1|yes|true|on)$/i.test(value ?? "");

const candidateFrom = ({
  form,
  authoredName,
  displayName,
  label,
  metadata,
  declaration,
  pipelineText,
  pipelineSource,
  order
}, options, diagnostics) => {
  const explicit = metadata.attributes["ravel-id"] ??
    metadata.attributes["lp-id"] ??
    (label?.startsWith("lp-") ? label.slice(3) : null);
  const canonical = semanticComponent(explicit ?? authoredName);
  if (!canonical) {
    diagnostics.push(diagnostic(
      "LPA101",
      "AsciiDoc piece name, ID, or lp-id does not produce a usable Ravel ID.",
      declaration
    ));
    return null;
  }
  const parsed = pipelineText
    ? parseDefinitionPipeline(pipelineText, pipelineSource ?? declaration)
    : { pipeline: [], diagnostics: [] };
  diagnostics.push(...parsed.diagnostics);
  const requestedRun = runSelected(
    options,
    [authoredName, canonical, label].filter(Boolean)
  ) || truthyAttribute(metadata.attributes["ravel-run"]);
  return {
    form,
    authoredName,
    canonical,
    displayName: displayName || authoredName,
    label,
    metadata,
    declaration,
    pipeline: parsed.pipeline,
    pipelineSource,
    language: null,
    fragments: [],
    run: requestedRun,
    provider: metadata.attributes["ravel-provider"] ||
      options.provider ||
      null,
    order
  };
};

const headingCandidates = (
  lines,
  uri,
  starts,
  excludedLines,
  options,
  diagnostics
) => {
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (excludedLines.has(index)) continue;
    const match = /^(={2,6})[ \t]+(.+?)[ \t]*$/.exec(lines[index].value);
    if (!match) continue;
    const metadata = metadataBefore(lines, index, uri, starts);
    if (!isPieceMetadata(metadata)) continue;
    const split = splitNamePipeline(match[2]);
    const titleStart = lines[index].value.indexOf(match[2]);
    const pipeWhitespace = split.pipe !== null
      ? match[2].slice(split.pipeIndex + 1).search(/\S|$/)
      : 0;
    const pipeStart = titleStart + split.pipeIndex + 1 + pipeWhitespace;
    const attributePipe = metadata.attributes["ravel-pipe"] ??
      metadata.attributes["lp-pipe"] ??
      null;
    if (split.pipe !== null && attributePipe !== null &&
        split.pipe !== attributePipe) {
      diagnostics.push(diagnostic(
        "LPA113",
        "AsciiDoc section title and block attribute declare conflicting pipelines.",
        rangeAt(uri, starts, lines[index].start, lines[index].end)
      ));
    }
    const pipelineText = attributePipe ?? split.pipe;
    const pipelineSource = attributePipe !== null
      ? metadata.attributeSources["ravel-pipe"] ??
        metadata.attributeSources["lp-pipe"]
      : split.pipe !== null
        ? rangeAt(
            uri,
            starts,
            lines[index].start + pipeStart,
            lines[index].start + pipeStart + split.pipe.length
          )
        : null;
    const declaration = rangeAt(
      uri,
      starts,
      metadata.declarationStart,
      lines[index].end
    );
    const candidate = candidateFrom({
      form: "section",
      authoredName: split.name,
      displayName: split.name,
      label: metadata.id,
      metadata,
      declaration,
      pipelineText,
      pipelineSource,
      order: lines[index].start
    }, options, diagnostics);
    if (candidate) {
      candidate.headingIndex = index;
      result.push(candidate);
    }
  }
  return result;
};

const blockCandidate = (block, options, diagnostics) => {
  const metadata = block.metadata;
  const authoredName = metadata.attributes["ravel-id"] ??
    metadata.attributes["lp-id"] ??
    (metadata.id?.startsWith("lp-") ? metadata.id.slice(3) : metadata.title);
  const pipelineText = metadata.attributes["ravel-pipe"] ??
    metadata.attributes["lp-pipe"] ??
    null;
  return candidateFrom({
    form: block.marker === "====" ? "container" : "block",
    authoredName,
    displayName: metadata.title ?? authoredName,
    label: metadata.id,
    metadata,
    declaration: block.declaration,
    pipelineText,
    pipelineSource: metadata.attributeSources["ravel-pipe"] ??
      metadata.attributeSources["lp-pipe"] ??
      null,
    order: block.declaration.range.start.offset
  }, options, diagnostics);
};

const underscoreReferencesFrom = (body, source) => {
  const references = [];
  const pattern = /(?:\\[1-9][0-9]*)?_(["'`])([\s\S]*?)\1/g;
  for (const match of body.matchAll(pattern)) {
    const prefix = match[0].indexOf("_");
    references.push({
      targetText: match[2],
      source: advanceRange(
        source,
        body,
        match.index + prefix,
        match.index + match[0].length
      )
    });
  }
  return references;
};

const navigationFrom = (
  text,
  excluded,
  labelToPiece,
  uri,
  starts
) => {
  const navigation = [];
  const patterns = [
    {
      pattern: /<<([^>,\s]+)(?:,[^>]*)?>>/g,
      target: (match) => match[1],
      syntax: "angle-xref"
    },
    {
      pattern: /xref:([^\s\[]+)\[[^\]]*\]/g,
      target: (match) => match[1].replace(/^#/, ""),
      syntax: "xref-macro"
    }
  ];
  const included = (offset) =>
    !excluded.some((range) => offset >= range.start && offset < range.end);
  for (const entry of patterns) {
    for (const match of text.matchAll(entry.pattern)) {
      if (!included(match.index)) continue;
      const targetLabel = entry.target(match);
      const targetPieceId = labelToPiece.get(targetLabel);
      if (!targetPieceId) continue;
      navigation.push({
        targetPieceId,
        targetLabel,
        syntax: entry.syntax,
        source: rangeAt(
          uri,
          starts,
          match.index,
          match.index + match[0].length
        )
      });
    }
  }
  return navigation;
};

const directiveAttributes = (content, line, uri, starts) => {
  const metadata = emptyMetadata();
  const fakeLine = {
    ...line,
    value: "[" + content + "]"
  };
  parseAttributeLine(fakeLine, uri, starts, metadata);
  return metadata;
};

const directivesFrom = (
  lines,
  document,
  uri,
  starts,
  excludedLines,
  diagnostics
) => {
  const directives = [];
  for (const [index, line] of lines.entries()) {
    if (excludedLines.has(index)) continue;
    const match = /^[ \t]*ravel::(write|derive|read)\[([\s\S]*)\][ \t]*$/
      .exec(line.value);
    if (!match) continue;
    const contentStart = line.value.indexOf("[") + 1;
    const attrs = directiveAttributes(
      match[2],
      {
        ...line,
        start: line.start + contentStart - 1,
        value: "[" + match[2] + "]"
      },
      uri,
      starts
    );
    const source = rangeAt(uri, starts, line.start, line.end);
    const valueSource = (name) => attrs.attributeSources[name] ?? source;
    if (match[1] === "write") {
      const target = attrs.attributes.target;
      const from = attrs.attributes.from;
      if (!target || !from) {
        diagnostics.push(diagnostic(
          "LPA101",
          "ravel::write requires target and from attributes.",
          source
        ));
        continue;
      }
      directives.push({
        kind: "out",
        name: target,
        from: from.includes("::") ? from : document + "::" + from,
        source
      });
      continue;
    }
    if (match[1] === "read") {
      const target = attrs.attributes.target;
      if (!target) {
        diagnostics.push(diagnostic(
          "LPA101",
          "ravel::read requires a target attribute.",
          source
        ));
        continue;
      }
      directives.push({
        kind: "in",
        target,
        source,
        metadata: {
          adapter: "asciidoc",
          ...(attrs.attributes.as
            ? { legacy: { alias: attrs.attributes.as } }
            : {})
        }
      });
      continue;
    }
    const target = attrs.attributes.target;
    const from = attrs.attributes.from;
    const using = attrs.attributes.using;
    if (!target || !from || !using) {
      diagnostics.push(diagnostic(
        "LPA101",
        "ravel::derive requires target, from, and using attributes.",
        source
      ));
      continue;
    }
    const parsed = parseDefinitionPipeline(using, valueSource("using"));
    diagnostics.push(...parsed.diagnostics);
    directives.push({
      kind: "create",
      document,
      name: target,
      compose: [
        {
          kind: "append",
          reference: from,
          source: valueSource("from")
        },
        {
          kind: "pipe",
          steps: parsed.pipeline.map((step) => ({
            type: "transform",
            name: step.name,
            arguments: step.arguments ?? [],
            source: valueSource("using")
          })),
          source: valueSource("using")
        }
      ],
      source
    });
  }
  return directives;
};

const includesFrom = (lines, uri, starts, excludedLines) => {
  const includes = [];
  for (const [index, line] of lines.entries()) {
    if (excludedLines.has(index)) continue;
    const match = /^[ \t]*include::([^\[]+)\[([^\]]*)\][ \t]*$/
      .exec(line.value);
    if (!match) continue;
    includes.push({
      target: match[1],
      attributes: match[2],
      source: rangeAt(uri, starts, line.start, line.end)
    });
  }
  return includes;
};

const configuredDocumentFrom = (lines) => {
  for (const line of lines.slice(0, 100)) {
    const match = /^:(?:ravel|lp)-document:[ \t]*(\S+)[ \t]*$/
      .exec(line.value);
    if (match) return match[1];
  }
  return null;
};

export const asciidocToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.adoc";
  const starts = lineStarts(text);
  const lines = linesOf(text);
  const documentId = options.document ??
    configuredDocumentFrom(lines) ??
    defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error(
      "AsciiDoc document identity must be a lowercase identifier: " +
      String(documentId)
    );
  }

  const diagnostics = [];
  const blocks = scanDelimitedBlocks(text, lines, uri, starts, diagnostics);
  const excludedLines = new Set();
  for (const block of blocks) {
    if (block.marker !== "----" && block.marker !== "....") continue;
    const end = block.closeIndex ?? lines.length;
    for (let index = block.openIndex + 1; index < end; index += 1) {
      excludedLines.add(index);
    }
  }
  const headings = headingCandidates(
    lines,
    uri,
    starts,
    excludedLines,
    options,
    diagnostics
  );
  const candidates = [...headings];
  const pieceContainers = new Map();

  for (const block of blocks) {
    if (block.marker !== "====" || !isPieceMetadata(block.metadata)) continue;
    const candidate = blockCandidate(block, options, diagnostics);
    if (!candidate) continue;
    candidates.push(candidate);
    pieceContainers.set(block, candidate);
  }

  const sourceBlocks = blocks.filter((block) =>
    block.marker === "----" || block.marker === "...."
  );
  for (const block of sourceBlocks) {
    let owner = null;
    if (isPieceMetadata(block.metadata)) {
      owner = blockCandidate(block, options, diagnostics);
      if (owner) candidates.push(owner);
    }
    if (!owner) {
      let parent = block.parent;
      while (parent && !pieceContainers.has(parent)) parent = parent.parent;
      owner = parent ? pieceContainers.get(parent) : null;
    }
    if (!owner) {
      owner = headings
        .filter((candidate) => candidate.headingIndex < block.openIndex)
        .at(-1) ?? null;
    }
    if (!owner) continue;
    owner.fragments.push({
      body: block.body,
      source: block.bodySource,
      language: blockLanguage(block.metadata),
      declaration: block.declaration,
      metadata: block.metadata
    });
  }

  candidates.sort((left, right) => left.order - right.order);
  const aliases = {};
  const chunks = [];
  const chunksById = new Map();
  const labelToPiece = new Map();
  const labelOwners = new Map();
  const surface = {
    definitions: [],
    references: [],
    directives: [],
    navigation: [],
    includes: includesFrom(lines, uri, starts, excludedLines)
  };

  for (const candidate of candidates) {
    const id = documentId + "::" + candidate.canonical;
    for (const alias of [
      candidate.authoredName,
      candidate.label,
      candidate.canonical
    ].filter(Boolean)) {
      aliases[alias] = candidate.canonical;
    }
    if (candidate.label) {
      const prior = labelOwners.get(candidate.label);
      if (prior && prior !== id) {
        diagnostics.push(diagnostic(
          "LPA103",
          "AsciiDoc rendered labels must be unique: " + candidate.label + ".",
          candidate.declaration
        ));
      } else {
        labelOwners.set(candidate.label, id);
        labelToPiece.set(candidate.label, id);
      }
    }
    let chunk = chunksById.get(id);
    if (!chunk) {
      const languages = candidate.fragments
        .map((fragment) => fragment.language)
        .filter(Boolean);
      const language = languages.length &&
        languages.every((entry) => entry === languages[0])
        ? languages[0]
        : null;
      if (new Set(languages).size > 1) {
        diagnostics.push(diagnostic(
          "LPA113",
          "AsciiDoc piece fragments have conflicting source languages.",
          candidate.declaration
        ));
      }
      chunk = {
        id,
        identity: {
          document: documentId,
          chunk: candidate.canonical,
          minor: null,
          type: null
        },
        name: candidate.displayName,
        body: "",
        definitionPipeline: candidate.pipeline,
        metadata: {
          ...(language ? { language } : {}),
          tags: [],
          data: {
            ravel: {
              adapter: "asciidoc",
              displayName: candidate.displayName,
              ...(candidate.label
                ? { renderedAnchor: candidate.label }
                : {}),
              referenceSyntax: {
                noweb: false,
                underscore: true,
                aliases
              },
              ...(candidate.run ? { run: true } : {}),
              ...(candidate.run && candidate.provider
                ? { provider: candidate.provider }
                : {})
            },
            asciidoc: {
              form: candidate.form,
              label: candidate.label,
              roles: candidate.metadata.roles,
              attributes: candidate.metadata.attributes,
              fragments: []
            }
          }
        },
        source: candidate.fragments[0]?.source ?? candidate.declaration,
        fragments: [],
        _pipelineKey: pipelineKey(candidate.pipeline)
      };
      chunks.push(chunk);
      chunksById.set(id, chunk);
    } else {
      const key = pipelineKey(candidate.pipeline);
      if (candidate.pipeline.length && chunk.definitionPipeline.length &&
          key !== chunk._pipelineKey) {
        diagnostics.push(diagnostic(
          "LPA113",
          "Repeated AsciiDoc pieces have conflicting pipelines.",
          candidate.declaration
        ));
      } else if (candidate.pipeline.length &&
          !chunk.definitionPipeline.length) {
        chunk.definitionPipeline = candidate.pipeline;
        chunk._pipelineKey = key;
      }
    }

    const fragmentRanges = [];
    for (const fragment of candidate.fragments) {
      if (fragment.language && chunk.metadata.language &&
          fragment.language !== chunk.metadata.language) {
        diagnostics.push(diagnostic(
          "LPA113",
          "Repeated AsciiDoc piece fragments have conflicting source languages.",
          fragment.declaration
        ));
      } else if (fragment.language && !chunk.metadata.language) {
        chunk.metadata.language = fragment.language;
      }
      chunk.body += fragment.body;
      chunk.fragments.push({
        body: fragment.body,
        source: fragment.source
      });
      chunk.metadata.data.asciidoc.fragments.push({
        source: fragment.source,
        declaration: fragment.declaration,
        language: fragment.language,
        attributes: fragment.metadata.attributes
      });
      fragmentRanges.push(fragment.source);
      for (const reference of underscoreReferencesFrom(
        fragment.body,
        fragment.source
      )) {
        surface.references.push({
          ownerPieceId: id,
          ...reference
        });
      }
    }
    if (candidate.run) {
      chunk.metadata.data.ravel.run = true;
      if (candidate.provider) {
        chunk.metadata.data.ravel.provider = candidate.provider;
      }
    }
    surface.definitions.push({
      pieceId: id,
      declaration: candidate.declaration,
      fragments: fragmentRanges,
      displayName: candidate.displayName,
      ...(candidate.label
        ? {
            sourceAnchor: candidate.label,
            renderedAnchor: candidate.label
          }
        : {}),
      ...(candidate.pipelineSource
        ? { pipeline: candidate.pipelineSource }
        : {})
    });
  }

  const directives = directivesFrom(
    lines,
    documentId,
    uri,
    starts,
    excludedLines,
    diagnostics
  );
  surface.directives = [...directives];
  surface.navigation = navigationFrom(
    text,
    sourceBlocks.map((block) => ({
      start: block.bodySource.range.start.offset,
      end: block.bodySource.range.end.offset
    })),
    labelToPiece,
    uri,
    starts
  );

  return {
    map: {
      version: 1,
      document: {
        id: documentId,
        uri,
        format: "asciidoc+ravel-v1"
      },
      chunks: chunks.map(({ _pipelineKey, ...chunk }) => chunk),
      directives,
      metadata: {
        adapter: "asciidoc",
        crossReferences: surface.navigation,
        includes: surface.includes
      }
    },
    diagnostics,
    surface
  };
};
