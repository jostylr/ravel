import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderMarkdownDocument } from "@pieceful/ravel-host-browser";

test("browser host renders the single-document FizzBuzz example with provenance", async () => {
  const source = await readFile(new URL("../packages/host-browser/app/fizzbuzz.md", import.meta.url), "utf8");
  const result = renderMarkdownDocument(source);

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.deliverables.length, 1);
  assert.equal(result.deliverables[0].name, "dist/fizzbuzz.js");
  assert.match(result.deliverables[0].value, /function overwriteMultiples/);
  assert.match(result.deliverables[0].value, /console\.log\(formatOutput\(values\)\)/);
  assert.equal(result.deliverables[0].provenanceMap.kind, "ravel-provenance-map");
  assert.ok(result.deliverables[0].provenanceMap.segments.length > 5);
});

test("browser host returns source-linked diagnostics instead of throwing", () => {
  const result = renderMarkdownDocument("```ravel\nout(???)\n```\n");

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.deliverables.length, 0);
});
