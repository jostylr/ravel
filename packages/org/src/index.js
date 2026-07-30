import { parseDefinitionPipeline } from "@pieceful/ravel-core";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const referencePolicies = new Set(["org-noweb", "underscore-quote", "both"]);
const executionOwners = new Set(["org", "ravel"]);

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
    lines.push({ start, end, contentEnd, value: text.slice(start, contentEnd) });
    start = end;
  }
  return lines;
};

const defaultDocumentId = (uri) => {
  const base = uri.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return componentPattern.test(id) ? id : null;
};

const semanticComponent = (value) => {
  const normalized = value.trim().toLowerCase()
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

const splitNamePipeline = (value, extended = true) => {
  const pipeIndex = extended ? firstUnescapedPipe(value) : -1;
  return {
    name: (pipeIndex === -1 ? value : value.slice(0, pipeIndex)).trim().replace(/\\\|/g, "|"),
    pipe: pipeIndex === -1 ? null : value.slice(pipeIndex + 1).trim(),
    pipeIndex
  };
};

const tokensFrom = (text, baseOffset = 0) => {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    while (/\s/.test(text[index] ?? "")) index += 1;
    if (index >= text.length) break;
    const start = index;
    let quote = "";
    let escaped = false;
    let depth = 0;
    while (index < text.length) {
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
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && /\s/.test(character)) {
        break;
      }
      index += 1;
    }
    tokens.push({ value: text.slice(start, index), start: baseOffset + start, end: baseOffset + index });
  }
  return tokens;
};

const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 &&
      ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
       (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const headerArgumentsFrom = (text, source, origin) => {
  const tokens = tokensFrom(text);
  const argumentsFound = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!/^:[A-Za-z][A-Za-z0-9_-]*$/.test(token.value)) continue;
    let next = index + 1;
    while (next < tokens.length && !/^:[A-Za-z][A-Za-z0-9_-]*$/.test(tokens[next].value)) next += 1;
    const valueStart = index + 1 < next ? tokens[index + 1].start : token.end;
    const valueEnd = index + 1 < next ? tokens[next - 1].end : token.end;
    const rawValue = text.slice(valueStart, valueEnd).trim();
    argumentsFound.push({
      name: token.value.slice(1).toLowerCase(),
      value: unquote(rawValue),
      rawValue,
      origin,
      source: advanceRange(source, text, token.start, valueEnd)
    });
    index = next - 1;
  }
  return argumentsFound;
};

const headerValue = (argumentsFound, name) =>
  argumentsFound.findLast((argument) => argument.name === name)?.value;

const keywordFrom = (line) => {
  const match = /^([ \t]*)#\+([A-Za-z][A-Za-z0-9_-]*)(?:\[([^\]]*)\])?:[ \t]*(.*)$/.exec(line.value);
  if (!match) return null;
  return {
    key: match[2].toUpperCase(),
    option: match[3] ?? null,
    value: match[4],
    valueStart: line.start + match[0].length - match[4].length
  };
};

const pipelineKey = (pipeline) =>
  JSON.stringify(pipeline.map(({ name, arguments: argumentsValue }) => [name, argumentsValue ?? []]));

const referencesFrom = (body, source, extended) => {
  const references = [];
  let index = 0;
  while (index < body.length) {
    const start = body.indexOf("<<", index);
    if (start === -1) break;
    const end = body.indexOf(">>", start + 2);
    if (end === -1) break;
    const authored = body.slice(start + 2, end);
    const split = splitNamePipeline(authored, extended);
    references.push({
      authored,
      name: split.name,
      pipe: split.pipe,
      pipeIndex: split.pipeIndex,
      source: advanceRange(source, body, start, end + 2)
    });
    index = end + 2;
  }
  return references;
};

const underscoreReferencesFrom = (body, source) => {
  const references = [];
  const pattern = /(?:\\[1-9][0-9]*)?_(["'`])([\s\S]*?)\1/g;
  for (const match of body.matchAll(pattern)) {
    const prefix = match[0].indexOf("_");
    references.push({
      targetText: match[2],
      source: advanceRange(source, body, match.index + prefix, match.index + match[0].length)
    });
  }
  return references;
};

const scanFileProperties = (lines, uri, starts) => {
  const properties = [];
  for (const line of lines) {
    const keyword = keywordFrom(line);
    if (keyword?.key !== "PROPERTY") continue;
    const match = /^(\S+)[ \t]*(.*)$/.exec(keyword.value);
    if (!match) continue;
    properties.push({
      name: match[1].toLowerCase(),
      value: match[2],
      source: rangeAt(uri, starts, line.start, line.end),
      valueSource: rangeAt(
        uri,
        starts,
        keyword.valueStart + keyword.value.indexOf(match[2]),
        keyword.valueStart + keyword.value.length
      )
    });
  }
  return properties;
};

const propertyValue = (properties, name) =>
  properties.findLast((property) => property.name === name)?.value;

const propertyHeaders = (properties, language) => {
  const found = [];
  for (const property of properties) {
    const name = property.name.replace(/\+$/, "");
    if (name !== "header-args" && name !== "header-args:" + language.toLowerCase()) continue;
    found.push(...headerArgumentsFrom(property.value, property.valueSource, "file-property"));
  }
  return found;
};

const resultAfter = (lines, startIndex, text, uri, starts) => {
  let index = startIndex;
  while (index < lines.length && lines[index].value.trim() === "") index += 1;
  const line = lines[index];
  if (!line) return null;
  const keyword = keywordFrom(line);
  if (keyword?.key !== "RESULTS") return null;
  let endIndex = index + 1;
  const wrapped = /^[ \t]*#\+BEGIN_([A-Za-z][A-Za-z0-9_-]*)\b/i.exec(lines[endIndex]?.value ?? "");
  const drawer = /^[ \t]*:RESULTS:[ \t]*$/i.test(lines[endIndex]?.value ?? "");
  if (wrapped) {
    endIndex += 1;
    while (endIndex < lines.length &&
        !new RegExp("^[ \t]*#\\+END_" + wrapped[1] + "[ \t]*$", "i").test(lines[endIndex].value)) {
      endIndex += 1;
    }
    if (endIndex < lines.length) endIndex += 1;
  } else if (drawer) {
    endIndex += 1;
    while (endIndex < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[endIndex].value)) endIndex += 1;
    if (endIndex < lines.length) endIndex += 1;
  } else {
    while (endIndex < lines.length) {
      const value = lines[endIndex].value;
      if (value.trim() === "" || /^\*+\s/.test(value) || /^#\+(?:NAME|LP_NAME):/i.test(value)) break;
      endIndex += 1;
    }
  }
  const end = endIndex === index + 1 ? line.end : lines[endIndex - 1].end;
  return {
    name: keyword.value || null,
    hash: keyword.option,
    text: text.slice(line.end, end),
    source: rangeAt(uri, starts, line.start, end),
    declaration: rangeAt(uri, starts, line.start, line.end),
    _nextIndex: endIndex
  };
};

const scanBlocks = (text, uri, starts, fileProperties) => {
  const lines = linesOf(text);
  const blocks = [];
  const ignored = [];
  const headingStack = [];
  let commentBlockDepth = 0;
  let literalBlockDepth = 0;
  let commentSubtreeLevel = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(\*+)[ \t]+(.*)$/.exec(line.value);
    if (heading) {
      const level = heading[1].length;
      headingStack.length = Math.min(headingStack.length, level - 1);
      const entry = {
        level,
        title: heading[2],
        source: rangeAt(uri, starts, line.start, line.end),
        headers: []
      };
      headingStack.push(entry);
      if (commentSubtreeLevel !== null && level <= commentSubtreeLevel) commentSubtreeLevel = null;
      if (/^COMMENT(?:[ \t]|$)/.test(heading[2])) commentSubtreeLevel = level;
      continue;
    }

    if (/^[ \t]*#\+BEGIN_COMMENT(?:[ \t]|$)/i.test(line.value)) {
      commentBlockDepth += 1;
      continue;
    }
    if (/^[ \t]*#\+END_COMMENT[ \t]*$/i.test(line.value)) {
      commentBlockDepth = Math.max(0, commentBlockDepth - 1);
      continue;
    }
    if (/^[ \t]*#\+BEGIN_(?:EXAMPLE|EXPORT)(?:[ \t]|$)/i.test(line.value)) {
      literalBlockDepth += 1;
      continue;
    }
    if (/^[ \t]*#\+END_(?:EXAMPLE|EXPORT)[ \t]*$/i.test(line.value)) {
      literalBlockDepth = Math.max(0, literalBlockDepth - 1);
      continue;
    }

    if (/^[ \t]*:PROPERTIES:[ \t]*$/i.test(line.value) && headingStack.length) {
      const headingEntry = headingStack.at(-1);
      for (let propertyIndex = index + 1; propertyIndex < lines.length; propertyIndex += 1) {
        const propertyLine = lines[propertyIndex];
        if (/^[ \t]*:END:[ \t]*$/i.test(propertyLine.value)) {
          index = propertyIndex;
          break;
        }
        const property = /^[ \t]*:(header-args(?::[^: \t]+)?):[ \t]*(.*)$/i.exec(propertyLine.value);
        if (!property) continue;
        const valueOffset = propertyLine.value.lastIndexOf(property[2]);
        headingEntry.headers.push({
          language: property[1].includes(":") ? property[1].split(":")[1].toLowerCase() : null,
          arguments: headerArgumentsFrom(
            property[2],
            rangeAt(
              uri,
              starts,
              propertyLine.start + valueOffset,
              propertyLine.start + valueOffset + property[2].length
            ),
            "subtree-property"
          )
        });
      }
      continue;
    }

    const begin = /^([ \t]*)#\+BEGIN_SRC(?:[ \t]+(.*))?[ \t]*$/i.exec(line.value);
    if (!begin) continue;
    let endIndex = index + 1;
    while (endIndex < lines.length && !/^[ \t]*#\+END_SRC[ \t]*$/i.test(lines[endIndex].value)) endIndex += 1;
    const endLine = lines[endIndex] ?? null;
    const bodyEnd = endLine?.start ?? text.length;

    let affiliateIndex = index - 1;
    const affiliations = [];
    while (affiliateIndex >= 0 && lines[affiliateIndex].value.trim() !== "") {
      const keyword = keywordFrom(lines[affiliateIndex]);
      if (!keyword || !["NAME", "LP_NAME", "LP_PIPE", "HEADER", "HEADERS", "CAPTION"].includes(keyword.key)) break;
      affiliations.unshift({
        ...keyword,
        source: rangeAt(uri, starts, lines[affiliateIndex].start, lines[affiliateIndex].end),
        valueSource: rangeAt(uri, starts, keyword.valueStart, lines[affiliateIndex].contentEnd),
        line: lines[affiliateIndex]
      });
      affiliateIndex -= 1;
    }
    const declarationStart = affiliations[0]?.line.start ?? line.start;
    const beginData = begin[2] ?? "";
    const beginSource = rangeAt(uri, starts, line.start, line.end);
    const beginTokens = tokensFrom(beginData);
    const language = beginTokens[0]?.value ?? "";
    const afterLanguage = beginTokens[0] ? beginData.slice(beginTokens[0].end) : "";
    const headerStart = /(?:^|\s):[A-Za-z][A-Za-z0-9_-]*/.exec(afterLanguage);
    const switches = (headerStart ? afterLanguage.slice(0, headerStart.index) : afterLanguage).trim();
    const beginHeadersText = headerStart ? afterLanguage.slice(headerStart.index).trimStart() : "";
    const beginHeadersOffset = beginHeadersText
      ? line.value.lastIndexOf(beginHeadersText)
      : line.contentEnd - line.start;
    const beginHeadersSource = rangeAt(
      uri,
      starts,
      line.start + beginHeadersOffset,
      line.start + beginHeadersOffset + beginHeadersText.length
    );
    const inheritedHeaders = [
      ...propertyHeaders(fileProperties, language),
      ...headingStack.flatMap((entry) => entry.headers
        .filter((group) => group.language === null || group.language === language.toLowerCase())
        .flatMap((group) => group.arguments))
    ];
    const affiliateHeaders = affiliations
      .filter((entry) => entry.key === "HEADER" || entry.key === "HEADERS")
      .flatMap((entry) => headerArgumentsFrom(entry.value, entry.valueSource, "affiliated-header"));
    const localHeaders = headerArgumentsFrom(beginHeadersText, beginHeadersSource, "begin-src");
    const headerArguments = [...inheritedHeaders, ...affiliateHeaders, ...localHeaders];
    const headingContext = headingStack.length
      ? (({ headers, ...context }) => context)(headingStack.at(-1))
      : null;
    const block = {
      language,
      switches,
      headerArguments,
      affiliations,
      declaration: rangeAt(uri, starts, declarationStart, line.end),
      begin: beginSource,
      body: text.slice(line.end, bodyEnd),
      bodySource: rangeAt(uri, starts, line.end, bodyEnd),
      end: endLine ? rangeAt(uri, starts, endLine.start, endLine.end) : null,
      heading: headingContext,
      results: resultAfter(lines, endIndex + 1, text, uri, starts)
    };
    if (commentBlockDepth || commentSubtreeLevel !== null) ignored.push({ ...block, reason: "commented" });
    else if (literalBlockDepth) ignored.push({ ...block, reason: "literal-container" });
    else blocks.push(block);
    if (!endLine) break;
    index = Math.max(endIndex, block.results?._nextIndex ? block.results._nextIndex - 1 : endIndex);
  }
  return { blocks, ignored };
};

const runSelected = (options, names) =>
  options.run === true ||
  (Array.isArray(options.run) && names.some((name) => options.run.includes(name)));

const cleanResult = (result) => {
  if (!result) return null;
  const { _nextIndex, ...clean } = result;
  return clean;
};

export const orgToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.org";
  const starts = lineStarts(text);
  const lines = linesOf(text);
  const fileProperties = scanFileProperties(lines, uri, starts);
  const configuredReferences = options.references ??
    propertyValue(fileProperties, "ravel-reference-style") ??
    "org-noweb";
  const references = configuredReferences === "noweb" ? "org-noweb" : configuredReferences;
  if (!referencePolicies.has(references)) {
    throw new Error("Unknown Org reference policy: " + references);
  }
  const propertyPipes = propertyValue(fileProperties, "ravel-noweb-pipes");
  const nowebPipes = options.nowebPipes ?? /^(?:yes|true|on)$/i.test(propertyPipes ?? "");
  const propertyOwner = propertyValue(fileProperties, "ravel-execution-owner");
  const executionOwner = options.executionOwner ?? propertyOwner ?? null;
  if (executionOwner !== null && !executionOwners.has(executionOwner)) {
    throw new Error("Org execution owner must be org or ravel: " + executionOwner);
  }
  const documentId = options.document ?? defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error("Org document identity must be a lowercase identifier: " + String(documentId));
  }

  const diagnostics = [];
  if (options.executionOwner && propertyOwner && options.executionOwner !== propertyOwner) {
    const property = fileProperties.findLast((entry) => entry.name === "ravel-execution-owner");
    diagnostics.push(diagnostic(
      "LPA113",
      "Org configuration and ravel-execution-owner property select different owners.",
      property?.source ?? rangeAt(uri, starts, 0, 0)
    ));
  }
  const scanned = scanBlocks(text, uri, starts, fileProperties);
  const aliases = {};
  const canonicalByName = new Map();
  const ownerByCanonical = new Map();
  const individualDeclarations = new Map();

  const canonicalFor = (name, source) => {
    if (canonicalByName.has(name)) return canonicalByName.get(name);
    const base = semanticComponent(name);
    if (!base) {
      diagnostics.push(diagnostic("LPA101", "Org piece name does not produce a usable Ravel ID: " + name, source));
      return null;
    }
    let canonical = base;
    let suffix = 2;
    while (ownerByCanonical.has(canonical) && ownerByCanonical.get(canonical) !== name) {
      canonical = base + "-" + suffix;
      suffix += 1;
    }
    if (canonical !== base) {
      diagnostics.push(diagnostic(
        "LPA102",
        "Org names normalize to the same Ravel ID; " + name + " was assigned " + canonical + ".",
        source
      ));
    }
    canonicalByName.set(name, canonical);
    ownerByCanonical.set(canonical, name);
    aliases[name] = canonical;
    return canonical;
  };

  const pipelineFrom = (value, source) => {
    if (!value) return [];
    const parsed = parseDefinitionPipeline(value, source);
    diagnostics.push(...parsed.diagnostics);
    return parsed.pipeline;
  };

  for (const block of scanned.blocks) {
    const nameKeyword = block.affiliations.findLast((entry) => entry.key === "NAME");
    const lpNameKeyword = block.affiliations.findLast((entry) => entry.key === "LP_NAME");
    const lpPipeKeyword = block.affiliations.findLast((entry) => entry.key === "LP_PIPE");
    const lpName = lpNameKeyword ? splitNamePipeline(lpNameKeyword.value) : null;
    const nativeName = nameKeyword?.value.trim() || null;
    if (nativeName && lpName?.name && nativeName !== lpName.name) {
      diagnostics.push(diagnostic(
        "LPA113",
        "#+NAME and #+LP_NAME must identify the same Org source block.",
        block.declaration
      ));
    }
    const primaryName = lpName?.name || nativeName;
    const groupName = headerValue(block.headerArguments, "noweb-ref")?.trim() || null;
    const declarations = [];
    if (primaryName) declarations.push({ name: primaryName, kind: "name" });
    if (groupName && groupName !== primaryName) declarations.push({ name: groupName, kind: "noweb-ref" });
    block.declarations = declarations;
    block.references = referencesFrom(block.body, block.bodySource, nowebPipes);

    const compactPipelineSource = lpName?.pipe !== null && lpNameKeyword
      ? advanceRange(
          lpNameKeyword.valueSource,
          lpNameKeyword.value,
          lpName.pipeIndex + 1 + lpNameKeyword.value.slice(lpName.pipeIndex + 1).search(/\S|$/),
          lpNameKeyword.value.length
        )
      : null;
    const compactPipeline = pipelineFrom(lpName?.pipe, compactPipelineSource ?? block.declaration);
    const adjacentPipeline = pipelineFrom(lpPipeKeyword?.value, lpPipeKeyword?.valueSource ?? block.declaration);
    if (compactPipeline.length && adjacentPipeline.length &&
        pipelineKey(compactPipeline) !== pipelineKey(adjacentPipeline)) {
      diagnostics.push(diagnostic("LPA113", "#+LP_NAME and #+LP_PIPE declare conflicting pipelines.", block.declaration));
    }
    block.pipeline = compactPipeline.length ? compactPipeline : adjacentPipeline;
    block.pipelineSource = compactPipeline.length
      ? compactPipelineSource
      : lpPipeKeyword?.valueSource ?? null;

    for (const declaration of declarations) {
      declaration.canonical = canonicalFor(declaration.name, block.declaration);
      if (declaration.kind === "name") {
        if (individualDeclarations.has(declaration.name)) {
          diagnostics.push(diagnostic(
            "LPA102",
            "Org requires #+NAME and #+LP_NAME declarations to be unique: " + declaration.name,
            block.declaration
          ));
        } else {
          individualDeclarations.set(declaration.name, block.declaration);
        }
      }
    }
    for (const reference of block.references) {
      reference.canonical = canonicalFor(reference.name, reference.source);
      if (nowebPipes && reference.pipeIndex !== -1) {
        diagnostics.push(diagnostic(
          "LPA114",
          "Piped Org-noweb references are not interpreted as pipelines by unmodified Babel.",
          reference.source,
          "warning"
        ));
      }
    }
    if (!block.end) {
      diagnostics.push(diagnostic("LPA111", "Org source block is missing #+END_SRC.", block.begin));
    }
  }

  const chunks = [];
  const chunksByCanonical = new Map();
  const surface = { definitions: [], references: [], directives: [] };
  const plannedEffects = [];
  const resultArtifacts = [];

  for (const block of scanned.blocks) {
    if (block.results) resultArtifacts.push(cleanResult(block.results));
    const names = block.declarations.map((declaration) => declaration.name);
    const evalRequest = headerValue(block.headerArguments, "eval");
    const tangleRequest = headerValue(block.headerArguments, "tangle");
    const configuredRun = runSelected(options, names);
    const executionRequested = configuredRun ||
      (evalRequest !== undefined && !/^(?:no|never|never-export|no-export)$/i.test(evalRequest));
    const ravelRun = configuredRun || /^yes$/i.test(evalRequest ?? "");
    const tangleRequested = tangleRequest !== undefined && !/^no$/i.test(tangleRequest);
    if ((executionRequested || tangleRequested) && executionOwner === null) {
      diagnostics.push(diagnostic(
        "LPA115",
        "Org execution or tangling requires ravel-execution-owner to be org or ravel.",
        block.declaration
      ));
    }
    if (block.declarations.length) {
      plannedEffects.push({
        kind: "org-babel",
        owner: executionOwner,
        pieces: block.declarations.map((declaration) =>
          declaration.canonical ? documentId + "::" + declaration.canonical : null
        ).filter(Boolean),
        language: block.language,
        requests: {
          eval: evalRequest ?? null,
          tangle: tangleRequest ?? null,
          results: headerValue(block.headerArguments, "results") ?? null,
          session: headerValue(block.headerArguments, "session") ?? null,
          cache: headerValue(block.headerArguments, "cache") ?? null,
          variables: block.headerArguments
            .filter((argument) => argument.name === "var")
            .map((argument) => argument.value)
        },
        source: block.declaration
      });
    }

    for (const declaration of block.declarations) {
      if (!declaration.canonical) continue;
      const id = documentId + "::" + declaration.canonical;
      let chunk = chunksByCanonical.get(declaration.canonical);
      if (!chunk) {
        chunk = {
          id,
          identity: { document: documentId, chunk: declaration.canonical, minor: null, type: null },
          name: declaration.name,
          body: "",
          definitionPipeline: block.pipeline,
          metadata: {
            ...(block.language ? { language: block.language } : {}),
            tags: [],
            data: {
              ravel: {
                adapter: "org",
                displayName: declaration.name,
                declarations: [],
                referenceSyntax: {
                  noweb: references !== "underscore-quote",
                  underscore: references !== "org-noweb",
                  dialect: nowebPipes ? "noweb-plus" : "noweb",
                  aliases
                },
                ...((executionOwner === "ravel" && ravelRun)
                  ? { run: true }
                  : {}),
                ...((executionOwner === "ravel" && ravelRun && options.provider)
                  ? { provider: options.provider }
                  : {})
              },
              org: {
                executionOwner,
                fragments: []
              }
            }
          },
          source: block.bodySource,
          fragments: [],
          _pipelineKey: pipelineKey(block.pipeline)
        };
        chunks.push(chunk);
        chunksByCanonical.set(declaration.canonical, chunk);
      } else {
        if (block.pipeline.length) {
          const key = pipelineKey(block.pipeline);
          if (chunk.definitionPipeline.length === 0) {
            chunk.definitionPipeline = block.pipeline;
            chunk._pipelineKey = key;
          } else if (chunk._pipelineKey !== key) {
            diagnostics.push(diagnostic(
              "LPA113",
              "Repeated Org fragments have conflicting pipelines for " + declaration.name + ".",
              block.declaration
            ));
          }
        }
        if (block.language && chunk.metadata.language && block.language !== chunk.metadata.language) {
          diagnostics.push(diagnostic(
            "LPA113",
            "Repeated Org fragments have conflicting languages for " + declaration.name + ".",
            block.declaration
          ));
        } else if (block.language && !chunk.metadata.language) {
          chunk.metadata.language = block.language;
        }
      }
      chunk.body += block.body;
      chunk.fragments.push({ body: block.body, source: block.bodySource });
      chunk.metadata.data.ravel.declarations.push(block.declaration);
      chunk.metadata.data.org.fragments.push({
        kind: declaration.kind,
        begin: block.begin,
        end: block.end,
        heading: block.heading,
        switches: block.switches,
        affiliations: block.affiliations.map(({ line, valueSource, ...entry }) => entry),
        pipeline: block.pipelineSource,
        headerArguments: block.headerArguments,
        results: cleanResult(block.results)
      });
      surface.definitions.push({
        pieceId: id,
        declaration: block.declaration,
        fragments: [block.bodySource],
        displayName: declaration.name,
        affiliations: block.affiliations.map((entry) => entry.source),
        ...(block.pipelineSource ? { pipeline: block.pipelineSource } : {})
      });
    }

    if (references !== "underscore-quote") {
      for (const declaration of block.declarations) {
        if (!declaration.canonical) continue;
        for (const reference of block.references) {
          surface.references.push({
            ownerPieceId: documentId + "::" + declaration.canonical,
            targetText: reference.name,
            source: reference.source
          });
        }
      }
    }
    if (references !== "org-noweb") {
      for (const declaration of block.declarations) {
        if (!declaration.canonical) continue;
        for (const reference of underscoreReferencesFrom(block.body, block.bodySource)) {
          surface.references.push({
            ownerPieceId: documentId + "::" + declaration.canonical,
            targetText: reference.targetText,
            source: reference.source
          });
        }
      }
    }
  }

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: "org+ravel-v1" },
      chunks: chunks.map(({ _pipelineKey, ...chunk }) => chunk),
      directives: [],
      metadata: {
        adapter: "org",
        references,
        nowebPipes,
        executionOwner,
        properties: fileProperties,
        plannedEffects,
        resultArtifacts,
        ignoredBlocks: [
          ...scanned.ignored.map((block) => ({
            reason: block.reason,
            declaration: block.declaration,
            body: block.bodySource
          })),
          ...scanned.blocks
            .filter((block) => block.declarations.length === 0)
            .map((block) => ({
              reason: "unnamed",
              declaration: block.declaration,
              body: block.bodySource
            }))
        ]
      }
    },
    diagnostics,
    surface
  };
};
