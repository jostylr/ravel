import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCurrentProjectionSourceVersion,
  hasCurrentRequestAuthority,
  hasSameLanguageRoutingContext,
  waitForPromiseOrAbort
} from
  "../packages/vscode/src/request-coordination.js";

test("shared refresh waiters cancel independently", async () => {
  let resolveShared;
  const shared = new Promise((resolve) => { resolveShared = resolve; });
  const first = new AbortController();
  const second = new AbortController();
  const firstWait = waitForPromiseOrAbort(shared, first.signal);
  const secondWait = waitForPromiseOrAbort(shared, second.signal);

  first.abort(new DOMException("first request cancelled", "AbortError"));
  await assert.rejects(firstWait, (error) =>
    error.name === "AbortError" && error.message === "first request cancelled"
  );
  resolveShared("current projection");
  assert.equal(await secondWait, "current projection");
});

test("pre-cancelled waiters fail without changing the shared promise", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("already cancelled", "AbortError"));
  await assert.rejects(
    waitForPromiseOrAbort(Promise.resolve("still valid"), controller.signal),
    (error) => error.name === "AbortError"
  );
  assert.equal(await waitForPromiseOrAbort(Promise.resolve(42)), 42);
});

test("automatic request authority fails closed across project and generation races", () => {
  const project = {};
  const authority = (overrides = {}) => hasCurrentRequestAuthority({
    project,
    activeProject: project,
    requestGeneration: 4,
    currentGeneration: 4,
    refreshPending: false,
    sourceStateCurrent: true,
    ...overrides
  });

  assert.equal(authority(), true);
  assert.equal(authority({ activeProject: {} }), false);
  assert.equal(authority({ currentGeneration: 5 }), false);
  assert.equal(authority({ refreshPending: true }), false);
  assert.equal(authority({ sourceStateCurrent: false }), false);
});

test("completion authority requires matching projection, project, and editor versions", () => {
  const authority = (overrides = {}) => hasCurrentProjectionSourceVersion({
    projectionSourceVersions: { "guide.md": 7 },
    projectSourceVersions: { "guide.md": 7 },
    sourceUri: "guide.md",
    documentVersion: 7,
    ...overrides
  });

  assert.equal(authority(), true);
  assert.equal(authority({ projectionSourceVersions: { "guide.md": 6 } }), false);
  assert.equal(authority({ projectSourceVersions: {} }), false);
  assert.equal(authority({ documentVersion: 8 }), false);
  assert.equal(authority({ sourceUri: "other.md" }), false);
});

test("call hierarchy rebasing preserves every selected routing identity", () => {
  const expected = {
    projectionId: "projection:web:app",
    targetId: "web",
    artifactId: "app.ts",
    occurrenceId: "web:main:0"
  };
  assert.equal(hasSameLanguageRoutingContext(expected, { ...expected, retries: 1 }), true);
  assert.equal(hasSameLanguageRoutingContext(expected, {
    ...expected,
    occurrenceId: "web:main:1"
  }), false);
  assert.equal(hasSameLanguageRoutingContext(expected, {
    ...expected,
    projectionId: "projection:web:other"
  }), false);
  assert.equal(hasSameLanguageRoutingContext({ targetId: "web" }, {
    targetId: "web",
    artifactId: "app.ts"
  }), true);
});
