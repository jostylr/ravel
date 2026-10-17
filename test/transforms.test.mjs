import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { builtinTransforms, json, markdown, template, templateData } from "../packages/transforms/src/index.js";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import { loadBuildInput } from "../packages/host-node/src/index.js";
import { renderMarkdownDocument } from "../packages/host-browser/src/index.js";
import { markdownToMap } from "../packages/markdown/src/index.js";

test("markdown renders CommonMark and escapes raw HTML unless asked", () => {
  assert.equal(markdown("# Title\n\n*a* <b>x</b>\n"), "<h1>Title</h1>\n<p><em>a</em> &lt;b&gt;x&lt;/b&gt;</p>\n");
  assert.equal(markdown("<b>x</b>\n", { arguments: [{ html: true }] }), "<p><b>x</b></p>\n");
  assert.throws(() => markdown("x", { arguments: ["nope"] }), /options object/);
});

test("template merges objects and key/value arguments and fills placeholders", () => {
  assert.deepEqual(templateData(['{"a":1,"b":{"c":"d"}}', "content", "<p>x</p>", { a: 2 }]), { a: 2, b: { c: "d" }, content: "<p>x</p>" });
  const args = ['{"title":"A & B","items":[{"t":"x"},{"t":"y"}],"n":{"k":3}}', "body", "<p>hi</p>"];
  assert.equal(
    template("<h1>{{ title | html }}</h1>{{body}}{{ n.k }} \\{{raw}} {{#each items}}[{{t}}]{{/each}}", { arguments: args }),
    "<h1>A &amp; B</h1><p>hi</p>3 {{raw}} [x][y]"
  );
  assert.equal(template("{{#each list}}{{this}},{{/each}}", { arguments: [{ list: ["a", "b"] }] }), "a,b,");
  assert.throws(() => template("{{missing}}", { arguments: [] }), /no value for \{\{ missing \}\}/);
  assert.throws(() => template("{{#each x}}", { arguments: [{ x: [] }] }), /without \{\{\/each\}\}/);
  assert.throws(() => template("{{/each}}", { arguments: [] }), /without a matching/);
  assert.throws(() => template("x", { arguments: ["dangling"] }), /key followed by its value/);
  assert.equal(json('say "hi"\n'), '"say \\"hi\\"\\n"');
  assert.deepEqual(Object.keys(builtinTransforms).sort(), ["json", "markdown", "template"]);
});

test("template parts keep exact layout provenance and attribute values to their arguments", () => {
  const source = (line) => ({ uri: "site.md", range: { start: { line, column: 0, offset: 0 }, end: { line, column: 0, offset: 0 } } });
  const map = {
    version: 1,
    document: { id: "site", uri: "site.md", format: "ravel-map-v1" },
    chunks: [
      { id: "site::layout", identity: { document: "site", chunk: "layout", minor: null, type: null }, name: "layout", body: "<h1>{{ title }}</h1>{{ content }}", metadata: {}, source: source(1) },
      { id: "site::data", identity: { document: "site", chunk: "data", minor: null, type: null }, name: "data", body: "{\"title\":\"Hi\"}", metadata: {}, source: source(5) },
      { id: "site::text", identity: { document: "site", chunk: "text", minor: null, type: null }, name: "text", body: "*words*", metadata: {}, source: source(9) },
      { id: "site::page", identity: { document: "site", chunk: "page", minor: null, type: null }, name: "page", body: "_`layout | template(ch('data'), 'content', ch('text | markdown'))`", metadata: {}, source: source(12) }
    ],
    directives: []
  };
  const program = transformGraph(combineMaps([map]), { transforms: builtinTransforms });
  assert.deepEqual(program.diagnostics, []);
  const page = program.chunks["site::page"];
  assert.equal(page.value, "<h1>Hi</h1><p><em>words</em></p>");
  const lines = page.segments.map((segment) => [
    page.value.slice(segment.generated.start, segment.generated.end),
    segment.precision,
    segment.source?.range.start.line,
    (segment.origins ?? []).map((origin) => origin.source?.range.start.line)
  ]);
  assert.deepEqual(lines[0].slice(0, 3), ["<h1>", "exact", 1]);
  assert.deepEqual([lines[1][0], lines[1][3]], ["Hi", [5]]);
  assert.deepEqual(lines[2].slice(0, 3), ["</h1>", "exact", 1]);
  assert.equal(lines[3][0], "<p><em>words</em></p>");
  assert.deepEqual(lines[3][3], [9]);
});

test("ravel.toml registers project transform modules alongside the built-ins", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-transforms-"));
  try {
    await mkdir(join(sandbox, "transforms"));
    await writeFile(join(sandbox, "transforms", "shout.mjs"), "export default (value, { arguments: args }) => value.toUpperCase() + (args[0] ?? '');\nexport const whisper = (value) => value.toLowerCase();\n");
    await writeFile(join(sandbox, "doc.md"), "```text {.ravel #main}\n_\"words.text | shout('!')\" _\"words.text | quiet\" _\"md.text | markdown\"\n```\n\n```text {.ravel #words}\nHello\n```\n\n```text {.ravel #md}\n*x*\n```\n");
    const config = (extra) => "version = 1\n\n[[files]]\npath = \"doc.md\"\n" + extra;
    await writeFile(join(sandbox, "ravel.toml"), config("\n[[transforms]]\nname = \"shout\"\nmodule = \"transforms/shout.mjs\"\n\n[[transforms]]\nname = \"quiet\"\nmodule = \"transforms/shout.mjs\"\nexport = \"whisper\"\n"));
    const loaded = await loadBuildInput(join(sandbox, "ravel.toml"));
    const program = transformGraph(loaded.pretransform, { transforms: loaded.transforms });
    assert.deepEqual(program.diagnostics, []);
    assert.equal(program.chunks["doc::main.text"].value, "HELLO\n! hello\n <p><em>x</em></p>\n\n");

    await writeFile(join(sandbox, "ravel.toml"), config("\n[[transforms]]\nname = \"trim\"\nmodule = \"transforms/shout.mjs\"\n"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /core command and cannot be replaced/);
    await writeFile(join(sandbox, "ravel.toml"), config("\n[[transforms]]\nname = \"nope\"\nmodule = \"transforms/shout.mjs\"\nexport = \"missing\"\n"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /no function export "missing"/);
    await writeFile(join(sandbox, "ravel.toml"), config("\n[[transforms]]\nname = \"far\"\nmodule = \"../outside.mjs\"\n"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /escapes the Ravel root/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("direct inputs and the browser host get the built-in transforms", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-builtin-"));
  try {
    const source = "```text {.ravel #main}\n_\"md.text | markdown\"\n```\n\n```text {.ravel #md}\n# Hi\n```\n";
    await writeFile(join(sandbox, "doc.md"), source);
    const loaded = await loadBuildInput(join(sandbox, "doc.md"));
    const program = transformGraph(loaded.pretransform, { transforms: loaded.transforms });
    assert.equal(program.chunks["doc::main.text"].value, "<h1>Hi</h1>\n\n");
    const browser = renderMarkdownDocument(source + "\n```ravel\nout(\"a.html\", _\"main.text\")\n```\n", { uri: "doc.md" });
    assert.equal(browser.ok, true);
    assert.equal(browser.deliverables[0].value, "<h1>Hi</h1>\n\n");
    assert.ok(markdownToMap);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
