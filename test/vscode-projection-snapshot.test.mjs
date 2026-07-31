import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRelevantEditorState,
  createEditorSnapshot,
  isSourceStateMismatch,
  projectionSourceState,
  sameRelevantEditorState,
  sameRelevantReadState,
  stabilizeEditorSnapshot
} from "../packages/vscode/src/projection-snapshot.js";

const entry = (uri, {
  path = "/workspace/" + uri,
  version = 1,
  text = uri,
  dirty = false
} = {}) => ({ uri, path, version, text, dirty });

test("projection text and versions come from the same overlay capture", () => {
  const captured = createEditorSnapshot([
    entry("guide.md", { version: 7, text: "const draft = 7", dirty: true }),
    entry("library.md", { version: 3, text: "export const saved = 3" })
  ]);

  assert.deepEqual(captured.overlays.get("/workspace/guide.md"), {
    text: "const draft = 7",
    version: 7
  });
  assert.deepEqual(captured.overlays.get("/workspace/library.md"), {
    text: "export const saved = 3",
    version: 3
  });
  assert.deepEqual(
    projectionSourceState(captured, ["guide.md", "library.md"]),
    {
      sourceTexts: {
        "guide.md": "const draft = 7",
        "library.md": "export const saved = 3"
      },
      sourceVersions: { "guide.md": 7, "library.md": 3 }
    }
  );
});

test("a dependency introduced by an overlay invalidates the capture if it changes", () => {
  const captured = createEditorSnapshot([
    entry("guide.md", {
      version: 2,
      text: "import library.md",
      dirty: true
    })
  ]);
  const current = createEditorSnapshot([
    entry("guide.md", {
      version: 2,
      text: "import library.md",
      dirty: true
    }),
    entry("library.md", {
      version: 4,
      text: "changed after capture",
      dirty: true
    })
  ]);

  assert.equal(
    sameRelevantEditorState(captured, current, ["guide.md", "library.md"]),
    false
  );
  assert.throws(
    () => assertRelevantEditorState(
      captured,
      current,
      ["guide.md", "library.md"]
    ),
    (error) => error.name === "AbortError" && isSourceStateMismatch(error)
  );
});

test("version and open-state changes invalidate while unrelated edits do not", () => {
  const captured = createEditorSnapshot([
    entry("guide.md", { version: 5, text: "draft", dirty: true })
  ]);
  const changedVersion = createEditorSnapshot([
    entry("guide.md", { version: 6, text: "draft", dirty: true })
  ]);
  assert.equal(
    sameRelevantEditorState(captured, changedVersion, ["guide.md"]),
    false
  );

  const noOpenDocuments = createEditorSnapshot([]);
  const cleanOpen = createEditorSnapshot([
    entry("library.md", { text: "saved", dirty: false }),
    entry("unrelated.md", { text: "irrelevant draft", dirty: true })
  ]);
  assert.equal(
    sameRelevantEditorState(noOpenDocuments, cleanOpen, ["library.md"]),
    false
  );
  assert.equal(
    sameRelevantEditorState(noOpenDocuments, cleanOpen, ["guide.md"]),
    true
  );
});

test("read-only authority adopts only a clean open matching evaluated bytes", () => {
  const captured = createEditorSnapshot([]);
  const cleanMatch = createEditorSnapshot([
    entry("library.md", { text: "evaluated library", dirty: false })
  ]);
  const cleanMismatch = createEditorSnapshot([
    entry("library.md", { text: "changed on disk", dirty: false })
  ]);
  const dirtyMatch = createEditorSnapshot([
    entry("library.md", { text: "evaluated library", dirty: true })
  ]);
  const evaluated = { "library.md": "evaluated library" };

  assert.equal(sameRelevantReadState(
    captured,
    cleanMatch,
    ["library.md"],
    evaluated
  ), true);
  assert.equal(sameRelevantReadState(
    captured,
    cleanMismatch,
    ["library.md"],
    evaluated
  ), false);
  assert.equal(sameRelevantReadState(
    captured,
    dirtyMatch,
    ["library.md"],
    evaluated
  ), false);
});

test("snapshot stabilization recaptures custom-extension inputs discovered by dirty config", async () => {
  const config = entry("ravel.toml", {
    path: "/workspace/ravel.toml",
    version: 2,
    text: "[[files]]\npath='chapter.txt'\nadapter='noweb'",
    dirty: true
  });
  const custom = entry("chapter.txt", {
    path: "/workspace/chapter.txt",
    version: 4,
    text: "<<main>>=\nconst inMemory = true\n@",
    dirty: true
  });
  const initial = createEditorSnapshot([config]);
  const evaluatedOverlays = [];
  const result = await stabilizeEditorSnapshot({
    initialSnapshot: initial,
    evaluate: async (snapshot) => {
      evaluatedOverlays.push([...snapshot.overlays.keys()].sort());
      return { loadedInputUris: ["ravel.toml", "chapter.txt"] };
    },
    captureNext: async (value) => createEditorSnapshot(
      value.loadedInputUris.includes("chapter.txt") ? [config, custom] : [config]
    )
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(evaluatedOverlays, [
    ["/workspace/ravel.toml"],
    ["/workspace/chapter.txt", "/workspace/ravel.toml"]
  ]);
  assert.equal(result.snapshot.documents.get("chapter.txt").text, custom.text);
});
