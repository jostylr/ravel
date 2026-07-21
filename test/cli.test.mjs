import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("CLI rejects unknown flags with a usage exit code", async () => {
  await assert.rejects(
    run(process.execPath, [cli, "check", proofOfConcept, "--not-a-ravel-option"]),
    (error) => error.code === 2 && /Unknown option/.test(error.stderr)
  );
});
}
