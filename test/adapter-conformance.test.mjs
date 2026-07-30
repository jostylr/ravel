import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executeLiveProgram,
  transformGraph
} from "../packages/core/src/index.js";
import { loadBuildInput } from "../packages/host-node/src/index.js";
import { javascriptLiveProvider } from "../packages/js-live/src/index.js";
import { prepareQuartoRender } from "../packages/quarto/src/index.js";

const example = (name) =>
  fileURLToPath(new URL("../examples/adapter-conformance/" + name, import.meta.url));
const formats = [
  "markdown",
  "markdown-litpro",
  "org",
  "noweb",
  "myst",
  "asciidoc",
  "html",
  "quarto"
];
const outputNames = ["report.md", "summary.json", "alerts.txt"];
const javascriptLanguages = new Set(["js", "javascript"]);

const semanticProjection = (graph) => ({
  chunks: graph.chunks.map((chunk) => ({
    id: chunk.id,
    language: javascriptLanguages.has(chunk.metadata.language)
      ? "javascript"
      : chunk.metadata.language,
    run: chunk.metadata.data.ravel.run === true,
    provider: chunk.metadata.data.ravel.provider ?? null,
    body: chunk.body.trim(),
    pipeline: chunk.definitionPipeline
  })).sort((left, right) => left.id.localeCompare(right.id)),
  outputs: graph.directives.map(({ kind, name, from }) => ({
    kind,
    name,
    from
  })).sort((left, right) => left.name.localeCompare(right.name))
});

test("every markup adapter compiles the field report to one semantic graph and identical outputs", async () => {
  const expected = Object.fromEntries(await Promise.all(outputNames.map(async (name) => [
    name,
    await readFile(example("expected/" + name), "utf8")
  ])));
  let baselineProjection;
  let baselineExecutions;

  for (const format of formats) {
    const loaded = await loadBuildInput(example("ravel-" + format + ".toml"));
    assert.deepEqual(loaded.pretransform.diagnostics, [], format);

    const projection = semanticProjection(loaded.pretransform);
    if (baselineProjection === undefined) baselineProjection = projection;
    else assert.deepEqual(projection, baselineProjection, format + " semantic graph");

    const executable = transformGraph(loaded.pretransform, {
      deferLiveResults: true
    });
    assert.deepEqual(executable.diagnostics, [], format);

    const live = await executeLiveProgram(executable, {
      providers: [javascriptLiveProvider],
      resources: loaded.live.resources
    });
    assert.equal(live.ok, true, format);
    assert.deepEqual(live.diagnostics, [], format);
    const values = Object.fromEntries(Object.entries(live.executions)
      .map(([id, execution]) => [id, execution.value]));
    if (baselineExecutions === undefined) baselineExecutions = values;
    else assert.deepEqual(values, baselineExecutions, format + " live values");

    const completed = transformGraph(loaded.pretransform, {
      liveResults: live
    });
    assert.deepEqual(completed.diagnostics, [], format);
    assert.deepEqual(
      Object.keys(completed.deliverables).sort(),
      outputNames.slice().sort(),
      format
    );
    for (const name of outputNames) {
      assert.equal(completed.deliverables[name].value, expected[name], format + " " + name);
    }
  }

  assert.deepEqual(Object.keys(baselineExecutions).sort(), [
    "field-report::analyze",
    "field-report::publish"
  ]);
  assert.equal(baselineExecutions["field-report::analyze"].observations, 9);
  assert.equal(baselineExecutions["field-report::publish"].summary.alertCount, 3);

  const quartoSource = await readFile(example("quarto.qmd"), "utf8");
  const preparedQuarto = prepareQuartoRender(quartoSource, {
    uri: "examples/adapter-conformance/quarto.qmd"
  });
  assert.deepEqual(preparedQuarto.diagnostics, []);
  assert.equal(
    preparedQuarto.source.match(/#\| eval: false/g)?.length,
    2
  );
  assert.match(preparedQuarto.source, /## Piece index/);
});
