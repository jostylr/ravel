import assert from "node:assert/strict";
import test from "node:test";
import {
  createNavigationHistory,
  sameNavigation
} from "../packages/vscode/src/navigation-history.js";

test("Explorer navigation history deduplicates offsets and stays bounded", () => {
  const history = createNavigationHistory(2);
  const first = { entityId: "chunk:first", generatedOffset: undefined, lens: "dependencies" };
  const output = { entityId: "deliverable:app.js", generatedOffset: 12, lens: "derivation" };

  assert.equal(history.push(first), true);
  assert.equal(history.push(first), false);
  assert.equal(history.push(output), true);
  assert.equal(history.push({ ...output, generatedOffset: 13 }), true);
  assert.equal(history.length, 2);
  assert.equal(history.pop().generatedOffset, 13);
  assert.deepEqual(history.pop(), output);
  assert.equal(history.pop(), undefined);
  assert.equal(sameNavigation(output, { ...output, lens: "changes" }), true);
});
