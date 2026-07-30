import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const project = fileURLToPath(new URL("../fixtures/myst/plugin-project", import.meta.url));

try {
  await run("myst", ["build", "--site", "--strict"], {
    cwd: project,
    maxBuffer: 20 * 1024 * 1024
  });
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log("Skipped MyST plugin smoke test because the myst CLI is not installed.");
    process.exit(0);
  }
  throw error;
}

const page = JSON.parse(await readFile(
  join(project, "_build", "site", "content", "index.json"),
  "utf8"
));
const xref = JSON.parse(await readFile(
  join(project, "_build", "site", "myst.xref.json"),
  "utf8"
));

const nodes = [];
const visit = (value) => {
  if (!value || typeof value !== "object") return;
  if (typeof value.type === "string") nodes.push(value);
  for (const child of value.children ?? []) visit(child);
};
visit(page.mdast);
const nodeText = (node) =>
  node?.value ?? (node?.children ?? []).map(nodeText).join("");
const main = nodes.find((node) =>
  node.type === "container" && node.identifier === "lp-main"
);
const analysis = nodes.find((node) =>
  node.type === "container" && node.identifier === "lp-analysis"
);
const ravelLive = nodes.find((node) =>
  node.type === "container" && node.identifier === "lp-ravel-live"
);
const ravelBuild = nodes.find((node) =>
  node.type === "container" && node.identifier === "ravel-build"
);

assert.equal(main.kind, "code");
assert.equal(main.class, "ravel-piece wide");
assert.match(nodeText(main), /Main program/);
assert.match(nodeText(main), /\| normalize-eol\(\) \| trim\(\)/);
assert.equal(analysis.kind, "figure");
assert.ok(nodes.some((node) =>
  node.type === "code" &&
  node.identifier === "lp-analysis-code" &&
  node.executable === true
));
assert.ok(nodes.some((node) =>
  node.type === "outputs" && node.identifier === "lp-analysis-outputs"
));
assert.equal(ravelLive.kind, "code");
assert.equal(ravelLive.children[0].executable, undefined);
assert.equal(ravelBuild.kind, "code");
assert.equal(ravelBuild.class, "ravel-directives");
assert.equal(ravelBuild.children[0].lang, "ravel");
assert.equal(ravelBuild.children[0].executable, undefined);
assert.ok(nodes.some((node) =>
  node.type === "crossReference" &&
  node.identifier === "lp-main" &&
  node.resolved === true
));
assert.ok(xref.references.some((entry) =>
  entry.identifier === "lp-main" && entry.kind === "code"
));
assert.ok(xref.references.some((entry) =>
  entry.identifier === "lp-analysis"
));

console.log("Ravel MyST plugin renders pieces, graph directives, cells, and cross-references.");
