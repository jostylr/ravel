import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.env.npm_execpath
  ? { executable: process.execPath, prefix: [process.env.npm_execpath] }
  : { executable: "npm", prefix: [] };
let npmLogsDirectory;
let npmCacheDirectory;

const npm = (argumentsValue, options = {}) => run(npmCommand.executable, [...npmCommand.prefix, ...argumentsValue], {
  ...options,
  env: {
    ...process.env,
    ...options.env,
    npm_config_cache: npmCacheDirectory,
    npm_config_logs_dir: npmLogsDirectory
  }
});

const packageFile = (body) => JSON.stringify(body, null, 2) + "\n";

const minimalMap = {
  version: 1,
  document: { id: "smoke", uri: "smoke.ravel-map.json", format: "ravel-map-v1" },
  chunks: [{
    id: "smoke::main",
    identity: { document: "smoke", chunk: "main", minor: null, type: null },
    body: "export const smoke = true;\n",
    source: { uri: "smoke.ravel-map.json", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } }
  }],
  directives: [{
    kind: "out",
    name: "dist/smoke.js",
    from: "smoke::main",
    source: { uri: "smoke.ravel-map.json", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } }
  }]
};

const expectedPackages = new Set([
  "@pieceful/ravel",
  "@pieceful/ravel-core",
  "@pieceful/ravel-host-node",
  "@pieceful/ravel-map",
  "@pieceful/ravel-markdown"
]);

const archiveContents = async (path) => (await run("tar", ["-tzf", path])).stdout.split(/\r?\n/).filter(Boolean);

const sandbox = await mkdtemp(join(tmpdir(), "ravel-packed-smoke-"));
try {
  const archives = join(sandbox, "archives");
  npmLogsDirectory = join(sandbox, "npm-logs");
  npmCacheDirectory = join(sandbox, "npm-cache");
  await mkdir(archives);
  await mkdir(npmLogsDirectory);
  await mkdir(npmCacheDirectory);
  const packed = JSON.parse((await npm([
    "pack", "--workspaces", "--pack-destination", archives, "--ignore-scripts", "--json"
  ], { cwd: root })).stdout);
  assert.deepEqual(new Set(packed.map((entry) => entry.name)), expectedPackages);

  for (const entry of packed) {
    const contents = await archiveContents(join(archives, entry.filename));
    assert.ok(contents.includes("package/package.json"), entry.name + " must contain package.json");
    assert.ok(contents.includes("package/LICENSE"), entry.name + " must contain its MIT license");
    assert.ok(contents.some((path) => path.startsWith("package/src/")), entry.name + " must contain its entry points");
    assert.equal(contents.some((path) => path.startsWith("package/test/")), false, entry.name + " must not contain tests");
    if (entry.name === "@pieceful/ravel-map") assert.ok(contents.includes("package/schema/ravel-map.schema.json"));
    if (entry.name !== "@pieceful/ravel") assert.ok(contents.includes("package/src/index.d.ts"), entry.name + " must contain declarations");
  }

  const installed = join(sandbox, "installed");
  await writeFile(join(sandbox, "package.json"), packageFile({ private: true, type: "module" }));
  await npm([
    "install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund",
    ...packed.map((entry) => join(archives, entry.filename))
  ], { cwd: sandbox });
  await writeFile(join(sandbox, "smoke.ravel-map.json"), packageFile(minimalMap));

  await run(process.execPath, ["--input-type=module", "--eval", [
    'await import("@pieceful/ravel-core");',
    'await import("@pieceful/ravel-markdown");',
    'await import("@pieceful/ravel-host-node");',
    'const map = await import("@pieceful/ravel-map");',
    'await import("@pieceful/ravel");',
    'if (map.RAVEL_MAP_SCHEMA.$id !== map.RAVEL_MAP_SCHEMA_ID) process.exit(1);'
  ].join(" ")], { cwd: sandbox });

  const binary = join(sandbox, "node_modules", ".bin", "ravel");
  assert.match((await run(binary, ["--help"], { cwd: sandbox })).stderr, /Usage: ravel check/);
  assert.equal((await run(binary, ["--version"], { cwd: sandbox })).stdout.trim(), "0.1.0");
  await run(binary, ["build", "smoke.ravel-map.json", "--out-dir", "build"], { cwd: sandbox });
  assert.equal(await readFile(join(sandbox, "build", "dist", "smoke.js"), "utf8"), "export const smoke = true;\n");
  const manifest = JSON.parse(await readFile(join(sandbox, "build", ".ravel-manifest.json"), "utf8"));
  const sidecar = JSON.parse(await readFile(join(sandbox, "build", "dist", "smoke.js.ravelmap"), "utf8"));
  const aggregate = JSON.parse(await readFile(join(sandbox, "build", ".ravelmap"), "utf8"));
  assert.equal(manifest.result, "success");
  assert.equal(manifest.provenance.aggregate, ".ravelmap");
  assert.equal(sidecar.kind, "ravel-provenance-map");
  assert.deepEqual(aggregate.maps, [sidecar]);
  console.log("Packed Ravel workspace artifacts import and build successfully.");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
