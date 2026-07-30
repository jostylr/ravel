import assert from "node:assert/strict";
import test from "node:test";
import {
  findExplorerEntityAtSelection,
  findNearestProjectConfig,
  isSupportedRavelInput,
  resolveProjectInput
} from "../packages/vscode/src/project.js";

test("VS Code project discovery prefers the nearest ravel.toml", async () => {
  const present = new Set(["/workspace/project/ravel.toml"]);
  const exists = async (path) => present.has(path);

  assert.equal(isSupportedRavelInput("/workspace/project/chapter.md"), true);
  assert.equal(isSupportedRavelInput("/workspace/project/image.png"), false);
  assert.equal(
    await findNearestProjectConfig(
      "/workspace/project/chapters/one.md",
      "/workspace",
      exists
    ),
    "/workspace/project/ravel.toml"
  );
  assert.equal(
    await resolveProjectInput(
      "/workspace/project/chapters/one.md",
      "/workspace",
      exists
    ),
    "/workspace/project/ravel.toml"
  );
});

test("editor selection chooses the narrowest source-linked graph entity", () => {
  const chunkSource = {
    uri: "guide.md",
    range: {
      start: { line: 10, column: 0, offset: 100 },
      end: { line: 20, column: 0, offset: 300 }
    }
  };
  const referenceSource = {
    uri: "guide.md",
    range: {
      start: { line: 12, column: 2, offset: 140 },
      end: { line: 12, column: 12, offset: 150 }
    }
  };
  const snapshot = {
    nodes: [{ id: "chunk:main", kind: "chunk", source: chunkSource }],
    edges: [{ id: "edge:reference", kind: "references", authoredAt: referenceSource }]
  };

  assert.equal(findExplorerEntityAtSelection(snapshot, "guide.md", {
    start: { line: 12, column: 5 },
    end: { line: 12, column: 5 }
  }).id, "edge:reference");
  assert.equal(findExplorerEntityAtSelection(snapshot, "guide.md", {
    start: { line: 16, column: 0 },
    end: { line: 16, column: 0 }
  }).id, "chunk:main");
  assert.equal(findExplorerEntityAtSelection(snapshot, "other.md", {
    start: { line: 12, column: 5 },
    end: { line: 12, column: 5 }
  }), null);
});

test("VS Code project discovery falls back to a supported active source", async () => {
  const exists = async () => false;
  assert.equal(
    await resolveProjectInput("/workspace/guide.md", "/workspace", exists),
    "/workspace/guide.md"
  );
  assert.equal(
    await resolveProjectInput("/workspace/ravel.toml", "/workspace", exists),
    "/workspace/ravel.toml"
  );
  assert.equal(
    await resolveProjectInput("/workspace/notes.txt", "/workspace", exists),
    null
  );
});
