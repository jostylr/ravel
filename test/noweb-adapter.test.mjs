import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";
import { nowebToMap } from "../packages/noweb/src/index.js";

const fixture = (name) =>
  readFile(new URL("../fixtures/noweb/" + name, import.meta.url), "utf8");

test("strict noweb scans documentation, definitions, repeats, references, and terminators losslessly", async () => {
  const source = await fixture("classic.nw");
  const adapted = nowebToMap(source, {
    uri: "fixtures/noweb/classic.nw",
    document: "classic"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "classic::main-js",
    "classic::message"
  ]);

  const main = adapted.map.chunks[0];
  assert.equal(main.body, [
    "console.log(<<message>>);",
    "console.log(\"done\");",
    ""
  ].join("\n"));
  assert.equal(main.fragments.length, 2);
  assert.equal(main.metadata.language, "javascript");
  assert.equal(main.metadata.data.ravel.languageSource, "pragma");
  assert.equal(main.metadata.data.ravel.documentation.length, 2);
  assert.equal(main.metadata.data.ravel.terminators.length, 2);
  assert.equal(adapted.map.directives[0].kind, "out");
  assert.equal(adapted.map.directives[0].from, "classic::main-js");
  assert.equal(adapted.map.directives[0].name, "dist/main.js");

  const referenceOffset = source.indexOf("<<message>>");
  assert.equal(adapted.surface.references[0].source.range.start.offset, referenceOffset);
  assert.equal(adapted.surface.references[0].source.range.end.offset, referenceOffset + "<<message>>".length);
  assert.equal(
    source.slice(
      main.fragments[0].source.range.start.offset,
      main.fragments[0].source.range.end.offset
    ),
    main.fragments[0].body
  );

  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["classic::main-js"].value, [
    "console.log(hello",
    ");",
    "console.log(\"done\");",
    ""
  ].join("\n"));
  assert.equal(program.deliverables["dist/main.js"].value, program.chunks["classic::main-js"].value);
});

test("strict noweb preserves pipes as part of classic chunk names", () => {
  const adapted = nowebToMap([
    "<<name | literal>>=",
    "value",
    "@",
    "<<main>>=",
    "<<name | literal>>",
    "@",
    ""
  ].join("\n"), { uri: "strict-pipe.nw", document: "strict-pipe" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "strict-pipe::name-literal",
    "strict-pipe::main"
  ]);
  assert.deepEqual(adapted.map.chunks[0].definitionPipeline, []);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["strict-pipe::main"].value, "value\n\n");
});

test("noweb-plus parses definition and use-site pipelines and reports classic portability", async () => {
  const source = await fixture("plus.nw");
  const adapted = nowebToMap(source, {
    uri: "fixtures/noweb/plus.nw",
    document: "plus",
    dialect: "noweb-plus"
  });

  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.equal(adapted.diagnostics.filter((entry) => entry.code === "LPA114").length, 2);
  assert.deepEqual(adapted.map.chunks[0].definitionPipeline.map((step) => step.name), ["trim"]);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["plus::main"].value, "hello");
});

test("classic-compatible pragmas and underscore-quote references share the core pipeline grammar", () => {
  const adapted = nowebToMap([
    "@ %ravel pipeline main | trim()",
    "<<main>>=",
    "  _\"message | trim()\"  ",
    "@",
    "<<message>>=",
    "  hello  ",
    "@",
    ""
  ].join("\n"), {
    uri: "compatible.nw",
    document: "compatible",
    references: "both"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(adapted.map.chunks[0].definitionPipeline.map((step) => step.name), ["trim"]);
  assert.equal(adapted.surface.references[0].targetText, "message | trim()");
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["compatible::main"].value, "hello");
});

test("repeated noweb pipelines must agree and definition transforms still run once", () => {
  const adapted = nowebToMap([
    "<<main | trim()>>=",
    "  first",
    "@",
    "<<main | indent(2)>>=",
    "second  ",
    "@",
    ""
  ].join("\n"), {
    uri: "repeat.nw",
    document: "repeat",
    dialect: "noweb-plus"
  });

  assert.ok(adapted.diagnostics.some((entry) => entry.code === "LPA113"));
  const program = transformGraph(combineMaps([adapted.map]));
  assert.equal(program.chunks["repeat::main"].value, "first\nsecond");
});

test("noweb live configuration produces metadata but performs no execution", () => {
  const adapted = nowebToMap("<<analysis.js>>=\nexport default 42;\n@\n", {
    uri: "live.nw",
    document: "live",
    run: true,
    provider: "quickjs-wasm-worker"
  });

  assert.deepEqual(adapted.diagnostics, []);
  const chunk = adapted.map.chunks[0];
  assert.equal(chunk.metadata.language, "javascript");
  assert.equal(chunk.metadata.data.ravel.run, true);
  assert.equal(chunk.metadata.data.ravel.provider, "quickjs-wasm-worker");
  assert.equal(adapted.map.metadata.plannedExecutions, undefined);
});

test("an unterminated noweb definition retains its body and reports the opener", () => {
  const source = "<<main>>=\nstill code\n";
  const adapted = nowebToMap(source, {
    uri: "unterminated.nw",
    document: "unterminated"
  });

  assert.equal(adapted.map.chunks[0].body, "still code\n");
  assert.equal(adapted.diagnostics[0].code, "LPA111");
  assert.equal(adapted.diagnostics[0].source.range.start.offset, 0);
});
