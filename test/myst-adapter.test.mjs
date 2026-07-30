import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";
import { modernMarkdownToMap } from "../packages/markdown/src/index.js";
import { mystToMap } from "../packages/myst/src/index.js";

const fixture = (name) =>
  readFile(new URL("../fixtures/myst/" + name, import.meta.url), "utf8");

test("MyST scans piece directives, native fallbacks, anchors, captions, and exact bodies", async () => {
  const source = await fixture("native.myst.md");
  const adapted = mystToMap(source, {
    uri: "fixtures/myst/native.myst.md",
    document: "native"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "native::main",
    "native::format-greeting",
    "native::analysis"
  ]);

  const main = adapted.map.chunks[0];
  assert.equal(main.name, "Main program");
  assert.equal(main.metadata.language, "python");
  assert.equal(main.metadata.data.ravel.renderedAnchor, "lp-main");
  assert.equal(main.body, "print(_\"format-greeting\")\n");
  assert.deepEqual(main.definitionPipeline.map((step) => step.name), ["trim"]);
  assert.equal(
    source.slice(main.fragments[0].source.range.start.offset, main.fragments[0].source.range.end.offset),
    main.body
  );

  const helper = adapted.map.chunks[1];
  assert.equal(helper.name, "Greeting formatter");
  assert.equal(helper.metadata.data.myst.fragments[0].directive, "code-block");
  assert.equal(helper.body, "def format_greeting():\n    return \"hello\"\n");

  const cell = adapted.map.chunks[2];
  assert.equal(cell.metadata.data.myst.notebookCell, true);
  assert.equal(cell.metadata.data.myst.executionOwner, "myst");
  assert.deepEqual(cell.metadata.tags, ["hide-output", "raises-exception"]);
  assert.equal(adapted.map.metadata.plannedEffects[0].kind, "myst-code-cell");
  assert.equal(adapted.map.metadata.plannedEffects[0].owner, "myst");
  assert.deepEqual(adapted.map.metadata.frontMatter.kernelspec, {
    name: "python3",
    display_name: "Python 3"
  });
});

test("the no-plugin fixture uses only native MyST code directives", async () => {
  const source = await fixture("fallback.myst.md");
  const adapted = mystToMap(source, {
    uri: "fixtures/myst/fallback.myst.md",
    document: "fallback"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(adapted.map.chunks.map((chunk) =>
    chunk.metadata.data.myst.fragments[0].directive
  ), ["code-block", "code-cell"]);
  assert.deepEqual(adapted.surface.navigation.map((entry) => entry.targetPieceId), [
    "fallback::main",
    "fallback::format-greeting"
  ]);
});

test("MyST navigation stays distinct from code composition references", async () => {
  const source = await fixture("native.myst.md");
  const adapted = mystToMap(source, {
    uri: "fixtures/myst/native.myst.md",
    document: "native"
  });

  assert.equal(adapted.surface.references.length, 1);
  assert.equal(adapted.surface.references[0].ownerPieceId, "native::main");
  assert.equal(adapted.surface.references[0].targetText, "format-greeting");
  assert.deepEqual(adapted.surface.navigation.map((entry) => entry.syntax), [
    "link", "role", "shorthand"
  ]);
  assert.ok(adapted.surface.navigation.every((entry) => entry.targetPieceId === "native::main"));
  for (const entry of [...adapted.surface.references, ...adapted.surface.navigation]) {
    assert.ok(entry.source.range.end.offset > entry.source.range.start.offset);
  }

  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.match(program.chunks["native::main"].value, /def format_greeting/);
});

test("an adjacent MyST target can provide the stable piece label", () => {
  const source = [
    "(lp-helper)=",
    "````{piece} helper",
    ":language: text",
    ":caption: Visible helper",
    "",
    "value",
    "````",
    "",
    "See {ref}`lp-helper`.",
    ""
  ].join("\n");
  const adapted = mystToMap(source, { uri: "target.myst.md", document: "target" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(adapted.map.chunks[0].id, "target::helper");
  assert.equal(adapted.map.chunks[0].metadata.data.ravel.renderedAnchor, "lp-helper");
  assert.equal(adapted.map.chunks[0].metadata.data.myst.fragments[0].target.label, "lp-helper");
  assert.equal(adapted.surface.navigation[0].targetPieceId, "target::helper");
});

test("MyST notebook cells preserve native ownership unless Pieceful is explicit", () => {
  const source = [
    "```{piece} analysis",
    ":language: javascript",
    ":caption: Analysis",
    ":label: lp-analysis",
    ":cell:",
    ":run:",
    "",
    "export default 42;",
    "```",
    ""
  ].join("\n");

  const native = mystToMap(source, { uri: "cell.myst.md", document: "cell" });
  assert.ok(native.diagnostics.some((entry) => entry.code === "LPA141"));
  assert.equal(native.map.chunks[0].metadata.data.ravel.run, undefined);
  assert.equal(native.map.metadata.plannedEffects[0].owner, "myst");

  const pieceful = mystToMap(source, {
    uri: "cell.myst.md",
    document: "cell",
    executionOwner: "pieceful",
    provider: "quickjs-wasm-worker"
  });
  assert.deepEqual(pieceful.diagnostics, []);
  assert.equal(pieceful.map.chunks[0].metadata.data.ravel.run, true);
  assert.equal(pieceful.map.chunks[0].metadata.data.ravel.provider, "quickjs-wasm-worker");
  assert.equal(pieceful.map.metadata.plannedEffects[0].owner, "pieceful");
});

test("MyST reports malformed ownership, conflicting labels, repeats, and unterminated directives", () => {
  const conflicts = mystToMap([
    "(lp-first)=",
    ":::{piece} mismatched",
    ":label: lp-second",
    "",
    "first",
    ":::",
    "",
    ":::{piece} shared | trim()",
    "",
    "first",
    ":::",
    "",
    ":::{piece} shared | indent(2)",
    "",
    "second",
    ":::",
    "",
    "```{note}",
    "ordinary prose",
    "```",
    ""
  ].join("\n"), { uri: "conflict.myst.md", document: "conflict" });

  assert.ok(conflicts.diagnostics.some((entry) =>
    entry.code === "LPA113" && entry.message.includes("target")
  ));
  assert.ok(conflicts.diagnostics.some((entry) =>
    entry.code === "LPA113" && entry.message.includes("pipelines")
  ));
  assert.equal(conflicts.map.metadata.ignoredDirectives[0].directive, "note");

  const unterminated = mystToMap(
    ":::{piece} main\n:caption: Main\n\nvalue\n",
    { uri: "broken.myst.md", document: "broken" }
  );
  assert.equal(unterminated.map.chunks[0].body, "value\n");
  assert.ok(unterminated.diagnostics.some((entry) => entry.code === "LPA111"));
});

test("MyST and modern Markdown normalize pieces and pipelines equivalently", () => {
  const markdown = modernMarkdownToMap([
    "```{.text .lp-piece #lp-main lp-title=\"Main\" lp-pipe=\"trim()\"}",
    "  _\"helper\"  ",
    "```",
    "",
    "```{.text .lp-piece #lp-helper lp-title=\"Helper\"}",
    "value",
    "```",
    ""
  ].join("\n"), { uri: "equivalent.md", document: "equivalent" });
  const myst = mystToMap([
    ":::{piece} main | trim()",
    ":language: text",
    ":caption: Main",
    ":label: lp-main",
    "",
    "  _\"helper\"  ",
    ":::",
    "",
    "```{piece} helper",
    ":language: text",
    ":caption: Helper",
    ":label: lp-helper",
    "",
    "value",
    "```",
    ""
  ].join("\n"), { uri: "equivalent.myst.md", document: "equivalent" });

  const semantic = ({ map }) => map.chunks.map((chunk) => ({
    id: chunk.id,
    body: chunk.body,
    language: chunk.metadata.language,
    pipeline: chunk.definitionPipeline.map((step) => [step.name, step.arguments])
  }));
  assert.deepEqual(markdown.diagnostics, []);
  assert.deepEqual(myst.diagnostics, []);
  assert.deepEqual(semantic(myst), semantic(markdown));
  for (const adapted of [markdown, myst]) {
    const program = transformGraph(combineMaps([adapted.map]));
    assert.deepEqual(program.diagnostics, []);
    assert.equal(program.chunks["equivalent::main"].value, "value");
  }
});
