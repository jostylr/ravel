import { markdownToMap } from "../../packages/markdown/src/index.js";

const sample = "```js {.ravel #main}\nconsole.log('browser');\n```\n";
const result = markdownToMap(sample, { uri: "browser.md", document: "browser" });
const passed = result.diagnostics.length === 0 && result.map.chunks.length === 1 &&
  result.map.chunks[0].id === "browser::main.js";

document.body.dataset.ravelMarkdownTest = passed ? "passed" : "failed";
document.querySelector("output").textContent = passed
  ? "Markdown adapter browser test passed."
  : JSON.stringify(result, null, 2);
