import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { htmlToMap } from "../packages/html/src/index.js";
import {
  combineMaps,
  createDeliverableProvenanceMap,
  sourceAtGeneratedOffset,
  transformGraph
} from "../packages/core/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";
import { modernMarkdownToMap } from "../packages/markdown/src/index.js";

const fixture = (name) =>
  readFile(new URL("../fixtures/html/" + name, import.meta.url), "utf8");

test("HTML scans semantic section and figure pieces without a DOM runtime", async () => {
  const source = await fixture("native.html");
  const adapted = htmlToMap(source, {
    uri: "fixtures/html/native.html"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "native::main",
    "native::helper",
    "native::bundle"
  ]);

  const [main, helper, bundle] = adapted.map.chunks;
  assert.equal(main.name, "Main program");
  assert.equal(main.metadata.language, "javascript");
  assert.equal(
    main.body,
    [
      "const comparison = 1 < 2;",
      "const helper = _\"helper\";",
      "console.log(comparison, helper, \"π\");",
      ""
    ].join("\n")
  );
  assert.deepEqual(
    main.definitionPipeline.map((step) => step.name),
    ["trim"]
  );
  assert.equal(helper.name, "Helper");
  assert.equal(helper.metadata.data.html.element, "figure");
  assert.equal(bundle.body, " first & second ");

  for (const chunk of adapted.map.chunks) {
    assert.equal(
      chunk.fragments.map((fragment) => fragment.body).join(""),
      chunk.body
    );
    for (const fragment of chunk.fragments.filter((entry) =>
      entry.precision === "exact" && entry.body
    )) {
      assert.equal(
        source.slice(
          fragment.source.range.start.offset,
          fragment.source.range.end.offset
        ),
        fragment.body
      );
    }
  }
});

test("HTML entity decoding retains honest source-to-value precision", async () => {
  const source = await fixture("native.html");
  const adapted = htmlToMap(source, {
    uri: "fixtures/html/native.html"
  });
  const values = adapted.surface.entities.map((entry) => entry.value);

  assert.ok(values.includes("<"));
  assert.ok(values.includes("&"));
  for (const entity of adapted.surface.entities) {
    assert.notEqual(
      source.slice(
        entity.source.range.start.offset,
        entity.source.range.end.offset
      ),
      entity.value
    );
  }

  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(
    program.deliverables["dist/bundle.txt"].value,
    "first & second"
  );
  const provenance = createDeliverableProvenanceMap(
    program.deliverables["dist/bundle.txt"]
  );
  const ampersand = sourceAtGeneratedOffset(
    provenance,
    program.deliverables["dist/bundle.txt"].value.indexOf("&")
  );
  assert.equal(ampersand.precision, "coarse");
  assert.equal(ampersand.sourceOffset, undefined);
  assert.equal(
    source.slice(
      ampersand.source.range.start.offset,
      ampersand.source.range.end.offset
    ),
    "&amp;"
  );
});

test("HTML keeps anchor navigation separate from code composition", async () => {
  const source = await fixture("native.html");
  const adapted = htmlToMap(source, {
    uri: "fixtures/html/native.html"
  });

  assert.deepEqual(
    adapted.surface.navigation.map((entry) => entry.targetPieceId),
    ["native::main", "native::helper"]
  );
  assert.equal(adapted.surface.references.length, 1);
  assert.equal(adapted.surface.references[0].ownerPieceId, "native::main");
  assert.equal(adapted.surface.references[0].targetText, "helper");
});

test("HTML visible links and data elements emit portable graph directives", async () => {
  const source = await fixture("native.html");
  const adapted = htmlToMap(source, {
    uri: "fixtures/html/native.html"
  });

  assert.deepEqual(
    adapted.map.directives.map((directive) => directive.kind),
    ["create", "out"]
  );
  assert.equal(adapted.map.directives[0].name, "bundle-clean.text");
  assert.equal(adapted.map.directives[1].name, "dist/bundle.txt");
  assert.match(
    source.slice(
      adapted.map.directives[1].source.range.start.offset,
      adapted.map.directives[1].source.range.end.offset
    ),
    /Write the clean bundle/
  );

  const read = htmlToMap([
    "<!doctype html>",
    "<meta name=\"ravel-document\" content=\"reader\">",
    "<a href=\"shared.html\" data-ravel-effect=\"read\"",
    "   data-ravel-as=\"shared\">Read the shared document</a>",
    ""
  ].join("\n"), {
    uri: "reader.html"
  });
  assert.deepEqual(read.diagnostics, []);
  assert.equal(read.map.directives[0].kind, "in");
  assert.equal(read.map.directives[0].target, "shared.html");
  assert.equal(read.map.directives[0].metadata.adapter, "html");
  assert.equal(read.map.directives[0].metadata.legacy.alias, "shared");
});

test("HTML ignores scripts and template contents and diagnoses duplicate identities", () => {
  const adapted = htmlToMap([
    "<!doctype html>",
    "<meta name=\"ravel-document\" content=\"safety\">",
    "<section id=\"lp-main\" data-ravel-piece=\"main\">",
    "  <pre><code>first</code></pre>",
    "</section>",
    "<figure id=\"lp-main\" data-ravel-piece=\"main\">",
    "  <pre><code>second</code></pre>",
    "</figure>",
    "<script>document.write('<section data-ravel-piece=\"runtime\"></section>')</script>",
    "<template><section data-ravel-piece=\"hidden\"><h2>Hidden</h2></section></template>",
    ""
  ].join("\n"), {
    uri: "safety.html"
  });

  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "safety::main"
  ]);
  assert.ok(adapted.diagnostics.some((entry) =>
    entry.code === "LPH103" && entry.message.includes("element IDs")
  ));
  assert.ok(adapted.diagnostics.some((entry) =>
    entry.code === "LPH103" && entry.message.includes("semantic piece IDs")
  ));
  assert.ok(adapted.diagnostics.some((entry) =>
    entry.code === "LPH102" && entry.severity === "warning"
  ));
});

test("HTML live attributes remain inert adapter metadata", () => {
  const adapted = htmlToMap([
    "<!doctype html>",
    "<figure data-ravel-piece=\"analysis\"",
    "        data-ravel-run",
    "        data-ravel-provider=\"quickjs-wasm-worker\">",
    "  <figcaption>Analysis</figcaption>",
    "  <pre><code class=\"language-javascript\">export default 42;</code></pre>",
    "</figure>",
    ""
  ].join("\n"), {
    uri: "live.html",
    document: "live"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(adapted.map.chunks[0].metadata.data.ravel.run, true);
  assert.equal(
    adapted.map.chunks[0].metadata.data.ravel.provider,
    "quickjs-wasm-worker"
  );
});

test("HTML and modern Markdown normalize equivalent pieces", () => {
  const html = htmlToMap([
    "<!doctype html>",
    "<section id=\"lp-main\" data-ravel-piece=\"main\" data-ravel-pipe=\"trim()\">",
    "  <h2>Main <code>main</code></h2>",
    "  <pre><code class=\"language-text\">  _\"helper\"  ",
    "</code></pre>",
    "</section>",
    "<figure id=\"lp-helper\" data-ravel-piece=\"helper\">",
    "  <figcaption>Helper <code>helper</code></figcaption>",
    "  <pre><code class=\"language-text\">value",
    "</code></pre>",
    "</figure>",
    ""
  ].join("\n"), {
    uri: "equivalent.html",
    document: "equivalent"
  });
  const markdown = modernMarkdownToMap([
    "```{.text .lp-piece #lp-main lp-title=\"Main\" lp-pipe=\"trim()\"}",
    "  _\"helper\"  ",
    "```",
    "",
    "```{.text .lp-piece #lp-helper lp-title=\"Helper\"}",
    "value",
    "```",
    ""
  ].join("\n"), {
    uri: "equivalent.md",
    document: "equivalent"
  });
  const semantic = ({ map }) => map.chunks.map((chunk) => ({
    id: chunk.id,
    body: chunk.body,
    language: chunk.metadata.language,
    pipeline: chunk.definitionPipeline.map((step) => [
      step.name,
      step.arguments
    ])
  }));

  assert.deepEqual(html.diagnostics, []);
  assert.deepEqual(markdown.diagnostics, []);
  assert.deepEqual(semantic(html), semantic(markdown));
});
