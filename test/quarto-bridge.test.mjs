import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  prepareQuartoProject,
  prepareQuartoRender,
  remapQuartoDiagnostic
} from "../packages/quarto/src/index.js";

const fixture = (name) =>
  readFile(new URL("../fixtures/quarto/" + name, import.meta.url), "utf8");

test("Quarto bridge adds graph navigation and a piece index to temporary source", async () => {
  const source = await fixture("static-listing.qmd");
  const prepared = prepareQuartoRender(source, {
    uri: "fixtures/quarto/static-listing.qmd"
  });

  assert.deepEqual(prepared.diagnostics, []);
  assert.equal(prepared.map.document.format, "markdown+ravel-modern-v1");
  assert.deepEqual(prepared.map.chunks.map((chunk) => chunk.id), [
    "quarto-static::main",
    "quarto-static::helper"
  ]);
  assert.match(prepared.source, /\*\*Uses:\*\* \[Helper\]\(#lst-lp-helper\)/);
  assert.match(prepared.source, /\*\*Used by:\*\* \[Main program\]\(#lst-lp-main\)/);
  assert.match(prepared.source, /## Piece index \{\.unnumbered #ravel-piece-index\}/);
  assert.equal(source.includes("ravel:graph:start"), false);

  const authored = prepared.sourceMap.segments.filter((segment) =>
    segment.kind === "authored"
  );
  for (const segment of authored) {
    assert.equal(
      prepared.source.slice(
        segment.generated.start,
        segment.generated.end
      ),
      source.slice(
        segment.source.range.start.offset,
        segment.source.range.end.offset
      )
    );
  }
  assert.ok(prepared.sourceMap.segments.some((segment) =>
    segment.precision === "generated" && segment.source === null
  ));
  assert.match(prepared.cacheKeyMaterial, /"bridgeVersion":"0\.1\.1"/);
});

test("Quarto bridge refuses to decorate an invalid Ravel graph", () => {
  const source = [
    "---",
    "ravel:",
    "  document: invalid",
    "---",
    "",
    "```{#lst-lp-main .text .lp-piece lst-cap=\"Main\"}",
    "_\"missing\"",
    "```",
    ""
  ].join("\n");
  const prepared = prepareQuartoRender(source, { uri: "invalid.qmd" });

  assert.ok(prepared.diagnostics.some((entry) => entry.code === "RV111"));
  assert.equal(prepared.source, source);
  assert.equal(prepared.sourceMap.segments[0].kind, "authored");
});

test("Quarto bridge weaves owned executable cells before native execution", async () => {
  const source = await fixture("executable-cell.qmd");
  const prepared = prepareQuartoRender(source, {
    uri: "fixtures/quarto/executable-cell.qmd"
  });

  assert.deepEqual(prepared.diagnostics, []);
  const analysis = prepared.map.chunks.find((chunk) =>
    chunk.id === "quarto-execution::analysis"
  );
  assert.equal(
    analysis.metadata.data.ravel.quarto.executionOwner,
    "quarto"
  );
  assert.match(prepared.source, /#\| lst-label: lst-lp-analysis/);
  assert.match(prepared.source, /print\(40 \+ 2\)/);
  assert.equal(prepared.source.includes("_\"prepared-data"), false);
  assert.ok(prepared.sourceMap.segments.some((segment) =>
    segment.kind === "woven-code" &&
    segment.source?.uri === "fixtures/quarto/executable-cell.qmd"
  ));
});

test("Quarto bridge disables native evaluation for Ravel-owned cells", () => {
  const source = [
    "---",
    "ravel:",
    "  document: guarded",
    "---",
    "",
    "```{python .lp-piece #lp-main ravel-execution-owner=\"ravel\"}",
    "#| lst-label: lst-lp-main",
    "#| lst-cap: Main",
    "exported = 42",
    "```",
    ""
  ].join("\n");
  const prepared = prepareQuartoRender(source, {
    uri: "guarded.qmd"
  });

  assert.deepEqual(prepared.diagnostics, []);
  assert.match(
    prepared.source,
    /#\| lst-cap: Main\n#\| eval: false\nexported = 42/
  );
});

test("Quarto project preparation resolves cross-document graph links", () => {
  const main = [
    "---",
    "ravel:",
    "  document: main",
    "---",
    "",
    "```{#lst-lp-main .javascript .lp-piece lst-cap=\"Main\"}",
    "console.log(_\"helper::value\");",
    "```",
    ""
  ].join("\n");
  const helper = [
    "---",
    "ravel:",
    "  document: helper",
    "---",
    "",
    "```{#lst-lp-value .javascript .lp-piece lst-cap=\"Value\"}",
    "42",
    "```",
    ""
  ].join("\n");
  const prepared = prepareQuartoProject([
    { uri: "chapters/main.qmd", source: main },
    { uri: "shared/helper.qmd", source: helper }
  ], {
    outputExtension: "html",
    providerVersions: { quarto: "1.9.38" },
    transformVersions: { custom: "2" },
    dependencies: [{ path: "data/input.csv", sha256: "abc" }]
  });

  assert.deepEqual(prepared.diagnostics, []);
  assert.match(
    prepared.documents[0].preparedSource,
    /\[Value\]\(\.\.\/shared\/helper\.html#lst-lp-value\)/
  );
  assert.match(
    prepared.documents[1].preparedSource,
    /\[Main\]\(\.\.\/chapters\/main\.html#lst-lp-main\)/
  );
  assert.match(prepared.cacheKeyMaterial, /"quarto":"1\.9\.38"/);
  assert.match(prepared.cacheKeyMaterial, /"custom":"2"/);
  assert.match(prepared.cacheKeyMaterial, /"data\/input\.csv"/);
});

test("Quarto diagnostics map woven code back to its authored definition", () => {
  const source = [
    "---",
    "ravel:",
    "  document: remap",
    "---",
    "",
    "```{#lst-lp-value .python .lp-piece lst-cap=\"Value\"}",
    "bad_name",
    "```",
    "",
    "```{python .lp-piece #lp-analysis ravel-execution-owner=\"quarto\"}",
    "#| lst-label: lst-lp-analysis",
    "#| lst-cap: Analysis",
    "",
    "print(_\"value | trim()\")",
    "```",
    ""
  ].join("\n");
  const project = prepareQuartoProject([
    { uri: "analysis.qmd", source }
  ]);
  assert.deepEqual(project.diagnostics, []);
  const document = project.documents[0];
  const generatedOffset = document.preparedSource.indexOf(
    "bad_name",
    document.preparedSource.indexOf("print(")
  );
  const before = document.preparedSource.slice(0, generatedOffset);
  const diagnostic = remapQuartoDiagnostic({
    file: "analysis.qmd",
    line: before.split("\n").length,
    column: generatedOffset - before.lastIndexOf("\n"),
    message: "NameError: bad_name"
  }, project);

  assert.equal(diagnostic.code, "RQ201");
  assert.equal(diagnostic.source.uri, "analysis.qmd");
  assert.equal(
    diagnostic.source.range.start.offset,
    source.indexOf("bad_name")
  );
  assert.equal(diagnostic.metadata.ravel.kind, "woven-code");
});

test("Quarto project preparation leaves every document unchanged on error", () => {
  const invalid = [
    "---",
    "ravel:",
    "  document: invalid-owner",
    "---",
    "",
    "```{python .lp-piece #lp-main ravel-execution-owner=\"ravel\"}",
    "#| eval: true",
    "print(42)",
    "```",
    ""
  ].join("\n");
  const valid = [
    "---",
    "ravel:",
    "  document: valid-neighbor",
    "---",
    "",
    "```{#lst-lp-main .text .lp-piece lst-cap=\"Main\"}",
    "ok",
    "```",
    ""
  ].join("\n");
  const project = prepareQuartoProject([
    { uri: "invalid.qmd", source: invalid },
    { uri: "valid.qmd", source: valid }
  ]);

  assert.ok(project.diagnostics.some((entry) => entry.code === "RM140"));
  assert.deepEqual(
    project.documents.map((entry) => entry.preparedSource),
    [invalid, valid]
  );
});
