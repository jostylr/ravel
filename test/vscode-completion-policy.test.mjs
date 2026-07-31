import assert from "node:assert/strict";
import test from "node:test";
import {
  isExactAuthoredRange,
  isSafePrimaryCompletion
} from "../packages/vscode/src/completion-policy.js";

test("primary completions require exact authored replacement spans", () => {
  const sourceUri = "guide.md";
  assert.equal(isSafePrimaryCompletion({ name: "value" }, sourceUri), true);
  assert.equal(isSafePrimaryCompletion({
    name: "value",
    replacementSpan: { start: 10, end: 15 },
    mappingKind: "exact",
    sourceUri
  }, sourceUri), true);
  for (const entry of [
    { replacementSpan: { start: 10, end: 15 }, mappingKind: "anchored", sourceUri },
    { replacementSpan: { start: 10, end: 15 }, mappingKind: "transformed", sourceUri },
    { replacementSpan: { start: 10, end: 15 }, mappingKind: "exact", sourceUri: "other.md" },
    { replacementSpan: { start: 10, end: 15 }, generatedOnly: true },
    { hasAction: true }
  ]) {
    assert.equal(isSafePrimaryCompletion(entry, sourceUri), false);
  }
});

test("rename preparation accepts only exact or identity ranges in the active source", () => {
  assert.equal(isExactAuthoredRange({
    mappingKind: "identity",
    sourceUri: "guide.md"
  }, "guide.md"), true);
  assert.equal(isExactAuthoredRange({
    mappingKind: "coarse",
    sourceUri: "guide.md"
  }, "guide.md"), false);
  assert.equal(isExactAuthoredRange({
    mappingKind: "exact",
    sourceUri: "other.md"
  }, "guide.md"), false);
});
