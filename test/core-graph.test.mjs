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

test("reports duplicate document identities before graph evaluation", () => {
  const first = { version: 1, document: { id: "guide", uri: "first.md", format: "markdown+ravel-v1" }, chunks: [], directives: [] };
  const second = { version: 1, document: { id: "guide", uri: "second.md", format: "markdown+ravel-v1" }, chunks: [], directives: [] };
  const graph = combineMaps([first, second]);
  assert.deepEqual(graph.documents.map((document) => document.uri), ["first.md"]);
  assert.deepEqual(graph.diagnostics.map((diagnostic) => diagnostic.code), ["RV102"]);
  assert.match(graph.diagnostics[0].message, /Duplicate document ID: guide/);
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

test("embedded substitutions indent nonblank continuation lines to their use site", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      {
        id: "guide::function-def",
        identity: identity("guide", "function-def"),
        body: "function () {\n  return 1;\n}\n\n",
        source: source("guide", 0)
      },
      {
        id: "guide::main",
        identity: identity("guide", "main"),
        body: "  handler = _\"function-def\"",
        source: source("guide", 10)
      }
    ],
    directives: []
  }]);

  const program = transformGraph(graph);

  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::main"].value, "  handler = function () {\n    return 1;\n  }\n\n");
});

test("emitted chunks do not inherit their emit call's continuation indentation", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "guide::source", identity: identity("guide", "source"), body: "one\n  two", source: source("guide", 0) },
      {
        id: "guide::main",
        identity: identity("guide", "main"),
        body: "  _\"source | emit('plain')\"",
        source: source("guide", 10)
      }
    ],
    directives: []
  }]);

  const program = transformGraph(graph);

  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::main"].value, "  one\n    two");
  assert.equal(program.chunks["guide::main:plain"].value, "one\n  two");
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

test("compose pipe transforms its accumulator while pass tees an emitted value", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{
      id: "guide::source",
      identity: identity("guide", "source"),
      body: "  value  \n",
      source: source("guide", 0)
    }],
    directives: [{
      kind: "create",
      document: "guide",
      name: "program:stage.js",
      compose: [
        { kind: "append", reference: "source", source: source("guide", 1) },
        {
          kind: "pass",
          source: source("guide", 2),
          steps: [
            { type: "transform", name: "trim", arguments: [], source: source("guide", 2) },
            { type: "emit", suffix: { minor: "observed", type: "js", inheritMinor: false }, metadata: {}, source: source("guide", 2) }
          ]
        },
        {
          kind: "pipe",
          source: source("guide", 3),
          steps: [
            { type: "transform", name: "trim", arguments: [], source: source("guide", 3) },
            { type: "emit", suffix: { minor: "min", type: "js", inheritMinor: false }, metadata: {}, source: source("guide", 3) },
            { type: "transform", name: "indent", arguments: [2], source: source("guide", 3) }
          ]
        }
      ],
      source: source("guide", 1)
    }]
  }]);

  const program = transformGraph(graph);
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::program:stage.js"].value, "  value");
  assert.equal(program.chunks["guide::program:observed.js"].value, "value");
  assert.equal(program.chunks["guide::program:min.js"].value, "value");
  assert.equal(program.chunks["guide::program:observed.js"].provenance[0].compose.stepKind, "pass");
  assert.equal(program.chunks["guide::program:min.js"].provenance[0].compose.stepKind, "pipe");
});

test("definition pipelines execute around delayed substitutions and retain phase snapshots", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      {
        id: "guide::content",
        identity: identity("guide", "content"),
        body: "markdown",
        source: source("guide", 0)
      },
      {
        id: "guide::page",
        identity: identity("guide", "page"),
        body: "before _\"|delay(ch('content | wrap()'), 1, 'SAFESLOT')\"",
        definitionPipeline: [{ type: "transform", name: "outer", arguments: [], source: source("guide", 1) }],
        source: source("guide", 1)
      }
    ],
    directives: []
  }]);

  const program = transformGraph(graph, {
    transforms: {
      outer: (value) => value + "<after-outer>",
      wrap: (value) => "<p>" + value + "</p>"
    }
  });

  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::page"].value, "before <p>markdown</p><after-outer>");
  assert.deepEqual(program.trace.chunks["guide::page"].map((entry) => entry.stage), [
    "protected-input", "transform-output", "fulfilled-output"
  ]);
  assert.match(program.trace.chunks["guide::page"][0].value, /SAFESLOT/);
  assert.equal(program.trace.chunks["guide::page"][2].value, "before <p>markdown</p><after-outer>");
});

test("delay reports a transform that does not preserve its safe symbol", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "guide::content", identity: identity("guide", "content"), body: "ready", source: source("guide", 0) },
      {
        id: "guide::page",
        identity: identity("guide", "page"),
        body: "_\"|delay(ch('content'), 1, 'SAFESLOT')\"",
        definitionPipeline: [{ type: "transform", name: "erase", arguments: [], source: source("guide", 1) }],
        source: source("guide", 1)
      }
    ],
    directives: []
  }]);
  const program = transformGraph(graph, { transforms: { erase: () => "" } });
  assert.equal(program.diagnostics[0].code, "RV123");
});

test("automatic delay symbols are deterministic and avoid authored collisions", () => {
  const graph = (body) => combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{
      id: "guide::page",
      identity: identity("guide", "page"),
      body,
      definitionPipeline: [{ type: "transform", name: "concat", arguments: [], source: source("guide", 1) }],
      source: source("guide", 1)
    }],
    directives: []
  }]);

  const first = transformGraph(graph("_\"|delay('later')\""));
  const second = transformGraph(graph("_\"|delay('later')\""));
  const token = first.trace.chunks["guide::page"][2].delays[0].safeSymbol;
  assert.match(token, /^RAVELDELAY[A-Z0-9]+$/);
  assert.equal(second.trace.chunks["guide::page"][2].delays[0].safeSymbol, token);

  const collision = transformGraph(graph("_\"|delay('later')\" " + token));
  const collisionToken = collision.trace.chunks["guide::page"][2].delays[0].safeSymbol;
  assert.notEqual(collisionToken, token);
  assert.deepEqual(collision.diagnostics, []);
  assert.equal(collision.chunks["guide::page"].value, "later " + token);
});

test("text and ch reset a pipeline and ch can contain an empty-segment pipeline", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "guide::source", identity: identity("guide", "source"), body: "ignored", source: source("guide", 0) },
      {
        id: "guide::main",
        identity: identity("guide", "main"),
        body: "_\"source | text('cool') | capitalize()\" _`|ch('|text(\"cool\")|capitalize()')` _\"source | surround(text('['), ch('source'))\"",
        source: source("guide", 1)
      },
      {
        id: "guide::empty",
        identity: identity("guide", "empty"),
        body: "_\"source | text()\"",
        source: source("guide", 2)
      }
    ],
    directives: []
  }]);
  const program = transformGraph(graph, {
    transforms: {
      capitalize: (value) => value[0].toUpperCase() + value.slice(1),
      surround: (value, context) => context.arguments[0] + value + context.arguments[1]
    }
  });
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::main"].value, "Cool Cool [ignoredignored");
  assert.equal(program.chunks["guide::empty"].value, "");
});

test("delay is permitted only as an isolated top-level empty-segment command", () => {
  const graph = combineMaps([{
    document: { id: "guide", uri: "guide.ravel-map.json", format: "ravel-map-v1" },
    chunks: [{
      id: "guide::main",
      identity: identity("guide", "main"),
      body: "_\"|delay(ch('source'))|capitalize()\"",
      source: source("guide", 0)
    }],
    directives: []
  }]);
  const program = transformGraph(graph);
  assert.equal(program.diagnostics[0].code, "RV121");
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

test("settles forward references before reporting deterministic cycles", () => {
  const forward = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "test::main", identity: identity("test", "main"), body: "_\"later\"", source: source("test", 0) },
      { id: "test::later", identity: identity("test", "later"), body: "ready\n", source: source("test", 1) }
    ],
    directives: []
  }]);
  assert.deepEqual(transformGraph(forward).diagnostics, []);

  const cyclic = combineMaps([{
    document: { id: "test", uri: "test.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "test::first", identity: identity("test", "first"), body: "_\"second\"", source: source("test", 0) },
      { id: "test::second", identity: identity("test", "second"), body: "_\"first\"", source: source("test", 1) }
    ],
    directives: []
  }]);
  const program = transformGraph(cyclic);
  assert.equal(program.diagnostics[0].code, "RV112");
  assert.match(program.diagnostics[0].message, /test::first → test::second → test::first/);
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
