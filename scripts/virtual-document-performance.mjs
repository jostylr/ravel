#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import {
  createProjectionService,
  mapSourceOffset,
  mapVirtualOffset
} from "@pieceful/ravel-projection";

const DEFAULTS = Object.freeze({
  lines: 100_000,
  segments: 2_000,
  lookups: 10_000
});

const SOURCE_URI = "benchmark://virtual-document/source.ts";
const ARTIFACT_ID = "generated/benchmark.ts";
const ROOT_PIECE_ID = "benchmark::root.ts";
const TARGET_ID = "benchmark";

const usage = `Usage: node scripts/virtual-document-performance.mjs [options]

Build and incrementally update a deterministic Ravel virtual document, then
exercise its bidirectional indexes, reuse path, and cancellation behavior.

Options:
  --lines <count>       Generated logical lines (default: ${DEFAULTS.lines})
  --segments <count>    Exact provenance segments (default: ${DEFAULTS.segments})
  --lookups <count>     Lookups in each mapping direction (default: ${DEFAULTS.lookups})
  --json                Print only machine-readable JSON
  --help                Show this help

Timings are informational. Correctness invariants fail the process, but there
are deliberately no machine-dependent performance thresholds.`;

const parsePositiveInteger = (value, flag) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${flag} requires a positive integer.`);
  }
  return parsed;
};

const parseArguments = (argv) => {
  const options = { ...DEFAULTS, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--lines" || argument === "--segments" || argument === "--lookups") {
      const key = argument.slice(2);
      options[key] = parsePositiveInteger(argv[++index], argument);
    } else if (argument.startsWith("--lines=")) {
      options.lines = parsePositiveInteger(argument.slice("--lines=".length), "--lines");
    } else if (argument.startsWith("--segments=")) {
      options.segments = parsePositiveInteger(argument.slice("--segments=".length), "--segments");
    } else if (argument.startsWith("--lookups=")) {
      options.lookups = parsePositiveInteger(argument.slice("--lookups=".length), "--lookups");
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  options.segments = Math.min(options.segments, options.lines);
  return options;
};

const invariant = (condition, message) => {
  if (!condition) throw new Error(`Benchmark invariant failed: ${message}`);
};

const position = (line, column, offset) => ({ line, column, offset });
const sourceLocation = (startLine, startOffset, endLine, endOffset) => ({
  uri: SOURCE_URI,
  range: {
    start: position(startLine, 0, startOffset),
    end: position(endLine, 0, endOffset)
  }
});

const createBenchmarkProgram = ({ lines, segments, mutationLine = -1 }) => {
  const digits = Math.max(6, String(lines - 1).length);
  const replacement = "9".repeat(digits);
  const lineText = (line) => {
    const label = String(line).padStart(digits, "0");
    const value = line === mutationLine ? replacement : label;
    return `const v${label} = ${value};\n`;
  };

  const chunks = {};
  const dependencies = [];
  const generatedParts = [];
  const provenanceSegments = [];
  let generatedOffset = 0;

  for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
    const startLine = Math.floor(segmentIndex * lines / segments);
    const endLine = Math.floor((segmentIndex + 1) * lines / segments);
    const blockParts = [];
    for (let line = startLine; line < endLine; line += 1) blockParts.push(lineText(line));
    const block = blockParts.join("");
    const startOffset = generatedOffset;
    const endOffset = startOffset + block.length;
    const pieceId = `benchmark::block-${String(segmentIndex).padStart(6, "0")}.ts`;
    const source = sourceLocation(startLine, startOffset, endLine, endOffset);

    dependencies.push(pieceId);
    generatedParts.push(block);
    chunks[pieceId] = {
      id: pieceId,
      value: block,
      source,
      metadata: { language: "typescript" },
      dependencies: [],
      references: []
    };
    provenanceSegments.push({
      generated: { start: startOffset, end: endOffset },
      source,
      chunk: pieceId,
      kind: "literal",
      precision: "exact",
      via: []
    });
    generatedOffset = endOffset;
  }

  const text = generatedParts.join("");
  const rootSource = sourceLocation(0, 0, 0, 0);
  chunks[ROOT_PIECE_ID] = {
    id: ROOT_PIECE_ID,
    value: text,
    source: rootSource,
    metadata: { language: "typescript" },
    dependencies,
    references: []
  };

  return {
    program: {
      version: 1,
      documents: [{ id: "benchmark", uri: SOURCE_URI, format: "benchmark" }],
      chunks,
      deliverables: {
        [ARTIFACT_ID]: {
          name: ARTIFACT_ID,
          from: ROOT_PIECE_ID,
          value: text,
          source: rootSource,
          segments: provenanceSegments
        }
      },
      diagnostics: [],
      trace: { chunks: {} }
    },
    sourceText: text,
    lineWidth: lineText(0).length,
    mutationLine
  };
};

const mib = (bytes) => Number((bytes / 1024 / 1024).toFixed(2));
const phaseRecords = [];

const measure = async (name, operation) => {
  const memoryBefore = process.memoryUsage();
  const started = performance.now();
  const value = await operation();
  const durationMs = performance.now() - started;
  const memoryAfter = process.memoryUsage();
  phaseRecords.push({
    name,
    durationMs: Number(durationMs.toFixed(2)),
    heapDeltaMiB: mib(memoryAfter.heapUsed - memoryBefore.heapUsed),
    rssMiB: mib(memoryAfter.rss)
  });
  return value;
};

const printHuman = (report) => {
  console.log("Ravel virtual-document performance harness");
  console.log(`Node ${report.runtime.node} on ${report.runtime.platform}/${report.runtime.arch}`);
  console.log(
    `Shape: ${report.shape.logicalLines.toLocaleString()} generated lines, ` +
    `${report.shape.requestedSegments.toLocaleString()} requested segments, ` +
    `${report.shape.textMiB} MiB UTF-16 text`
  );
  console.log("");
  console.log("Phase                         Time (ms)   Heap Δ MiB   RSS MiB");
  for (const phase of report.phases) {
    console.log(
      `${phase.name.padEnd(29)}${phase.durationMs.toFixed(2).padStart(10)}` +
      `${phase.heapDeltaMiB.toFixed(2).padStart(13)}${phase.rssMiB.toFixed(2).padStart(10)}`
    );
  }
  console.log("");
  console.log(
    `Mapping: ${report.mapping.virtualLookupsPerSecond.toLocaleString()} virtual→source/s, ` +
    `${report.mapping.sourceLookupsPerSecond.toLocaleString()} source→virtual/s ` +
    `(${report.mapping.lookupsEach.toLocaleString()} each)`
  );
  console.log(
    `Reuse: mappings=${report.cache.reusedMappings}, indexes=${report.cache.reusedIndexes}, ` +
    `lineIndex=${report.cache.reusedLineIndex}; incremental=${report.incremental.changeKind}`
  );
  console.log(
    `Cancellation: ${report.cancellation.errorName}, published snapshot preserved=` +
    `${report.cancellation.publishedSnapshotPreserved}; service stats ${JSON.stringify(report.serviceStats)}`
  );
  console.log("Timing policy: informational-only (correctness invariants are enforced).");
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  let cancelAtNextYield;
  const service = createProjectionService({
    workspaceId: "benchmark",
    targetId: TARGET_ID,
    stage: "assembled",
    yieldEvery: 1,
    maxRetainedSnapshots: 3,
    scheduler: async () => {
      const controller = cancelAtNextYield;
      cancelAtNextYield = undefined;
      controller?.abort("intentional benchmark cancellation");
      await Promise.resolve();
    }
  });

  const base = await measure("fixture:cold", () => createBenchmarkProgram(options));
  const cold = await measure("projection:cold", () => service.update({
    id: "benchmark-cold",
    program: base.program,
    sourceVersions: { [SOURCE_URI]: 1 },
    sourceTexts: { [SOURCE_URI]: base.sourceText }
  }));
  invariant(cold.opened.length === 1, "cold update should open exactly one projection");
  const coldDocument = cold.opened[0];
  invariant(coldDocument.text === base.sourceText, "cold projection text should equal its source fixture");

  const cached = await measure("projection:cache-hit", () => service.update({
    id: "benchmark-cache-hit",
    program: base.program,
    sourceVersions: { [SOURCE_URI]: 1 },
    sourceTexts: { [SOURCE_URI]: base.sourceText }
  }));
  invariant(cached.unchanged.length === 1, "identical input should take the unchanged cache path");
  const cachedDocument = cached.unchanged[0];
  const cache = {
    reusedMappings: cachedDocument.mappings === coldDocument.mappings,
    reusedIndexes: cachedDocument.indexes === coldDocument.indexes,
    reusedLineIndex: cachedDocument.lineIndex === coldDocument.lineIndex
  };
  invariant(Object.values(cache).every(Boolean), "cache hit should retain mapping and line-index identities");

  const mutationLine = Math.floor(options.lines / 2);
  const changed = await measure("fixture:incremental", () => createBenchmarkProgram({
    ...options,
    mutationLine
  }));
  invariant(changed.sourceText.length === base.sourceText.length, "mutation must preserve source length");

  const incremental = await measure("projection:incremental", () => service.update({
    id: "benchmark-incremental",
    program: changed.program,
    sourceVersions: { [SOURCE_URI]: 2 },
    sourceTexts: { [SOURCE_URI]: changed.sourceText }
  }));
  invariant(incremental.changed.length === 1, "one changed artifact should produce one changed projection");
  const document = incremental.changed[0];
  const textChange = incremental.textChanges[document.id];
  invariant(textChange?.kind === "incremental", "single-line mutation should use incremental text sync");
  invariant(textChange.changes.length === 1, "incremental sync should contain one replacement");

  const warmupCount = Math.min(500, options.lookups);
  const offsetFor = (index) => {
    const line = (index * 7_919 + 104_729) % options.lines;
    return line * changed.lineWidth + 8;
  };
  for (let index = 0; index < warmupCount; index += 1) {
    mapVirtualOffset(document, offsetFor(index), { affinity: "none" });
    mapSourceOffset(document, SOURCE_URI, offsetFor(index), { affinity: "none" });
  }

  let virtualChecksum = 0;
  await measure("mapping:virtual-to-source", () => {
    for (let index = 0; index < options.lookups; index += 1) {
      const offset = offsetFor(index);
      const result = mapVirtualOffset(document, offset, { affinity: "none" });
      invariant(result.ok && result.matches.length === 1, `virtual lookup ${index} should be exact`);
      virtualChecksum += result.matches[0].sourceOffset;
    }
  });

  let sourceChecksum = 0;
  await measure("mapping:source-to-virtual", () => {
    for (let index = 0; index < options.lookups; index += 1) {
      const offset = offsetFor(index);
      const result = mapSourceOffset(document, SOURCE_URI, offset, { affinity: "none" });
      const exactMatches = result.ok
        ? result.matches.filter((match) => match.quality === "exact")
        : [];
      invariant(exactMatches.length === 1, `source lookup ${index} should have one exact candidate`);
      sourceChecksum += exactMatches[0].virtualOffset;
    }
  });
  invariant(virtualChecksum === sourceChecksum, "bidirectional lookup checksums should agree");

  const publishedBeforeCancellation = service.getProjection(document.id);
  const cancellationController = new AbortController();
  cancelAtNextYield = cancellationController;
  let cancellationError;
  await measure("projection:cancellation", async () => {
    try {
      await service.update({
        id: "benchmark-cancelled",
        program: changed.program,
        sourceVersions: { [SOURCE_URI]: 2 },
        sourceTexts: { [SOURCE_URI]: changed.sourceText },
        projections: [
          { artifactId: ARTIFACT_ID, targetId: TARGET_ID },
          { artifactId: ARTIFACT_ID, targetId: `${TARGET_ID}-cancel-probe` }
        ]
      }, cancellationController.signal);
    } catch (error) {
      cancellationError = error;
    }
  });
  invariant(cancellationError?.name === "AbortError", "yield-boundary cancellation should reject with AbortError");
  invariant(service.getProjection(document.id) === publishedBeforeCancellation,
    "cancelled updates must not replace the published projection");

  const virtualPhase = phaseRecords.find((entry) => entry.name === "mapping:virtual-to-source");
  const sourcePhase = phaseRecords.find((entry) => entry.name === "mapping:source-to-virtual");
  const report = {
    schemaVersion: 1,
    timingPolicy: "informational-only",
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    shape: {
      logicalLines: options.lines,
      lineIndexEntries: document.lineIndex.lineStarts.length,
      requestedSegments: options.segments,
      mappings: document.mappings.length,
      occurrences: document.occurrences.length,
      textCodeUnits: document.text.length,
      textMiB: mib(document.text.length * 2)
    },
    phases: phaseRecords,
    mapping: {
      lookupsEach: options.lookups,
      virtualLookupsPerSecond: Math.round(options.lookups / virtualPhase.durationMs * 1_000),
      sourceLookupsPerSecond: Math.round(options.lookups / sourcePhase.durationMs * 1_000),
      checksum: virtualChecksum
    },
    cache,
    incremental: {
      mutationLine,
      changeKind: textChange.kind,
      replacementCount: textChange.changes.length,
      replacedCodeUnits: textChange.changes[0].range.end - textChange.changes[0].range.start,
      insertedCodeUnits: textChange.changes[0].text.length
    },
    cancellation: {
      errorName: cancellationError.name,
      message: cancellationError.message,
      publishedSnapshotPreserved: service.getProjection(document.id) === publishedBeforeCancellation
    },
    serviceStats: service.getStats()
  };

  service.dispose();
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    printHuman(report);
    console.log("");
    console.log(`RESULT_JSON ${JSON.stringify(report)}`);
  }
};

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
