import { parseDefinitionPipeline } from "@pieceful/ravel-core";
import { parse as parseYaml } from "yaml";

const componentPattern = /^[a-z][a-z0-9-]*$/;
const supportedDirectives = new Set(["piece", "code", "code-block", "code-cell"]);
const executionOwners = new Set(["myst", "pieceful"]);

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
  const base = uri.split(/[\\/]/).at(-1)?.replace(/(?:\.myst)?\.[^.]+$/, "") ?? "";
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

const splitNamePipeline = (value) => {
  const pipeIndex = firstUnescapedPipe(value);
  return {
    name: (pipeIndex === -1 ? value : value.slice(0, pipeIndex)).trim().replace(/\\\|/g, "|"),
    pipe: pipeIndex === -1 ? null : value.slice(pipeIndex + 1).trim(),
    pipeIndex
  };
};

const frontMatterFrom = (text) => {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { data: undefined, source: null, end: 0 };
  }
  const firstEnd = text.indexOf("\n");
  const close = /^---[ \t]*\r?$/m.exec(text.slice(firstEnd + 1));
  if (!close) return { data: undefined, source: null, end: 0 };
  const contentStart = firstEnd + 1;
  const contentEnd = contentStart + close.index;
  const end = contentEnd + close[0].length;
  try {
    return { data: parseYaml(text.slice(contentStart, contentEnd)), start: 0, end };
  } catch {
    return { data: undefined, start: 0, end };
  }
};

const scalar = (value) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const booleanValue = (value) => {
  if (value.trim() === "") return true;
  if (/^(?:true|yes|on|1)$/i.test(value.trim())) return true;
  if (/^(?:false|no|off|0)$/i.test(value.trim())) return false;
  return null;
};

const tagsFrom = (value) => {
  const trimmed = value.trim();
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner.split(",").flatMap((entry) =>
    entry.trim().split(/\s+/).filter(Boolean)
  ).map(scalar);
};

const optionValue = (options, name) =>
  options.findLast((option) => option.name === name)?.value;

const scanFences = (text, uri, starts, frontMatterEnd) => {
  const lines = linesOf(text);
  const fences = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.start < frontMatterEnd) continue;
    const opening = /^([ \t]{0,3})(:{3,}|`{3,})\{([A-Za-z][A-Za-z0-9_-]*)\}(?:[ \t]+(.*?))?[ \t]*$/.exec(line.value);
    if (!opening) continue;
    const marker = opening[2][0];
    const minimumLength = opening[2].length;
    let endIndex = index + 1;
    while (endIndex < lines.length) {
      const close = /^([ \t]{0,3})(:{3,}|`{3,})[ \t]*$/.exec(lines[endIndex].value);
      if (close && close[2][0] === marker && close[2].length >= minimumLength) break;
      endIndex += 1;
    }
    const endLine = lines[endIndex] ?? null;
    const contentEnd = endLine?.start ?? text.length;
    const options = [];
    let bodyIndex = index + 1;
    while (bodyIndex < endIndex) {
      const optionLine = lines[bodyIndex];
      const option = /^[ \t]{0,3}:([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(optionLine.value);
      if (!option) break;
      const rawValue = option[2] ?? "";
      const valueStart = optionLine.contentEnd - rawValue.length;
      options.push({
        name: option[1].toLowerCase(),
        value: scalar(rawValue),
        rawValue,
        source: rangeAt(uri, starts, optionLine.start, optionLine.end),
        valueSource: rangeAt(uri, starts, valueStart, optionLine.contentEnd)
      });
      bodyIndex += 1;
    }
    if (bodyIndex < endIndex && lines[bodyIndex].value.trim() === "") bodyIndex += 1;
    const bodyStart = lines[bodyIndex]?.start ?? contentEnd;
    fences.push({
      directive: opening[3].toLowerCase(),
      argument: opening[4] ?? "",
      marker: opening[2],
      declaration: rangeAt(uri, starts, line.start, line.end),
      body: text.slice(bodyStart, contentEnd),
      bodySource: rangeAt(uri, starts, bodyStart, contentEnd),
      options,
      end: endLine ? rangeAt(uri, starts, endLine.start, endLine.end) : null,
      fullStart: line.start,
      fullEnd: endLine?.end ?? text.length,
      _endIndex: endIndex
    });
    if (endLine) index = endIndex;
    else break;
  }
  return fences;
};

const precedingTarget = (text, fence, uri, starts) => {
  const before = text.slice(0, fence.fullStart);
  const lineEnd = before.endsWith("\n") ? before.length - 1 : before.length;
  const lineStart = before.lastIndexOf("\n", Math.max(0, lineEnd - 1)) + 1;
  const value = before.slice(lineStart, lineEnd).replace(/\r$/, "");
  const match = /^[ \t]{0,3}\(([^()\s]+)\)=[ \t]*$/.exec(value);
  if (!match) return null;
  return {
    label: match[1],
    source: rangeAt(uri, starts, lineStart, before.length)
  };
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

const narrativeCrossReferences = (text, excluded, labelToPiece, uri, starts) => {
  const references = [];
  const patterns = [
    {
      pattern: /\[[^\]]*\]\(#([^) \t]+)\)/g,
      target: (match) => match[1],
      syntax: "link"
    },
    {
      pattern: /\{(?:ref|numref)\}`([^`]+)`/g,
      target: (match) => /<([^<>]+)>[ \t]*$/.exec(match[1])?.[1] ?? match[1].trim(),
      syntax: "role"
    },
    {
      pattern: /(^|[^\w@])@([A-Za-z][A-Za-z0-9:._/-]*)/gm,
      target: (match) => match[2],
      start: (match) => match.index + match[1].length,
      syntax: "shorthand"
    }
  ];
  const included = (offset) => !excluded.some((range) => offset >= range.start && offset < range.end);
  for (const entry of patterns) {
    for (const match of text.matchAll(entry.pattern)) {
      const start = entry.start?.(match) ?? match.index;
      const targetLabel = entry.target(match).replace(/^#/, "")
        .replace(entry.syntax === "shorthand" ? /[.,;:!?]+$/ : /$^/, "");
      const targetPieceId = labelToPiece.get(targetLabel);
      if (!targetPieceId || !included(start)) continue;
      const length = entry.syntax === "shorthand" ? match[0].length - match[1].length : match[0].length;
      references.push({
        targetPieceId,
        targetLabel,
        syntax: entry.syntax,
        source: rangeAt(uri, starts, start, start + length)
      });
    }
  }
  return references.sort((left, right) =>
    left.source.range.start.offset - right.source.range.start.offset
  );
};

const pipelineKey = (pipeline) =>
  JSON.stringify(pipeline.map(({ name, arguments: argumentsValue }) => [name, argumentsValue ?? []]));

const runSelected = (options, names) =>
  options.run === true ||
  (Array.isArray(options.run) && names.some((name) => options.run.includes(name)));

export const mystToMap = (text, options = {}) => {
  const uri = options.uri ?? "document.myst.md";
  const starts = lineStarts(text);
  const frontMatter = frontMatterFrom(text);
  const configuredDocument = frontMatter.data?.ravel?.document ?? frontMatter.data?.lp?.document;
  const documentId = options.document ?? configuredDocument ?? defaultDocumentId(uri);
  if (!componentPattern.test(documentId ?? "")) {
    throw new Error("MyST document identity must be a lowercase identifier: " + String(documentId));
  }
  const frontMatterOwner = frontMatter.data?.ravel?.execution_owner ??
    frontMatter.data?.ravel?.executionOwner;
  const executionOwner = options.executionOwner ?? frontMatterOwner ?? null;
  if (executionOwner !== null && !executionOwners.has(executionOwner)) {
    throw new Error("MyST execution owner must be myst or pieceful: " + executionOwner);
  }

  const diagnostics = [];
  const fences = scanFences(text, uri, starts, frontMatter.end);
  const candidates = [];
  const ignoredDirectives = [];
  for (const fence of fences) {
    if (!fence.end) {
      diagnostics.push(diagnostic("LPA111", "MyST directive is missing its closing fence.", fence.declaration));
    }
    if (!supportedDirectives.has(fence.directive)) {
      ignoredDirectives.push({
        directive: fence.directive,
        declaration: fence.declaration,
        body: fence.bodySource,
        reason: "unrecognized-directive"
      });
      continue;
    }

    const optionLabel = optionValue(fence.options, "label") || null;
    const target = precedingTarget(text, fence, uri, starts);
    if (target && optionLabel && target.label !== optionLabel) {
      diagnostics.push(diagnostic(
        "LPA113",
        "A MyST target and directive :label: must agree when both label one piece.",
        fence.declaration
      ));
    }
    const label = optionLabel ?? target?.label ?? null;
    const fallback = fence.directive !== "piece";
    if (fallback && !label?.startsWith("lp-")) {
      ignoredDirectives.push({
        directive: fence.directive,
        declaration: fence.declaration,
        body: fence.bodySource,
        reason: "non-piece-label"
      });
      continue;
    }

    const split = fence.directive === "piece"
      ? splitNamePipeline(fence.argument)
      : { name: label.slice(3), pipe: null, pipeIndex: -1 };
    const caption = optionValue(fence.options, "caption") || null;
    const authoredName = split.name || (label?.replace(/^lp-/, "") ?? "");
    const explicitSemantic = label ? label.replace(/^lp-/, "") : null;
    const canonical = semanticComponent(explicitSemantic ?? authoredName);
    if (!canonical) {
      diagnostics.push(diagnostic(
        "LPA101",
        "MyST piece name or label does not produce a usable Pieceful ID.",
        fence.declaration
      ));
      continue;
    }
    if (!label) {
      diagnostics.push(diagnostic(
        "LPA102",
        "MyST piece ID was inferred from its mutable directive argument.",
        fence.declaration,
        "info"
      ));
    }
    const displayName = caption ?? authoredName;
    if (!displayName) {
      diagnostics.push(diagnostic(
        "LPA101",
        "MyST piece has no visible caption or directive name.",
        fence.declaration
      ));
    }
    if (fallback && !caption) {
      diagnostics.push(diagnostic(
        "LPA101",
        "A native MyST fallback block needs :caption: for a visible piece name.",
        fence.declaration,
        "warning"
      ));
    }

    const language = fence.directive === "piece"
      ? optionValue(fence.options, "language") || null
      : scalar(fence.argument).split(/\s+/)[0] || null;
    const cellOption = booleanValue(optionValue(fence.options, "cell") ?? "false");
    const notebookCell = fence.directive === "code-cell" || cellOption === true;
    const runOption = booleanValue(optionValue(fence.options, "run") ?? "false");
    const piecefulRequested = runSelected(options, [authoredName, canonical, label].filter(Boolean)) ||
      runOption === true;
    if (piecefulRequested && executionOwner !== "pieceful") {
      diagnostics.push(diagnostic(
        "LPA141",
        "Pieceful execution requires executionOwner: pieceful; MyST remains the default notebook owner.",
        fence.declaration
      ));
    }
    if (notebookCell && executionOwner === "pieceful" && !piecefulRequested) {
      diagnostics.push(diagnostic(
        "LPA141",
        "A MyST notebook cell assigned to Pieceful must explicitly request run.",
        fence.declaration
      ));
    }

    const declarationText = text.slice(
      fence.declaration.range.start.offset,
      fence.declaration.range.end.offset
    );
    const pipeWhitespace = split.pipe !== null
      ? fence.argument.slice(split.pipeIndex + 1).search(/\S|$/)
      : 0;
    const pipeStart = declarationText.indexOf(fence.argument) + split.pipeIndex + 1 + pipeWhitespace;
    const pipeSource = split.pipe !== null
      ? advanceRange(fence.declaration, declarationText, pipeStart, pipeStart + split.pipe.length)
      : null;
    const parsedPipeline = split.pipe
      ? parseDefinitionPipeline(split.pipe, pipeSource ?? fence.declaration)
      : { pipeline: [], diagnostics: [] };
    diagnostics.push(...parsedPipeline.diagnostics);
    candidates.push({
      ...fence,
      label,
      target,
      canonical,
      authoredName,
      displayName,
      caption,
      language,
      pipeline: parsedPipeline.pipeline,
      pipelineSource: pipeSource,
      notebookCell,
      piecefulRun: piecefulRequested && executionOwner === "pieceful",
      tags: tagsFrom(optionValue(fence.options, "tags") ?? "")
    });
  }

  const aliases = {};
  const chunks = [];
  const chunksById = new Map();
  const labelToPiece = new Map();
  const labelOwners = new Map();
  const surface = { definitions: [], references: [], directives: [], navigation: [] };
  const plannedEffects = [];
  for (const candidate of candidates) {
    const id = documentId + "::" + candidate.canonical;
    for (const alias of [candidate.authoredName, candidate.label, candidate.canonical].filter(Boolean)) {
      aliases[alias] = candidate.canonical;
    }
    if (candidate.label) {
      const priorOwner = labelOwners.get(candidate.label);
      if (priorOwner && priorOwner !== id) {
        diagnostics.push(diagnostic(
          "LPA103",
          "MyST rendered labels must be unique: " + candidate.label + ".",
          candidate.declaration
        ));
      } else {
        labelOwners.set(candidate.label, id);
        labelToPiece.set(candidate.label, id);
      }
    }
    let chunk = chunksById.get(id);
    if (!chunk) {
      chunk = {
        id,
        identity: { document: documentId, chunk: candidate.canonical, minor: null, type: null },
        name: candidate.displayName,
        body: "",
        definitionPipeline: candidate.pipeline,
        metadata: {
          ...(candidate.language ? { language: candidate.language } : {}),
          tags: [...candidate.tags],
          data: {
            ravel: {
              adapter: "myst",
              displayName: candidate.displayName,
              ...(candidate.label ? { renderedAnchor: candidate.label } : {}),
              referenceSyntax: {
                noweb: false,
                underscore: true,
                aliases
              },
              ...(candidate.piecefulRun ? { run: true } : {}),
              ...(candidate.piecefulRun && options.provider ? { provider: options.provider } : {})
            },
            myst: {
              label: candidate.label,
              caption: candidate.caption,
              notebookCell: candidate.notebookCell,
              executionOwner: candidate.notebookCell ? (executionOwner ?? "myst") : executionOwner,
              fragments: []
            }
          }
        },
        source: candidate.bodySource,
        fragments: [],
        _pipelineKey: pipelineKey(candidate.pipeline)
      };
      chunks.push(chunk);
      chunksById.set(id, chunk);
    } else {
      if (candidate.pipeline.length) {
        const key = pipelineKey(candidate.pipeline);
        if (chunk.definitionPipeline.length === 0) {
          chunk.definitionPipeline = candidate.pipeline;
          chunk._pipelineKey = key;
        } else if (chunk._pipelineKey !== key) {
          diagnostics.push(diagnostic(
            "LPA113",
            "Repeated MyST fragments have conflicting pipelines for " + candidate.authoredName + ".",
            candidate.declaration
          ));
        }
      }
      if (candidate.language && chunk.metadata.language && candidate.language !== chunk.metadata.language) {
        diagnostics.push(diagnostic(
          "LPA113",
          "Repeated MyST fragments have conflicting languages for " + candidate.authoredName + ".",
          candidate.declaration
        ));
      } else if (candidate.language && !chunk.metadata.language) {
        chunk.metadata.language = candidate.language;
      }
      if (candidate.label && chunk.metadata.data.myst.label &&
          candidate.label === chunk.metadata.data.myst.label) {
        diagnostics.push(diagnostic(
          "LPA103",
          "Repeated MyST fragments cannot reuse the same rendered label.",
          candidate.declaration,
          "warning"
        ));
      }
      chunk.metadata.tags = [...new Set([...chunk.metadata.tags, ...candidate.tags])];
    }

    chunk.body += candidate.body;
    chunk.fragments.push({ body: candidate.body, source: candidate.bodySource });
    chunk.metadata.data.myst.fragments.push({
      directive: candidate.directive,
      marker: candidate.marker,
      declaration: candidate.declaration,
      end: candidate.end,
      label: candidate.label,
      target: candidate.target,
      caption: candidate.caption,
      language: candidate.language,
      options: candidate.options,
      pipeline: candidate.pipelineSource,
      notebookCell: candidate.notebookCell,
      tags: candidate.tags
    });
    surface.definitions.push({
      pieceId: id,
      declaration: candidate.declaration,
      fragments: [candidate.bodySource],
      displayName: candidate.displayName,
      ...(candidate.label ? {
        sourceAnchor: candidate.label,
        renderedAnchor: candidate.label
      } : {}),
      ...(candidate.pipelineSource ? { pipeline: candidate.pipelineSource } : {})
    });
    for (const reference of underscoreReferencesFrom(candidate.body, candidate.bodySource)) {
      surface.references.push({ ownerPieceId: id, ...reference });
    }
    if (candidate.notebookCell) {
      plannedEffects.push({
        kind: "myst-code-cell",
        owner: executionOwner ?? "myst",
        pieceId: id,
        language: candidate.language,
        label: candidate.label,
        tags: candidate.tags,
        source: candidate.declaration
      });
    }
  }

  surface.navigation = narrativeCrossReferences(
    text,
    fences.map((fence) => ({ start: fence.fullStart, end: fence.fullEnd })),
    labelToPiece,
    uri,
    starts
  );

  return {
    map: {
      version: 1,
      document: { id: documentId, uri, format: "myst+ravel-v1" },
      chunks: chunks.map(({ _pipelineKey, ...chunk }) => chunk),
      directives: [],
      metadata: {
        adapter: "myst",
        frontMatter: frontMatter.data ?? null,
        crossReferences: surface.navigation,
        plannedEffects,
        ignoredDirectives
      }
    },
    diagnostics,
    surface
  };
};
