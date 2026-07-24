import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  combineMaps,
  createDeliverableProvenanceMap,
  explainGeneratedOffset,
  generatedRangesForSource,
  generatedRangesForSourceRange,
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
    {
      id: "guide::trimmed",
      identity: identity("trimmed"),
      body: "_\"leaf | replace('E', 'e')\"",
      source: source(500)
    }
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
  assert.deepEqual(generatedRangesForSourceRange(map, "guide.md", {
    start: 101,
    end: 103
  })[0].generated, { start: 4, end: 6 });

  const explanation = explainGeneratedOffset(program, "app.txt", 4);
  assert.equal(explanation.definition.id, "guide::leaf");
  assert.deepEqual(explanation.dependencyPath, [
    "guide::main",
    "guide::middle",
    "guide::leaf"
  ]);
});

test("arbitrary transforms retain honest coarse provenance", () => {
  const program = provenanceProgram();
  const map = createDeliverableProvenanceMap(program.deliverables["trimmed.txt"]);

  assert.equal(map.segments.length, 1);
  assert.equal(map.segments[0].precision, "coarse");
  assert.equal(map.segments[0].kind, "transform");
  assert.equal(sourceAtGeneratedOffset(map, 1).sourceOffset, undefined);
  assert.equal(map.segments[0].origins[0].chunk, "guide::leaf");
  assert.deepEqual(generatedRangesForSource(map, "guide.md", 101).map((match) => ({
    generated: match.generated,
    precision: match.precision,
    through: match.through
  })), [{
    generated: { start: 0, end: 4 },
    precision: "coarse",
    through: "transform-origin"
  }]);
});

test("continuation indentation preserves source text exactly and marks only inserted spaces coarse", () => {
  const program = transformGraph(combineMaps([{
    version: 1,
    document: { id: "guide", uri: "guide.md", format: "ravel-map-v1" },
    chunks: [
      {
        id: "guide::leaf",
        identity: identity("leaf"),
        body: "one\n  two\n\nthree",
        source: source(100)
      },
      {
        id: "guide::indented",
        identity: identity("indented"),
        body: "  value = _\"leaf\"",
        source: source(300)
      }
    ],
    directives: [
      { kind: "out", name: "indented.txt", from: "guide::indented", source: source(500) }
    ]
  }]));
  const map = createDeliverableProvenanceMap(program.deliverables["indented.txt"]);

  assert.equal(program.deliverables["indented.txt"].value, "  value = one\n    two\n\n  three");
  assert.deepEqual(map.segments.map(({ generated, kind, precision }) => ({
    generated,
    kind,
    precision
  })), [
    { generated: { start: 0, end: 10 }, kind: "literal", precision: "exact" },
    { generated: { start: 10, end: 14 }, kind: "literal", precision: "exact" },
    { generated: { start: 14, end: 16 }, kind: "continuation-indent", precision: "coarse" },
    { generated: { start: 16, end: 23 }, kind: "literal", precision: "exact" },
    { generated: { start: 23, end: 25 }, kind: "continuation-indent", precision: "coarse" },
    { generated: { start: 25, end: 30 }, kind: "literal", precision: "exact" }
  ]);
  assert.equal(sourceAtGeneratedOffset(map, 19).sourceOffset, 107);
  assert.equal(sourceAtGeneratedOffset(map, 24).sourceOffset, undefined);
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

test("compose, alias, and emit retain explicit derivation steps", () => {
  const extendedIdentity = (chunk, minor = null, type = null) => ({
    document: "guide",
    chunk,
    minor,
    type
  });
  const program = transformGraph(combineMaps([{
    version: 1,
    document: { id: "guide", uri: "guide.md", format: "ravel-map-v1" },
    chunks: [
      {
        id: "guide::source",
        identity: extendedIdentity("source"),
        body: "value",
        source: source(10)
      },
      {
        id: "guide::emitter",
        identity: extendedIdentity("emitter"),
        body: "_\"source | emit('copy.js')\"",
        source: source(20)
      }
    ],
    directives: [
      {
        kind: "create",
        document: "guide",
        name: "assembled.js",
        compose: [
          { kind: "append", reference: "source", source: source(30) },
          { kind: "newline", count: 2, source: source(31) },
          { kind: "append", reference: "source", source: source(32) }
        ],
        source: source(30)
      },
      {
        kind: "alias",
        document: "guide",
        name: "public.js",
        reference: "assembled.js",
        source: source(40)
      },
      { kind: "out", name: "public.js", from: "guide::public.js", source: source(50) },
      { kind: "out", name: "copy.js", from: "guide::emitter:copy.js", source: source(51) }
    ]
  }]));

  const publicMap = createDeliverableProvenanceMap(program.deliverables["public.js"]);
  assert.equal(program.deliverables["public.js"].value, "value\n\nvalue");
  assert.deepEqual(publicMap.segments.map(({ generated, kind, precision }) => ({
    generated,
    kind,
    precision
  })), [
    { generated: { start: 0, end: 5 }, kind: "literal", precision: "exact" },
    { generated: { start: 5, end: 7 }, kind: "compose-newline", precision: "coarse" },
    { generated: { start: 7, end: 12 }, kind: "literal", precision: "exact" }
  ]);
  assert.deepEqual(publicMap.segments[0].via.map(({ kind }) => kind), [
    "reference",
    "create",
    "reference",
    "alias"
  ]);
  assert.equal(generatedRangesForSource(publicMap, "guide.md", 11).length, 2);

  const emittedMap = createDeliverableProvenanceMap(program.deliverables["copy.js"]);
  assert.deepEqual(emittedMap.segments[0].via.map(({ kind }) => kind), [
    "reference",
    "emit"
  ]);
  assert.equal(emittedMap.segments[0].via[1].owner, "guide::emitter");
});

test("delayed substitutions preserve the fulfilled chunk and transformed input origins", () => {
  const program = transformGraph(combineMaps([{
    version: 1,
    document: { id: "guide", uri: "guide.md", format: "ravel-map-v1" },
    chunks: [
      {
        id: "guide::content",
        identity: identity("content"),
        body: "ready",
        source: source(100)
      },
      {
        id: "guide::page",
        identity: identity("page"),
        body: "before _\"|delay(ch('content'), 1, 'SLOT')\" after",
        definitionPipeline: [{
          type: "transform",
          name: "identity-transform",
          arguments: [],
          source: source(300)
        }],
        source: source(200)
      }
    ],
    directives: [
      { kind: "out", name: "page.txt", from: "guide::page", source: source(400) }
    ]
  }]), {
    transforms: { "identity-transform": (value) => value }
  });
  const map = createDeliverableProvenanceMap(program.deliverables["page.txt"]);

  assert.equal(program.deliverables["page.txt"].value, "before ready after");
  assert.deepEqual(map.segments.map(({ generated, chunk, precision }) => ({
    generated,
    chunk,
    precision
  })), [
    { generated: { start: 0, end: 7 }, chunk: "guide::page", precision: "coarse" },
    { generated: { start: 7, end: 12 }, chunk: "guide::content", precision: "exact" },
    { generated: { start: 12, end: 18 }, chunk: "guide::page", precision: "coarse" }
  ]);
  assert.deepEqual(map.segments[0].origins.map(({ kind }) => kind), [
    "literal",
    "delay-placeholder",
    "literal"
  ]);
  assert.deepEqual(map.segments[1].via.map(({ from, to }) => [from, to]), [
    ["guide::page", "guide::content"]
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
