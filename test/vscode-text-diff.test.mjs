import assert from "node:assert/strict";
import test from "node:test";
import { diffText } from "../packages/vscode/src/text-diff.js";

const textFor = (parts, included) => parts
  .filter(({ type }) => type === "equal" || type === included)
  .map(({ text }) => text)
  .join("");

test("text diffs preserve both revisions and isolate multiple edits", () => {
  const before = "const answer = oldValue;\nreturn answer;\n";
  const after = "const answer = newValue;\nlog(answer);\nreturn answer;\n";
  const parts = diffText(before, after);

  assert.equal(textFor(parts, "removed"), before);
  assert.equal(textFor(parts, "added"), after);
  assert.ok(parts.some(({ type, text }) => type === "removed" && text.includes("oldValue")));
  assert.ok(parts.some(({ type, text }) => type === "added" && text.includes("newValue")));
  assert.ok(parts.some(({ type, text }) => type === "added" && text.includes("log")));
});

test("text diffs coalesce equal input and bound unrelated comparisons", () => {
  assert.deepEqual(diffText("same text", "same text"), [
    { type: "equal", text: "same text" }
  ]);
  assert.deepEqual(diffText("old", "new", { maxEditDistance: 0 }), [
    { type: "removed", text: "old" },
    { type: "added", text: "new" }
  ]);
});
