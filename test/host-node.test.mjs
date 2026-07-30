import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createBuildManifest, createOutputBackup, loadBuildInput, loadPretransformGraph, planDeliverables, planStaleDeliverables, RavelInputError, writeBuildArtifacts, writeBuildManifest, writeDeliverables } from "../packages/host-node/src/index.js";
import { JavaScriptModulePreparationError, prepareJavaScriptModules } from "../packages/js-live/src/node.js";
import { markdownToMap } from "../packages/markdown/src/index.js";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import { markdownLike, pugLike } from "../test-support/phase-transforms.mjs";

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

test("Node host validates JSON maps before following imports", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-map-validation-"));
  const input = join(sandbox, "invalid.ravel-map.json");
  try {
    await writeFile(input, JSON.stringify({
      version: 2,
      document: { id: "Bad ID", uri: "invalid.ravel-map.json", format: "ravel-map-v1" },
      chunks: []
    }));
    await assert.rejects(
      loadPretransformGraph(input),
      (error) => error.name === "RavelMapValidationError" &&
        error.diagnostics.some((diagnostic) => diagnostic.message.includes("version must be 1"))
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host reports malformed inputs and TOML fields as source diagnostics", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-input-diagnostics-"));
  const malformedMap = join(sandbox, "broken.ravel-map.json");
  const config = join(sandbox, "ravel.toml");
  try {
    await writeFile(malformedMap, "{ not JSON");
    await assert.rejects(
      loadBuildInput(malformedMap),
      (error) => error instanceof RavelInputError && error.diagnostics[0].code === "RM201" &&
        error.diagnostics[0].source.uri === malformedMap
    );
    await writeFile(config, "version = 1\nunknown = true\n[build]\nout_dir = \"build\"\n");
    await assert.rejects(
      loadBuildInput(config),
      (error) => error instanceof RavelInputError && error.diagnostics[0].code === "RC102" &&
        /config\.unknown/.test(error.diagnostics[0].message)
    );
    await assert.rejects(
      loadBuildInput(join(sandbox, "unsupported.txt")),
      (error) => error instanceof RavelInputError && error.diagnostics[0].code === "RH101"
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host loads one TOML build run containing multiple Markdown files", async () => {
  const config = fileURLToPath(
    new URL("../fixtures/markdown/ravel-web.toml", import.meta.url),
  );
  const loaded = await loadBuildInput(config);
  const program = transformGraph(loaded.pretransform);

  assert.deepEqual(program.diagnostics, []);
  assert.ok(loaded.outputDirectory.endsWith(join(".ravel", "runs", "markdown-web")));
  assert.deepEqual(Object.keys(program.chunks).sort(), [
    "handbook::compiler:what.ts",
    "handbook::main.javascript",
    "runtime::support.javascript"
  ]);
  assert.equal(program.deliverables["dist/main.js"].from, "handbook::main.javascript");
  assert.match(program.deliverables["dist/main.js"].value, /export const finish/);
});

test("JavaScript Node preparation bundles only allowlisted bare package exports", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-live-modules-"));
  const packageDirectory = join(sandbox, "node_modules", "fixture-module");
  const source = {
    uri: join(sandbox, "ravel.toml"),
    range: {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 0, offset: 0 }
    }
  };
  try {
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
      name: "fixture-module",
      version: "1.0.0",
      type: "module",
      exports: {
        "./pure": "./pure.js",
        "./host": "./host.js"
      }
    }));
    await writeFile(join(packageDirectory, "pure.js"), "export const twice = (value) => value * 2;\n");
    await writeFile(join(packageDirectory, "host.js"), 'import "node:fs"; export default true;\n');

    const modules = await prepareJavaScriptModules([
      { specifier: "@example/math", from: "fixture-module/pure", source }
    ], { rootDirectory: sandbox });
    assert.match(modules["@example/math"], /twice/);

    await assert.rejects(
      prepareJavaScriptModules([
        { specifier: "@example/host", from: "fixture-module/host", source }
      ], { rootDirectory: sandbox }),
      (error) => error instanceof JavaScriptModulePreparationError &&
        error.diagnostics[0].code === "RJL140" &&
        /node:fs/.test(error.diagnostics[0].message)
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host writes source locations relative to a build root", async () => {
  const config = fileURLToPath(
    new URL("../fixtures/markdown/ravel-web.toml", import.meta.url),
  );
  const loaded = await loadBuildInput(config);
  const program = transformGraph(loaded.pretransform);

  assert.deepEqual(loaded.pretransform.documents.map((document) => document.uri).sort(), ["guide.md", "runtime.md"]);
  assert.equal(loaded.pretransform.chunks.find((chunk) => chunk.id === "handbook::main.javascript").source.uri, "guide.md");
  assert.equal(program.deliverables["dist/main.js"].source.uri, "ravel-web.toml");
  assert.equal(program.chunks["handbook::main.javascript"].references[0].source.uri, "guide.md");
});

test("Node host redacts absolute source locations outside a build root", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-source-uri-"));
  const root = join(sandbox, "project");
  const input = join(root, "entry.ravel-map.json");
  const external = join(sandbox, "private", "source.md");
  const source = { uri: external, range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  try {
    await mkdir(root);
    await writeFile(input, JSON.stringify({
      version: 1,
      document: { id: "entry", uri: external, format: "ravel-map-v1" },
      chunks: [{
        id: "entry::main",
        identity: { document: "entry", chunk: "main", minor: null, type: null },
        body: "",
        source
      }],
      directives: []
    }));
    const loaded = await loadBuildInput(input);
    assert.equal(loaded.pretransform.documents[0].uri, "<external>/source.md");
    assert.equal(loaded.pretransform.chunks[0].source.uri, "<external>/source.md");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host follows in directives from Markdown into another Markdown map", async () => {
  const entry = fileURLToPath(
    new URL("../fixtures/markdown/importing-entry.md", import.meta.url),
  );
  const loaded = await loadBuildInput(entry);
  const program = transformGraph(loaded.pretransform);

  assert.deepEqual(program.diagnostics, []);
  assert.deepEqual(Object.keys(program.chunks).sort(), ["entry::main.js", "library::helper.js"]);
  assert.equal(program.deliverables["dist/main.js"].value, "export const helper = true;\n");
});

test("Node host loads Quarto sources through the modern Markdown adapter", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-quarto-"));
  const input = join(sandbox, "analysis.qmd");
  try {
    await writeFile(input, [
      "---",
      "title: Analysis",
      "---",
      "## Live result",
      "",
      "```{.javascript .run provider=quickjs-wasm-worker}",
      "export default \"ready\";",
      "```",
      ""
    ].join("\n"));
    const loaded = await loadBuildInput(input);

    assert.deepEqual(loaded.pretransform.diagnostics, []);
    assert.equal(loaded.pretransform.documents[0].format, "markdown+ravel-modern-v1");
    assert.equal(loaded.pretransform.chunks[0].id, "analysis::live-result");
    assert.equal(loaded.pretransform.chunks[0].metadata.data.ravel.run, true);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host selects markdown-litpro and its dialect from TOML", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-litpro-host-"));
  const input = join(sandbox, "legacy.md");
  const config = join(sandbox, "ravel.toml");
  try {
    await writeFile(input, [
      "# Main",
      "",
      "    value",
      "",
      "[result.txt](# \"save:\")",
      ""
    ].join("\n"));
    await writeFile(config, [
      "version = 1",
      "",
      "[[files]]",
      "path = \"legacy.md\"",
      "adapter = \"markdown-litpro\"",
      "dialect = \"litpro-2017\"",
      ""
    ].join("\n"));

    const loaded = await loadBuildInput(config);
    assert.equal(loaded.pretransform.documents[0].format, "markdown+litpro-litpro-2017-v1");
    const program = transformGraph(loaded.pretransform);
    assert.deepEqual(program.diagnostics, []);
    assert.equal(program.deliverables["result.txt"].value, "value");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host loads noweb extensions and TOML noweb-plus settings", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-noweb-host-"));
  const input = join(sandbox, "program.nw");
  const config = join(sandbox, "ravel.toml");
  try {
    await writeFile(input, [
      "<<main | trim()>>=",
      "  <<message | trim()>>  ",
      "@",
      "<<message>>=",
      "  hello  ",
      "@",
      ""
    ].join("\n"));
    await writeFile(config, [
      "version = 1",
      "",
      "[[files]]",
      "path = \"program.nw\"",
      "adapter = \"noweb\"",
      "dialect = \"noweb-plus\"",
      "references = \"both\"",
      "language = \"javascript\"",
      "run = true",
      "provider = \"quickjs-wasm-worker\"",
      ""
    ].join("\n"));

    const direct = await loadBuildInput(input);
    assert.equal(direct.pretransform.documents[0].format, "noweb-v1");
    assert.equal(direct.pretransform.chunks[0].id, "program::main-trim");

    const loaded = await loadBuildInput(config);
    assert.equal(loaded.pretransform.documents[0].format, "noweb-plus-v1");
    assert.equal(loaded.pretransform.chunks[0].metadata.language, "javascript");
    assert.equal(loaded.pretransform.chunks[0].metadata.data.ravel.run, true);
    assert.equal(loaded.pretransform.chunks[0].metadata.data.ravel.provider, "quickjs-wasm-worker");
    const program = transformGraph(loaded.pretransform);
    assert.equal(program.chunks["program::main"].value, "hello");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host loads Org extensions and TOML ownership/reference settings", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-org-host-"));
  const input = join(sandbox, "program.org");
  const config = join(sandbox, "ravel.toml");
  try {
    await writeFile(input, [
      "#+LP_NAME: message",
      "#+BEGIN_SRC javascript",
      "  hello  ",
      "#+END_SRC",
      "",
      "#+LP_NAME: main | trim()",
      "#+BEGIN_SRC javascript :eval yes",
      "  <<message | trim()>>  ",
      "#+END_SRC",
      ""
    ].join("\n"));
    await writeFile(config, [
      "version = 1",
      "",
      "[[files]]",
      "path = \"program.org\"",
      "adapter = \"org\"",
      "references = \"both\"",
      "noweb_pipes = true",
      "execution_owner = \"pieceful\"",
      "run = true",
      "provider = \"quickjs-wasm-worker\"",
      ""
    ].join("\n"));

    const direct = await loadBuildInput(input);
    assert.equal(direct.pretransform.documents[0].format, "org+ravel-v1");
    assert.equal(direct.pretransform.chunks[1].metadata.data.ravel.run, undefined);
    assert.ok(direct.pretransform.diagnostics.some((entry) => entry.code === "LPA115"));

    const loaded = await loadBuildInput(config);
    assert.equal(loaded.pretransform.documents[0].format, "org+ravel-v1");
    assert.equal(loaded.pretransform.chunks[1].metadata.data.ravel.run, true);
    assert.equal(loaded.pretransform.chunks[1].metadata.data.ravel.provider, "quickjs-wasm-worker");
    const program = transformGraph(loaded.pretransform);
    assert.equal(program.chunks["program::main"].value, "hello");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host loads .myst.md directly and explicit MyST TOML execution settings", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-myst-host-"));
  const input = join(sandbox, "program.myst.md");
  const ordinary = join(sandbox, "explicit.md");
  const config = join(sandbox, "ravel.toml");
  const source = [
    "```{piece} main | trim()",
    ":language: javascript",
    ":caption: Main",
    ":label: lp-main",
    ":cell:",
    "",
    " export default 42; ",
    "```",
    ""
  ].join("\n");
  try {
    await writeFile(input, source);
    await writeFile(ordinary, source);
    await writeFile(config, [
      "version = 1",
      "",
      "[[files]]",
      "path = \"explicit.md\"",
      "adapter = \"myst\"",
      "execution_owner = \"pieceful\"",
      "run = true",
      "provider = \"quickjs-wasm-worker\"",
      ""
    ].join("\n"));

    const direct = await loadBuildInput(input);
    assert.equal(direct.pretransform.documents[0].format, "myst+ravel-v1");
    assert.equal(direct.pretransform.chunks[0].metadata.data.myst.executionOwner, "myst");
    assert.equal(direct.pretransform.chunks[0].metadata.data.ravel.run, undefined);

    const loaded = await loadBuildInput(config);
    assert.equal(loaded.pretransform.documents[0].format, "myst+ravel-v1");
    assert.equal(loaded.pretransform.chunks[0].metadata.data.ravel.run, true);
    assert.equal(loaded.pretransform.chunks[0].metadata.data.ravel.provider, "quickjs-wasm-worker");
    const program = transformGraph(loaded.pretransform);
    assert.equal(program.chunks["explicit::main"].value, "export default 42;");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("LitPro load directives retain the adapter and document alias", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-litpro-load-"));
  const entry = join(sandbox, "entry.md");
  const library = join(sandbox, "library.md");
  try {
    await writeFile(entry, [
      "# Main",
      "",
      "    _\"shared::helper\"",
      "",
      "[shared](library.md \"load:\")",
      "[result.txt](# \"save:\")",
      ""
    ].join("\n"));
    await writeFile(library, [
      "# Helper",
      "",
      "    loaded",
      ""
    ].join("\n"));

    const loaded = await loadBuildInput(entry, {
      adapter: "markdown-litpro",
      dialect: "litpro-2017",
      document: "entry"
    });
    const program = transformGraph(loaded.pretransform);
    assert.deepEqual(program.diagnostics, []);
    assert.deepEqual(loaded.pretransform.documents.map((document) => document.id).sort(), ["entry", "shared"]);
    assert.equal(program.deliverables["result.txt"].value, "loaded");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("LitPro front matter selects the adapter for a direct Markdown input", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-litpro-frontmatter-"));
  const input = join(sandbox, "legacy.md");
  try {
    await writeFile(input, [
      "---",
      "lp:",
      "  adapter: markdown-litpro",
      "  document: selected",
      "  dialect: litpro-plus",
      "---",
      "# Main | trim()",
      "",
      "    value",
      ""
    ].join("\n"));

    const loaded = await loadBuildInput(input);
    assert.equal(loaded.pretransform.documents[0].format, "markdown+litpro-litpro-plus-v1");
    assert.equal(loaded.pretransform.chunks[0].id, "selected::main");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host confines TOML inputs, imports, and configured outputs to its root", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-scope-"));
  const root = join(sandbox, "project");
  const markdown = "```javascript {.ravel #main}\nexport const value = true;\n```\n";
  const config = (file) => "version = 1\n\n[build]\nout_dir = \"build\"\n\n[[files]]\npath = \"" + file + "\"\n";

  try {
    await mkdir(root);
    await writeFile(join(sandbox, "outside.md"), markdown);
    await writeFile(join(root, "entry.md"), "```ravel\nin(\"../outside.md\")\n```\n" + markdown);
    await writeFile(join(root, "ravel.toml"), config("entry.md"));
    await assert.rejects(loadBuildInput(join(root, "ravel.toml")), /escapes the Ravel root/);

    await writeFile(join(root, "main.md"), markdown);
    await writeFile(join(root, "escape-output.toml"), config("main.md").replace('out_dir = "build"', 'out_dir = "../build"'));
    await assert.rejects(loadBuildInput(join(root, "escape-output.toml")), /build\.out_dir escapes the Ravel root/);

    await symlink(join(sandbox, "outside.md"), join(root, "linked.md"));
    await writeFile(join(root, "symlink.toml"), config("linked.md"));
    await assert.rejects(loadBuildInput(join(root, "symlink.toml")), /must not traverse a symbolic link/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host refuses symlinked deliverable paths", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-output-scope-"));
  const root = join(sandbox, "project");
  const outside = join(sandbox, "outside");

  try {
    await mkdir(join(root, "build"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(root, "build", "dist"));
    const program = {
      deliverables: {
        "dist/main.js": { name: "dist/main.js", value: "export {};\n" }
      }
    };
    await assert.rejects(
      writeDeliverables(program, join(root, "build"), { rootDirectory: root }),
      /must not traverse a symbolic link/
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host plans, atomically writes, and manifests deliverables", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-manifest-"));
  const output = join(sandbox, "build");
  const program = {
    version: 1,
    deliverables: {
      "dist/z.txt": { name: "dist/z.txt", from: "guide::z", value: "zeta\n" },
      "dist/a.txt": { name: "dist/a.txt", from: "guide::a", value: "alpha\n" }
    }
  };

  try {
    const plan = planDeliverables(program, output);
    assert.deepEqual(plan.deliverables.map((entry) => entry.name), ["dist/a.txt", "dist/z.txt"]);
    assert.equal(plan.deliverables[0].bytes, 6);
    await mkdir(join(output, "dist"), { recursive: true });
    await writeFile(join(output, "dist", "a.txt"), "old\n");

    const written = await writeDeliverables(program, output);
    assert.equal(written.length, 2);
    assert.equal(await readFile(join(output, "dist", "a.txt"), "utf8"), "alpha\n");
    assert.equal(await readFile(join(output, "dist", "z.txt"), "utf8"), "zeta\n");
    assert.deepEqual((await readdir(join(output, "dist"))).sort(), ["a.txt", "z.txt"]);

    const generatedAt = "2026-07-22T12:34:56.000Z";
    const expectedManifest = createBuildManifest(program, output, { builtAt: generatedAt });
    const { path, manifest } = await writeBuildManifest(program, output, { generatedAt });
    assert.deepEqual(manifest, expectedManifest);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), expectedManifest);
    assert.equal(manifest.deliverables[0].sha256.length, 64);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host creates a no-overwrite ZIP backup of managed output", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-backup-"));
  const output = join(sandbox, "build");
  const program = { version: 1, deliverables: {
    "dist/main.txt": { name: "dist/main.txt", from: "guide::main", value: "ready\\n" }
  } };
  try {
    await writeBuildArtifacts(program, output, { rootDirectory: sandbox, generatedAt: "2026-07-22T12:34:56.000Z" });
    await writeFile(join(output, "unmanaged.txt"), "keep this too\\n");
    const backup = await createOutputBackup(output, {
      outputRootDirectory: sandbox,
      backupRootDirectory: sandbox
    });
    assert.equal(backup.path, join(sandbox, "backups", "build-1784723696.zip"));
    assert.deepEqual(backup.files, [".manifest.txt", ".ravel-manifest.json", "dist/main.txt", "unmanaged.txt"]);
    assert.equal((await readFile(backup.path)).subarray(0, 4).toString("binary"), "PK\x03\x04");
    await assert.rejects(
      createOutputBackup(output, { outputRootDirectory: sandbox, backupRootDirectory: sandbox }),
      /Backup file already exists/
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host reports stale deliverables from the preceding manifest", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-stale-"));
  const output = join(sandbox, "build");
  const first = { version: 1, deliverables: {
    "dist/current.js": { name: "dist/current.js", from: "guide::current", value: "current\n" },
    "dist/removed.js": { name: "dist/removed.js", from: "guide::removed", value: "removed\n" }
  } };
  const second = { version: 1, deliverables: {
    "dist/current.js": { name: "dist/current.js", from: "guide::current", value: "current\n" }
  } };
  try {
    await writeDeliverables(first, output);
    await writeBuildManifest(first, output);
    assert.deepEqual(await planStaleDeliverables(second, output, { staleSince: "2026-01-02T03:04:05.000Z" }), [{
      name: "dist/removed.js", path: "dist/removed.js", from: "guide::removed", staleSince: "2026-01-02T03:04:05.000Z"
    }]);
    assert.equal(await readFile(join(output, "dist", "removed.js"), "utf8"), "removed\n");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host produces repeatable graphs, manifests, and bytes in separate roots", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-repeatable-"));
  const makeProject = async (name) => {
    const root = join(sandbox, name);
    const input = join(root, "project.ravel-map.json");
    const output = join(root, "output");
    const source = { uri: input, range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
    await mkdir(root);
    await writeFile(input, JSON.stringify({
      version: 1,
      document: { id: "project", uri: input, format: "ravel-map-v1" },
      chunks: [{
        id: "project::main",
        identity: { document: "project", chunk: "main", minor: null, type: null },
        body: "_\"|delay('ready')\"",
        definitionPipeline: [{ type: "transform", name: "concat", arguments: [], source }],
        source
      }],
      directives: [{ kind: "out", name: "dist/main.txt", from: "project::main", source }]
    }));
    const loaded = await loadBuildInput(input);
    const program = transformGraph(loaded.pretransform);
    await writeDeliverables(program, output);
    const manifest = createBuildManifest(program, output);
    return { program, manifest, bytes: await readFile(join(output, "dist", "main.txt"), "utf8") };
  };
  try {
    const first = await makeProject("one");
    const second = await makeProject("two");
    assert.deepEqual(first.program, second.program);
    assert.deepEqual(
      { ...first.manifest, outputDirectory: "." },
      { ...second.manifest, outputDirectory: "." }
    );
    assert.equal(first.bytes, second.bytes);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("Node host does not commit deliverables when an artifact transaction cannot stage", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-transaction-"));
  const output = join(sandbox, "build");
  const program = { version: 1, deliverables: {
    "dist/first.txt": { name: "dist/first.txt", from: "guide::first", value: "first\n" },
    "dist/second.txt": { name: "dist/second.txt", from: "guide::second", value: "second\n" }
  } };
  try {
    await mkdir(join(output, "dist", "second.txt"), { recursive: true });
    await assert.rejects(writeBuildArtifacts(program, output), /must be a file when it already exists/);
    await assert.rejects(readFile(join(output, "dist", "first.txt"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(output, ".ravel-manifest.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("external language transforms run before delayed content is fulfilled", () => {
  const text = "```markdown {.ravel #content pipe=\"markdown()\"}\n# Hello\n```\n\n```pug {.ravel #page pipe=\"pug()\"}\nhtml\n  body\n    | _\"|delay(ch('content.markdown'), 1, 'RAVELSAFE')\"\n```\n";
  const { map, diagnostics } = markdownToMap(text, { uri: "page.md", document: "page", mode: "primary" });
  assert.deepEqual(diagnostics, []);
  const program = transformGraph(combineMaps([map]), {
    transforms: {
      pug: pugLike,
      markdown: markdownLike
    }
  });
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["page::page.pug"].value, "<html><body><h1>Hello</h1></body></html>");
  assert.match(program.trace.chunks["page::page.pug"][0].value, /RAVELSAFE/);
});
