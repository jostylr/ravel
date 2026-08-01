import { copyFile, mkdir, rm } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../docs/playground/", import.meta.url));
const application = fileURLToPath(new URL("../packages/host-browser/app/app.js", import.meta.url));
const template = fileURLToPath(new URL("../packages/host-browser/app/index.html", import.meta.url));

await mkdir(output, { recursive: true });
await Promise.all([
  rm(output + "app.js.map", { force: true }),
  rm(output + "app.css.map", { force: true }),
  rm(output + "chunks", { recursive: true, force: true })
]);
await build({
  entryPoints: [application],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outdir: output,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  assetNames: "assets/[name]-[hash]",
  loader: { ".md": "text" },
  sourcemap: false,
  minify: true,
  legalComments: "none",
  logLevel: "info"
});
await copyFile(template, output + "index.html");

console.log("Built the Ravel playground in " + relative(root, output));
