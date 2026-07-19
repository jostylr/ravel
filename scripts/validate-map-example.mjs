import { readFile } from "node:fs/promises";

const map = JSON.parse(
  await readFile(new URL("../examples/greeting.ravel-map.json", import.meta.url), "utf8"),
);

const fail = (message) => {
  console.error("Ravel Map example invalid: " + message);
  process.exitCode = 1;
};

if (map.version !== 1) fail("version must be 1");
if (!map.document || typeof map.document.id !== "string") {
  fail("document.id is required");
}
if (!Array.isArray(map.chunks) || map.chunks.length === 0) {
  fail("at least one chunk is required");
}

const ids = new Set();
for (const chunk of map.chunks ?? []) {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(chunk.id ?? "")) {
    fail("invalid chunk id: " + chunk.id);
  }
  if (ids.has(chunk.id)) fail("duplicate chunk id: " + chunk.id);
  ids.add(chunk.id);
  if (typeof chunk.body !== "string") fail(chunk.id + ".body must be a string");
  if (!chunk.source?.uri || !chunk.source?.range?.start || !chunk.source?.range?.end) {
    fail(chunk.id + ".source must include uri and range");
  }
}

if (process.exitCode !== 1) {
  console.log("Ravel Map example passes structural validation.");
}

