import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWorkspaceEdit,
  validateSourceEditVersions
} from "../packages/language-service/src/edits.js";

const projection = {
  id: "target:app:assembled:typescript",
  uri: "ravel-virtual://project/web/dist/app.ts/assembled",
  version: 4,
  sourceVersions: { "guide.md": 9 }
};

const projectionService = (mapping, projected = projection) => ({
  projections: new Map([[projected.id, projected]]),
  toSource(id, range) {
    assert.equal(id, projected.id);
    return mapping(range);
  }
});

const workspaceEdit = (edits, version = 4) => ({
  documentChanges: [{
    textDocument: { uri: projection.uri, version },
    edits
  }]
});

test("classifies exact generated edits as authored edits and deduplicates repeated expansion", () => {
  const service = projectionService((range) => [{
    kind: "exact",
    source: { uri: "guide.md", range: { start: 20, end: 23 } }
  }]);
  const result = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 100, end: 103 }, newText: "next" },
    { range: { start: 200, end: 203 }, newText: "next" }
  ]), {
    projectionService: service,
    sourceVersions: new Map([["guide.md", 9]]),
    isWritableSource: (uri) => uri === "guide.md"
  });

  assert.equal(result.classification, "automatic");
  assert.equal(result.applicable, true);
  assert.deepEqual(result.sourceEdit, {
    documents: [{
      uri: "guide.md",
      version: 9,
      edits: [{ range: { start: 20, end: 23 }, text: "next" }]
    }]
  });
  assert.equal(result.entries.filter(({ duplicate }) => duplicate).length, 1);
});

test("requires preview for coarse or ambiguous mappings", () => {
  const coarse = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 4, end: 8 }, newText: "value" }
  ]), {
    projectionService: projectionService(() => [{
      kind: "anchored",
      source: { uri: "guide.md", range: { start: 10, end: 40 } }
    }])
  });
  assert.equal(coarse.classification, "preview");
  assert.equal(coarse.entries[0].reason, "non-exact-mapping");

  const ambiguous = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 4, end: 8 }, newText: "value" }
  ]), {
    projectionService: projectionService(() => [
      { kind: "exact", source: { uri: "a.md", range: { start: 1, end: 5 } } },
      { kind: "exact", source: { uri: "b.md", range: { start: 2, end: 6 } } }
    ])
  });
  assert.equal(ambiguous.classification, "preview");
  assert.equal(ambiguous.entries[0].reason, "ambiguous-source");
});

test("routes synthetic imports only through an explicit destination policy", () => {
  const service = projectionService(() => [{ kind: "synthetic" }]);
  const denied = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 0, end: 0 }, newText: "import { x } from './x';\n" }
  ]), { projectionService: service });
  assert.equal(denied.classification, "rejected");
  assert.equal(denied.entries[0].reason, "synthetic-text");

  const routed = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 0, end: 0 }, newText: "import { x } from './x';\n" }
  ]), {
    projectionService: service,
    importDestination: { pieceId: "guide::imports.ts" }
  });
  assert.equal(routed.classification, "action");
  assert.deepEqual(routed.entries[0].action.destination, {
    pieceId: "guide::imports.ts"
  });
});

test("rejects conflicts, stale projections, resource operations, and outside-workspace sources", () => {
  const conflicts = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 1, end: 2 }, newText: "one" },
    { range: { start: 3, end: 4 }, newText: "two" }
  ]), {
    projectionService: projectionService(() => [{
      kind: "exact",
      source: { uri: "guide.md", range: { start: 10, end: 11 } }
    }])
  });
  assert.equal(conflicts.classification, "rejected");
  assert.ok(conflicts.entries.every(({ reason }) => reason === "conflicting-source-edits"));

  const stale = classifyWorkspaceEdit(workspaceEdit([], 3), {
    projectionService: projectionService(() => [])
  });
  assert.equal(stale.entries[0].reason, "stale-projection");

  const resource = classifyWorkspaceEdit({
    documentChanges: [{ kind: "create", uri: "file:///new.ts" }]
  }, { projectionService: projectionService(() => []) });
  assert.equal(resource.entries[0].reason, "resource-operation");

  const external = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 1, end: 2 }, newText: "x" }
  ]), {
    projectionService: projectionService(() => [{
      kind: "exact",
      source: { uri: "../outside.md", range: { start: 1, end: 2 } }
    }]),
    isWritableSource: () => false
  });
  assert.equal(external.entries[0].reason, "outside-workspace");
});

test("fails closed when writability or a current source version is not proven", () => {
  const edit = workspaceEdit([
    { range: { start: 1, end: 2 }, newText: "x" }
  ]);
  const mapping = (overrides = {}) => projectionService(() => [{
    kind: "exact",
    writable: true,
    source: { uri: "guide.md", range: { start: 1, end: 2 } },
    ...overrides
  }]);

  const nonWritable = classifyWorkspaceEdit(edit, {
    projectionService: mapping({ writable: false }),
    sourceVersions: { "guide.md": 1 },
    isWritableSource: () => true
  });
  assert.equal(nonWritable.entries[0].reason, "non-writable-mapping");

  const unverified = classifyWorkspaceEdit(edit, {
    projectionService: mapping(),
    sourceVersions: { "guide.md": 1 }
  });
  assert.equal(unverified.entries[0].reason, "writability-unverified");

  const unversioned = classifyWorkspaceEdit(edit, {
    projectionService: mapping(),
    isWritableSource: () => true
  });
  assert.equal(unversioned.entries[0].reason, "source-version-unavailable");
  assert.equal(validateSourceEditVersions({
    documents: [{ uri: "guide.md", edits: [] }]
  }, { "guide.md": 1 }).valid, false);
});

test("requires the projection's captured source version to match the host", () => {
  const edit = workspaceEdit([
    { range: { start: 1, end: 2 }, newText: "x" }
  ]);
  const exact = () => [{
    kind: "exact",
    source: { uri: "guide.md", range: { start: 1, end: 2 } }
  }];

  const stale = classifyWorkspaceEdit(edit, {
    projectionService: projectionService(exact),
    sourceVersions: { "guide.md": 10 },
    isWritableSource: () => true
  });
  assert.equal(stale.entries[0].reason, "projection-source-version-mismatch");
  assert.equal(stale.entries[0].expectedVersion, 9);
  assert.equal(stale.entries[0].actualVersion, 10);

  const uncaptured = classifyWorkspaceEdit(edit, {
    projectionService: projectionService(exact, {
      ...projection,
      sourceVersions: {}
    }),
    sourceVersions: { "guide.md": 9 },
    isWritableSource: () => true
  });
  assert.equal(uncaptured.entries[0].reason, "projection-source-version-mismatch");
  assert.equal(uncaptured.entries[0].expectedVersion, undefined);
});

test("rejects malformed and oversized language-service workspace edits", () => {
  const service = projectionService(() => []);
  const malformed = classifyWorkspaceEdit({
    documentChanges: [{ textDocument: { uri: projection.uri, version: 4 }, edits: {} }]
  }, { projectionService: service });
  assert.equal(malformed.entries[0].reason, "invalid-edit");

  const oversized = classifyWorkspaceEdit(workspaceEdit([
    { range: { start: 0, end: 0 }, newText: "0123456789" }
  ]), {
    projectionService: service,
    limits: { replacementTextCodeUnits: 4 }
  });
  assert.equal(oversized.classification, "rejected");
  assert.equal(oversized.entries[0].reason, "edit-limit-exceeded");
});

test("revalidates authored document versions before apply", () => {
  const sourceEdit = {
    documents: [
      { uri: "a.md", version: 4, edits: [] },
      { uri: "b.md", version: 8, edits: [] }
    ]
  };
  assert.deepEqual(validateSourceEditVersions(sourceEdit, new Map([
    ["a.md", 4],
    ["b.md", 9]
  ])), {
    valid: false,
    stale: [{ uri: "b.md", expected: 8, actual: 9 }]
  });
});
