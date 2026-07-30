import { parseDefinitionPipeline } from "@pieceful/ravel-core";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const dialects = new Set(["noweb", "noweb-plus"]);
const referencePolicies = new Set(["noweb", "underscore-quote", "both"]);

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

const splitNamePipeline = (value, extended) => {
  const pipeIndex = extended ? firstUnescapedPipe(value) : -1;
  return {
    name: (pipeIndex === -1 ? value : value.slice(0, pipeIndex)).trim().replace(/\\\|/g, "|"),
    pipe: pipeIndex === -1 ? null : value.slice(pipeIndex + 1).trim(),
    pipeIndex
  };
};

const pipelineKey = (pipeline) =>
  JSON.stringify(pipeline.map(({ name, arguments: argumentsValue }) => [name, argumentsValue ?? []]));

const inferredLanguage = (name) => {
  const match = /\.([A-Za-z][A-Za-z0-9+-]*)$/.exec(name.trim());
  if (!match) return null;
  const extension = match[1].toLowerCase();
  return ({
    c: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", css: "css", go: "go",
    html: "html", java: "java", js: "javascript", jsx: "javascript",
    json: "json", lua: "lua", py: "python", rb: "ruby", rs: "rust",
    sh: "shell", ts: "typescript", tsx: "typescript", xml: "xml"
  })[extension] ?? extension;
};

const scanDefinitions = (text, uri, starts) => {
  const lines = linesOf(text);
  const definitions = [];
  let documentationStart = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const opener = /^([ \t]*)<<(.+)>>=[ \t]*$/.exec(line.value);
    if (!opener) continue;
    let terminator = null;
    let terminatorIndex = index + 1;
    for (; terminatorIndex < lines.length; terminatorIndex += 1) {
      if (/^@[ \t]*$/.test(lines[terminatorIndex].value)) {
        terminator = lines[terminatorIndex];
        break;
      }
    }
    const bodyEnd = terminator?.start ?? text.length;
    const nameStart = line.start + opener[1].length + 2;
    definitions.push({
      authoredHeader: opener[2],
      nameStart,
      declaration: rangeAt(uri, starts, line.start, line.end),
      documentation: text.slice(documentationStart, line.start),
      documentationSource: rangeAt(uri, starts, documentationStart, line.start),
      body: text.slice(line.end, bodyEnd),
      bodySource: rangeAt(uri, starts, line.end, bodyEnd),
      terminator: terminator ? rangeAt(uri, starts, terminator.start, terminator.end) : null
    });
    if (!terminator) break;
    documentationStart = terminator.end;
    index = terminatorIndex;
  }
  return definitions;
};

const pragmasFrom = (text, source) => {
  const pragmas = [];
  const pattern = /^[ \t]*@[ \t]+%ravel[ \t]+(pipeline|language|output|run)[ \t]+(.+?)[ \t]*$/gm;
  for (const match of text.matchAll(pattern)) {
    const pipe = firstUnescapedPipe(match[2]);
    const name = (pipe === -1 ? match[2] : match[2].slice(0, pipe)).trim().replace(/\\\|/g, "|");
    pragmas.push({
      kind: match[1],
      name,
      value: pipe === -1 ? null : match[2].slice(pipe + 1).trim(),
      source: advanceRange(source, text, match.index, match.index + match[0].length)
    });
  }
  return pragmas;
};

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

const runConfiguration = (options, name, canonical) => {
  if (options.run === true) return { run: true, provider: options.provider ?? null };
  if (Array.isArray(options.run)) {
    return { run: options.run.includes(name) || options.run.includes(canonical), provider: options.provider ?? null };
  }
  const entry = options.run && typeof options.run === "object"
    ? options.run[name] ?? options.run[canonical]
    : null;
  if (entry === true) return { run: true, provider: options.provider ?? null };
  if (entry && typeof entry === "object") {
    return { run: entry.run !== false, provider: entry.provider ?? options.provider ?? null };
  }
  return { run: false, provider: null };
};

export const nowebToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.nw";
  const starts = lineStarts(text);
  const dialect = options.dialect ?? "noweb";
  const references = options.references ?? (dialect === "noweb-plus" ? "both" : "noweb");
  if (!dialects.has(dialect)) throw new Error("Unknown noweb dialect: " + dialect);
  if (!referencePolicies.has(references)) throw new Error("Unknown noweb reference policy: " + references);
  const documentId = options.document ?? defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error("noweb document identity must be a lowercase identifier: " + String(documentId));
  }

  const diagnostics = [];
  const scanned = scanDefinitions(text, uri, starts);
  const extended = dialect === "noweb-plus";
  const canonicalByName = new Map();
  const ownerByCanonical = new Map();
  const aliases = {};

  const canonicalFor = (name, source) => {
    if (canonicalByName.has(name)) return canonicalByName.get(name);
    const base = semanticComponent(name);
    if (!base) {
      diagnostics.push(diagnostic("LPA101", "noweb chunk name does not produce a usable Ravel ID: " + name, source));
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
        "noweb chunk names normalize to the same Ravel ID; " + name + " was assigned " + canonical + ".",
        source
      ));
    }
    canonicalByName.set(name, canonical);
    ownerByCanonical.set(canonical, name);
    aliases[name] = canonical;
    return canonical;
  };

  for (const definition of scanned) {
    definition.split = splitNamePipeline(definition.authoredHeader, extended);
    definition.canonical = canonicalFor(definition.split.name, definition.declaration);
    definition.references = referencesFrom(definition.body, definition.bodySource, extended);
    if (!definition.terminator) {
      diagnostics.push(diagnostic(
        "LPA111",
        "noweb definition is missing its `@` terminator.",
        definition.declaration
      ));
    }
    if (extended && definition.split.pipeIndex !== -1) {
      diagnostics.push(diagnostic(
        "LPA114",
        "noweb-plus definition pipes are not interpreted as pipelines by classic noweb.",
        definition.declaration,
        "warning"
      ));
    }
  }
  for (const definition of scanned) {
    for (const reference of definition.references) {
      reference.canonical = canonicalFor(reference.name, reference.source);
      if (extended && reference.pipeIndex !== -1) {
        diagnostics.push(diagnostic(
          "LPA114",
          "noweb-plus reference pipes are not interpreted as pipelines by classic noweb.",
          reference.source,
          "warning"
        ));
      }
    }
  }

  const chunks = [];
  const chunksByCanonical = new Map();
  const directives = [];
  const surface = { definitions: [], references: [], directives: [] };
  const pendingPragmas = [];

  const parsePipeline = (value, source) => {
    if (!value) return [];
    const parsed = parseDefinitionPipeline(value, source);
    diagnostics.push(...parsed.diagnostics);
    return parsed.pipeline;
  };

  for (const definition of scanned) {
    pendingPragmas.push(...pragmasFrom(definition.documentation, definition.documentationSource));
    if (!definition.canonical) continue;
    const matching = pendingPragmas.filter((pragma) => pragma.name === definition.split.name);
    for (let index = pendingPragmas.length - 1; index >= 0; index -= 1) {
      if (pendingPragmas[index].name === definition.split.name) pendingPragmas.splice(index, 1);
    }
    const pipelinePragmas = matching.filter((pragma) => pragma.kind === "pipeline");
    const pragmaPipeline = pipelinePragmas.flatMap((pragma) => {
      if (!pragma.value) {
        diagnostics.push(diagnostic("LPA110", "Ravel pipeline pragmas require `name | pipeline`.", pragma.source));
        return [];
      }
      return parsePipeline(pragma.value, pragma.source);
    });
    const inlinePipeline = parsePipeline(
      definition.split.pipe,
      rangeAt(
        uri,
        starts,
        definition.nameStart + Math.max(0, definition.split.pipeIndex + 1),
        definition.nameStart + definition.authoredHeader.length
      )
    );
    if (inlinePipeline.length && pragmaPipeline.length &&
        pipelineKey(inlinePipeline) !== pipelineKey(pragmaPipeline)) {
      diagnostics.push(diagnostic("LPA113", "Inline and pragma definition pipelines conflict.", definition.declaration));
    }
    const declaredPipeline = inlinePipeline.length ? inlinePipeline : pragmaPipeline;
    const id = documentId + "::" + definition.canonical;
    let chunk = chunksByCanonical.get(definition.canonical);
    if (!chunk) {
      const configuredLanguage = options.languages?.[definition.split.name] ??
        options.languages?.[definition.canonical] ?? options.language ?? null;
      const languagePragma = matching.findLast((pragma) => pragma.kind === "language");
      const language = languagePragma?.value ?? configuredLanguage ?? inferredLanguage(definition.split.name);
      const languageSource = languagePragma
        ? "pragma"
        : configuredLanguage
          ? "configuration"
          : language
            ? "chunk-name-extension"
            : null;
      const configuredRun = runConfiguration(options, definition.split.name, definition.canonical);
      const runPragma = matching.findLast((pragma) => pragma.kind === "run");
      const runValues = Object.fromEntries((runPragma?.value?.split("|") ?? [])
        .map((value) => value.trim().split("=", 2))
        .filter(([key, value]) => key && value));
      chunk = {
        id,
        identity: { document: documentId, chunk: definition.canonical, minor: null, type: null },
        name: definition.split.name,
        body: "",
        definitionPipeline: declaredPipeline,
        metadata: {
          ...(language ? { language } : {}),
          tags: [],
          data: {
            ravel: {
              adapter: "noweb",
              dialect,
              displayName: definition.split.name,
              declarations: [],
              documentation: [],
              terminators: [],
              referenceSyntax: {
                noweb: references !== "underscore-quote",
                underscore: references !== "noweb",
                dialect,
                aliases
              },
              ...(languageSource ? { languageSource } : {}),
              ...((configuredRun.run || runPragma) ? { run: true } : {}),
              ...((runValues.provider ?? configuredRun.provider)
                ? { provider: runValues.provider ?? configuredRun.provider }
                : {})
            }
          }
        },
        source: definition.bodySource,
        fragments: [],
        _pipelineKey: pipelineKey(declaredPipeline)
      };
      chunks.push(chunk);
      chunksByCanonical.set(definition.canonical, chunk);
    } else if (declaredPipeline.length) {
      const key = pipelineKey(declaredPipeline);
      if (chunk.definitionPipeline.length === 0) {
        chunk.definitionPipeline = declaredPipeline;
        chunk._pipelineKey = key;
      } else if (chunk._pipelineKey !== key) {
        diagnostics.push(diagnostic(
          "LPA113",
          "Repeated noweb definitions have conflicting pipelines for " + definition.split.name + ".",
          definition.declaration
        ));
      }
    }

    chunk.body += definition.body;
    chunk.fragments.push({ body: definition.body, source: definition.bodySource });
    const ravel = chunk.metadata.data.ravel;
    ravel.declarations.push(definition.declaration);
    ravel.documentation.push({
      text: definition.documentation,
      source: definition.documentationSource
    });
    if (definition.terminator) ravel.terminators.push(definition.terminator);

    const languagePragma = matching.findLast((pragma) => pragma.kind === "language");
    const fragmentLanguage = languagePragma?.value ??
      options.languages?.[definition.split.name] ??
      options.languages?.[definition.canonical] ??
      options.language ??
      inferredLanguage(definition.split.name);
    if (fragmentLanguage && chunk.metadata.language && fragmentLanguage !== chunk.metadata.language) {
      diagnostics.push(diagnostic(
        "LPA113",
        "Repeated noweb definitions have conflicting languages for " + definition.split.name + ".",
        definition.declaration
      ));
    } else if (fragmentLanguage && !chunk.metadata.language) {
      chunk.metadata.language = fragmentLanguage;
    }

    surface.definitions.push({
      pieceId: id,
      declaration: definition.declaration,
      fragments: [definition.bodySource],
      displayName: definition.split.name,
      documentation: definition.documentationSource
    });
    if (references !== "underscore-quote") {
      for (const reference of definition.references) {
        surface.references.push({
          ownerPieceId: id,
          targetText: reference.name,
          source: reference.source
        });
      }
    }
    if (references !== "noweb") {
      for (const reference of underscoreReferencesFrom(definition.body, definition.bodySource)) {
        surface.references.push({
          ownerPieceId: id,
          targetText: reference.targetText,
          source: reference.source
        });
      }
    }

    for (const pragma of matching.filter((entry) => entry.kind === "output")) {
      if (!pragma.value) {
        diagnostics.push(diagnostic("LPA110", "Ravel output pragmas require `name | path`.", pragma.source));
        continue;
      }
      const directive = { kind: "out", name: pragma.value, from: id, source: pragma.source };
      directives.push(directive);
      surface.directives.push({ kind: "out", target: pragma.value, source: pragma.source });
    }
  }

  if (scanned.length === 0) {
    diagnostics.push(diagnostic(
      "LPA100",
      "No noweb chunk definitions were found.",
      rangeAt(uri, starts, 0, text.length),
      "warning"
    ));
  }
  for (const pragma of pendingPragmas) {
    diagnostics.push(diagnostic(
      "LPA110",
      "Ravel " + pragma.kind + " pragma did not match a following noweb definition: " + pragma.name,
      pragma.source
    ));
  }

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: dialect + "-v1" },
      chunks: chunks.map(({ _pipelineKey, ...chunk }) => chunk),
      directives,
      metadata: {
        adapter: "noweb",
        dialect,
        references,
        documentation: scanned.map((definition) => ({
          text: definition.documentation,
          source: definition.documentationSource
        }))
      }
    },
    diagnostics,
    surface
  };
};
