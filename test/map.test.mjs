import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RAVEL_MAP_SCHEMA_ID, RAVEL_MAP_VERSION, validateRavelMap } from "@pieceful/ravel-map";

test("the public map contract validates checked-in examples", async () => {
  const map = JSON.parse(await readFile(new URL("../examples/greeting.ravel-map.json", import.meta.url), "utf8"));
  assert.equal(RAVEL_MAP_VERSION, 1);
  assert.equal(RAVEL_MAP_SCHEMA_ID, "https://ravel.dev/schema/ravel-map-v1.json");
  assert.deepEqual(validateRavelMap(map), []);
});

test("map validation reports version, identity, and required-field errors", () => {
  const diagnostics = validateRavelMap({
    version: 2,
    document: { id: "Bad ID", uri: "bad.json", format: "ravel-map-v1" },
    chunks: [{
      id: "bad::piece",
      identity: { document: "other", chunk: "piece", minor: null, type: null },
      body: 42,
      source: { uri: "bad.json", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } }
    }]
  });

  assert.ok(diagnostics.length >= 4);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.code === "RM200"));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("version must be 1")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("document.id must be")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("chunks[0].body must be a string")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("identity.document must match")));
});
