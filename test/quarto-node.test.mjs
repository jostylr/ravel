import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  prepareQuartoProjectDirectory,
  renderPreparedQuartoProject,
  renderQuartoProject
} from "../packages/quarto/src/node.js";

const projectFixture = fileURLToPath(new URL(
  "../fixtures/quarto/project",
  import.meta.url
));

test("Quarto Node host prepares an isolated complete project tree", async () => {
  const authored = await readFile(join(projectFixture, "index.qmd"), "utf8");
  const prepared = await prepareQuartoProjectDirectory(projectFixture, {
    quartoVersion: "test-1",
    to: "html",
    transformVersions: { trim: "builtin-1" }
  });
  try {
    assert.deepEqual(prepared.diagnostics, []);
    const temporarySource = await readFile(
      join(prepared.temporaryDirectory, "index.qmd"),
      "utf8"
    );
    assert.match(
      temporarySource,
      /\[Shared value\]\(shared\/helper\.html#lst-lp-value\)/
    );
    assert.match(
      temporarySource,
      new RegExp("ravel:project-cache " + prepared.cacheKey)
    );
    assert.equal(
      await readFile(
        join(prepared.temporaryDirectory, "assets/status.txt"),
        "utf8"
      ),
      "copied project resource\n"
    );
    assert.equal(
      await readFile(join(projectFixture, "index.qmd"), "utf8"),
      authored
    );
    assert.match(prepared.cacheKeyMaterial, /"quarto":"test-1"/);
    assert.match(prepared.cacheKeyMaterial, /"trim":"builtin-1"/);
    assert.equal(prepared.cacheKey.length, 64);
    assert.equal(prepared.cacheStamp, prepared.cacheKey);
    assert.equal(
      prepared.documents[0].sourceMap.segments.at(-1).kind,
      "project-cache-stamp"
    );
  } finally {
    const temporaryDirectory = prepared.temporaryDirectory;
    await prepared.cleanup();
    await assert.rejects(access(temporaryDirectory));
  }
});

test("Quarto Node host requires explicit authority for project scripts", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-quarto-script-"));
  try {
    await writeFile(join(sandbox, "_quarto.yml"), [
      "project:",
      "  type: default",
      "  pre-render: echo should-not-run",
      ""
    ].join("\n"));
    await writeFile(join(sandbox, "index.qmd"), [
      "---",
      "ravel:",
      "  document: script-test",
      "---",
      "",
      "```{#lst-lp-main .text .lp-piece lst-cap=\"Main\"}",
      "ok",
      "```",
      ""
    ].join("\n"));
    const prepared = await prepareQuartoProjectDirectory(sandbox, {
      quartoVersion: "test-1"
    });
    try {
      const rendered = await renderPreparedQuartoProject(prepared);
      assert.equal(rendered.ok, false);
      assert.equal(rendered.diagnostics[0].code, "RQ302");
    } finally {
      await prepared.cleanup();
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Quarto Node host remaps structured renderer failures", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-quarto-failure-"));
  try {
    const source = [
      "---",
      "ravel:",
      "  document: failure",
      "---",
      "",
      "```{#lst-lp-value .python .lp-piece lst-cap=\"Value\"}",
      "bad_name",
      "```",
      "",
      "```{python .lp-piece #lp-analysis ravel-execution-owner=\"quarto\"}",
      "#| lst-label: lst-lp-analysis",
      "#| lst-cap: Analysis",
      "",
      "print(_\"value | trim()\")",
      "```",
      ""
    ].join("\n");
    await writeFile(join(sandbox, "index.qmd"), source);
    const renderer = join(sandbox, "fake-quarto.mjs");
    await writeFile(renderer, [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('9.9.9'); process.exit(0); }",
      "const prepared = readFileSync('index.qmd', 'utf8');",
      "const target = prepared.indexOf('bad_name', prepared.indexOf('print('));",
      "const before = prepared.slice(0, target);",
      "const line = before.split('\\n').length;",
      "const log = args[args.indexOf('--log') + 1];",
      "writeFileSync(log, JSON.stringify({",
      "  level: 40, levelName: 'ERROR',",
      "  msg: `index.qmd:${line}:7\\nNameError: bad_name`",
      "}) + '\\n');",
      "console.error(`index.qmd:${line}:7\\nNameError: bad_name`);",
      "process.exit(1);",
      ""
    ].join("\n"));
    const rendered = await renderQuartoProject(sandbox, {
      command: process.execPath,
      commandArguments: [renderer]
    });
    try {
      assert.equal(rendered.ok, false);
      assert.equal(rendered.quartoVersion, "9.9.9");
      assert.equal(rendered.diagnostics[0].code, "RQ201");
      assert.equal(rendered.diagnostics[0].source.uri, "index.qmd");
      assert.equal(
        rendered.diagnostics[0].source.range.start.offset,
        source.indexOf("bad_name")
      );
    } finally {
      await rendered.prepared.cleanup();
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
