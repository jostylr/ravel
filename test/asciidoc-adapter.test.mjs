import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { asciidocToMap } from "../packages/asciidoc/src/index.js";
import {
  combineMaps,
  transformGraph
} from "../packages/core/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";
import { modernMarkdownToMap } from "../packages/markdown/src/index.js";

const fixture = (name) =>
  readFile(new URL("../fixtures/asciidoc/" + name, import.meta.url), "utf8");

test("AsciiDoc scans section, block, and container pieces losslessly", async () => {
  const source = await fixture("native.adoc");
  const adapted = asciidocToMap(source, {
    uri: "fixtures/asciidoc/native.adoc"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "native::main",
    "native::format-greeting",
    "native::bundle"
  ]);

  const [main, helper, bundle] = adapted.map.chunks;
  assert.equal(main.name, "Main program");
  assert.equal(main.metadata.language, "javascript");
  assert.equal(
    main.body,
    "const greeting = _\"format-greeting\";\nconsole.log(greeting);\n"
  );
  assert.deepEqual(
    main.definitionPipeline.map((step) => step.name),
    ["trim"]
  );
  assert.equal(helper.name, "Greeting formatter");
  assert.equal(helper.metadata.data.asciidoc.form, "block");
  assert.equal(bundle.metadata.data.asciidoc.form, "container");
  assert.equal(bundle.body, " first\nsecond \n");
  for (const chunk of adapted.map.chunks) {
    for (const fragment of chunk.fragments) {
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

test("AsciiDoc keeps native navigation separate from code composition", async () => {
  const source = await fixture("native.adoc");
  const adapted = asciidocToMap(source, {
    uri: "fixtures/asciidoc/native.adoc"
  });

  assert.equal(adapted.surface.references.length, 1);
  assert.equal(
    adapted.surface.references[0].ownerPieceId,
    "native::main"
  );
  assert.equal(
    adapted.surface.references[0].targetText,
    "format-greeting"
  );
  assert.deepEqual(
    adapted.surface.navigation.map((entry) => entry.syntax),
    ["angle-xref", "xref-macro"]
  );
  assert.deepEqual(
    adapted.surface.navigation.map((entry) => entry.targetPieceId),
    ["native::main", "native::format-greeting"]
  );
});

test("AsciiDoc ravel macros emit portable graph directives", async () => {
  const source = await fixture("native.adoc");
  const adapted = asciidocToMap(source, {
    uri: "fixtures/asciidoc/native.adoc"
  });

  assert.deepEqual(
    adapted.map.directives.map((directive) => directive.kind),
    ["create", "out"]
  );
  assert.equal(adapted.map.directives[0].name, "bundle-clean.text");
  assert.equal(adapted.map.directives[0].compose[1].kind, "pipe");
  assert.equal(
    source.slice(
      adapted.map.directives[0].source.range.start.offset,
      adapted.map.directives[0].source.range.end.offset
    ).trimEnd(),
    "ravel::derive[target=bundle-clean.text,from=bundle,using=\"trim()\"]"
  );

  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["native::bundle-clean.text"].value, "first\nsecond");
  assert.equal(program.deliverables["dist/bundle.txt"].value, "first\nsecond");
});

test("AsciiDoc live attributes remain inert adapter metadata", () => {
  const adapted = asciidocToMap([
    ".Analysis",
    "[source#lp-analysis,javascript,role=lp-piece,ravel-run=true,ravel-provider=quickjs-wasm-worker]",
    "----",
    "export default 42;",
    "----",
    ""
  ].join("\n"), {
    uri: "live.adoc",
    document: "live"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(adapted.map.chunks[0].metadata.data.ravel.run, true);
  assert.equal(
    adapted.map.chunks[0].metadata.data.ravel.provider,
    "quickjs-wasm-worker"
  );
});

test("AsciiDoc diagnoses pipeline conflicts and unterminated blocks", () => {
  const adapted = asciidocToMap([
    "[#lp-main,lp-pipe=\"indent(2)\"]",
    "== Main | trim()",
    "",
    "[source,text]",
    "----",
    "value",
    ""
  ].join("\n"), {
    uri: "broken.adoc",
    document: "broken"
  });

  assert.ok(adapted.diagnostics.some((entry) =>
    entry.code === "LPA113" && entry.message.includes("conflicting pipelines")
  ));
  assert.ok(adapted.diagnostics.some((entry) => entry.code === "LPA111"));
  assert.equal(adapted.map.chunks[0].body, "value\n");
});

test("AsciiDoc and modern Markdown normalize equivalent pieces", () => {
  const asciidoc = asciidocToMap([
    "[#lp-main]",
    "== Main | trim()",
    "",
    "[source,text]",
    "----",
    "  _\"helper\"  ",
    "----",
    "",
    ".Helper",
    "[source#lp-helper,text,role=lp-piece,lp-id=helper]",
    "----",
    "value",
    "----",
    ""
  ].join("\n"), {
    uri: "equivalent.adoc",
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

  assert.deepEqual(asciidoc.diagnostics, []);
  assert.deepEqual(markdown.diagnostics, []);
  assert.deepEqual(semantic(asciidoc), semantic(markdown));
});
