import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as typescript from "typescript";
import { createTypeScriptLanguageBridgeWithApi } from
  "../packages/language-typescript/src/index.js";
import {
  copyTypeScriptStandardLibraries
} from "../scripts/copy-typescript-libs.mjs";

test("VS Code bundle carries TypeScript standard libraries and recognizes Array", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ravel-typescript-libs-"));
  try {
    const copied = await copyTypeScriptStandardLibraries({
      destinationDirectory: directory
    });
    assert.ok(copied.includes("lib.d.ts"));
    assert.ok(copied.includes("lib.es2022.full.d.ts"));
    assert.ok((await stat(path.join(directory, "lib.es5.d.ts"))).size > 100_000);
    assert.match(
      await readFile(path.join(directory, "lib.es2022.full.d.ts"), "utf8"),
      /reference lib="es2022"/
    );

    // Model the esbuild layout: TypeScript executes from extension.cjs and
    // asks for its default library beside that bundle rather than under the
    // repository's node_modules directory.
    const bundledTypeScript = new Proxy(typescript, {
      get(target, property) {
        if (property === "getDefaultLibFilePath") {
          return (options) => path.join(
            directory,
            path.basename(typescript.getDefaultLibFilePath(options))
          );
        }
        return target[property];
      }
    });
    const bridge = createTypeScriptLanguageBridgeWithApi(bundledTypeScript, {
      currentDirectory: directory,
      configSearchRoot: directory
    });
    const document = {
      id: "projection:stdlib",
      uri: "pieceful-virtual://test/stdlib/main.js",
      version: 1,
      stage: "assembled",
      languageId: "javascript",
      artifactId: "main.js",
      text: "const values = Array.from([1, 2, 3]);\nvalues.map((value) => value * 2);\n"
    };
    try {
      await bridge.open(document);
      const diagnostics = await bridge.request({
        kind: "diagnostics",
        documentUri: document.uri,
        categories: ["compilerOptions", "syntactic", "semantic"]
      }, { version: document.version });
      assert.equal(
        diagnostics.some(({ code, message }) =>
          code === 2304 || code === 2318 || /(?:global type|name) ['\"]?Array/.test(message)
        ),
        false,
        JSON.stringify(diagnostics, null, 2)
      );
    } finally {
      await bridge.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
