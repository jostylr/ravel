import { cp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../documentation/_site", import.meta.url));
const output = fileURLToPath(new URL("../docs", import.meta.url));

const render = spawn("quarto", ["render", "documentation"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  shell: process.platform === "win32",
  stdio: "inherit"
});

const exitCode = await new Promise((resolve, reject) => {
  render.on("error", reject);
  render.on("exit", resolve);
});
if (exitCode !== 0) process.exit(exitCode ?? 1);

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
console.log("Copied the rendered documentation to docs");
