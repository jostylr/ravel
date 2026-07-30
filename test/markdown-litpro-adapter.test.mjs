import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { combineMaps, parseChunkId, transformGraph } from "../packages/core/src/index.js";
import { litproMarkdownToMap } from "../packages/markdown-litpro/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";

const fixture = async (name) =>
  readFile(new URL("../fixtures/markdown-litpro/" + name, import.meta.url), "utf8");

test("markdown-litpro reproduces the historical H5/H6 and relative-reference fixture", async () => {
  const source = await fixture("h5-litpro-2017.md");
  const expected = (await fixture("h5-litpro-2017.expected.txt")).trimEnd();
  const adapted = litproMarkdownToMap(source, {
    uri: "fixtures/markdown-litpro/h5-litpro-2017.md",
    document: "h5",
    dialect: "litpro-2017"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "h5::h5-and-h6-checking-how-h5-and-h6-headings-behave",
    "h5::h5-and-h6",
    "h5::simple",
    "h5::simple/test",
    "h5::simple/doc",
    "h5::simple/doc/great",
    "h5::simple/more",
    "h5::simple/more:yo",
    "h5::simple/more/dude"
  ]);

  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.deliverables.out.value, expected);
});

test("core addresses preserve LitPro slash paths and resolve relative path forms", () => {
  const cases = [
    ["book::main/doc/test:fixture.js", {
      document: "book", chunk: "main/doc/test", minor: "fixture", type: "js"
    }],
    ["./child", {
      document: null, chunk: "./child", minor: null, type: null, relativePath: "./child"
    }],
    ["../:minor", {
      document: null, chunk: "..", minor: "minor", type: null, relativePath: ".."
    }]
  ];

  for (const [value, expected] of cases) {
    const parsed = parseChunkId(value, { reference: true });
    assert.deepEqual({
      document: parsed.document,
      chunk: parsed.chunk,
      minor: parsed.minor,
      type: parsed.type,
      ...(parsed.relativePath ? { relativePath: parsed.relativePath } : {})
    }, expected);
  }
});

test("legacy H6 without H5 retains the empty path segment", () => {
  const adapted = litproMarkdownToMap([
    "# Main",
    "###### Deep",
    "",
    "    value",
    "",
    "# Entry",
    "",
    "    _\"main//deep\"",
    "",
    "[out](# \"save:\")",
    ""
  ].join("\n"), { uri: "empty-child.md", document: "empty-child" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.ok(adapted.map.chunks.some((chunk) => chunk.id === "empty-child::main//deep"));
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.deliverables.out.value, "value");
});

test("repeated major headings concatenate and litpro-plus pipelines apply once", () => {
  const adapted = litproMarkdownToMap([
    "# Main | trim()",
    "",
    "```text",
    "  first",
    "```",
    "",
    "## Main | trim()",
    "",
    "```text",
    "second  ",
    "```",
    ""
  ].join("\n"), { uri: "repeat.md", document: "repeat" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(adapted.map.chunks.length, 1);
  assert.equal(adapted.map.chunks[0].body, "  first\nsecond  ");
  assert.equal(adapted.map.chunks[0].fragments.length, 2);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.equal(program.chunks["repeat::main"].value, "first\nsecond");
});

test("pieceful-2020 accumulates repeated heading pipelines", () => {
  const adapted = litproMarkdownToMap([
    "# Main | trim()",
    "",
    "    value",
    "",
    "## Main | indent(2)",
    ""
  ].join("\n"), {
    uri: "pieceful-2020.md",
    document: "pieceful-2020",
    dialect: "pieceful-2020"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(adapted.map.chunks[0].definitionPipeline.map((step) => step.name), ["trim", "indent"]);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.equal(program.chunks["pieceful-2020::main"].value, "  value");
});

test("litpro-2017 diagnoses heading pipelines without executing them", () => {
  const adapted = litproMarkdownToMap("# Main | trim()\n\n    value\n", {
    uri: "historical.md",
    document: "historical",
    dialect: "litpro-2017"
  });

  assert.equal(adapted.diagnostics[0].code, "LPA113");
  assert.deepEqual(adapted.map.chunks[0].definitionPipeline, []);
});

test("minor links switch ownership and caret returns to the active heading", () => {
  const adapted = litproMarkdownToMap([
    "# Main",
    "",
    "    first",
    "",
    "[aside]()",
    "",
    "    aside",
    "",
    "[^]()",
    "",
    "    last",
    ""
  ].join("\n"), { uri: "minor.md", document: "minor" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(adapted.map.chunks.find((chunk) => chunk.id === "minor::main").body, "first\nlast");
  assert.equal(adapted.map.chunks.find((chunk) => chunk.id === "minor::main:aside").body, "aside");
});

test("flat and none heading modes remain explicit alternatives", () => {
  const flat = litproMarkdownToMap("# One\n\n    a\n\n##### Five\n\n    b\n", {
    uri: "flat.md",
    document: "flat",
    headings: "flat"
  });
  assert.deepEqual(flat.map.chunks.map((chunk) => chunk.id), ["flat::one", "flat::five"]);

  const none = litproMarkdownToMap([
    "# Narrative",
    "",
    "```javascript lp:actual | trim()",
    "export default \"ok\";",
    "```",
    ""
  ].join("\n"), {
    uri: "none.md",
    document: "none",
    headings: "none"
  });
  assert.deepEqual(none.diagnostics, []);
  assert.deepEqual(none.map.chunks.map((chunk) => chunk.id), ["none::actual"]);
  assert.deepEqual(none.map.chunks[0].definitionPipeline.map((step) => step.name), ["trim"]);
});

test("LitPro live fences retain execution metadata but do not execute", () => {
  const adapted = litproMarkdownToMap([
    "# Analysis",
    "",
    "```{.javascript .run .browser provider=quickjs-wasm-worker}",
    "export default \"ready\";",
    "```",
    ""
  ].join("\n"), { uri: "live-litpro.md", document: "live-litpro" });

  assert.deepEqual(adapted.diagnostics, []);
  const chunk = adapted.map.chunks[0];
  assert.equal(chunk.metadata.language, "javascript");
  assert.deepEqual(chunk.metadata.tags, ["browser"]);
  assert.equal(chunk.metadata.data.ravel.run, true);
  assert.equal(chunk.metadata.data.ravel.provider, "quickjs-wasm-worker");
});

test("counted legacy substitutions resolve at the requested definition phase", () => {
  const adapted = litproMarkdownToMap([
    "# Source",
    "",
    "    value",
    "",
    "# Main | trim()",
    "",
    "    before \\1_\"source\" after",
    ""
  ].join("\n"), { uri: "counted.md", document: "counted" });

  assert.deepEqual(adapted.diagnostics, []);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["counted::main"].value, "before value after");
  assert.equal(program.trace.chunks["counted::main"][2].stage, "fulfilled-output");
});

test("legacy links become portable directives or inert planned effects", () => {
  const adapted = litproMarkdownToMap([
    "# Main",
    "",
    "    value",
    "",
    "[shared](shared.md \"load:\")",
    "[result.txt](# \"save: | legacy tidy\")",
    "[memo](# \"custom: argument\")",
    "<!--+ legacy compiler instruction -->",
    ""
  ].join("\n"), { uri: "directives.md", document: "directives" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(adapted.map.directives.map((directive) => directive.kind), ["in", "out"]);
  assert.equal(adapted.map.directives[0].metadata.legacy.alias, "shared");
  assert.equal(adapted.map.directives[1].from, "directives::main");
  assert.equal(adapted.map.metadata.plannedEffects[0].directive, "custom");
  assert.equal(adapted.map.metadata.legacyComments.length, 1);
});
