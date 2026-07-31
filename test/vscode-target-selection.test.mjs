import assert from "node:assert/strict";
import test from "node:test";
import {
  createTargetSelectionStore,
  normalizeTargetCandidates,
  resolveActiveTarget
} from "../packages/vscode/src/target-selection.js";

const candidates = [
  {
    targetId: "browser",
    artifactId: "dist/client.ts",
    projectionId: "browser-client",
    occurrenceId: "browser-1"
  },
  {
    targetId: "server",
    artifactId: "dist/server.ts",
    projectionId: "server-main",
    occurrenceId: "server-1"
  }
];

test("active target policy applies explicit, generated-view, sole-artifact, and default priorities", () => {
  assert.equal(resolveActiveTarget({
    candidates,
    explicitPieceSelection: { targetId: "server" },
    explicitDocumentSelection: { targetId: "browser" },
    generatedViewSelection: { targetId: "browser" },
    defaultTargetId: "browser"
  }).reason, "explicit-piece");

  assert.equal(resolveActiveTarget({
    candidates,
    generatedViewSelection: { targetId: "server", artifactId: "dist/server.ts" },
    defaultTargetId: "browser"
  }).reason, "generated-view");

  const sole = resolveActiveTarget({ candidates: [candidates[0]] });
  assert.equal(sole.reason, "sole-artifact");
  assert.equal(sole.targetId, "browser");
  assert.equal(sole.artifactId, "dist/client.ts");

  const configured = resolveActiveTarget({ candidates, defaultTargetId: "server" });
  assert.equal(configured.reason, "configured-default");
  assert.equal(configured.targetId, "server");
});

test("active target policy preserves an exact projection occurrence selection", () => {
  const repeated = [
    candidates[0],
    {
      ...candidates[0],
      projectionId: "browser-client-secondary",
      occurrenceId: "browser-2"
    }
  ];
  const selected = resolveActiveTarget({
    candidates: repeated,
    explicitDocumentSelection: {
      targetId: "browser",
      artifactId: "dist/client.ts",
      projectionId: "browser-client-secondary",
      occurrenceId: "browser-2"
    }
  });

  assert.equal(selected.status, "selected");
  assert.equal(selected.reason, "explicit-document");
  assert.equal(selected.projectionId, "browser-client-secondary");
  assert.equal(selected.occurrenceId, "browser-2");
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0].occurrenceId, "browser-2");
});

test("active target policy rejects a cross-candidate projection occurrence pair", () => {
  const repeated = [
    candidates[0],
    {
      ...candidates[0],
      projectionId: "browser-client-secondary",
      occurrenceId: "browser-2"
    }
  ];
  const unresolved = resolveActiveTarget({
    candidates: repeated,
    explicitDocumentSelection: {
      targetId: "browser",
      artifactId: "dist/client.ts",
      projectionId: "browser-client",
      occurrenceId: "browser-2"
    }
  });

  assert.equal(unresolved.reason, "sole-artifact");
  assert.equal(unresolved.projectionId, undefined);
  assert.equal(unresolved.occurrenceId, undefined);
  assert.equal(unresolved.candidates.length, 2);
});

test("active target policy exposes ambiguity and never honors disappeared selections", () => {
  const unresolved = resolveActiveTarget({
    candidates,
    explicitPieceSelection: { targetId: "removed" },
    generatedViewSelection: { targetId: "also-removed" }
  });
  assert.equal(unresolved.status, "ambiguous");
  assert.equal(unresolved.reason, "target-selection-required");
  assert.deepEqual(unresolved.applicableTargetIds, ["browser", "server"]);

  const unavailable = resolveActiveTarget({ candidates: [] });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.targetId, undefined);
});

test("candidate normalization deduplicates occurrences without using text equality", () => {
  const normalized = normalizeTargetCandidates([
    candidates[0],
    { ...candidates[0] },
    { ...candidates[0], occurrenceId: "browser-2", semanticIdentity: "same-program" }
  ]);

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.map(({ occurrenceId }) => occurrenceId), ["browser-1", "browser-2"]);
});

test("target selection store scopes piece choices over document choices and round trips persistence", () => {
  const documentScope = {
    workspaceId: "workspace",
    documentUri: "file:///workspace/guide.md"
  };
  const pieceScope = { ...documentScope, pieceId: "guide::handler.ts" };
  const store = createTargetSelectionStore();
  store.set(documentScope, { targetId: "browser" });
  store.set(pieceScope, { targetId: "server", artifactId: "dist/server.ts" });

  const result = store.resolve(pieceScope, { candidates });
  assert.equal(result.reason, "explicit-piece");
  assert.equal(result.targetId, "server");
  assert.equal(store.resolve({ ...documentScope, pieceId: "guide::other.ts" }, {
    candidates
  }).reason, "explicit-document");

  const restored = createTargetSelectionStore(store.toJSON());
  assert.deepEqual(restored.get(pieceScope), {
    targetId: "server",
    artifactId: "dist/server.ts"
  });
  assert.deepEqual(restored.toJSON(), store.toJSON());
});

test("target selection store round trips and invalidates occurrence context", () => {
  const scope = {
    workspaceId: "workspace",
    documentUri: "file:///workspace/guide.md"
  };
  const repeated = [
    candidates[0],
    {
      ...candidates[0],
      projectionId: "browser-client-secondary",
      occurrenceId: "browser-2"
    }
  ];
  const selection = {
    targetId: "browser",
    artifactId: "dist/client.ts",
    projectionId: "browser-client-secondary",
    occurrenceId: "browser-2"
  };
  const store = createTargetSelectionStore();
  store.set(scope, selection);

  assert.deepEqual(store.resolve(scope, { candidates: repeated }), {
    status: "selected",
    reason: "explicit-document",
    ...selection,
    candidates: [repeated[1]],
    applicableTargetIds: ["browser"]
  });

  const restored = createTargetSelectionStore(store.toJSON());
  assert.deepEqual(restored.get(scope), selection);
  assert.deepEqual(restored.toJSON(), store.toJSON());
  assert.deepEqual(restored.invalidate(scope, [repeated[0]]), selection);
  assert.equal(restored.get(scope), undefined);
});

test("piece occurrence choices survive requests in other pieces", () => {
  const documentScope = {
    workspaceId: "workspace",
    documentUri: "file:///workspace/guide.md"
  };
  const pieceA = { ...documentScope, pieceId: "guide::a.ts" };
  const pieceB = { ...documentScope, pieceId: "guide::b.ts" };
  const candidateA = {
    targetId: "browser",
    artifactId: "dist/client.ts",
    projectionId: "browser-client",
    occurrenceId: "a:second"
  };
  const candidateB = {
    targetId: "browser",
    artifactId: "dist/client.ts",
    projectionId: "browser-client",
    occurrenceId: "b:first"
  };
  const store = createTargetSelectionStore();
  store.set(documentScope, {
    targetId: "browser",
    artifactId: "dist/client.ts"
  });
  store.set(pieceA, candidateA);

  assert.equal(store.resolve(pieceB, { candidates: [candidateB] }).occurrenceId, "b:first");
  assert.deepEqual(store.get(pieceA), candidateA);
  assert.equal(store.resolve(pieceA, { candidates: [candidateA] }).occurrenceId, "a:second");
});

test("target selection store invalidates a choice when configuration removes its target", () => {
  const scope = {
    workspaceId: "workspace",
    documentUri: "file:///workspace/guide.md",
    pieceId: "guide::handler.ts"
  };
  const store = createTargetSelectionStore();
  store.set(scope, { targetId: "server" });

  assert.deepEqual(store.invalidate(scope, [candidates[0]]), { targetId: "server" });
  assert.equal(store.get(scope), undefined);
  assert.equal(store.invalidate(scope, [candidates[0]]), undefined);
});
