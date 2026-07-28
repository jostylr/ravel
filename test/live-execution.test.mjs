import assert from "node:assert/strict";
import test from "node:test";
import {
  combineMaps,
  executeLiveProgram,
  planLiveExecutions,
  transformGraph
} from "@pieceful/ravel-core";
import {
  createJavaScriptLiveProvider,
  javascriptLiveProvider
} from "@pieceful/ravel-js-live";
import { validateRavelMap } from "@pieceful/ravel-map";
import { markdownToMap } from "@pieceful/ravel-markdown";

const liveProgram = (source, document = "live") => {
  const adapted = markdownToMap(source, {
    uri: document + ".md",
    document,
    mode: "primary"
  });
  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  return { map: adapted.map, program };
};

test("Markdown .run metadata drives QuickJS execution with immutable dependencies and resources", async () => {
  const source = [
    "```js {.run #source}",
    "export default [1, 2];",
    "```",
    "",
    "```javascript {.run #process}",
    "const input = ch(\"source\");",
    "const csv = load(\"cool.csv\");",
    "export default {",
    "  rows: input.map((value) => value * 2),",
    "  csv,",
    "  empty: \"\"",
    "};",
    "```",
    ""
  ].join("\n");
  const { map, program } = liveProgram(source);

  assert.equal(map.chunks[0].metadata.data.ravel.run, true);
  assert.equal(map.chunks[0].metadata.language, "js");
  assert.deepEqual(map.chunks[0].metadata.tags, []);

  const plan = planLiveExecutions(program, { providers: [javascriptLiveProvider] });
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.nodes["live::process.javascript"].dependencies.map(({ reference, id }) => ({ reference, id })),
    [{ reference: "source", id: "live::source.js" }]
  );

  const result = await executeLiveProgram(program, {
    providers: [javascriptLiveProvider],
    resources: { "cool.csv": "a,b\n1,2\n" }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.executions["live::source.js"].value, [1, 2]);
  assert.deepEqual(result.executions["live::process.javascript"].value, {
    rows: [2, 4],
    csv: "a,b\n1,2\n",
    empty: ""
  });
});

test("valid empty and falsy JavaScript exports remain distinct from a missing export", async () => {
  const cases = [
    ["empty-string", "\"\"", ""],
    ["empty-array", "[]", []],
    ["empty-object", "{}", {}],
    ["false-value", "false", false],
    ["zero-value", "0", 0],
    ["null-value", "null", null]
  ];
  for (const [name, expression, expected] of cases) {
    const { program } = liveProgram([
      "```js {.run #" + name + "}",
      "export default " + expression + ";",
      "```",
      ""
    ].join("\n"), name);
    const result = await executeLiveProgram(program, { providers: [javascriptLiveProvider] });
    assert.equal(result.ok, true, name);
    assert.deepEqual(result.executions[name + "::" + name + ".js"].value, expected);
  }

  const { program } = liveProgram([
    "```js {.run #missing}",
    "const value = 1;",
    "```",
    ""
  ].join("\n"), "missing");
  const missing = await executeLiveProgram(program, { providers: [javascriptLiveProvider] });
  assert.equal(missing.ok, false);
  assert.ok(missing.diagnostics.some((entry) => entry.code === "RJL101"));
});

test("live inputs are frozen copies and mutation cannot alter the producer", async () => {
  const { program } = liveProgram([
    "```js {.run #source}",
    "export default { rows: [1, 2] };",
    "```",
    "",
    "```js {.run #mutator}",
    "const input = ch(\"source\");",
    "input.rows.push(3);",
    "export default input;",
    "```",
    ""
  ].join("\n"), "immutability");

  const result = await executeLiveProgram(program, { providers: [javascriptLiveProvider] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.executions["immutability::source.js"].value, { rows: [1, 2] });
  assert.equal(result.executions["immutability::mutator.js"].status, "failed");
  assert.ok(result.diagnostics.some((entry) => entry.code === "RJL110"));
});

test("core execution planning remains language-neutral", async () => {
  const point = { line: 0, column: 0, offset: 0 };
  const source = { uri: "sample.rix", range: { start: point, end: point } };
  const program = {
    version: 1,
    documents: [{ id: "sample", uri: "sample.rix", format: "test" }],
    chunks: {
      "sample::value.rix": {
        id: "sample::value.rix",
        identity: { document: "sample", chunk: "value", minor: null, type: "rix" },
        value: "answer",
        metadata: { language: "rix", data: { ravel: { run: true } } },
        source,
        dependencies: [],
        references: [],
        provenance: []
      }
    },
    deliverables: {},
    diagnostics: [],
    trace: { chunks: {} }
  };
  const provider = {
    id: "test-rix",
    version: "1",
    languages: ["rix"],
    analyze: () => ({ dependencies: [], resources: [], diagnostics: [] }),
    execute: () => ({ ok: true, hasExport: true, value: { answer: 42 } })
  };

  const result = await executeLiveProgram(program, { providers: [provider] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.executions["sample::value.rix"].value, { answer: 42 });
});

test("live JavaScript rejects dynamic dependencies and respects execution deadlines", async () => {
  const point = { line: 0, column: 0, offset: 0 };
  const sourceLocation = { uri: "bad.js", range: { start: point, end: point } };
  const dynamic = javascriptLiveProvider.analyze({
    source: "const name = \"source.js\"; export default ch(name);",
    sourceLocation
  });
  assert.ok(dynamic.diagnostics.some((entry) => entry.code === "RJL107"));

  const timed = await javascriptLiveProvider.execute({
    id: "bad::loop.js",
    runId: "test",
    language: "js",
    source: "while (true) {} export default null;",
    sourceLocation,
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], diagnostics: [] },
    limits: { timeoutMs: 10 }
  });
  assert.equal(timed.ok, false);
  assert.ok(timed.diagnostics.some((entry) => entry.code === "RJL120"));
});

test("Ravel values reject lossy JSON coercions", async () => {
  const cases = [
    ["undefined", "undefined"],
    ["function", "() => 1"],
    ["non-finite", "Infinity"],
    ["cycle", "(() => { const value = {}; value.self = value; return value; })()"],
    ["accessor", "Object.defineProperty({}, \"value\", { get() { return 1; }, enumerable: true })"],
    ["symbol-key", "({ [Symbol(\"hidden\")]: 1 })"],
    ["sparse-array", "new Array(1)"]
  ];
  for (const [name, expression] of cases) {
    const { program } = liveProgram([
      "```js {.run #" + name + "}",
      "export default " + expression + ";",
      "```",
      ""
    ].join("\n"), "invalid-" + name);
    const result = await executeLiveProgram(program, { providers: [javascriptLiveProvider] });
    assert.equal(result.ok, false, name);
    assert.equal(result.executions["invalid-" + name + "::" + name + ".js"].status, "failed");
    assert.ok(result.diagnostics.some((entry) => entry.code === "RJL110"), name);
  }
});

test("the QuickJS realm exposes no ambient host capabilities", async () => {
  const { program } = liveProgram([
    "```js {.run #capabilities}",
    "export default {",
    "  process: typeof process,",
    "  require: typeof require,",
    "  fetch: typeof fetch,",
    "  console: typeof console",
    "};",
    "```",
    ""
  ].join("\n"), "sandbox");
  const result = await executeLiveProgram(program, { providers: [javascriptLiveProvider] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.executions["sandbox::capabilities.js"].value, {
    process: "undefined",
    require: "undefined",
    fetch: "undefined",
    console: "undefined"
  });

  const sourceLocation = program.chunks["sandbox::capabilities.js"].source;
  const imported = javascriptLiveProvider.analyze({
    source: "import value from \"host\"; export default value;",
    sourceLocation
  });
  assert.ok(imported.diagnostics.some((entry) => entry.code === "RJL108"));

  const internals = javascriptLiveProvider.analyze({
    source: "export default __ravelInputs;",
    sourceLocation
  });
  assert.ok(internals.diagnostics.some((entry) => entry.code === "RJL103"));
});

test("each JavaScript execution receives a fresh realm", async () => {
  const point = { line: 0, column: 0, offset: 0 };
  const request = {
    id: "realm::counter.js",
    runId: "realm",
    language: "js",
    source: [
      "globalThis.counter = (globalThis.counter ?? 0) + 1;",
      "export default globalThis.counter;"
    ].join("\n"),
    sourceLocation: {
      uri: "realm.md",
      range: { start: point, end: point }
    },
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], diagnostics: [] },
    limits: {}
  };
  const first = await javascriptLiveProvider.execute(request);
  const second = await javascriptLiveProvider.execute(request);
  assert.equal(JSON.parse(first.serialized), 1);
  assert.equal(JSON.parse(second.serialized), 1);
});

test("an untyped ch reference must identify exactly one local chunk", () => {
  const { program } = liveProgram([
    "```js {.run #source}",
    "export default 1;",
    "```",
    "",
    "```text {#source}",
    "static",
    "```",
    "",
    "```js {.run #consumer}",
    "export default ch(\"source\");",
    "```",
    ""
  ].join("\n"), "ambiguous");
  const plan = planLiveExecutions(program, { providers: [javascriptLiveProvider] });
  assert.equal(plan.ok, false);
  assert.ok(plan.diagnostics.some((entry) => entry.code === "RL109"));
});

test("approved virtual modules can provide a CSV parser without host access", async () => {
  const provider = createJavaScriptLiveProvider({
    modules: {
      "@ravel/csv": [
        "export const parseCsv = (text) =>",
        "  text.trim().split(/\\r?\\n/).map((line) => line.split(\",\"));"
      ].join("\n")
    }
  });
  const { program } = liveProgram([
    "```js {.run #parse}",
    "import { parseCsv } from \"@ravel/csv\";",
    "const csv = load(\"cool.csv\");",
    "export default parseCsv(csv);",
    "```",
    ""
  ].join("\n"), "modules");
  const plan = planLiveExecutions(program, { providers: [provider] });
  assert.deepEqual(
    plan.nodes["modules::parse.js"].modules.map(({ specifier }) => specifier),
    ["@ravel/csv"]
  );
  const result = await executeLiveProgram(program, {
    providers: [provider],
    resources: { "cool.csv": "name,value\nalpha,1\n" }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.executions["modules::parse.js"].value, [
    ["name", "value"],
    ["alpha", "1"]
  ]);
  await provider.dispose();
});

test("ordinary Ravel processing consumes live strings and whole or selected JSON text", async () => {
  const adapted = markdownToMap([
    "```js {.run #raw}",
    'export default "hello";',
    "```",
    "",
    "```js {.run #structured}",
    'export default { message: "world", details: { count: 2 } };',
    "```",
    "",
    "```text {.ravel #selected}",
    '_"structured.js | jsontext(\'message\')"',
    "```",
    "",
    "```json {.ravel #details}",
    '_"structured.js | jsontext(\'details\')"',
    "```",
    "",
    "```json {.ravel #whole}",
    '_"structured.js | jsontext()"',
    "```",
    "",
    "```ravel",
    'out("raw.txt", _"raw.js")',
    'out("selected.txt", _"selected.text")',
    'out("details.json", _"details.json")',
    'out("whole.json", _"whole.json")',
    "```",
    ""
  ].join("\n"), {
    uri: "materialize.md",
    document: "materialize",
    mode: "primary"
  });
  assert.deepEqual(adapted.diagnostics, []);
  const graph = combineMaps([adapted.map]);
  const executable = transformGraph(graph, { deferLiveResults: true });
  assert.deepEqual(executable.diagnostics, []);

  const liveResult = await executeLiveProgram(executable, {
    providers: [javascriptLiveProvider]
  });
  assert.equal(liveResult.ok, true);
  assert.deepEqual(liveResult.executions["materialize::structured.js"].value, {
    message: "world",
    details: { count: 2 }
  });

  const completed = transformGraph(graph, { liveResults: liveResult });
  assert.deepEqual(completed.diagnostics, []);
  assert.equal(completed.deliverables["raw.txt"].value, "hello");
  assert.equal(completed.deliverables["selected.txt"].value, "world\n");
  assert.equal(completed.deliverables["details.json"].value, '{"count":2}\n');
  assert.equal(
    completed.deliverables["whole.json"].value,
    '{"message":"world","details":{"count":2}}\n'
  );

  const invalid = transformGraph({
    ...graph,
    directives: [
      ...graph.directives,
      {
        kind: "out",
        name: "structured.json",
        from: "materialize::structured.js",
        source: graph.directives[0].source
      }
    ]
  }, { liveResults: liveResult });
  assert.ok(invalid.diagnostics.some((entry) =>
    entry.code === "RV140" && /requires a live string/.test(entry.message)
  ));
});

test("the host terminates and replaces an unresponsive worker", async () => {
  let terminated = false;
  let workersCreated = 0;
  class HangingWorker extends EventTarget {
    constructor() {
      super();
      setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
        data: { type: "ready" }
      })), 0);
    }

    postMessage(message) {
      if (message.type === "configure") {
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", {
          data: { type: "configured" }
        })), 0);
      }
    }

    terminate() {
      terminated = true;
    }
  }

  const provider = createJavaScriptLiveProvider({
    workerFactory: () => {
      workersCreated += 1;
      return new HangingWorker();
    },
    timeoutMs: 5,
    workerTerminationGraceMs: 1
  });
  const point = { line: 0, column: 0, offset: 0 };
  const outcome = await provider.execute({
    id: "worker::hang.js",
    runId: "worker",
    language: "js",
    source: "export default 1;",
    sourceLocation: {
      uri: "worker.md",
      range: { start: point, end: point }
    },
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], modules: [], diagnostics: [] },
    limits: {}
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.diagnostics.some((entry) => entry.code === "RJL120"));
  assert.equal(terminated, true);
  const replacementOutcome = await provider.execute({
    id: "worker::hang-again.js",
    runId: "worker",
    language: "js",
    source: "export default 2;",
    sourceLocation: {
      uri: "worker.md",
      range: { start: point, end: point }
    },
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], modules: [], diagnostics: [] },
    limits: {}
  });
  assert.equal(replacementOutcome.ok, false);
  assert.equal(workersCreated, 2);
  await provider.dispose();
});

test("cancellation terminates the outer worker and permits a later run", async () => {
  const provider = createJavaScriptLiveProvider({ timeoutMs: 5000 });
  const controller = new AbortController();
  const point = { line: 0, column: 0, offset: 0 };
  const sourceLocation = {
    uri: "cancel.md",
    range: { start: point, end: point }
  };
  const pending = provider.execute({
    id: "cancel::loop.js",
    runId: "cancel",
    language: "js",
    source: "while (true) {} export default null;",
    sourceLocation,
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], modules: [], diagnostics: [] },
    limits: {},
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 5);
  const cancelled = await pending;
  assert.equal(cancelled.ok, false);
  assert.ok(cancelled.diagnostics.some((entry) => entry.code === "RJL121"));

  const recovered = await provider.execute({
    id: "cancel::recovered.js",
    runId: "cancel",
    language: "js",
    source: "export default \"recovered\";",
    sourceLocation,
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], modules: [], diagnostics: [] },
    limits: {}
  });
  assert.equal(JSON.parse(recovered.serialized), "recovered");
  await provider.dispose();
});

test("serialized live output is quota limited inside the worker", async () => {
  const provider = createJavaScriptLiveProvider({ outputBytes: 4 });
  const point = { line: 0, column: 0, offset: 0 };
  const outcome = await provider.execute({
    id: "quota::output.js",
    runId: "quota",
    language: "js",
    source: "export default \"too large\";",
    sourceLocation: {
      uri: "quota.md",
      range: { start: point, end: point }
    },
    inputs: {},
    resources: {},
    analysis: { dependencies: [], resources: [], modules: [], diagnostics: [] },
    limits: {}
  });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.diagnostics.some((entry) => entry.code === "RJL122"));
  await provider.dispose();
});
