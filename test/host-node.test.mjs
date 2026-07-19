import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadBuildInput, loadPretransformGraph } from "../packages/host-node/src/index.js";
import { transformGraph } from "../packages/core/src/index.js";

test("Node host joins in maps and produces out deliverables", async () => {
  const entry = fileURLToPath(
    new URL("../examples/poc/project.ravel-map.json", import.meta.url),
  );
  const pretransform = await loadPretransformGraph(entry);
  const program = transformGraph(pretransform);

  assert.deepEqual(program.diagnostics, []);
  assert.deepEqual(Object.keys(program.chunks).sort(), ["library::greeting", "project::greeting", "project::greeting:browser", "project::main"]);
  assert.deepEqual(Object.keys(program.deliverables).sort(), [
    "dist/greeting.js",
    "generated/greeting.js"
  ]);
  assert.match(program.deliverables["dist/greeting.js"].value, /console\.log\(greeting\)/);
  assert.equal(program.deliverables["generated/greeting.js"].value, "const greeting = 'Hello, Ravel!';\n");
});

test("Node host loads one TOML build run containing multiple Markdown files", async () => {
  const config = fileURLToPath(
    new URL("../fixtures/markdown/ravel-web.toml", import.meta.url),
  );
  const loaded = await loadBuildInput(config);
  const program = transformGraph(loaded.pretransform);

  assert.deepEqual(program.diagnostics, []);
  assert.match(loaded.outputDirectory, /\.ravel\/runs\/markdown-web$/);
  assert.deepEqual(Object.keys(program.chunks).sort(), [
    "handbook::compiler:what.ts",
    "handbook::main.javascript",
    "runtime::support.javascript"
  ]);
  assert.equal(program.deliverables["dist/main.js"].from, "handbook::main.javascript");
  assert.match(program.deliverables["dist/main.js"].value, /export const finish/);
});
