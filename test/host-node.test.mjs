import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadBuildInput, loadPretransformGraph, writeDeliverables } from "../packages/host-node/src/index.js";
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
