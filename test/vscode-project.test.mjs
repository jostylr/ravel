import assert from "node:assert/strict";
import test from "node:test";
import {
  findExplorerDefinitionAtSelection,
  findExplorerEntityAtSelection,
  findNearestProjectConfig,
  isSupportedRavelInput,
  projectIncludesPath,
  resolveProjectInput,
  shouldCaptureEditorPath
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
    nodes: [
      { id: "chunk:definition", kind: "chunk", source: {
        uri: "library.md",
        range: {
          start: { line: 4, column: 0, offset: 20 },
          end: { line: 6, column: 0, offset: 80 }
        }
      } },
      { id: "chunk:main", kind: "chunk", source: chunkSource }
    ],
    edges: [{
      id: "edge:reference",
      kind: "references",
      source: "chunk:definition",
      target: "chunk:main",
      authoredAt: referenceSource
    }]
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
  assert.equal(findExplorerDefinitionAtSelection(snapshot, "guide.md", {
    start: { line: 12, column: 5 },
    end: { line: 12, column: 5 }
  }).id, "chunk:definition");
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

test("active project reuse is limited to loaded and authored inputs", () => {
  const project = {
    rootDirectory: "/workspace/project",
    loadedInputUris: ["ravel.toml", "maps/input.json", "chapters/legacy.txt"],
    authoredSourceUris: ["guide.md", "chapters/library.org"]
  };
  assert.equal(projectIncludesPath(project, "/workspace/project/guide.md"), true);
  assert.equal(projectIncludesPath(project, "/workspace/project/ravel.toml"), true);
  assert.equal(projectIncludesPath(project, "/workspace/project/chapters/legacy.txt"), true);
  assert.equal(projectIncludesPath(project, "/workspace/project/src/app.ts"), false);
  assert.equal(projectIncludesPath(project, "/workspace/other/guide.md"), false);
  assert.equal(projectIncludesPath(
    project,
    "/workspace/project/ravel.toml",
    { authoredOnly: true }
  ), false);
  assert.equal(projectIncludesPath(
    project,
    "/workspace/project/chapters/library.org",
    { authoredOnly: true }
  ), true);
});

test("editor capture includes configured custom extensions and supported fallbacks", () => {
  const relevant = ["ravel.toml", "chapters/legacy.txt"];
  assert.equal(shouldCaptureEditorPath(
    "/workspace/project",
    "/workspace/project/chapters/legacy.txt",
    relevant
  ), true);
  assert.equal(shouldCaptureEditorPath(
    "/workspace/project",
    "/workspace/project/new-reference.md",
    relevant,
    { includeSupportedFallback: true }
  ), true);
  assert.equal(shouldCaptureEditorPath(
    "/workspace/project",
    "/workspace/project/output/app.ts",
    relevant,
    { includeSupportedFallback: true }
  ), false);
  assert.equal(shouldCaptureEditorPath(
    "/workspace/project",
    "/workspace/other/guide.md",
    relevant,
    { includeSupportedFallback: true }
  ), false);
});
