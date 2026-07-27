import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { markdownToMap } from "../packages/markdown/src/index.js";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";

const fixture = async (name) => readFile(new URL("../fixtures/markdown/" + name, import.meta.url), "utf8");

test("Markdown fences create source-mapped chunks with greedy continuations", async () => {
  const { map, diagnostics } = markdownToMap(await fixture("guide.md"), {
    uri: "fixtures/markdown/guide.md",
    mode: "primary"
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(map.document.id, "handbook");
  assert.deepEqual(map.chunks.map((chunk) => chunk.id), [
    "handbook::compiler:what.ts",
    "handbook::main.javascript"
  ]);
  const compiler = map.chunks[0];
  assert.match(compiler.body, /compile[\s\S]*parse[\s\S]*finish/);
  assert.equal(compiler.fragments.length, 3);
  assert.deepEqual(compiler.metadata.tags, ["browser"]);
  assert.equal(compiler.metadata.data.ravel.definitionPipe, "dedent() | emit('.js')");
  assert.deepEqual(compiler.definitionPipeline.map(({ name, arguments: args }) => ({ name, arguments: args })), [
    { name: "dedent", arguments: [] }
  ]);
  assert.equal(compiler.source.range.start.line, 8);
});

test("primary Markdown mode requires explicit Ravel classification", () => {
  const { diagnostics } = markdownToMap("```js\nconst example = true;\n```\n", {
    uri: "example.md",
    document: "example",
    mode: "primary"
  });
  assert.equal(diagnostics[0].code, "RM103");
});

test(".run marks a named fence as executable without changing its language or tags", () => {
  const { map, diagnostics } = markdownToMap(
    "```js {.run #analysis .browser provider=quickjs-wasm-worker}\nexport default \"\";\n```\n",
    { uri: "live.md", document: "live", mode: "primary" }
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(map.chunks[0].metadata.language, "js");
  assert.deepEqual(map.chunks[0].metadata.tags, ["browser"]);
  assert.deepEqual(map.chunks[0].metadata.data.ravel, {
    run: true,
    provider: "quickjs-wasm-worker"
  });
});

test(".run requires a stable identity", () => {
  const unnamed = markdownToMap("```js {.run}\nexport default 1;\n```\n", {
    uri: "live.md",
    document: "live",
    mode: "primary"
  });
  assert.match(unnamed.diagnostics[0].message, /\.run fence.*#chunk/);
});

test("ravel fences translate directives into portable staged composition IR", () => {
  const text = "```text {.ravel #source}\n  value  \n```\n\n```ravel\ncreate(\"program:stage.js\", compose(\n  _\"source.text\",\n  pass(trim(), emit(\"observed.js\")),\n  pipe(trim(), emit(\"min.js\"), indent(2))\n))\nalias(\"public.js\", _\"program:stage.js\")\nout(\"dist/stage.js\", _\"program:stage.js\")\n```\n";
  const { map, diagnostics } = markdownToMap(text, { uri: "guide.md", document: "guide", mode: "primary" });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(map.directives.map((directive) => directive.kind), ["create", "alias", "out"]);
  assert.equal(map.directives[0].compose[1].kind, "pass");
  assert.equal(map.directives[0].compose[2].steps[1].suffix, "min.js");
  assert.equal(map.directives[2].from, "guide::program:stage.js");

  const program = transformGraph(combineMaps([map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::program:stage.js"].value, "  value");
  assert.equal(program.chunks["guide::program:observed.js"].value, "value");
  assert.equal(program.chunks["guide::program:min.js"].value, "value");
  assert.equal(program.chunks["guide::public.js"].value, "  value");
  assert.equal(program.deliverables["dist/stage.js"].value, "  value");
});
