import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../packages/cli/src/index.js", import.meta.url));
const proofOfConcept = fileURLToPath(new URL("../examples/poc/project.ravel-map.json", import.meta.url));

// Bun's current node:test compatibility layer inherits its test-runner state
// into child Bun processes. Keep subprocess CLI assertions in the Node suite;
// the portable engine and host assertions still run under both runtimes.
if (!process.versions.bun) {
test("CLI check validates a project without writing outputs", async () => {
  const result = await run(process.execPath, [cli, "check", "examples/poc/project.ravel-map.json"]);
  assert.match(result.stdout, /Ravel check passed\./);
  assert.equal(result.stderr, "");
});

test("CLI check accepts direct markup and TOML project inputs", async () => {
  const markdown = await run(process.execPath, [cli, "check", "fixtures/markdown/guide.md", "--mode", "primary"]);
  assert.match(markdown.stdout, /Ravel check passed\./);

  const org = await run(process.execPath, [cli, "check", "fixtures/org/native.org"]);
  assert.match(org.stdout, /Ravel check passed\./);

  const myst = await run(process.execPath, [cli, "check", "fixtures/myst/native.myst.md"]);
  assert.match(myst.stdout, /Ravel check passed\./);

  const toml = await run(process.execPath, [cli, "check", "--config", "fixtures/markdown/ravel-web.toml"]);
  assert.match(toml.stdout, /Ravel check passed\./);
});

test("CLI check analyzes live JavaScript without executing it", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-check-live-"));
  const input = join(sandbox, "live.md");
  try {
    await writeFile(input, [
      "```js {.run #broken}",
      "export default ;",
      "```",
      ""
    ].join("\n"));
    await assert.rejects(
      run(process.execPath, [cli, "check", input]),
      (error) => error.code === 1 && /RJL100/.test(error.stderr)
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI run bundles an allowlisted installed module and reads only declared resources", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-live-"));
  const packageDirectory = join(sandbox, "node_modules", "tiny-csv");
  try {
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
      name: "tiny-csv",
      version: "1.0.0",
      type: "module",
      exports: { "./sync": "./sync.js" }
    }));
    await writeFile(
      join(packageDirectory, "sync.js"),
      "export const parse = (text) => text.trim().split(/\\r?\\n/).map((line) => line.split(','));\n"
    );
    await writeFile(join(sandbox, "cool.csv"), "name,value\nalpha,1\n");
    await writeFile(join(sandbox, "live.md"), [
      "```js {.run #parse}",
      'import { parse } from "@example/csv";',
      'export default parse(load("cool.csv"));',
      "```",
      "",
      "```js {.run #count}",
      'const count = ch("parse").length;',
      'export default { count, report: "rows=" + count };',
      "```",
      "",
      "```text {.ravel #report}",
      '_"count.js | jsontext(\'report\')"',
      "```",
      "",
      "```json {.ravel #summary}",
      '_"count.js | jsontext()"',
      "```",
      "",
      "```ravel",
      'out("report.txt", _"report.text")',
      'out("summary.json", _"summary.json")',
      "```",
      ""
    ].join("\n"));
    await writeFile(join(sandbox, "ravel.toml"), [
      "version = 1",
      "",
      "[build]",
      'out_dir = "build"',
      "",
      "[[files]]",
      'path = "live.md"',
      'mode = "primary"',
      "",
      "[[live.modules]]",
      'specifier = "@example/csv"',
      'from = "tiny-csv/sync"',
      "",
      "[[live.resources]]",
      'name = "cool.csv"',
      'path = "cool.csv"',
      ""
    ].join("\n"));

    const result = await run(process.execPath, [cli, "run", "--config", "ravel.toml", "--json"], { cwd: sandbox });
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.executions["live::parse.js"].value, [
      ["name", "value"],
      ["alpha", "1"]
    ]);
    assert.deepEqual(summary.executions["live::count.js"].value, {
      count: 2,
      report: "rows=2"
    });
    assert.deepEqual((await readdir(sandbox)).sort(), [
      "cool.csv",
      "live.md",
      "node_modules",
      "ravel.toml"
    ]);

    const built = await run(process.execPath, [cli, "build", "--config", "ravel.toml", "--json"], { cwd: sandbox });
    assert.equal(JSON.parse(built.stdout).ok, true);
    assert.equal(await readFile(join(sandbox, "build", "report.txt"), "utf8"), "rows=2\n");
    assert.equal(
      await readFile(join(sandbox, "build", "summary.json"), "utf8"),
      '{"count":2,"report":"rows=2"}\n'
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI builds a canonical ravel.toml and honors its clean and backup policy", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-default-config-"));
  const source = "```javascript {.ravel #main}\nexport const ready = true;\n```\n\n```ravel\nout(\"dist/main.js\", _\"main.javascript\")\n```\n";
  const config = (backup = "false") => "version = 1\n\n[build]\nout_dir = \"build\"\nclean = true\nbackup = " + backup + "\n\n[[files]]\npath = \"guide.md\"\n";
  try {
    await writeFile(join(sandbox, "guide.md"), source);
    await writeFile(join(sandbox, "ravel.toml"), config());
    const first = await run(process.execPath, [cli], { cwd: sandbox });
    assert.match(first.stdout, /Ravel wrote 1 deliverable/);
    assert.equal(await readFile(join(sandbox, "build", "dist", "main.js"), "utf8"), "export const ready = true;\n");

    await writeFile(join(sandbox, "ravel.toml"), config('"archives/before-clean.zip"'));
    const second = await run(process.execPath, [cli], { cwd: sandbox });
    assert.match(second.stdout, /Backup: .*archives(?:\/|\\)before-clean\.zip/);
    assert.equal((await readFile(join(sandbox, "archives", "before-clean.zip"))).subarray(0, 4).toString("binary"), "PK\x03\x04");
    assert.deepEqual(await readdir(join(sandbox, "archives")), ["before-clean.zip"]);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI check renders map validation errors without a stack trace", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-check-"));
  const input = join(sandbox, "invalid.ravel-map.json");
  try {
    await writeFile(input, JSON.stringify({
      version: 2,
      document: { id: "Bad ID", uri: "invalid.ravel-map.json", format: "ravel-map-v1" },
      chunks: []
    }));
    await assert.rejects(
      run(process.execPath, [cli, "check", input]),
      (error) => error.code === 1 &&
        /RM200/.test(error.stderr) &&
        /version must be 1/.test(error.stderr) &&
        !/at file:/.test(error.stderr)
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI check can emit machine-readable diagnostics", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-json-"));
  const input = join(sandbox, "invalid.ravel-map.json");
  try {
    await writeFile(input, JSON.stringify({ version: 2, chunks: [] }));
    await assert.rejects(
      run(process.execPath, [cli, "check", input, "--json"]),
      (error) => {
        const diagnostics = JSON.parse(error.stderr);
        return error.code === 1 && Array.isArray(diagnostics) && diagnostics.some((entry) => entry.code === "RM200");
      }
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI renders malformed JSON and TOML configuration as source errors", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-input-errors-"));
  const map = join(sandbox, "broken.ravel-map.json");
  const config = join(sandbox, "ravel.toml");
  try {
    await writeFile(map, "{ broken");
    await assert.rejects(
      run(process.execPath, [cli, "check", map]),
      (error) => error.code === 1 && /RM201/.test(error.stderr) && /Invalid JSON Ravel Map/.test(error.stderr)
    );
    await writeFile(config, "version = 1\nwrong = true\n[build]\nout_dir = \"build\"\n");
    await assert.rejects(
      run(process.execPath, [cli, "check", config, "--json"]),
      (error) => {
        const diagnostics = JSON.parse(error.stderr);
        return error.code === 1 && diagnostics[0].code === "RC102" && /config\.wrong/.test(diagnostics[0].message);
      }
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI build dry-run emits a stable plan without creating its output directory", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-dry-run-"));
  const output = join(sandbox, "output");
  try {
    const result = await run(process.execPath, [cli, "build", proofOfConcept, "--out-dir", output, "--dry-run", "--json"]);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.ok, true);
    assert.equal(plan.command, "build");
    assert.equal(plan.dryRun, true);
    assert.deepEqual(plan.deliverables.map((entry) => entry.name), ["dist/greeting.js", "generated/greeting.js"]);
    await assert.rejects(lstat(output), { code: "ENOENT" });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI inspect provides compact chunk and dependency-graph views", async () => {
  const chunks = await run(process.execPath, [cli, "inspect", proofOfConcept, "--chunks", "--json"]);
  const chunkView = JSON.parse(chunks.stdout);
  assert.equal(chunkView.view, "chunks");
  assert.deepEqual(chunkView.chunks.map((chunk) => chunk.id), ["library::greeting", "project::greeting", "project::greeting:browser", "project::main"]);
  assert.equal(Object.hasOwn(chunkView.chunks[0], "value"), false);

  const graph = await run(process.execPath, [cli, "inspect", proofOfConcept, "--graph", "--json"]);
  const graphView = JSON.parse(graph.stdout);
  assert.equal(graphView.view, "graph");
  assert.deepEqual(graphView.deliverables.map((deliverable) => deliverable.name), ["dist/greeting.js", "generated/greeting.js"]);
});

test("CLI inspect queries generated and source provenance offsets", async () => {
  const generated = await run(process.execPath, [
    cli,
    "inspect",
    proofOfConcept,
    "--provenance",
    "dist/greeting.js",
    "--generated-offset",
    "1",
    "--json"
  ]);
  const generatedView = JSON.parse(generated.stdout);
  assert.equal(generatedView.view, "provenance");
  assert.equal(generatedView.match.chunk, "library::greeting");
  assert.equal(generatedView.match.precision, "exact");
  assert.equal(generatedView.match.sourceOffset, generatedView.match.source.range.start.offset + 1);
  assert.equal(generatedView.definition.id, "library::greeting");
  assert.deepEqual(generatedView.dependencyPath, [
    "project::main",
    "project::greeting",
    "library::greeting"
  ]);
  assert.deepEqual(generatedView.match.via.map(({ from, to }) => [from, to]), [
    ["project::greeting", "library::greeting"],
    ["project::main", "project::greeting"]
  ]);

  const reverse = await run(process.execPath, [
    cli,
    "inspect",
    proofOfConcept,
    "--provenance",
    "dist/greeting.js",
    "--source-uri",
    generatedView.match.source.uri,
    "--source-offset",
    String(generatedView.match.sourceOffset),
    "--json"
  ]);
  assert.equal(JSON.parse(reverse.stdout).matches[0].generatedOffset, 1);

  await assert.rejects(
    run(process.execPath, [cli, "inspect", proofOfConcept, "--generated-offset", "1"]),
    (error) => error.code === 2 && /require --provenance/.test(error.stderr)
  );
});

test("CLI build writes deliverables, a manifest, and an explicit graph", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-write-"));
  const input = join(sandbox, "project.ravel-map.json");
  const output = join(sandbox, "output");
  const graph = join(sandbox, "program.json");
  const source = { uri: input, range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  try {
    await writeFile(input, JSON.stringify({
      version: 1,
      document: { id: "project", uri: input, format: "ravel-map-v1" },
      chunks: [{
        id: "project::main",
        identity: { document: "project", chunk: "main", minor: null, type: null },
        name: "Main",
        body: "console.log('hello');\\n",
        metadata: {},
        source
      }],
      directives: [{ kind: "out", name: "dist/main.js", from: "project::main", source }]
    }));
    const result = await run(process.execPath, [cli, "build", input, "--out-dir", output, "--graph", graph, "--json"]);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.ok, true);
    assert.equal(await readFile(join(output, "dist", "main.js"), "utf8"), "console.log('hello');\\n");
    assert.equal(JSON.parse(await readFile(join(output, ".ravel-manifest.json"), "utf8")).result, "success");
    assert.equal(JSON.parse(await readFile(graph, "utf8")).chunks["project::main"].value, "console.log('hello');\\n");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI dry-run reports stale outputs without deleting them", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-cli-stale-"));
  const input = join(sandbox, "project.ravel-map.json");
  const output = join(sandbox, "output");
  const source = { uri: input, range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  const project = (outputs) => ({
    version: 1,
    document: { id: "project", uri: input, format: "ravel-map-v1" },
    chunks: [{
      id: "project::main",
      identity: { document: "project", chunk: "main", minor: null, type: null },
      name: "Main",
      body: "ready\\n",
      metadata: {},
      source
    }],
    directives: outputs.map((name) => ({ kind: "out", name, from: "project::main", source }))
  });
  try {
    await writeFile(input, JSON.stringify(project(["dist/current.txt", "dist/removed.txt"])));
    await run(process.execPath, [cli, "build", input, "--out-dir", output, "--json"]);
    const backupDryRun = await run(process.execPath, [cli, "build", input, "--out-dir", output, "--backup", "snapshots/current.zip", "--dry-run", "--json"]);
    assert.equal(JSON.parse(backupDryRun.stdout).backup.path, join(sandbox, "snapshots", "current.zip"));
    await assert.rejects(lstat(join(sandbox, "snapshots", "current.zip")), { code: "ENOENT" });
    const backup = await run(process.execPath, [cli, "build", input, "--out-dir", output, "--backup", "snapshots/current.zip", "--json"]);
    assert.equal(JSON.parse(backup.stdout).backup.files.includes("dist/removed.txt"), true);
    assert.equal((await readFile(join(sandbox, "snapshots", "current.zip"))).subarray(0, 4).toString("binary"), "PK\x03\x04");
    await assert.rejects(
      run(process.execPath, [cli, "build", input, "--out-dir", output, "--backup", "snapshots/current.zip", "--json"]),
      (error) => error.code === 3 && /Backup file already exists/.test(error.stderr)
    );
    await writeFile(input, JSON.stringify(project(["dist/current.txt"])));
    const result = await run(process.execPath, [cli, "build", input, "--out-dir", output, "--dry-run", "--json"]);
    const stale = JSON.parse(result.stdout).stale;
    assert.equal(stale.length, 1);
    assert.deepEqual({ name: stale[0].name, path: stale[0].path, from: stale[0].from }, {
      name: "dist/removed.txt", path: "dist/removed.txt", from: "project::main"
    });
    assert.match(stale[0].staleSince, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(await readFile(join(output, "dist", "removed.txt"), "utf8"), "ready\\n");

    const clean = await run(process.execPath, [cli, "build", input, "--out-dir", output, "--clean", "--json"]);
    assert.deepEqual(JSON.parse(clean.stdout).removed.map((entry) => entry.name), ["dist/current.txt", "dist/removed.txt"]);
    await assert.rejects(readFile(join(output, "dist", "removed.txt"), "utf8"), { code: "ENOENT" });
    assert.match(await readFile(join(output, ".manifest.txt"), "utf8"), /Current files:\n  dist\/current\.txt \(project::main\)/);

    await writeFile(input, JSON.stringify(project([])));
    await run(process.execPath, [cli, "build", input, "--out-dir", output, "--json"]);
    const refreshDryRun = await run(process.execPath, [cli, "refresh", output, "--dry-run", "--json"]);
    assert.deepEqual(JSON.parse(refreshDryRun.stdout).removed.map((entry) => entry.name), ["dist/current.txt"]);
    assert.equal(await readFile(join(output, "dist", "current.txt"), "utf8"), "ready\\n");
    const refresh = await run(process.execPath, [cli, "refresh", output, "--json"]);
    assert.deepEqual(JSON.parse(refresh.stdout).removed.map((entry) => entry.name), ["dist/current.txt"]);
    await assert.rejects(readFile(join(output, "dist", "current.txt"), "utf8"), { code: "ENOENT" });
    assert.doesNotMatch(await readFile(join(output, ".manifest.txt"), "utf8"), /Stale files/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("CLI rejects unknown flags with a usage exit code", async () => {
  await assert.rejects(
    run(process.execPath, [cli, "check", proofOfConcept, "--not-a-ravel-option"]),
    (error) => error.code === 2 && /Unknown option/.test(error.stderr)
  );
});
}
