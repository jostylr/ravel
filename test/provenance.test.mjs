import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  combineMaps,
  createDeliverableProvenanceMap,
  generatedRangesForSource,
  sourceAtGeneratedOffset,
  transformGraph
} from "../packages/core/src/index.js";
import {
  cleanManagedArtifacts,
  writeBuildArtifacts
} from "../packages/host-node/src/index.js";
import { markdownToMap } from "../packages/markdown/src/index.js";

const source = (offset) => ({
  uri: "guide.md",
  range: {
    start: { line: 0, column: 0, offset },
    end: { line: 0, column: 0, offset: offset + 1 }
  }
});

const identity = (chunk) => ({ document: "guide", chunk, minor: null, type: null });

const provenanceProgram = () => transformGraph(combineMaps([{
  version: 1,
  document: { id: "guide", uri: "guide.md", format: "ravel-map-v1" },
  chunks: [
    { id: "guide::leaf", identity: identity("leaf"), body: "LEAF", source: source(100) },
    { id: "guide::middle", identity: identity("middle"), body: "[_\"leaf\"]", source: source(200) },
    { id: "guide::main", identity: identity("main"), body: "A _\"middle\" Z", source: source(300) },
    { id: "guide::trimmed", identity: identity("trimmed"), body: "_\"leaf | trim()\"", source: source(500) }
  ],
  directives: [
    { kind: "out", name: "app.txt", from: "guide::main", source: source(600) },
    { kind: "out", name: "trimmed.txt", from: "guide::trimmed", source: source(700) }
  ]
}]));

test("provenance maps exact nested substitutions and supports forward and reverse queries", () => {
  const program = provenanceProgram();
  const map = createDeliverableProvenanceMap(program.deliverables["app.txt"]);

  assert.equal(program.deliverables["app.txt"].value, "A [LEAF] Z");
  assert.deepEqual(map.segments.map((segment) => [
    segment.generated.start,
    segment.generated.end,
    segment.chunk,
    segment.precision
  ]), [
    [0, 2, "guide::main", "exact"],
    [2, 3, "guide::middle", "exact"],
    [3, 7, "guide::leaf", "exact"],
    [7, 8, "guide::middle", "exact"],
    [8, 10, "guide::main", "exact"]
  ]);

  const leaf = sourceAtGeneratedOffset(map, 4);
  assert.equal(leaf.source.uri, "guide.md");
  assert.equal(leaf.sourceOffset, 101);
  assert.deepEqual(leaf.via.map(({ from, to }) => [from, to]), [
    ["guide::middle", "guide::leaf"],
    ["guide::main", "guide::middle"]
  ]);
  assert.deepEqual(generatedRangesForSource(map, "guide.md", 101), [{
    generated: { start: 3, end: 7 },
    generatedOffset: 4,
    precision: "exact",
    chunk: "guide::leaf",
    kind: "literal",
    via: leaf.via
  }]);
});

test("arbitrary transforms retain honest coarse provenance", () => {
  const program = provenanceProgram();
  const map = createDeliverableProvenanceMap(program.deliverables["trimmed.txt"]);

  assert.equal(map.segments.length, 1);
  assert.equal(map.segments[0].precision, "coarse");
  assert.equal(map.segments[0].kind, "transform");
  assert.equal(sourceAtGeneratedOffset(map, 1).sourceOffset, undefined);
});

test("greedy Markdown chunks retain their non-contiguous source fragments", () => {
  const markdown = [
    "```js {.ravel .greedy #main}",
    "first",
    "```",
    "",
    "narrative between fragments",
    "",
    "```js",
    "second",
    "```",
    "",
    "```js {.end}",
    "third",
    "```",
    "",
    "```ravel",
    "out(\"dist/greedy.js\", _\"main.js\")",
    "```",
    ""
  ].join("\n");
  const adapted = markdownToMap(markdown, {
    uri: "guide.md",
    document: "guide",
    mode: "primary"
  });
  const program = transformGraph(combineMaps([adapted.map]));
  const segments = program.deliverables["dist/greedy.js"].segments;

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(program.deliverables["dist/greedy.js"].value, "first\nsecond\nthird\n");
  assert.deepEqual(segments.map((segment) => [
    segment.generated,
    segment.source.range.start.line,
    segment.precision
  ]), [
    [{ start: 0, end: 6 }, 1, "exact"],
    [{ start: 6, end: 13 }, 7, "exact"],
    [{ start: 13, end: 19 }, 11, "exact"]
  ]);
});

test("the Node host writes managed sidecar and aggregate provenance maps", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-provenance-"));
  const output = join(sandbox, "build");
  try {
    const program = provenanceProgram();
    const result = await writeBuildArtifacts(program, output, {
      rootDirectory: sandbox,
      generatedAt: "2026-07-23T12:34:56.000Z"
    });
    const sidecar = JSON.parse(await readFile(join(output, "app.txt.ravelmap"), "utf8"));
    const aggregate = JSON.parse(await readFile(join(output, ".ravelmap"), "utf8"));
    const manifest = JSON.parse(await readFile(join(output, ".ravel-manifest.json"), "utf8"));

    assert.deepEqual(aggregate.maps[0], sidecar);
    assert.equal(manifest.provenance.aggregate, ".ravelmap");
    assert.equal(manifest.deliverables[0].ravelmap, "app.txt.ravelmap");
    assert.equal(result.provenance.sidecars.length, 2);

    await cleanManagedArtifacts(output, { rootDirectory: sandbox });
    await assert.rejects(readFile(join(output, "app.txt.ravelmap"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(output, ".ravelmap"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
