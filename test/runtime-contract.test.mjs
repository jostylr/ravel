import assert from "node:assert/strict";
import test from "node:test";
import { runtimeContractFailures } from "../browser-test/shared/runtime-contract.mjs";

test("portable Ravel packages can rely on the Web Platform baseline", () => {
  assert.deepEqual(runtimeContractFailures(), []);
});
