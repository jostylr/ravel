import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prepareQuartoRender } from "../packages/quarto/src/index.js";

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
