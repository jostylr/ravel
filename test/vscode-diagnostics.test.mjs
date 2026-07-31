import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnosticProjectionRouting,
  groupRavelDiagnostics,
  hasDiagnosticPublicationAuthority,
  hasDiagnosticRunAuthority,
  normalizeRavelDiagnostics
} from "../packages/vscode/src/diagnostics.js";

const source = (uri, start, end) => ({
  uri,
  range: {
    start: { line: 0, column: start, offset: start },
    end: { line: 0, column: end, offset: end }
  }
});

test("normalizes, resolves, sorts, and deduplicates Ravel diagnostics", () => {
  const diagnostic = {
    code: "RV111",
    severity: "error",
    message: "Unknown reference.",
    source: source("guide.md", 10, 15),
    related: [source("library.md", 2, 4)]
  };
  const result = normalizeRavelDiagnostics([diagnostic, structuredClone(diagnostic)], {
    resolveUri: (uri) => "file:///workspace/" + uri
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    uri: "file:///workspace/guide.md",
    range: {
      start: { line: 0, character: 10 },
      end: { line: 0, character: 15 }
    },
    code: "RV111",
    severity: "error",
    message: "Unknown reference.",
    source: "ravel",
    related: [{
      uri: "file:///workspace/library.md",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 }
      },
      message: "Unknown reference."
    }]
  });
});

test("groups target diagnostics by source URI without collapsing distinct targets", () => {
  const base = {
    code: 2322,
    severity: "error",
    message: "Type mismatch.",
    source: source("guide.md", 3, 8)
  };
  const grouped = groupRavelDiagnostics([
    { ...base, targetId: "browser" },
    { ...base, targetId: "server" }
  ]);
  assert.equal(grouped.get("guide.md").length, 2);
});

test("stale diagnostic failures cannot mutate the active project's collection", () => {
  const project = {};
  const authority = (overrides = {}) => hasDiagnosticPublicationAuthority({
    project,
    activeProject: project,
    refreshPending: false,
    sourceStateCurrent: true,
    ...overrides
  });

  assert.equal(authority(), true);
  assert.equal(authority({ activeProject: {} }), false);
  assert.equal(authority({ refreshPending: true }), false);
  assert.equal(authority({ sourceStateCurrent: false }), false);
});

test("target diagnostics retain their exact projection occurrence route", () => {
  assert.deepEqual(diagnosticProjectionRouting({
    id: "projection:web:app",
    targetId: "web",
    artifactId: "dist/app.ts",
    stage: "assembled"
  }, {
    occurrenceId: "occurrence:repeated:2"
  }), {
    targetId: "web",
    artifactId: "dist/app.ts",
    stage: "assembled",
    projectionId: "projection:web:app",
    occurrenceId: "occurrence:repeated:2"
  });
});

test("diagnostic runs pin generation, router, and projection-service identity", () => {
  const project = {};
  const router = {};
  const projectionService = {};
  const authority = (overrides = {}) => hasDiagnosticRunAuthority({
    project,
    activeProject: project,
    refreshPending: false,
    requestGeneration: 7,
    currentGeneration: 7,
    router,
    currentRouter: router,
    projectionService,
    currentProjectionService: projectionService,
    ...overrides
  });
  assert.equal(authority(), true);
  assert.equal(authority({ currentRouter: {} }), false);
  assert.equal(authority({ currentProjectionService: {} }), false);
  assert.equal(authority({ currentGeneration: 8 }), false);
  assert.equal(authority({ refreshPending: true }), false);
  assert.equal(authority({ aborted: true }), false);
});
