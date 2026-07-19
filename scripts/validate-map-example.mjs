import { readFile } from "node:fs/promises";

const maps = await Promise.all([
  "../examples/greeting.ravel-map.json",
  "../examples/poc/library.ravel-map.json",
  "../examples/poc/project.ravel-map.json"
].map(async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"))));

const fail = (message) => {
  console.error("Ravel Map example invalid: " + message);
  process.exitCode = 1;
};

for (const map of maps) {
  if (map.version !== 1) fail("version must be 1");
  if (!map.document || typeof map.document.id !== "string") {
    fail("document.id is required");
  }
  if (!Array.isArray(map.chunks) || map.chunks.length === 0) {
    fail("at least one chunk is required");
  }

  const ids = new Set();
  for (const chunk of map.chunks ?? []) {
    const identity = chunk.identity;
    const parts = ["document", "chunk", "minor", "type"];
    if (!identity || !parts.every((part) => Object.hasOwn(identity, part))) {
      fail("chunk identity must explicitly include document, chunk, minor, and type");
      continue;
    }
    if (parts.some((part) => identity[part] !== null && !/^[a-z][a-z0-9-]*$/.test(identity[part]))) {
      fail("invalid identity component for chunk: " + chunk.id);
    }
    if (identity.document === null && identity.chunk === null) {
      fail("a chunk must have a document or chunk component: " + chunk.id);
    }
    const canonical = (identity.document === null ? "" : identity.document + "::") +
      (identity.chunk ?? "") +
      (identity.minor === null ? "" : ":" + identity.minor) +
      (identity.type === null ? "" : "." + identity.type);
    if (chunk.id !== canonical) fail("chunk id must match identity: " + chunk.id);
    if (ids.has(chunk.id)) fail("duplicate chunk id: " + chunk.id);
    ids.add(chunk.id);
    if (typeof chunk.body !== "string") fail(chunk.id + ".body must be a string");
    if (!chunk.source?.uri || !chunk.source?.range?.start || !chunk.source?.range?.end) {
      fail(chunk.id + ".source must include uri and range");
    }
  }
}

if (process.exitCode !== 1) {
  console.log("Ravel Map examples pass structural validation.");
}
