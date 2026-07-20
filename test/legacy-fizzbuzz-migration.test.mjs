import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { loadBuildInput, writeDeliverables } from "../packages/host-node/src/index.js";
import { transformGraph } from "../packages/core/src/index.js";
import { markdownToMap } from "../packages/markdown/src/index.js";

const run = promisify(execFile);
const migrationConfig = fileURLToPath(new URL("../examples/migration/ravel-fizzbuzz.toml", import.meta.url));

test("the legacy FizzBuzz migration builds static, runnable outputs", async () => {
  const source = await readFile(new URL("../examples/migration/fizzbuzz.md", import.meta.url), "utf8");
  const parsed = markdownToMap(source, {
    uri: "examples/migration/fizzbuzz.md",
    mode: "primary"
  });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.map.document.id, "fizzbuzz");
  assert.equal(parsed.map.chunks.find((chunk) => chunk.id === "fizzbuzz::program:helpers.js").fragments.length, 3);

  const loaded = await loadBuildInput(migrationConfig);
  const program = transformGraph(loaded.pretransform);

  assert.deepEqual(program.diagnostics, []);
  assert.deepEqual(Object.keys(program.chunks).sort(), [
    "fizzbuzz-library::format-output.js",
    "fizzbuzz::fizzbuzz.js",
    "fizzbuzz::fizzbuzz:compact.js",
    "fizzbuzz::fizzbuzz:source.js",
    "fizzbuzz::program:helpers.js",
    "fizzbuzz::program:initial-array.js",
    "fizzbuzz::program:main.js",
    "fizzbuzz::program:preamble.js",
    "fizzbuzz::public.js"
  ]);
  assert.match(program.chunks["fizzbuzz::program:helpers.js"].value, /function overwriteMultiples[\s\S]*values\[index\] = label/);
  assert.equal(program.chunks["fizzbuzz::fizzbuzz:source.js"].value, program.chunks["fizzbuzz::fizzbuzz.js"].value);
  assert.equal(program.chunks["fizzbuzz::fizzbuzz:compact.js"].value, program.chunks["fizzbuzz::fizzbuzz.js"].value);
  assert.equal(program.deliverables["dist/fizzbuzz-compact.js"].value, program.chunks["fizzbuzz::fizzbuzz:compact.js"].value);

  const outputDirectory = await mkdtemp(join(tmpdir(), "ravel-fizzbuzz-"));
  try {
    await writeDeliverables(program, outputDirectory);
    const output = join(outputDirectory, "dist", "fizzbuzz.js");
    const { stdout } = await run(process.execPath, [output]);
    assert.equal(stdout.trim().split(", ").length, 100);
    assert.match(stdout, /^1, 2, Fizz, 4, Buzz/);
    assert.match(stdout, /FizzBuzz, 16, 17/);
    assert.match(stdout, /, 98, Fizz, Buzz\n$/);
    assert.equal(await readFile(output, "utf8"), program.deliverables["dist/fizzbuzz.js"].value);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
