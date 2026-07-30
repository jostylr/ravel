import { createExplorerView } from "../../packages/explorer/src/browser.js";

const snapshot = {
  version: 1,
  project: { id: "browser", label: "Browser Explorer" },
  revision: "browser-fixture",
  lens: "dependencies",
  focus: ["chunk:browser::main.js"],
  truncated: false,
  nodes: [
    {
      id: "document:browser",
      kind: "document",
      label: "browser",
      data: {},
      fingerprint: "document"
    },
    {
      id: "chunk:browser::source.js",
      kind: "chunk",
      label: "source.js",
      parent: "document:browser",
      language: "js",
      state: ["live"],
      data: {},
      fingerprint: "source"
    },
    {
      id: "transform:browser::source.js:0:trim",
      kind: "transform",
      label: "trim",
      parent: "chunk:browser::source.js",
      data: {},
      fingerprint: "transform"
    },
    {
      id: "chunk:browser::main.js",
      kind: "chunk",
      label: "main.js",
      parent: "document:browser",
      language: "js",
      data: {},
      fingerprint: "main"
    },
    {
      id: "deliverable:dist/main.js",
      kind: "deliverable",
      label: "dist/main.js",
      data: {},
      fingerprint: "output"
    }
  ],
  edges: [
    {
      id: "contains-source",
      kind: "contains",
      source: "document:browser",
      target: "chunk:browser::source.js"
    },
    {
      id: "contains-main",
      kind: "contains",
      source: "document:browser",
      target: "chunk:browser::main.js"
    },
    {
      id: "transform",
      kind: "transforms",
      source: "chunk:browser::source.js",
      target: "transform:browser::source.js:0:trim"
    },
    {
      id: "reference",
      kind: "references",
      source: "chunk:browser::source.js",
      target: "chunk:browser::main.js",
      label: "source.js"
    },
    {
      id: "output",
      kind: "produces",
      source: "chunk:browser::main.js",
      target: "deliverable:dist/main.js"
    }
  ],
  groups: [
    {
      id: "group:document:browser",
      kind: "document",
      label: "browser",
      nodeIds: ["chunk:browser::source.js", "chunk:browser::main.js"],
      collapsed: false
    }
  ],
  diagnostics: { errors: 0, warnings: 0, information: 0 },
  counts: {
    availableNodes: 5,
    visibleNodes: 5,
    visibleEdges: 5,
    chunks: 2
  }
};

const root = document.querySelector("#explorer");

try {
  const view = createExplorerView(root, snapshot);
  await view.ready;
  const positioned = view.cy.nodes().every((node) => {
    const position = node.position();
    return Number.isFinite(position.x) && Number.isFinite(position.y);
  });
  const selected = view.select("chunk:browser::main.js");
  document.body.dataset.ravelExplorerTest =
    positioned && selected?.id === "chunk:browser::main.js" ? "passed" : "failed";
} catch (error) {
  document.body.dataset.ravelExplorerTest = "failed";
  throw error;
}
