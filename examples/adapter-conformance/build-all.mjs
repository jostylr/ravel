import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const cli = fileURLToPath(new URL("../../packages/cli/src/index.js", import.meta.url));
const formats = [
  "markdown",
  "markdown-litpro",
  "org",
  "noweb",
  "myst",
  "asciidoc",
  "html",
  "quarto"
];
const outputs = ["report.md", "summary.json", "alerts.txt"];
const expected = Object.fromEntries(await Promise.all(outputs.map(async (name) => [
  name,
  await readFile(join(directory, "expected", name))
])));

for (const format of formats) {
  await run(process.execPath, [
    cli,
    "build",
    "--config",
    join(directory, "ravel-" + format + ".toml"),
    "--json"
  ], { cwd: directory });

  for (const name of outputs) {
    const actual = await readFile(join(directory, ".ravel", "build", format, name));
    assert.deepEqual(actual, expected[name], format + " produced a different " + name);
  }
}

for (const name of outputs) {
  const sha256 = createHash("sha256").update(expected[name]).digest("hex");
  console.log(name + "  " + sha256);
}
console.log("Built " + formats.length + " equivalent documents with identical outputs.");
