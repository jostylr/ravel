import { dirname, extname, join, resolve } from "node:path";

const supportedExtensions = new Set([
  ".adoc",
  ".asciidoc",
  ".htm",
  ".html",
  ".json",
  ".markdown",
  ".md",
  ".mdown",
  ".myst.md",
  ".nw",
  ".noweb",
  ".org",
  ".qmd",
  ".toml"
]);

export const isSupportedRavelInput = (path) => {
  const lower = path.toLowerCase();
  return lower.endsWith(".myst.md") || supportedExtensions.has(extname(lower));
};

const inside = (root, candidate) => {
  const boundary = resolve(root);
  const path = resolve(candidate);
  return path === boundary || path.startsWith(boundary + "/");
};

export const findNearestProjectConfig = async (
  documentPath,
  workspaceRoot,
  exists
) => {
  const boundary = resolve(workspaceRoot);
  let directory = dirname(resolve(documentPath));
  while (inside(boundary, directory)) {
    const candidate = join(directory, "ravel.toml");
    if (await exists(candidate)) return candidate;
    if (directory === boundary) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
};

export const resolveProjectInput = async (
  documentPath,
  workspaceRoot,
  exists
) => {
  const absolute = resolve(documentPath);
  if (!isSupportedRavelInput(absolute)) return null;
  if (absolute.toLowerCase().endsWith(".toml")) return absolute;
  return await findNearestProjectConfig(absolute, workspaceRoot, exists) ?? absolute;
};
