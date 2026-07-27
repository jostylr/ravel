import { createJavaScriptLiveProvider } from "../../packages/js-live/src/index.js";

const provider = createJavaScriptLiveProvider({
  workerFactory: () => new Worker(new URL("./js-live-worker.mjs", import.meta.url), {
    type: "module",
    name: "ravel-quickjs-browser-test"
  }),
  modules: {
    "@ravel/csv": [
      "export const parseCsv = (text) =>",
      "  text.trim().split(/\\r?\\n/).map((line) => line.split(\",\"));"
    ].join("\n")
  }
});

const point = { line: 0, column: 0, offset: 0 };
const output = document.querySelector("output");

try {
  const outcome = await provider.execute({
    id: "browser::csv.js",
    runId: "browser",
    language: "js",
    source: [
      "import { parseCsv } from \"@ravel/csv\";",
      "export default parseCsv(load(\"cool.csv\"));"
    ].join("\n"),
    sourceLocation: {
      uri: "browser.md",
      range: { start: point, end: point }
    },
    inputs: {},
    resources: { "cool.csv": "name,value\nalpha,1\n" },
    analysis: { dependencies: [], resources: [], modules: [], diagnostics: [] },
    limits: {}
  });
  const value = outcome.ok ? JSON.parse(outcome.serialized) : null;
  const passed = JSON.stringify(value) ===
    JSON.stringify([["name", "value"], ["alpha", "1"]]);
  document.body.dataset.ravelJsLiveTest = passed ? "passed" : "failed";
  output.textContent = passed
    ? "QuickJS worker browser test passed."
    : JSON.stringify(outcome, null, 2);
  if (!passed) throw new Error(output.textContent);
} catch (error) {
  document.body.dataset.ravelJsLiveTest = "failed";
  output.textContent = error?.message ?? String(error);
  throw error;
} finally {
  await provider.dispose();
}
