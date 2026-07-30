import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import packagedSchema from "@pieceful/ravel-map/schema" with { type: "json" };
import { RAVEL_MAP_SCHEMA, RAVEL_MAP_SCHEMA_ID, RAVEL_MAP_VERSION, validateRavelMap } from "@pieceful/ravel-map";

test("the public map contract validates checked-in examples", async () => {
  const map = JSON.parse(await readFile(new URL("../examples/greeting.ravel-map.json", import.meta.url), "utf8"));
  assert.equal(RAVEL_MAP_VERSION, 1);
  assert.equal(RAVEL_MAP_SCHEMA_ID, "https://ravel.dev/schema/ravel-map-v1.json");
  assert.equal(RAVEL_MAP_SCHEMA.$id, RAVEL_MAP_SCHEMA_ID);
  assert.equal(RAVEL_MAP_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(RAVEL_MAP_SCHEMA, packagedSchema);
  assert.deepEqual(
    RAVEL_MAP_SCHEMA,
    JSON.parse(await readFile(new URL("../schemas/ravel-map.schema.json", import.meta.url), "utf8"))
  );
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

test("map validation rejects reversed ranges and unsupported directive shapes", () => {
  const diagnostics = validateRavelMap({
    version: 1,
    document: { id: "guide", uri: "guide.json", format: "ravel-map-v1" },
    chunks: [],
    directives: [{
      kind: "run",
      source: { uri: "guide.json", range: { start: { line: 1, column: 4, offset: 8 }, end: { line: 1, column: 2, offset: 6 } } }
    }, {
      kind: "out",
      source: { uri: "guide.json", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } }
    }]
  });
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("must be one of in, out, create, or alias")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("valid source range")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes("is required for an out directive")));
});

test("map validation accepts boolean run metadata and rejects other run values", () => {
  const point = { line: 0, column: 0, offset: 0 };
  const base = {
    version: 1,
    document: { id: "live", uri: "live.json", format: "ravel-map-v1" },
    chunks: [{
      id: "live::main.js",
      identity: { document: "live", chunk: "main", minor: null, type: "js" },
      body: "export default null;",
      metadata: { language: "js", data: { ravel: { run: true } } },
      source: { uri: "live.json", range: { start: point, end: point } }
    }]
  };
  assert.deepEqual(validateRavelMap(base), []);

  const invalid = structuredClone(base);
  invalid.chunks[0].metadata.data.ravel.run = "yes";
  assert.ok(validateRavelMap(invalid).some((entry) =>
    entry.message.includes("metadata.data.ravel.run must be a boolean")
  ));

  invalid.chunks[0].metadata.data.ravel.run = true;
  invalid.chunks[0].metadata.data.ravel.provider = "";
  assert.ok(validateRavelMap(invalid).some((entry) =>
    entry.message.includes("metadata.data.ravel.provider must be a non-empty string")
  ));
});

test("map validation accepts exact and coarse fragment precision", () => {
  const point = { line: 0, column: 0, offset: 0 };
  const base = {
    version: 1,
    document: { id: "html", uri: "source.html", format: "html+ravel-v1" },
    chunks: [{
      id: "html::main",
      identity: {
        document: "html",
        chunk: "main",
        minor: null,
        type: null
      },
      body: "<",
      source: { uri: "source.html", range: { start: point, end: point } },
      fragments: [{
        body: "<",
        source: {
          uri: "source.html",
          range: { start: point, end: point }
        },
        precision: "coarse"
      }]
    }]
  };
  assert.deepEqual(validateRavelMap(base), []);

  const invalid = structuredClone(base);
  invalid.chunks[0].fragments[0].precision = "approximate";
  assert.ok(validateRavelMap(invalid).some((entry) =>
    entry.message.includes("precision must be exact or coarse")
  ));
});
