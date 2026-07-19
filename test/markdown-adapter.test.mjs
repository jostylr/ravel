import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { markdownToMap } from "../packages/markdown/src/index.js";

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
