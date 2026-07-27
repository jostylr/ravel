import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const destination = resolve(
  fileURLToPath(new URL("../browser-test/generated/emscripten-module.wasm", import.meta.url))
);
const source = fileURLToPath(import.meta.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
