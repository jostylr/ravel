import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { markdownToMap, modernMarkdownToMap } from "../packages/markdown/src/index.js";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";

const fixture = async (name) => readFile(new URL("../fixtures/markdown/" + name, import.meta.url), "utf8");

test("Markdown fences create source-mapped chunks with greedy continuations", async () => {
  const { map, diagnostics } = markdownToMap(await fixture("guide.md"), {
    uri: "fixtures/markdown/guide.md",
    mode: "primary"
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(map.document.id, "handbook");
  assert.deepEqual(map.chunks.map((chunk) => chunk.id), [
    "handbook::compiler:what.ts",
    "handbook::main.javascript"
  ]);
  const compiler = map.chunks[0];
  assert.match(compiler.body, /compile[\s\S]*parse[\s\S]*finish/);
  assert.equal(compiler.fragments.length, 3);
  assert.deepEqual(compiler.metadata.tags, ["browser"]);
  assert.equal(compiler.metadata.data.ravel.definitionPipe, "dedent() | emit('.js')");
  assert.deepEqual(compiler.definitionPipeline.map(({ name, arguments: args }) => ({ name, arguments: args })), [
    { name: "dedent", arguments: [] }
  ]);
  assert.equal(compiler.source.range.start.line, 8);
});

test("primary Markdown mode requires explicit Ravel classification", () => {
  const { diagnostics } = markdownToMap("```js\nconst example = true;\n```\n", {
    uri: "example.md",
    document: "example",
    mode: "primary"
  });
  assert.equal(diagnostics[0].code, "RM103");
});

test(".run marks a named fence as executable without changing its language or tags", () => {
  const { map, diagnostics } = markdownToMap(
    "```js {.run #analysis .browser provider=quickjs-wasm-worker}\nexport default \"\";\n```\n",
    { uri: "live.md", document: "live", mode: "primary" }
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(map.chunks[0].metadata.language, "js");
  assert.deepEqual(map.chunks[0].metadata.tags, ["browser"]);
  assert.deepEqual(map.chunks[0].metadata.data.ravel, {
    run: true,
    provider: "quickjs-wasm-worker"
  });
});

test(".run requires a stable identity", () => {
  const unnamed = markdownToMap("```js {.run}\nexport default 1;\n```\n", {
    uri: "live.md",
    document: "live",
    mode: "primary"
  });
  assert.match(unnamed.diagnostics[0].message, /\.run fence.*#chunk/);
});

test("ravel fences translate directives into portable staged composition IR", () => {
  const text = "```text {.ravel #source}\n  value  \n```\n\n```ravel\ncreate(\"program:stage.js\", compose(\n  _\"source.text\",\n  pass(trim(), emit(\"observed.js\")),\n  pipe(trim(), emit(\"min.js\"), indent(2))\n))\nalias(\"public.js\", _\"program:stage.js\")\nout(\"dist/stage.js\", _\"program:stage.js\")\n```\n";
  const { map, diagnostics } = markdownToMap(text, { uri: "guide.md", document: "guide", mode: "primary" });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(map.directives.map((directive) => directive.kind), ["create", "alias", "out"]);
  assert.equal(map.directives[0].compose[1].kind, "pass");
  assert.equal(map.directives[0].compose[2].steps[1].suffix, "min.js");
  assert.equal(map.directives[2].from, "guide::program:stage.js");

  const program = transformGraph(combineMaps([map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["guide::program:stage.js"].value, "  value");
  assert.equal(program.chunks["guide::program:observed.js"].value, "value");
  assert.equal(program.chunks["guide::program:min.js"].value, "value");
  assert.equal(program.chunks["guide::public.js"].value, "  value");
  assert.equal(program.deliverables["dist/stage.js"].value, "  value");
});

test("modern Markdown keeps heading ownership across a named fence", () => {
  const source = [
    "# Guide",
    "## Main program | trim()",
    "",
    "```javascript",
    "first();",
    "```",
    "",
    "```javascript lp:helper | trim()",
    "helper();",
    "```",
    "",
    "```javascript",
    "third();",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = modernMarkdownToMap(source, {
    uri: "modern.md",
    document: "modern"
  });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(validateRavelMap(map), []);
  assert.equal(map.document.format, "markdown+ravel-modern-v1");
  assert.deepEqual(map.chunks.map((chunk) => chunk.id), ["modern::main-program", "modern::helper"]);
  assert.equal(map.chunks[0].body, "first();\nthird();\n");
  assert.equal(map.chunks[0].fragments.length, 2);
  assert.equal(map.chunks[0].metadata.language, "javascript");
  assert.deepEqual(map.chunks[0].metadata.data.ravel.fragmentLanguages, ["javascript", "javascript"]);
  assert.deepEqual(map.chunks[0].metadata.data.ravel.fragmentInfo, [
    { language: "javascript", infoString: "javascript" },
    { language: "javascript", infoString: "javascript" }
  ]);
  assert.equal(map.chunks[1].body, "helper();\n");
});

test("modern Markdown accepts a first-fence pipeline and retains heading-owned live metadata", () => {
  const source = [
    "## Analysis {#lp-analysis}",
    "",
    "```{.javascript .run provider=quickjs-wasm-worker lp-pipe=\"trim()\"}",
    "export default \"ok\";",
    "```",
    "",
    "```javascript",
    "// still analysis",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = modernMarkdownToMap(source, {
    uri: "live-modern.md",
    document: "live-modern"
  });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(validateRavelMap(map), []);
  assert.equal(map.chunks[0].id, "live-modern::analysis");
  assert.deepEqual(map.chunks[0].definitionPipeline, [{ name: "trim", arguments: [] }]);
  assert.deepEqual(map.chunks[0].metadata.data.ravel.run, true);
  assert.equal(map.chunks[0].metadata.data.ravel.provider, "quickjs-wasm-worker");
  assert.equal(map.chunks[0].fragments.length, 2);
});

test("modern Markdown rejects a definition pipeline on a later heading-owned fence", () => {
  const source = [
    "## Main",
    "",
    "```js",
    "first();",
    "```",
    "",
    "```js | trim()",
    "second();",
    "```",
    ""
  ].join("\n");
  const { diagnostics } = modernMarkdownToMap(source, {
    uri: "later-pipe.md",
    document: "later-pipe"
  });

  assert.equal(diagnostics[0].code, "RM105");
  assert.match(diagnostics[0].message, /Only the first unnamed fence/);
});

test("lp.adapter front matter opts markdownToMap into the modern profile", () => {
  const source = [
    "---",
    "lp:",
    "  adapter: markdown",
    "  document: front-matter",
    "---",
    "# Narrative title",
    "## Owned",
    "",
    "```js",
    "value();",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = markdownToMap(source);

  assert.deepEqual(diagnostics, []);
  assert.equal(map.document.format, "markdown+ravel-modern-v1");
  assert.deepEqual(map.chunks.map((chunk) => chunk.id), ["front-matter::owned"]);
});

test("an explicit fences profile overrides modern Markdown front matter", () => {
  const source = [
    "---",
    "lp:",
    "  adapter: markdown",
    "  document: compatibility",
    "---",
    "## Not a piece in the fences profile",
    "",
    "```js",
    "example();",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = markdownToMap(source, { profile: "fences" });

  assert.deepEqual(diagnostics, []);
  assert.equal(map.document.format, "markdown+ravel-fences-v1");
  assert.deepEqual(map.chunks, []);
});

test("modern Pandoc fences support named declarations and explicit append fragments", () => {
  const source = [
    "```{.javascript .lp-piece #lp-helper lp-title=\"Helper\"}",
    "helper();",
    "```",
    "",
    "```{.javascript .lp-fragment lp-for=\"helper\"}",
    "helper.extra = true;",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = modernMarkdownToMap(source, {
    uri: "pandoc.md",
    document: "pandoc"
  });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(validateRavelMap(map), []);
  assert.equal(map.chunks[0].name, "Helper");
  assert.equal(map.chunks[0].body, "helper();\nhelper.extra = true;\n");
  assert.equal(map.chunks[0].metadata.data.ravel.renderedAnchor, "lp-helper");
});

test("modern Markdown recognizes native Quarto listing labels and captions", () => {
  const source = [
    "```{#lst-lp-main .javascript .lp-piece lp-id=\"main\" lst-cap=\"Main program\" lp-pipe=\"trim()\"}",
    "  console.log(_\"helper\");  ",
    "```",
    "",
    "See @lst-lp-main.",
    ""
  ].join("\n");
  const { map, diagnostics } = modernMarkdownToMap(source, {
    uri: "listing.qmd",
    document: "listing"
  });

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(validateRavelMap(map), []);
  assert.equal(map.chunks[0].id, "listing::main");
  assert.equal(map.chunks[0].name, "Main program");
  assert.equal(
    map.chunks[0].metadata.data.ravel.renderedAnchor,
    "lst-lp-main"
  );
  assert.deepEqual(map.chunks[0].metadata.data.ravel.quarto, {
    listingLabel: "lst-lp-main",
    listingCaption: "Main program"
  });
  assert.deepEqual(map.chunks[0].definitionPipeline, [{
    name: "trim",
    arguments: []
  }]);

  const inferred = modernMarkdownToMap([
    "```{#lst-lp-helper .javascript .lp-piece lst-cap=\"Helper\"}",
    "helper();",
    "```",
    ""
  ].join("\n"), {
    uri: "inferred.qmd",
    document: "inferred"
  });
  assert.deepEqual(inferred.diagnostics, []);
  assert.equal(inferred.map.chunks[0].id, "inferred::helper");
});

test("modern Markdown separates Quarto cell options and execution ownership", () => {
  const source = [
    "```{python .lp-piece #lp-analysis lp-id=\"analysis\" ravel-execution-owner=\"quarto\"}",
    "#| lst-label: lst-lp-analysis",
    "#| lst-cap: Analysis",
    "#| echo: true",
    "",
    "print(_\"prepared-data\")",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = modernMarkdownToMap(source, {
    uri: "cell.qmd",
    document: "cell"
  });

  assert.deepEqual(diagnostics, []);
  assert.equal(map.chunks[0].id, "cell::analysis");
  assert.equal(map.chunks[0].body, "\nprint(_\"prepared-data\")\n");
  assert.equal(map.chunks[0].metadata.language, "python");
  assert.deepEqual(map.chunks[0].metadata.data.ravel.quarto, {
    listingLabel: "lst-lp-analysis",
    listingCaption: "Analysis",
    executable: true,
    executionOwner: "quarto",
    cellOptions: {
      "lst-label": "lst-lp-analysis",
      "lst-cap": "Analysis",
      echo: true
    }
  });

  const conflict = modernMarkdownToMap(source.replace(
    ".lp-piece",
    ".lp-piece .run"
  ), {
    uri: "conflict.qmd",
    document: "conflict"
  });
  assert.ok(conflict.diagnostics.some((entry) =>
    entry.code === "RM140" && entry.message.includes("both own execution")
  ));
});

test("modern Markdown diagnoses incompatible fragment languages", () => {
  const source = [
    "## Mixed",
    "",
    "```js",
    "one();",
    "```",
    "",
    "```css",
    ".two {}",
    "```",
    ""
  ].join("\n");
  const { map, diagnostics } = modernMarkdownToMap(source, {
    uri: "mixed.md",
    document: "mixed"
  });

  assert.equal(diagnostics[0].code, "RM150");
  assert.match(diagnostics[0].message, /js, css/);
  assert.equal(map.chunks[0].metadata.language, undefined);
  assert.deepEqual(map.chunks[0].metadata.data.ravel.fragmentLanguages, ["js", "css"]);
});
