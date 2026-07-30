import {
  combineMaps,
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

const anchorFor = (chunk) =>
  chunk.metadata?.data?.ravel?.renderedAnchor ?? null;

const graphFor = (map, program) => {
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
    const anchor = anchorFor(chunk);
    return anchor
      ? "[" + label + "](#" + anchor + ")"
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
    baseSourceMap = identitySourceMap(text, map.document.uri),
    authoredText = text
  } = {}
) => {
  const uri = map.document.uri;
  if (text.includes(startMarker)) {
    return { source: text, sourceMap: baseSourceMap };
  }
  const graph = graphFor(map, program);
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
  if (includeIndex && graph.length) {
    insertions.push({ offset: text.length, value: indexBlock(graph) });
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
  const program = transformGraph(graph);
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
  const cacheKeyMaterial = JSON.stringify({
    bridgeVersion,
    adapterFormat: adapted.map.document.format,
    source: text,
    preparedSource: decorated.source
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
