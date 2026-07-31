import assert from "node:assert/strict";
import test from "node:test";
import {
  createGeneratedDocumentRegistry,
  createGeneratedDocumentUri
} from "../packages/vscode/src/generated-document-registry.js";

const projection = (version, overrides = {}) => ({
  id: "projection:browser:app:assembled",
  snapshotId: "snapshot:" + version,
  version,
  workspaceId: "workspace/one",
  artifactId: "dist/app.ts",
  targetId: "browser/client",
  stage: "assembled",
  languageId: "typescript",
  text: "const a = 1;\nconst b = a;\n",
  occurrences: [
    {
      id: "occurrence:a:1",
      pieceId: "guide::a.ts",
      virtual: { start: 0, end: 12 },
      expansionPath: ["guide::main.ts", "guide::a.ts"]
    },
    {
      id: "occurrence:a:2",
      pieceId: "guide::a.ts",
      virtual: { start: 23, end: 24 },
      expansionPath: ["guide::main.ts", "guide::a.ts"]
    },
    {
      id: "occurrence:b:1",
      pieceId: "guide::b.ts",
      virtual: { start: 13, end: 25 },
      expansionPath: ["guide::main.ts", "guide::b.ts"]
    }
  ],
  ...overrides
});

test("generated document URIs are stable, escaped, and exclude versions", () => {
  const first = createGeneratedDocumentUri(projection(1));
  const second = createGeneratedDocumentUri(projection(99));

  assert.equal(first, second);
  assert.match(first, /^pieceful-virtual:\/\/workspace%2Fone\//);
  assert.match(first, /browser%2Fclient\/dist%2Fapp\.ts\/assembled\/dist\/app\.ts$/);
  assert.equal(first.includes("snapshot"), false);
});

test("registry refreshes a stable read-only document and rejects stale versions", () => {
  const registry = createGeneratedDocumentRegistry();
  const changes = [];
  const subscription = registry.onDidChange((change) => changes.push(change.type));
  const first = registry.update(projection(1));

  assert.equal(registry.getContent(first.uri), projection(1).text);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.occurrences), true);
  assert.throws(() => {
    first.text = "mutated";
  }, TypeError);

  const stale = registry.markStale(first.uri, "Recomputing after source edit.");
  assert.equal(stale.state, "stale");
  assert.equal(registry.getContent(first.uri, { allowStale: false }), undefined);
  assert.equal(registry.getContent(first.uri), first.text);

  const next = registry.update(projection(2, { text: first.text.replace("1", "2") }));
  assert.equal(next.uri, first.uri);
  assert.equal(next.state, "current");
  assert.equal(registry.getContent(first.uri), next.text);
  assert.throws(() => registry.update(projection(1)), /moved backwards/);
  assert.deepEqual(changes, ["added", "stale", "updated"]);
  subscription.dispose();
});

test("registry accepts a newer snapshot with unchanged content at the same language version", () => {
  const registry = createGeneratedDocumentRegistry();
  const first = registry.update(projection(1));
  const refreshed = registry.update(projection(1, {
    snapshotId: "snapshot:metadata-only"
  }));

  assert.equal(refreshed.version, first.version);
  assert.equal(refreshed.text, first.text);
  assert.equal(refreshed.snapshotId, "snapshot:metadata-only");
  assert.notEqual(refreshed, first);
});

test("registry retains invalidated last-good content only when the caller permits it", () => {
  const registry = createGeneratedDocumentRegistry();
  const document = registry.update(projection(1));
  const invalidated = registry.invalidate(document.uri, "Artifact was removed.");

  assert.equal(invalidated.invalidated, true);
  assert.equal(invalidated.state, "stale");
  assert.equal(registry.getContent(document.uri), document.text);
  assert.equal(registry.getContent(document.uri, { allowInvalidated: false }), undefined);
  assert.equal(registry.remove(document.uri), true);
  assert.equal(registry.get(document.uri), undefined);
  assert.equal(registry.remove(document.uri), false);
});

test("occurrence navigation is ordered, piece-scoped, and optionally non-wrapping", () => {
  const registry = createGeneratedDocumentRegistry();
  const document = registry.update(projection(1));

  assert.deepEqual(
    registry.occurrences(document.uri, { pieceId: "guide::a.ts" }).map(({ id }) => id),
    ["occurrence:a:1", "occurrence:a:2"]
  );
  assert.equal(
    registry.nextOccurrence(document.uri, "occurrence:a:1").id,
    "occurrence:a:2"
  );
  assert.equal(
    registry.nextOccurrence(document.uri, "occurrence:a:2").id,
    "occurrence:a:1"
  );
  assert.equal(
    registry.nextOccurrence(document.uri, "occurrence:a:2", { wrap: false }),
    undefined
  );
  assert.equal(
    registry.previousOccurrence(document.uri, "missing", { pieceId: "guide::a.ts" }).id,
    "occurrence:a:2"
  );
});

test("registry validates occurrence ranges and stable URI identity", () => {
  const registry = createGeneratedDocumentRegistry();
  const first = registry.update(projection(1));

  assert.throws(() => registry.update(projection(2, {
    uri: first.uri,
    targetId: "server"
  })), /reused for another projection/);
  assert.throws(() => registry.update(projection(2, {
    occurrences: [{
      id: "outside",
      pieceId: "guide::a.ts",
      virtual: { start: 0, end: 10_000 }
    }]
  })), /valid half-open offset range/);
});
