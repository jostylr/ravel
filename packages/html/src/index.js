import { characterEntities } from "character-entities";
import { parse } from "parse5";
import { parseDefinitionPipeline } from "@pieceful/ravel-core";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const pieceTags = new Set(["section", "figure"]);

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

const locationRange = (location, uri, starts) => rangeAt(
  uri,
  starts,
  location?.startOffset ?? 0,
  location?.endOffset ?? location?.startOffset ?? 0
);

const defaultDocumentId = (uri) => {
  const base = uri.split(/[\\/]/).at(-1)
    ?.replace(/\.html?$/i, "") ?? "";
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

const attributesOf = (node) => Object.fromEntries(
  (node.attrs ?? []).map((attribute) => [attribute.name, attribute.value])
);

const attributeValue = (node, name) =>
  node?.attrs?.find((attribute) => attribute.name === name)?.value;

const ravelAttribute = (node, suffix) =>
  attributeValue(node, "data-ravel-" + suffix) ??
  attributeValue(node, "data-lp-" + suffix);

const attributeSource = (node, name, text, uri, starts) => {
  const location = node.sourceCodeLocation?.attrs?.[name];
  if (!location) return locationRange(node.sourceCodeLocation, uri, starts);
  const raw = text.slice(location.startOffset, location.endOffset);
  const equals = raw.indexOf("=");
  if (equals === -1) return locationRange(location, uri, starts);
  let start = equals + 1;
  while (/\s/.test(raw[start] ?? "")) start += 1;
  let end = raw.length;
  while (end > start && /\s/.test(raw[end - 1])) end -= 1;
  if ((raw[start] === "\"" || raw[start] === "'") &&
      raw[end - 1] === raw[start]) {
    start += 1;
    end -= 1;
  }
  return rangeAt(
    uri,
    starts,
    location.startOffset + start,
    location.startOffset + end
  );
};

const ravelAttributeSource = (node, suffix, text, uri, starts) => {
  const canonical = "data-ravel-" + suffix;
  return attributeValue(node, canonical) !== undefined
    ? attributeSource(node, canonical, text, uri, starts)
    : attributeSource(node, "data-lp-" + suffix, text, uri, starts);
};

const childNodesOf = (node) =>
  node.tagName === "template" ? [] : node.childNodes ?? [];

const walk = (node, visit) => {
  visit(node);
  for (const child of childNodesOf(node)) walk(child, visit);
};

const descendants = (node, predicate, stop = () => false) => {
  const result = [];
  const visit = (current) => {
    for (const child of childNodesOf(current)) {
      if (stop(child)) continue;
      if (predicate(child)) result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
};

const normalizedText = (node, excludedTags = new Set()) => {
  let value = "";
  const collect = (current) => {
    if (current.nodeName === "#text") {
      value += current.value;
      return;
    }
    if (excludedTags.has(current.tagName)) return;
    for (const child of childNodesOf(current)) collect(child);
  };
  collect(node);
  return value.replace(/\s+/g, " ").trim();
};

const mergeSegment = (segments, next) => {
  const prior = segments.at(-1);
  if (prior &&
      prior.precision === next.precision &&
      prior.source.range.end.offset === next.source.range.start.offset) {
    prior.body += next.body;
    prior.source.range.end = next.source.range.end;
    return;
  }
  segments.push(next);
};

const namedEntityAt = (raw, rawIndex, decoded, decodedIndex) => {
  const match = /^&([A-Za-z0-9]+)/.exec(raw.slice(rawIndex));
  if (!match) return null;
  for (let length = match[1].length; length > 0; length -= 1) {
    const name = match[1].slice(0, length);
    const value = characterEntities[name];
    if (value === undefined || !decoded.startsWith(value, decodedIndex)) {
      continue;
    }
    const semicolon = raw[rawIndex + 1 + length] === ";" ? 1 : 0;
    return {
      rawLength: 1 + length + semicolon,
      value
    };
  }
  return null;
};

const entityAt = (raw, rawIndex, decoded, decodedIndex) => {
  const numeric = /^&#(?:[xX][0-9A-Fa-f]+|[0-9]+);?/
    .exec(raw.slice(rawIndex));
  if (numeric) {
    const codePoint = decoded.codePointAt(decodedIndex);
    const value = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
    return value
      ? { rawLength: numeric[0].length, value }
      : null;
  }
  return namedEntityAt(raw, rawIndex, decoded, decodedIndex);
};

const fallbackBoundary = (raw, rawIndex, decoded, decodedIndex) => {
  const limit = 64;
  for (let distance = 2; distance <= limit; distance += 1) {
    for (let rawDistance = 1; rawDistance < distance; rawDistance += 1) {
      const decodedDistance = distance - rawDistance;
      const rawAnchor = raw.slice(
        rawIndex + rawDistance,
        rawIndex + rawDistance + 4
      );
      if (rawAnchor.length &&
          decoded.slice(
            decodedIndex + decodedDistance,
            decodedIndex + decodedDistance + rawAnchor.length
          ) === rawAnchor) {
        return {
          rawEnd: rawIndex + rawDistance,
          decodedEnd: decodedIndex + decodedDistance
        };
      }
    }
  }
  return { rawEnd: raw.length, decodedEnd: decoded.length };
};

const decodedTextSegments = (node, text, uri, starts) => {
  const location = node.sourceCodeLocation;
  if (!location) return [];
  const raw = text.slice(location.startOffset, location.endOffset);
  const decoded = node.value;
  const segments = [];
  let rawIndex = 0;
  let decodedIndex = 0;
  const append = (rawEnd, decodedEnd, precision) => {
    mergeSegment(segments, {
      body: decoded.slice(decodedIndex, decodedEnd),
      source: rangeAt(
        uri,
        starts,
        location.startOffset + rawIndex,
        location.startOffset + rawEnd
      ),
      precision
    });
    rawIndex = rawEnd;
    decodedIndex = decodedEnd;
  };

  while (rawIndex < raw.length || decodedIndex < decoded.length) {
    if (raw[rawIndex] === "&") {
      const entity = entityAt(raw, rawIndex, decoded, decodedIndex);
      if (entity) {
        append(
          rawIndex + entity.rawLength,
          decodedIndex + entity.value.length,
          "coarse"
        );
        continue;
      }
    }
    if (raw[rawIndex] === decoded[decodedIndex]) {
      let end = rawIndex + 1;
      while (end < raw.length &&
          raw[end] !== "&" &&
          raw[end] !== "\r" &&
          raw[end] === decoded[decodedIndex + end - rawIndex]) {
        end += 1;
      }
      append(end, decodedIndex + end - rawIndex, "exact");
      continue;
    }
    if (raw.startsWith("\r\n", rawIndex) &&
        decoded[decodedIndex] === "\n") {
      append(rawIndex + 2, decodedIndex + 1, "coarse");
      continue;
    }
    if (raw[rawIndex] === "\r" && decoded[decodedIndex] === "\n") {
      append(rawIndex + 1, decodedIndex + 1, "coarse");
      continue;
    }
    const boundary = fallbackBoundary(
      raw,
      rawIndex,
      decoded,
      decodedIndex
    );
    append(boundary.rawEnd, boundary.decodedEnd, "coarse");
  }
  return segments;
};

const segmentsForCode = (node, text, uri, starts) => {
  const textNodes = descendants(node, (child) => child.nodeName === "#text");
  const segments = textNodes.flatMap((child) =>
    decodedTextSegments(child, text, uri, starts)
  );
  if (segments.length) return segments;
  const start = node.sourceCodeLocation?.startTag?.endOffset ??
    node.sourceCodeLocation?.startOffset ?? 0;
  const end = node.sourceCodeLocation?.endTag?.startOffset ?? start;
  return [{
    body: "",
    source: rangeAt(uri, starts, start, end),
    precision: "exact"
  }];
};

const languageFrom = (code, candidate) => {
  const explicit = ravelAttribute(code, "language") ??
    ravelAttribute(candidate.node, "language");
  if (explicit) return explicit;
  const classes = (attributeValue(code, "class") ?? "").split(/\s+/);
  return classes.find((entry) => entry.startsWith("language-"))
    ?.slice("language-".length) || null;
};

const runSelected = (options, names) =>
  options.run === true ||
  (Array.isArray(options.run) &&
    names.some((name) => options.run.includes(name)));

const truthyAttribute = (value) =>
  value === "" || /^(?:1|yes|true|on)$/i.test(value ?? "");

const virtualRangeSource = (segments, start, end) => {
  const overlapping = segments.filter((segment) =>
    start < segment.generated.end && end > segment.generated.start
  );
  if (!overlapping.length) return null;
  return {
    uri: overlapping[0].source.uri,
    range: {
      start: overlapping[0].source.range.start,
      end: overlapping.at(-1).source.range.end
    }
  };
};

const underscoreReferencesFrom = (body, segments) => {
  const references = [];
  const pattern = /(?:\\[1-9][0-9]*)?_(["'`])([\s\S]*?)\1/g;
  for (const match of body.matchAll(pattern)) {
    const prefix = match[0].indexOf("_");
    const start = match.index + prefix;
    const source = virtualRangeSource(
      segments,
      start,
      match.index + match[0].length
    );
    if (source) references.push({ targetText: match[2], source });
  }
  return references;
};

const directiveFrom = (
  node,
  document,
  text,
  uri,
  starts,
  diagnostics
) => {
  const effect = ravelAttribute(node, "effect");
  if (!effect) return null;
  const source = locationRange(node.sourceCodeLocation, uri, starts);
  const target = ravelAttribute(node, "target") ??
    attributeValue(node, "href") ??
    attributeValue(node, "value");
  const from = ravelAttribute(node, "from");
  if (effect === "write") {
    if (!target || !from) {
      diagnostics.push(diagnostic(
        "LPH101",
        "HTML write links require a target and data-ravel-from.",
        source
      ));
      return null;
    }
    return {
      kind: "out",
      name: target,
      from: from.includes("::") ? from : document + "::" + from,
      source
    };
  }
  if (effect === "read") {
    if (!target) {
      diagnostics.push(diagnostic(
        "LPH101",
        "HTML read links require an href or data-ravel-target.",
        source
      ));
      return null;
    }
    const alias = ravelAttribute(node, "as");
    return {
      kind: "in",
      target,
      source,
      metadata: {
        adapter: "html",
        ...(alias ? { legacy: { alias } } : {})
      }
    };
  }
  if (effect === "derive") {
    const using = ravelAttribute(node, "using") ??
      ravelAttribute(node, "pipe");
    if (!target || !from || !using) {
      diagnostics.push(diagnostic(
        "LPH101",
        "HTML derive elements require target, data-ravel-from, and data-ravel-using.",
        source
      ));
      return null;
    }
    const usingSource = ravelAttributeSource(
      node,
      ravelAttribute(node, "using") !== undefined ? "using" : "pipe",
      text,
      uri,
      starts
    );
    const parsed = parseDefinitionPipeline(using, usingSource);
    diagnostics.push(...parsed.diagnostics);
    return {
      kind: "create",
      document,
      name: target,
      compose: [
        {
          kind: "append",
          reference: from,
          source: ravelAttributeSource(node, "from", text, uri, starts)
        },
        {
          kind: "pipe",
          steps: parsed.pipeline.map((step) => ({
            type: "transform",
            name: step.name,
            arguments: step.arguments ?? [],
            source: usingSource
          })),
          source: usingSource
        }
      ],
      source
    };
  }
  diagnostics.push(diagnostic(
    "LPH101",
    "Unknown HTML Ravel effect: " + effect + ".",
    source
  ));
  return null;
};

export const htmlToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.html";
  const starts = lineStarts(text);
  const diagnostics = [];
  const parseErrors = [];
  const documentNode = parse(text, {
    scriptingEnabled: false,
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error)
  });
  for (const error of parseErrors) {
    if (error.code === "missing-doctype") continue;
    diagnostics.push(diagnostic(
      "LPH110",
      "HTML parse error: " + error.code + ".",
      rangeAt(
        uri,
        starts,
        error.startOffset ?? 0,
        error.endOffset ?? error.startOffset ?? 0
      ),
      "warning"
    ));
  }

  const nodes = [];
  walk(documentNode, (node) => nodes.push(node));
  const configuredDocument = nodes
    .filter((node) => node.tagName === "meta")
    .find((node) => ["ravel-document", "lp-document"].includes(
      attributeValue(node, "name")
    ));
  const documentId = options.document ??
    attributeValue(configuredDocument, "content") ??
    defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error(
      "HTML document identity must be a lowercase identifier: " +
      String(documentId)
    );
  }

  const ids = new Map();
  for (const node of nodes) {
    const id = attributeValue(node, "id");
    if (!id || !node.sourceCodeLocation) continue;
    if (ids.has(id)) {
      diagnostics.push(diagnostic(
        "LPH103",
        "HTML element IDs must be unique: " + id + ".",
        attributeSource(node, "id", text, uri, starts)
      ));
    } else {
      ids.set(id, node);
    }
  }

  const candidateNodes = nodes.filter((node) =>
    pieceTags.has(node.tagName) &&
    ravelAttribute(node, "piece") !== undefined &&
    node.sourceCodeLocation
  );
  const candidates = [];
  const candidateByNode = new Map();
  for (const node of candidateNodes) {
    const declaration = locationRange(node.sourceCodeLocation, uri, starts);
    const authored = ravelAttribute(node, "piece");
    const split = splitNamePipeline(authored);
    const explicitPipeline = ravelAttribute(node, "pipe");
    if (split.pipe !== null && explicitPipeline !== undefined &&
        split.pipe !== explicitPipeline) {
      diagnostics.push(diagnostic(
        "LPH113",
        "HTML piece name and data-ravel-pipe declare conflicting pipelines.",
        declaration
      ));
    }
    const canonical = semanticComponent(split.name);
    if (!canonical) {
      diagnostics.push(diagnostic(
        "LPH101",
        "HTML data-ravel-piece does not produce a usable Ravel ID.",
        declaration
      ));
      continue;
    }
    const titleTag = node.tagName === "figure"
      ? "figcaption"
      : /^(?:h[1-6])$/;
    const titleNode = descendants(
      node,
      (child) => typeof titleTag === "string"
        ? child.tagName === titleTag
        : titleTag.test(child.tagName ?? ""),
      (child) => candidateNodes.includes(child)
    )[0];
    const displayName = titleNode
      ? normalizedText(titleNode, new Set(["code"]))
      : "";
    if (!displayName) {
      diagnostics.push(diagnostic(
        "LPH102",
        "HTML pieces should have a visible heading or figcaption.",
        declaration,
        "warning"
      ));
    }
    const pipelineText = explicitPipeline ?? split.pipe;
    const pipelineSource = explicitPipeline !== undefined
      ? ravelAttributeSource(node, "pipe", text, uri, starts)
      : (() => {
          const pieceSource = ravelAttributeSource(
            node,
            "piece",
            text,
            uri,
            starts
          );
          const afterPipe = authored.slice(split.pipeIndex + 1);
          const whitespace = afterPipe.search(/\S|$/);
          const start = pieceSource.range.start.offset +
            split.pipeIndex + 1 + whitespace;
          return rangeAt(
            uri,
            starts,
            start,
            start + (split.pipe?.length ?? 0)
          );
        })();
    const parsed = pipelineText
      ? parseDefinitionPipeline(pipelineText, pipelineSource)
      : { pipeline: [], diagnostics: [] };
    diagnostics.push(...parsed.diagnostics);
    const label = attributeValue(node, "id") ?? null;
    const requestedRun = runSelected(
      options,
      [split.name, canonical, label].filter(Boolean)
    ) || truthyAttribute(ravelAttribute(node, "run"));
    const candidate = {
      node,
      authoredName: split.name,
      canonical,
      displayName: displayName || split.name,
      label,
      pipeline: parsed.pipeline,
      pipelineSource: pipelineText ? pipelineSource : null,
      declaration,
      fragments: [],
      codeBlocks: [],
      run: requestedRun,
      provider: ravelAttribute(node, "provider") ?? options.provider ?? null,
      order: node.sourceCodeLocation.startOffset
    };
    candidates.push(candidate);
    candidateByNode.set(node, candidate);
  }

  const nearestCandidate = (node) => {
    let current = node.parentNode;
    while (current) {
      if (candidateByNode.has(current)) return candidateByNode.get(current);
      current = current.parentNode;
    }
    return null;
  };
  for (const code of nodes.filter((node) =>
    node.tagName === "code" && node.parentNode?.tagName === "pre"
  )) {
    const owner = nearestCandidate(code);
    if (!owner) continue;
    const language = languageFrom(code, owner);
    const segments = segmentsForCode(code, text, uri, starts);
    const body = segments.map((segment) => segment.body).join("");
    const generated = [];
    let cursor = 0;
    for (const segment of segments) {
      generated.push({
        ...segment,
        generated: {
          start: cursor,
          end: cursor + segment.body.length
        }
      });
      cursor += segment.body.length;
    }
    const broadSource = rangeAt(
      uri,
      starts,
      code.sourceCodeLocation?.startTag?.endOffset ??
        code.sourceCodeLocation.startOffset,
      code.sourceCodeLocation?.endTag?.startOffset ??
        code.sourceCodeLocation.endOffset
    );
    owner.fragments.push(...generated.map((segment) => ({
      body: segment.body,
      source: segment.source,
      precision: segment.precision
    })));
    owner.codeBlocks.push({
      body,
      language,
      source: broadSource,
      declaration: locationRange(code.sourceCodeLocation, uri, starts),
      segments: generated
    });
  }

  candidates.sort((left, right) => left.order - right.order);
  const aliases = {};
  const chunks = [];
  const definitions = [];
  const references = [];
  const semanticOwners = new Map();
  const labelToPiece = new Map();
  for (const candidate of candidates) {
    const id = documentId + "::" + candidate.canonical;
    if (semanticOwners.has(id)) {
      diagnostics.push(diagnostic(
        "LPH103",
        "HTML semantic piece IDs must be unique: " + id + ".",
        candidate.declaration
      ));
      continue;
    }
    semanticOwners.set(id, candidate);
    if (candidate.label && !labelToPiece.has(candidate.label)) {
      labelToPiece.set(candidate.label, id);
    }
    for (const alias of [
      candidate.authoredName,
      candidate.canonical,
      candidate.label
    ].filter(Boolean)) {
      aliases[alias] = candidate.canonical;
    }
    const languages = candidate.codeBlocks
      .map((block) => block.language)
      .filter(Boolean);
    const language = languages.length &&
      languages.every((entry) => entry === languages[0])
      ? languages[0]
      : null;
    if (new Set(languages).size > 1) {
      diagnostics.push(diagnostic(
        "LPH113",
        "HTML piece fragments have conflicting source languages.",
        candidate.declaration
      ));
    }
    const body = candidate.fragments.map((fragment) => fragment.body).join("");
    const chunkSegments = [];
    let bodyOffset = 0;
    for (const fragment of candidate.fragments) {
      chunkSegments.push({
        ...fragment,
        generated: {
          start: bodyOffset,
          end: bodyOffset + fragment.body.length
        }
      });
      bodyOffset += fragment.body.length;
    }
    for (const reference of underscoreReferencesFrom(body, chunkSegments)) {
      references.push({ ownerPieceId: id, ...reference });
    }
    const chunk = {
      id,
      identity: {
        document: documentId,
        chunk: candidate.canonical,
        minor: null,
        type: null
      },
      name: candidate.displayName,
      body,
      definitionPipeline: candidate.pipeline,
      metadata: {
        ...(language ? { language } : {}),
        tags: [],
        data: {
          ravel: {
            adapter: "html",
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
          html: {
            element: candidate.node.tagName,
            label: candidate.label,
            attributes: attributesOf(candidate.node),
            fragments: candidate.codeBlocks.map((block) => ({
              source: block.source,
              declaration: block.declaration,
              language: block.language,
              entities: block.segments
                .filter((segment) => segment.precision === "coarse")
                .map((segment) => ({
                  generated: segment.generated,
                  source: segment.source,
                  value: segment.body
                }))
            }))
          }
        }
      },
      source: candidate.fragments[0]?.source ?? candidate.declaration,
      fragments: candidate.fragments
    };
    chunks.push(chunk);
    definitions.push({
      pieceId: id,
      declaration: candidate.declaration,
      fragments: candidate.codeBlocks.map((block) => block.source),
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

  const directives = nodes
    .filter((node) =>
      (node.tagName === "a" || node.tagName === "data") &&
      ravelAttribute(node, "effect") !== undefined
    )
    .map((node) => directiveFrom(
      node,
      documentId,
      text,
      uri,
      starts,
      diagnostics
    ))
    .filter(Boolean);
  const navigation = nodes
    .filter((node) =>
      node.tagName === "a" &&
      attributeValue(node, "href")?.startsWith("#") &&
      ravelAttribute(node, "effect") === undefined
    )
    .map((node) => {
      const targetLabel = attributeValue(node, "href").slice(1);
      const targetPieceId = labelToPiece.get(targetLabel);
      return targetPieceId
        ? {
            targetPieceId,
            targetLabel,
            syntax: "anchor",
            source: locationRange(node.sourceCodeLocation, uri, starts)
          }
        : null;
    })
    .filter(Boolean);
  const entities = chunks.flatMap((chunk) =>
    chunk.metadata.data.html.fragments.flatMap((fragment) =>
      fragment.entities.map((entity) => ({
        pieceId: chunk.id,
        ...entity
      }))
    )
  );

  return {
    map: {
      version: 1,
      document: {
        id: documentId,
        uri,
        format: "html+ravel-v1"
      },
      chunks,
      directives,
      metadata: {
        adapter: "html",
        crossReferences: navigation,
        sourceBoundary: "authored-html"
      }
    },
    diagnostics,
    surface: {
      definitions,
      references,
      directives: [...directives],
      navigation,
      entities
    }
  };
};
