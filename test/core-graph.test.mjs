import assert from "node:assert/strict";
import test from "node:test";
import { combineMaps, formatChunkId, parseChunkId, transformGraph } from "../packages/core/src/index.js";

const source = (uri, offset = 0) => ({
  uri,
  range: {
    start: { line: 0, column: 0, offset },
    end: { line: 0, column: 0, offset: offset + 1 }
  }
});

const identity = (document, chunk, minor = null, type = null) => ({
  document, chunk, minor, type
});

test("parses and canonicalizes document, chunk, minor, and type addresses", () => {
  const cases = [
    ["guide::", identity("guide", null)],
    ["guide::.javascript", identity("guide", null, null, "javascript")],
    ["guide:::preamble.javascript", identity("guide", null, "preamble", "javascript")],
    ["guide::parser.javascript", identity("guide", "parser", null, "javascript")],
    ["guide::parser:preamble.javascript", identity("guide", "parser", "preamble", "javascript")],
    ["shared", identity(null, "shared")]
  ];

  for (const [address, expected] of cases) {
    const parsed = parseChunkId(address, { reference: true });
    assert.deepEqual(
      { document: parsed.document, chunk: parsed.chunk, minor: parsed.minor, type: parsed.type },
      expected
    );
    assert.equal(formatChunkId(parsed), address);
  }
});

test("transforms references, expands emit chunks, and plans out deliverables", () => {
  const graph = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      {
        id: "test::base",
        identity: identity("test", "base"),
        body: "hello\n",
        metadata: { language: "text" },
        source: source("test", 0)
      },
      {
        id: "test::main",
        identity: identity("test", "main"),
        body: "_`base | indent(2) | emit('indented', {\"language\": \"text\", \"tags\": [\"derived\"]})`",
        source: source("test", 10)
      }
    ],
    directives: [
      { kind: "out", name: "main.txt", from: "test::main", source: source("test", 20) },
      { kind: "out", name: "derived.txt", from: "test::main:indented", source: source("test", 30) }
    ]
  }]);

  const program = transformGraph(graph);

  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["test::main"].value, "  hello\n");
  assert.equal(program.chunks["test::main:indented"].value, "  hello\n");
  assert.deepEqual(program.chunks["test::main"].dependencies, ["test::base"]);
  assert.equal(program.chunks["test::main:indented"].generated, true);
  assert.equal(program.chunks["test::main:indented"].provenance[0].kind, "emit");
  assert.equal(program.deliverables["main.txt"].value, "  hello\n");
  assert.equal(program.deliverables["derived.txt"].from, "test::main:indented");
});

test("emit stays in the owner chunk and can change only its type", () => {
  const graph = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "test::source", identity: identity("test", "source"), body: "const value = 1;\n", source: source("test", 0) },
      {
        id: "test::compiler:what.ts",
        identity: identity("test", "compiler", "what", "ts"),
        body: "_\"source | emit('.js')\"",
        source: source("test", 1)
      }
    ],
    directives: []
  }]);

  const program = transformGraph(graph);
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["test::compiler:what.js"].value, "const value = 1;\n");
});

test("emit rejects attempts to redefine a document or base chunk", () => {
  const graph = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{
      id: "test::main",
      identity: identity("test", "main"),
      body: "_\"main | emit('other::target')\"",
      source: source("test", 0)
    }],
    directives: []
  }]);

  const program = transformGraph(graph);
  assert.equal(program.diagnostics[0].code, "RV131");
  assert.equal(program.chunks["test::main"].value, "");
  assert.equal(program.chunks["other::target"], undefined);
});

test("create imposes its document and alias retains target provenance", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{ id: "guide::source.js", identity: identity("guide", "source", null, "js"), body: "const source = true;\n", source: source("guide", 0) }],
    directives: [
      {
        kind: "create", document: "guide", name: "program:cool.js",
        compose: [
          { kind: "append", reference: "source.js", source: source("guide", 1) },
          { kind: "newline", count: 0, source: source("guide", 1) },
          { kind: "append", reference: "source.js", source: source("guide", 1) }
        ],
        source: source("guide", 1)
      },
      { kind: "alias", document: "guide", name: "public.js", reference: "program:cool.js", source: source("guide", 2) }
    ]
  }]);
  const program = transformGraph(graph);
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::program:cool.js"].value, "const source = true;\nconst source = true;\n");
  assert.equal(program.chunks["guide::public.js"].value, "const source = true;\nconst source = true;\n");
  assert.equal(program.chunks["guide::public.js"].provenance[0].kind, "alias");
});

test("reports unknown references with a source-linked diagnostic", () => {
  const graph = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{ id: "test::main", identity: identity("test", "main"), body: "_\"missing\"", source: source("test", 0) }],
    directives: []
  }]);

  const program = transformGraph(graph);
  assert.equal(program.diagnostics[0].code, "RV111");
  assert.equal(program.chunks["test::main"].value, "");
});

test("resolves local, global, root, minor, and typed chunk identities", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "guide::", identity: identity("guide", null), body: "root\n", source: source("guide", 0) },
      { id: "guide::.javascript", identity: identity("guide", null, null, "javascript"), body: "root type\n", source: source("guide", 1) },
      { id: "guide:::preamble.javascript", identity: identity("guide", null, "preamble", "javascript"), body: "root minor type\n", source: source("guide", 2) },
      { id: "guide::section", identity: identity("guide", "section"), body: "_\":preamble\"", source: source("guide", 3) },
      { id: "guide::section:preamble", identity: identity("guide", "section", "preamble"), body: "local minor\n", source: source("guide", 4) },
      { id: "guide::section.javascript", identity: identity("guide", "section", null, "javascript"), body: "local type\n", source: source("guide", 5) },
      { id: "guide::main", identity: identity("guide", "main"), body: "_\"section\"_\"shared\"_\"guide::\"_\"guide::.javascript\"_\"guide:::preamble.javascript\"_\"section.javascript\"", source: source("guide", 6) },
      { id: "shared", identity: identity(null, "shared"), body: "global\n", source: source("guide", 7) }
    ],
    directives: []
  }]);

  const program = transformGraph(graph);
  assert.deepEqual(program.diagnostics, []);
  assert.equal(
    program.chunks["guide::main"].value,
    "local minor\nglobal\nroot\nroot type\nroot minor type\nlocal type\n"
  );
  assert.deepEqual(program.chunks["guide::section"].dependencies, ["guide::section:preamble"]);
  assert.equal(program.chunks["guide::main"].references[1].chunk, "shared");
});
