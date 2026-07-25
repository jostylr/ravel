import assert from "node:assert/strict";
import test from "node:test";
import { validateRavelMap } from "@pieceful/ravel-map";
import {
  combineMaps,
  createDeliverableProvenanceMap,
  parseChunk,
  transformGraph
} from "@pieceful/ravel-core";
import { portableConformanceFailures } from "../browser-test/shared/portable-conformance.mjs";

test("shared portable fixtures agree in Node and Bun", () => {
  assert.deepEqual(portableConformanceFailures({
    validateRavelMap,
    parseChunk,
    combineMaps,
    transformGraph,
    createDeliverableProvenanceMap
  }), []);
});
