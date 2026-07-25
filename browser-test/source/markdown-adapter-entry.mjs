import { markdownToMap } from "../../packages/markdown/src/index.js";
import { validateRavelMap } from "../../packages/map/src/index.js";
import { combineMaps, createDeliverableProvenanceMap, parseChunk, transformGraph } from "../../packages/core/src/index.js";
import { portableConformanceFailures } from "../shared/portable-conformance.mjs";

const sample = "```text {.ravel #source}\n  browser value  \n```\n\n```ravel\ncreate(\"program:browser.js\", compose(\n  _\"source.text\",\n  pass(trim(), emit(\"observed.js\")),\n  pipe(trim(), emit(\"min.js\"), indent(2))\n))\n```\n";
const result = markdownToMap(sample, { uri: "browser.md", document: "browser" });
const program = transformGraph(combineMaps([result.map]));
const portableFailures = portableConformanceFailures({
  validateRavelMap,
  parseChunk,
  combineMaps,
  transformGraph,
  createDeliverableProvenanceMap
});
const passed = portableFailures.length === 0 && result.diagnostics.length === 0 && program.diagnostics.length === 0 &&
  program.chunks["browser::program:browser.js"]?.value === "  browser value" &&
  program.chunks["browser::program:observed.js"]?.value === "browser value" &&
  program.chunks["browser::program:min.js"]?.value === "browser value";

document.body.dataset.ravelMarkdownTest = passed ? "passed" : "failed";
document.querySelector("output").textContent = passed
  ? "Markdown directives browser test passed."
  : JSON.stringify({ portableFailures, result, program }, null, 2);
