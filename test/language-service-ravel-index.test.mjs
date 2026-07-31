import assert from "node:assert/strict";
import test from "node:test";
import { combineMaps, transformGraph } from "@pieceful/ravel-core";
import { createRavelSemanticIndex } from "../packages/language-service/src/ravel-index.js";

const source = (offset, end = offset + 1) => ({
  uri: "guide.md",
  range: {
    start: { line: 0, column: offset, offset },
    end: { line: 0, column: end, offset: end }
  }
});

const fixture = () => {
  const pretransform = combineMaps([{
    version: 1,
    document: { id: "guide", uri: "guide.md", format: "ravel-map-v1" },
    chunks: [
      {
        id: "guide::answer.ts",
        identity: { document: "guide", chunk: "answer", minor: null, type: "ts" },
        name: "Answer",
        body: "export const answer = 42;",
        metadata: { language: "typescript" },
        source: source(10, 35)
      },
      {
        id: "guide::main.ts",
        identity: { document: "guide", chunk: "main", minor: null, type: "ts" },
        name: "Main",
        body: "_\"answer.ts\"\nconsole.log(answer);",
        metadata: { language: "typescript" },
        source: source(100, 136)
      }
    ],
    directives: [{
      kind: "out",
      name: "dist/main.ts",
      from: "guide::main.ts",
      source: source(200, 220)
    }]
  }]);
  const program = transformGraph(pretransform);
  return { program, pretransform, revision: "revision-1" };
};

test("indexes complete Ravel symbols, references, directives, and diagnostics", () => {
  const context = fixture();
  const index = createRavelSemanticIndex(context);

  assert.equal(index.revision, "revision-1");
  assert.deepEqual(index.documentSymbols("guide.md").map(({ kind, name }) => [kind, name]), [
    ["piece", "Answer"],
    ["piece", "Main"],
    ["directive", "dist/main.ts"]
  ]);
  assert.equal(index.references.length, 1);
  assert.equal(index.references[0].targetId, "guide::answer.ts");
  assert.equal(index.diagnostics.length, 0);
});

test("navigates, hovers, and finds references through exact authored Ravel syntax", () => {
  const index = createRavelSemanticIndex(fixture());
  const reference = index.references[0];
  const cursor = reference.source.range.start;
  const definition = index.definitionAt("guide.md", cursor);

  assert.equal(definition.id, "guide::answer.ts");
  assert.deepEqual(definition.range, source(10, 35).range);
  assert.equal(index.entityAt("guide.md", cursor).kind, "reference");

  const hover = index.hoverAt("guide.md", cursor);
  assert.equal(hover.contents.canonicalId, "guide::answer.ts");
  assert.equal(hover.contents.language, "typescript");
  assert.equal(hover.contents.referenceCount, 1);

  assert.deepEqual(index.referencesFor("guide::answer.ts", {
    includeDeclaration: true
  }).map(({ kind }) => kind), ["piece", "reference"]);
});

test("completes canonical piece IDs and searches workspace symbols", () => {
  const index = createRavelSemanticIndex(fixture());
  assert.deepEqual(index.completeReferences("ans").map(({ label }) => label), [
    "guide::answer.ts"
  ]);
  assert.deepEqual(index.workspaceSymbols("main").map(({ name }) => name), [
    "Main",
    "dist/main.ts"
  ]);
});

test("malformed percent characters in source URIs never crash semantic lookup", () => {
  const context = structuredClone(fixture());
  context.program.chunks["guide::answer.ts"].source.uri = "chapter%name.md";
  const index = createRavelSemanticIndex(context);

  assert.equal(index.documentSymbols("unrelated%source.md").length, 0);
  assert.deepEqual(
    index.documentSymbols("chapter%25name.md").map(({ name }) => name),
    ["Answer"]
  );
  assert.equal(index.entityAt("unrelated%source.md", { line: 0, column: 12 }), null);
});
