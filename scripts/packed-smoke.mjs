import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
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
  "@pieceful/ravel-asciidoc",
  "@pieceful/ravel-core",
  "@pieceful/ravel-html",
  "@pieceful/ravel-host-node",
  "@pieceful/ravel-js-live",
  "@pieceful/ravel-language-bridge",
  "@pieceful/ravel-language-service",
  "@pieceful/ravel-language-typescript",
  "@pieceful/ravel-map",
  "@pieceful/ravel-markdown",
  "@pieceful/ravel-markdown-litpro",
  "@pieceful/ravel-myst",
  "@pieceful/ravel-myst-plugin",
  "@pieceful/ravel-noweb",
  "@pieceful/ravel-org",
  "@pieceful/ravel-projection",
  "@pieceful/ravel-quarto"
]);

const publicWorkspacePaths = [];
for (const entry of await readdir(join(root, "packages"), {
  withFileTypes: true
})) {
  if (!entry.isDirectory()) {
    continue;
  }
  const workspacePath = join("packages", entry.name);
  const manifest = JSON.parse(
    await readFile(join(root, workspacePath, "package.json"), "utf8")
  );
  if (!manifest.private) {
    publicWorkspacePaths.push(workspacePath);
  }
}
publicWorkspacePaths.sort();

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
    "pack",
    ...publicWorkspacePaths.flatMap((workspacePath) => [
      "--workspace",
      workspacePath
    ]),
    "--pack-destination",
    archives,
    "--ignore-scripts",
    "--json"
  ], { cwd: root })).stdout);
  assert.deepEqual(new Set(packed.map((entry) => entry.name)), expectedPackages);

  const vscodePacked = JSON.parse((await npm([
    "pack",
    "--workspace",
    "packages/vscode",
    "--pack-destination",
    archives,
    "--ignore-scripts",
    "--json"
  ], { cwd: root })).stdout);
  assert.equal(vscodePacked.length, 1);
  assert.equal(vscodePacked[0].name, "@pieceful/ravel-vscode");
  const vscodeContents = await archiveContents(join(
    archives,
    vscodePacked[0].filename
  ));
  assert.ok(vscodeContents.includes("package/dist/extension.cjs"));
  assert.ok(vscodeContents.includes("package/dist/webview.mjs"));
  assert.ok(vscodeContents.includes("package/dist/lib.d.ts"));
  assert.ok(vscodeContents.includes("package/dist/lib.es5.d.ts"));
  assert.ok(vscodeContents.includes("package/dist/lib.es2022.full.d.ts"));
  assert.ok(
    vscodeContents.filter((path) =>
      /^package\/dist\/lib(?:\..+)?\.d\.ts$/.test(path)
    ).length >= 90,
    "VS Code package must contain the complete TypeScript standard-library set"
  );

  for (const entry of packed) {
    const contents = await archiveContents(join(archives, entry.filename));
    assert.ok(contents.includes("package/package.json"), entry.name + " must contain package.json");
    assert.ok(contents.includes("package/README.md"), entry.name + " must contain its package README");
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
    'const asciidoc = await import("@pieceful/ravel-asciidoc");',
    'const core = await import("@pieceful/ravel-core");',
    'const html = await import("@pieceful/ravel-html");',
    'const live = await import("@pieceful/ravel-js-live");',
    'const liveNode = await import("@pieceful/ravel-js-live/node");',
    'const languageBridge = await import("@pieceful/ravel-language-bridge");',
    'const languageBridgeTesting = await import("@pieceful/ravel-language-bridge/testing");',
    'const languageService = await import("@pieceful/ravel-language-service");',
    'const languageTypescript = await import("@pieceful/ravel-language-typescript");',
    'await import("@pieceful/ravel-markdown");',
    'await import("@pieceful/ravel-markdown-litpro");',
    'const myst = await import("@pieceful/ravel-myst");',
    'const mystPlugin = await import("@pieceful/ravel-myst-plugin");',
    'const noweb = await import("@pieceful/ravel-noweb");',
    'const org = await import("@pieceful/ravel-org");',
    'const projection = await import("@pieceful/ravel-projection");',
    'const quarto = await import("@pieceful/ravel-quarto");',
    'const quartoNode = await import("@pieceful/ravel-quarto/node");',
    'await import("@pieceful/ravel-host-node");',
    'const map = await import("@pieceful/ravel-map");',
    'await import("@pieceful/ravel");',
    'if (typeof languageBridge.createBridgeCapabilities !== "function") process.exit(1);',
    'if (typeof languageBridgeTesting.createFakeLanguageBridge !== "function") process.exit(1);',
    'if (typeof languageService.createLanguageRouter !== "function") process.exit(1);',
    'if (typeof languageTypescript.createTypeScriptLanguageBridgeWithApi !== "function") process.exit(1);',
    'if (typeof projection.createProjectionService !== "function") process.exit(1);',
    'if (map.RAVEL_MAP_SCHEMA.$id !== map.RAVEL_MAP_SCHEMA_ID) process.exit(1);',
    'const point = { line: 0, column: 0, offset: 0 };',
    'if (asciidoc.asciidocToMap("[#lp-main]\\n== Main\\n\\n[source,text]\\n----\\nok\\n----\\n", { document: "smoke" }).map.chunks[0].body !== "ok\\n") process.exit(1);',
    'if (html.htmlToMap("<figure data-ravel-piece=\\"main\\"><figcaption>Main</figcaption><pre><code>ok</code></pre></figure>", { document: "smoke" }).map.chunks[0].body !== "ok") process.exit(1);',
    'if (noweb.nowebToMap("<<main>>=\\nok\\n@\\n", { document: "smoke" }).map.chunks[0].body !== "ok\\n") process.exit(1);',
    'if (org.orgToMap("#+NAME: main\\n#+BEGIN_SRC text\\nok\\n#+END_SRC\\n", { document: "smoke" }).map.chunks[0].body !== "ok\\n") process.exit(1);',
    'if (!quarto.prepareQuartoRender("```{#lst-lp-main .text .lp-piece lst-cap=\\"Main\\"}\\nok\\n```\\n", { document: "smoke" }).source.includes("Piece index")) process.exit(1);',
    'if (typeof quartoNode.renderQuartoProject !== "function") process.exit(1);',
    'if (myst.mystToMap("```{ravel:piece} main\\n:caption: Main\\n\\nok\\n```\\n", { document: "smoke" }).map.chunks[0].body !== "ok\\n") process.exit(1);',
    'if (mystPlugin.default.directives[0].name !== "ravel:piece") process.exit(1);',
    'if (mystPlugin.default.directives[1].name !== "ravel") process.exit(1);',
    'const provider = live.createJavaScriptLiveProvider({ modules: {',
    '"@ravel/math": "export const twice = (value) => value * 2;"',
    '} });',
    'const outcome = await provider.execute({',
    'id: "smoke::live.js", runId: "pack", language: "js",',
    'source: "import { twice } from \\"@ravel/math\\"; export default { packed: twice(21) };",',
    'sourceLocation: { uri: "smoke.md", range: { start: point, end: point } },',
    'inputs: {}, resources: {}, analysis: {}, limits: {}',
    '});',
    'await provider.dispose();',
    'if (!outcome.ok) throw new Error(JSON.stringify(outcome));',
    'if (core.serializeRavelValue(JSON.parse(outcome.serialized)) !== "{\\"packed\\":42}") process.exit(1);',
    'const prepared = await liveNode.prepareJavaScriptModules([',
    '{ specifier: "@ravel/acorn", from: "acorn" }',
    '], { rootDirectory: process.cwd() });',
    'if (!prepared["@ravel/acorn"].includes("parse")) process.exit(1);'
  ].join(" ")], { cwd: sandbox });

  const binary = join(sandbox, "node_modules", ".bin", process.platform === "win32" ? "ravel.cmd" : "ravel");
  const cliOptions = { cwd: sandbox, ...(process.platform === "win32" ? { shell: true } : {}) };
  assert.match((await run(binary, ["--help"], cliOptions)).stderr, /Usage: ravel check/);
  assert.equal((await run(binary, ["--version"], cliOptions)).stdout.trim(), "0.2.0");
  await run(binary, ["build", "smoke.ravel-map.json", "--out-dir", "build"], cliOptions);
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
