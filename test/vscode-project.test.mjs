import assert from "node:assert/strict";
import test from "node:test";
import {
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
