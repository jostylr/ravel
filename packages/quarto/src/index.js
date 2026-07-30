import {
  combineMaps,
  sourceAtGeneratedOffset,
  transformGraph
} from "@pieceful/ravel-core";
import { modernMarkdownToMap } from "@pieceful/ravel-markdown";

const bridgeVersion = "0.1.1";
const startMarker = "<!-- ravel:graph:start -->";
const endMarker = "<!-- ravel:graph:end -->";

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

const sourceRange = (uri, starts, start, end) => ({
  uri,
  range: {
    start: positionAt(starts, start),
    end: positionAt(starts, end)
  }
});

const code = (value) => "`" + String(value).replace(/`/g, "\\`") + "`";

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalValue(value[key])])
  );
};

const cacheMaterial = (value) => JSON.stringify(canonicalValue(value));

const anchorFor = (chunk) =>
  chunk.metadata?.data?.ravel?.renderedAnchor ?? null;

const graphFor = (
  map,
  program,
  linkTarget = (chunk) => {
    const anchor = anchorFor(chunk);
    return anchor ? "#" + anchor : null;
  }
) => {
  const sourceChunks = new Map(map.chunks.map((chunk) => [chunk.id, chunk]));
  const reverse = new Map([...sourceChunks.keys()].map((id) => [id, []]));
  for (const [id, chunk] of Object.entries(program.chunks ?? {})) {
    for (const dependency of chunk.dependencies ?? []) {
      if (reverse.has(dependency) && sourceChunks.has(id)) {
        reverse.get(dependency).push(id);
      }
    }
  }
  const link = (id) => {
    const chunk = sourceChunks.get(id);
    if (!chunk) return code(id);
    const label = chunk.name ?? chunk.identity?.chunk ?? id;
    const target = linkTarget(chunk);
    return target
      ? "[" + label + "](" + target + ")"
      : code(label);
  };
  return [...sourceChunks.values()].map((chunk) => ({
    id: chunk.id,
    chunk,
    uses: (program.chunks?.[chunk.id]?.dependencies ?? [])
      .filter((id) => sourceChunks.has(id)),
    usedBy: reverse.get(chunk.id) ?? [],
    link
  }));
};

const relationBlock = (entry) => [
  "",
  startMarker,
  "::: {.ravel-piece-graph data-ravel-piece=\"" + entry.id + "\"}",
  "**Piece:** " + code(entry.chunk.name ?? entry.chunk.identity.chunk) +
    " · **Uses:** " +
    (entry.uses.length ? entry.uses.map(entry.link).join(", ") : "none") +
    " · **Used by:** " +
    (entry.usedBy.length ? entry.usedBy.map(entry.link).join(", ") : "none"),
  ":::",
  endMarker,
  ""
].join("\n");

const indexBlock = (entries) => [
  "",
  startMarker,
  "## Piece index {.unnumbered #ravel-piece-index}",
  "",
  "| Piece | Uses | Used by |",
  "| --- | --- | --- |",
  ...entries.map((entry) => [
    entry.link(entry.id),
    entry.uses.length ? entry.uses.map(entry.link).join(", ") : "none",
    entry.usedBy.length ? entry.usedBy.map(entry.link).join(", ") : "none"
  ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
  endMarker,
  ""
].join("\n");

const identitySourceMap = (text, uri) => {
  const starts = lineStarts(text);
  return {
    version: 1,
    kind: "ravel-quarto-source-map",
    source: uri,
    generatedLength: text.length,
    segments: text.length
      ? [{
          generated: { start: 0, end: text.length },
          source: sourceRange(uri, starts, 0, text.length),
          precision: "exact",
          kind: "authored"
        }]
      : []
  };
};

const generatedOffsetForSource = (map, uri, offset) => {
  for (const segment of map.segments ?? []) {
    const start = segment.source?.range?.start?.offset;
    const end = segment.source?.range?.end?.offset;
    const generatedLength = segment.generated.end - segment.generated.start;
    if (segment.source?.uri !== uri ||
        segment.precision !== "exact" ||
        end - start !== generatedLength ||
        offset < start ||
        offset > end) {
      continue;
    }
    return segment.generated.start + offset - start;
  }
  return null;
};

const copyMappedRange = (
  sourceMap,
  start,
  end,
  generatedStart,
  authoredText
) => {
  const copied = [];
  const authoredStarts = lineStarts(authoredText);
  for (const segment of sourceMap.segments ?? []) {
    const overlapStart = Math.max(start, segment.generated.start);
    const overlapEnd = Math.min(end, segment.generated.end);
    if (overlapStart >= overlapEnd) continue;
    const relativeStart = overlapStart - segment.generated.start;
    const relativeEnd = overlapEnd - segment.generated.start;
    const next = {
      ...segment,
      generated: {
        start: generatedStart + overlapStart - start,
        end: generatedStart + overlapEnd - start
      }
    };
    const sourceStart = segment.source?.range?.start?.offset;
    const sourceEnd = segment.source?.range?.end?.offset;
    const segmentLength = segment.generated.end - segment.generated.start;
    if (segment.precision === "exact" &&
        segment.source?.uri === sourceMap.source &&
        sourceEnd - sourceStart === segmentLength) {
      next.source = sourceRange(
        sourceMap.source,
        authoredStarts,
        sourceStart + relativeStart,
        sourceStart + relativeEnd
      );
    } else if (relativeStart !== 0 || relativeEnd !== segmentLength) {
      next.precision = "coarse";
    }
    copied.push(next);
  }
  return copied;
};

export const weaveQuartoExecutions = (text, map, program) => {
  const uri = map.document.uri;
  const starts = lineStarts(text);
  const diagnostics = [];
  const replacements = [];
  for (const chunk of map.chunks) {
    const quarto = chunk.metadata?.data?.ravel?.quarto;
    if (quarto?.executable !== true) continue;
    if (!Array.isArray(chunk.fragments) || chunk.fragments.length !== 1) {
      diagnostics.push({
        code: "RM140",
        severity: "error",
        message: "A Quarto executable piece must contain exactly one code fragment.",
        source: chunk.source
      });
      continue;
    }
    const fragment = chunk.fragments[0];
    if (quarto.executionOwner === "quarto") {
      const resolved = program.chunks?.[chunk.id];
      if (!resolved) continue;
      replacements.push({
        start: fragment.source.range.start.offset,
        end: fragment.source.range.end.offset,
        value: resolved.value,
        segments: resolved.segments ?? [],
        kind: "woven-code"
      });
      continue;
    }
    if (quarto.executionOwner === "ravel") {
      if (quarto.cellOptions?.eval === true) {
        diagnostics.push({
          code: "RM140",
          severity: "error",
          message: "A Ravel-owned Quarto cell cannot declare eval: true.",
          source: chunk.source
        });
        continue;
      }
      if (quarto.cellOptions?.eval !== false) {
        replacements.push({
          start: fragment.source.range.start.offset,
          end: fragment.source.range.start.offset,
          value: "#| eval: false\n",
          segments: [],
          kind: "execution-guard"
        });
      }
    }
  }
  replacements.sort((left, right) => left.start - right.start);
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index].start < replacements[index - 1].end) {
      diagnostics.push({
        code: "RM140",
        severity: "error",
        message: "Quarto executable source ranges overlap.",
        source: sourceRange(
          uri,
          starts,
          replacements[index].start,
          replacements[index].end
        )
      });
    }
  }
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return {
      source: text,
      sourceMap: identitySourceMap(text, uri),
      diagnostics
    };
  }

  let source = "";
  let cursor = 0;
  const segments = [];
  const appendAuthored = (end) => {
    if (end <= cursor) return;
    const generatedStart = source.length;
    source += text.slice(cursor, end);
    segments.push({
      generated: { start: generatedStart, end: source.length },
      source: sourceRange(uri, starts, cursor, end),
      precision: "exact",
      kind: "authored"
    });
    cursor = end;
  };
  for (const replacement of replacements) {
    appendAuthored(replacement.start);
    const generatedStart = source.length;
    source += replacement.value;
    if (replacement.segments.length) {
      for (const segment of replacement.segments) {
        segments.push({
          ...segment,
          generated: {
            start: generatedStart + segment.generated.start,
            end: generatedStart + segment.generated.end
          },
          kind: replacement.kind
        });
      }
    } else if (replacement.value.length) {
      segments.push({
        generated: { start: generatedStart, end: source.length },
        source: null,
        precision: "generated",
        kind: replacement.kind
      });
    }
    cursor = replacement.end;
  }
  appendAuthored(text.length);
  return {
    source,
    sourceMap: {
      version: 1,
      kind: "ravel-quarto-source-map",
      source: uri,
      generatedLength: source.length,
      segments
    },
    diagnostics
  };
};

export const decorateQuartoMarkdown = (
  text,
  map,
  program,
  {
    includeIndex = true,
    indexScope = "document",
    graphMap = map,
    linkTarget,
    baseSourceMap = identitySourceMap(text, map.document.uri),
    authoredText = text
  } = {}
) => {
  const uri = map.document.uri;
  if (text.includes(startMarker)) {
    return { source: text, sourceMap: baseSourceMap };
  }
  const graph = graphFor(graphMap, program, linkTarget);
  const insertions = graph
    .filter((entry) => entry.chunk.source?.uri === uri)
    .map((entry) => {
      const offset = generatedOffsetForSource(
        baseSourceMap,
        uri,
        entry.chunk.source.range.end.offset
      );
      return offset === null
        ? null
        : { offset, value: relationBlock(entry) };
    })
    .filter(Boolean);
  const indexEntries = indexScope === "project"
    ? graph
    : graph.filter((entry) => entry.chunk.source?.uri === uri);
  if (includeIndex && indexEntries.length) {
    insertions.push({ offset: text.length, value: indexBlock(indexEntries) });
  }
  insertions.sort((left, right) =>
    left.offset - right.offset || left.value.localeCompare(right.value)
  );

  let source = "";
  let sourceCursor = 0;
  const segments = [];
  const appendAuthored = (end) => {
    if (end <= sourceCursor) return;
    const generatedStart = source.length;
    source += text.slice(sourceCursor, end);
    segments.push(...copyMappedRange(
      baseSourceMap,
      sourceCursor,
      end,
      generatedStart,
      authoredText
    ));
    sourceCursor = end;
  };
  for (const insertion of insertions) {
    appendAuthored(insertion.offset);
    const generatedStart = source.length;
    source += insertion.value;
    segments.push({
      generated: { start: generatedStart, end: source.length },
      source: null,
      precision: "generated",
      kind: "graph-decoration"
    });
  }
  appendAuthored(text.length);

  return {
    source,
    sourceMap: {
      version: 1,
      kind: "ravel-quarto-source-map",
      source: uri,
      generatedLength: source.length,
      segments
    }
  };
};

export const prepareQuartoRender = (text, options = {}) => {
  const adapted = modernMarkdownToMap(text, {
    uri: options.uri ?? "document.qmd",
    document: options.document,
    headings: options.headings
  });
  const graph = combineMaps([adapted.map]);
  const program = transformGraph(graph, {
    deferLiveResults: true
  });
  const woven = weaveQuartoExecutions(text, adapted.map, program);
  const diagnostics = [
    ...adapted.diagnostics,
    ...program.diagnostics,
    ...woven.diagnostics
  ];
  const blocked = diagnostics.some((entry) => entry.severity === "error");
  const decorated = blocked
    ? {
        source: text,
        sourceMap: identitySourceMap(text, adapted.map.document.uri)
      }
    : decorateQuartoMarkdown(woven.source, adapted.map, program, {
        includeIndex: options.includeIndex,
        baseSourceMap: woven.sourceMap,
        authoredText: text
      });
  const cacheKeyMaterial = cacheMaterial({
    bridgeVersion,
    adapterFormat: adapted.map.document.format,
    source: text,
    preparedSource: decorated.source,
    providerVersions: options.providerVersions ?? {},
    transformVersions: options.transformVersions ?? {},
    dependencies: options.dependencies ?? []
  });
  return {
    source: decorated.source,
    map: adapted.map,
    program,
    diagnostics,
    sourceMap: decorated.sourceMap,
    cacheKeyMaterial
  };
};

const portablePath = (value) => String(value).replace(/\\/g, "/");

const relativeDocumentPath = (from, to) => {
  const fromParts = portablePath(from).split("/");
  const toParts = portablePath(to).split("/");
  fromParts.pop();
  while (fromParts.length && toParts.length &&
      fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [
    ..."../".repeat(fromParts.filter(Boolean).length).split("/").filter(Boolean),
    ...toParts
  ].join("/") || portablePath(to).split("/").pop();
};

const withOutputExtension = (uri, outputExtension) => {
  if (!outputExtension) return uri;
  return uri.replace(/\.[^./]+$/, "") +
    (outputExtension.startsWith(".")
      ? outputExtension
      : "." + outputExtension);
};

const projectLinkTarget = (currentUri, chunk, outputExtension) => {
  const anchor = anchorFor(chunk);
  if (!anchor) return null;
  const targetUri = chunk.source?.uri;
  if (!targetUri || targetUri === currentUri) return "#" + anchor;
  return relativeDocumentPath(
    currentUri,
    withOutputExtension(targetUri, outputExtension)
  ) + "#" + anchor;
};

/**
 * Prepare a complete set of Quarto documents against one resolved Ravel graph.
 * This remains portable and effect-free; the Node subpath owns filesystem and
 * process capabilities.
 */
export const prepareQuartoProject = (documents, options = {}) => {
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new TypeError("prepareQuartoProject requires one or more documents.");
  }
  const uris = new Set();
  const adapted = documents.map((document) => {
    if (!document || typeof document.uri !== "string" ||
        typeof document.source !== "string") {
      throw new TypeError("Each Quarto project document requires uri and source strings.");
    }
    if (uris.has(document.uri)) {
      throw new TypeError("Duplicate Quarto project document URI: " + document.uri);
    }
    uris.add(document.uri);
    return {
      ...document,
      adapted: modernMarkdownToMap(document.source, {
        uri: document.uri,
        document: document.document,
        headings: document.headings
      })
    };
  });
  const graph = combineMaps(adapted.map((entry) => entry.adapted.map));
  const program = transformGraph(graph, {
    transforms: options.transforms,
    deferLiveResults: true
  });
  const diagnostics = [
    ...adapted.flatMap((entry) => entry.adapted.diagnostics),
    ...program.diagnostics
  ];
  const graphBlocked = diagnostics.some((entry) => entry.severity === "error");
  const wovenDocuments = adapted.map((entry) => ({
    entry,
    woven: graphBlocked
      ? {
          source: entry.source,
          sourceMap: identitySourceMap(entry.source, entry.uri),
          diagnostics: []
        }
      : weaveQuartoExecutions(
          entry.source,
          entry.adapted.map,
          program
        )
  }));
  diagnostics.push(...wovenDocuments.flatMap((item) =>
    item.woven.diagnostics
  ));
  const blocked = diagnostics.some((entry) => entry.severity === "error");
  const preparedDocuments = wovenDocuments.map(({ entry, woven }) => {
    if (blocked) {
      return {
        uri: entry.uri,
        source: entry.source,
        preparedSource: entry.source,
        map: entry.adapted.map,
        sourceMap: identitySourceMap(entry.source, entry.uri),
        diagnostics: [
          ...entry.adapted.diagnostics,
          ...woven.diagnostics
        ]
      };
    }
    const decorated = decorateQuartoMarkdown(
      woven.source,
      entry.adapted.map,
      program,
      {
        includeIndex: options.includeIndex,
        indexScope: options.indexScope ?? "document",
        graphMap: graph,
        linkTarget: (chunk) => projectLinkTarget(
          entry.uri,
          chunk,
          options.outputExtension
        ),
        baseSourceMap: woven.sourceMap,
        authoredText: entry.source
      }
    );
    return {
      uri: entry.uri,
      source: entry.source,
      preparedSource: decorated.source,
      map: entry.adapted.map,
      sourceMap: decorated.sourceMap,
      diagnostics: [
        ...entry.adapted.diagnostics,
        ...woven.diagnostics
      ]
    };
  });
  const cacheKeyMaterial = cacheMaterial({
    bridgeVersion,
    adapterFormats: preparedDocuments.map((entry) =>
      entry.map.document.format
    ),
    documents: preparedDocuments.map((entry) => ({
      uri: entry.uri,
      source: entry.source,
      preparedSource: entry.preparedSource
    })),
    providerVersions: options.providerVersions ?? {},
    transformVersions: options.transformVersions ?? {},
    dependencies: options.dependencies ?? [],
    outputExtension: options.outputExtension ?? null
  });
  return {
    documents: preparedDocuments,
    graph,
    program,
    diagnostics,
    cacheKeyMaterial
  };
};

/**
 * Add a generated project cache stamp without disturbing authored offsets.
 * Node hosts use this after hashing cacheKeyMaterial so Quarto freeze:auto sees
 * non-source dependency and provider-version changes.
 */
export const stampQuartoProjectCache = (project, stamp) => {
  if (typeof stamp !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(stamp)) {
    throw new TypeError("A Quarto project cache stamp must be a safe token.");
  }
  return {
    ...project,
    cacheStamp: stamp,
    documents: project.documents.map((document) => {
      const value = "\n<!-- ravel:project-cache " + stamp + " -->\n";
      const generatedStart = document.preparedSource.length;
      return {
        ...document,
        preparedSource: document.preparedSource + value,
        sourceMap: {
          ...document.sourceMap,
          generatedLength: generatedStart + value.length,
          segments: [
            ...(document.sourceMap.segments ?? []),
            {
              generated: {
                start: generatedStart,
                end: generatedStart + value.length
              },
              source: null,
              precision: "generated",
              kind: "project-cache-stamp"
            }
          ]
        }
      };
    })
  };
};

const offsetAtPosition = (
  text,
  line,
  column,
  lineBase,
  columnBase
) => {
  if (!Number.isInteger(line) || !Number.isInteger(column)) return null;
  const starts = lineStarts(text);
  const lineIndex = line - lineBase;
  if (lineIndex < 0 || lineIndex >= starts.length) return null;
  const start = starts[lineIndex];
  const next = starts[lineIndex + 1] ?? text.length;
  return Math.min(next, Math.max(start, start + column - columnBase));
};

const pointSource = (uri, text, offset) => {
  const starts = lineStarts(text);
  const safe = Math.min(text.length, Math.max(0, offset));
  const end = safe < text.length ? safe + 1 : safe;
  return sourceRange(uri, starts, safe, end);
};

/**
 * Translate a Quarto/Pandoc location in temporary source back to authored
 * source. Exact woven segments can point into another project document.
 */
export const remapQuartoDiagnostic = (
  diagnostic,
  project,
  {
    lineBase = 1,
    columnBase = 1
  } = {}
) => {
  const documents = project?.documents ?? [];
  const generatedUri = diagnostic.uri ?? diagnostic.file ??
    diagnostic.source?.uri;
  const document = documents.find((entry) =>
    entry.uri === generatedUri ||
    entry.temporaryUri === generatedUri ||
    portablePath(entry.uri) === portablePath(generatedUri ?? "")
  );
  const line = diagnostic.line ??
    diagnostic.source?.range?.start?.line;
  const column = diagnostic.column ??
    diagnostic.source?.range?.start?.column ??
    columnBase;
  if (!document) return {
    ...diagnostic,
    code: diagnostic.code ?? "RQ201",
    severity: diagnostic.severity ?? "error"
  };
  const generatedOffset = offsetAtPosition(
    document.preparedSource,
    line,
    column,
    lineBase,
    columnBase
  );
  const mapped = generatedOffset === null
    ? null
    : sourceAtGeneratedOffset(document.sourceMap, generatedOffset);
  const origin = documents.find((entry) =>
    entry.uri === mapped?.source?.uri
  );
  const source = Number.isInteger(mapped?.sourceOffset) && origin
    ? pointSource(origin.uri, origin.source, mapped.sourceOffset)
    : mapped?.source ?? pointSource(document.uri, document.source, 0);
  const related = (mapped?.via ?? [])
    .map((entry) => entry.source)
    .filter(Boolean)
    .map((entry) => ({
      message: "Ravel " + (entry.kind ?? "derivation") + " source",
      source: entry
    }));
  return {
    ...diagnostic,
    code: diagnostic.code ?? "RQ201",
    severity: diagnostic.severity ?? "error",
    source,
    ...(related.length ? { related } : {}),
    metadata: {
      ...(diagnostic.metadata ?? {}),
      ravel: {
        ...(diagnostic.metadata?.ravel ?? {}),
        generatedUri,
        generatedLine: line,
        generatedColumn: column,
        precision: mapped?.precision ?? "unmapped",
        kind: mapped?.kind ?? null
      }
    }
  };
};
