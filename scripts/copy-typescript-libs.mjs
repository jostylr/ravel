import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromExtension = createRequire(new URL(
  "../packages/vscode/package.json",
  import.meta.url
));

export const typeScriptLibraryDirectory = () =>
  dirname(requireFromExtension.resolve("typescript"));

const isStandardLibraryDeclaration = (name) =>
  /^lib(?:\..+)?\.d\.ts$/.test(name);

export const copyTypeScriptStandardLibraries = async ({
  sourceDirectory = typeScriptLibraryDirectory(),
  destinationDirectory = join(repositoryRoot, "packages", "vscode", "dist")
} = {}) => {
  const names = (await readdir(sourceDirectory))
    .filter(isStandardLibraryDeclaration)
    .sort();
  if (!names.includes("lib.d.ts") || !names.includes("lib.es5.d.ts")) {
    throw new Error(
      `TypeScript standard-library declarations were not found in ${sourceDirectory}.`
    );
  }
  await mkdir(destinationDirectory, { recursive: true });
  await Promise.all(names.map((name) => copyFile(
    join(sourceDirectory, name),
    join(destinationDirectory, name)
  )));
  return Object.freeze(names);
};

const invokedPath = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const copied = await copyTypeScriptStandardLibraries();
  console.log(`Copied ${copied.length} TypeScript standard-library declarations into the VS Code bundle.`);
}
