import assert from "node:assert/strict";
import test from "node:test";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";

const source = (uri, offset = 0) => ({
  uri,
  range: {
    start: { line: 0, column: 0, offset },
    end: { line: 0, column: 0, offset: offset + 1 }
  }
});

test("transforms references, expands emit chunks, and plans out deliverables", () => {
  const graph = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "base", body: "hello\n", metadata: { language: "text" }, source: source("test", 0) },
      {
        id: "main",
        body: "_`base | indent(2) | emit('base.indented', {\"language\": \"text\", \"tags\": [\"derived\"]})`",
        source: source("test", 10)
      }
    ],
    directives: [
      { kind: "out", name: "main.txt", from: "main", source: source("test", 20) },
      { kind: "out", name: "derived.txt", from: "base.indented", source: source("test", 30) }
    ]
  }]);

  const program = transformGraph(graph);

  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks.main.value, "  hello\n");
  assert.equal(program.chunks["base.indented"].value, "  hello\n");
  assert.deepEqual(program.chunks.main.dependencies, ["base"]);
  assert.equal(program.chunks["base.indented"].generated, true);
  assert.equal(program.chunks["base.indented"].provenance[0].kind, "emit");
  assert.equal(program.deliverables["main.txt"].value, "  hello\n");
  assert.equal(program.deliverables["derived.txt"].from, "base.indented");
});

test("reports unknown references with a source-linked diagnostic", () => {
  const graph = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{ id: "main", body: "_\"missing\"", source: source("test", 0) }],
    directives: []
  }]);

  const program = transformGraph(graph);
  assert.equal(program.diagnostics[0].code, "RV111");
  assert.equal(program.chunks.main.value, "");
});
