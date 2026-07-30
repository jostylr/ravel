import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";

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
  const offset = relative(boundary, path);
  return offset === "" ||
    offset !== ".." && !offset.startsWith(".." + sep) && !isAbsolute(offset);
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

const comparePosition = (left, right) =>
  left.line - right.line || left.column - right.column;

const containsPosition = (range, position) =>
  comparePosition(range.start, position) <= 0 &&
  comparePosition(position, range.end) < 0;

const intersectsRange = (left, right) =>
  comparePosition(left.start, right.end) < 0 &&
  comparePosition(right.start, left.end) < 0;

const rangeSize = (range) => {
  if (Number.isInteger(range.start.offset) && Number.isInteger(range.end.offset)) {
    return range.end.offset - range.start.offset;
  }
  return (range.end.line - range.start.line) * 1_000_000 +
    range.end.column - range.start.column;
};

export const findExplorerEntityAtSelection = (
  snapshot,
  sourceUri,
  selection
) => {
  if (!snapshot || !sourceUri || !selection?.start || !selection?.end) return null;
  const collapsed = comparePosition(selection.start, selection.end) === 0;
  const candidates = [
    ...(snapshot.nodes ?? []).map((entity) => ({
      entity,
      source: entity.source,
      priority: entity.kind === "chunk" ? 1 : 2
    })),
    ...(snapshot.edges ?? []).map((entity) => ({
      entity,
      source: entity.authoredAt,
      priority: 0
    }))
  ].filter(({ source }) =>
    source?.uri === sourceUri &&
    source.range &&
    (collapsed
      ? containsPosition(source.range, selection.start)
      : intersectsRange(source.range, selection))
  );
  candidates.sort((left, right) =>
    rangeSize(left.source.range) - rangeSize(right.source.range) ||
    left.priority - right.priority ||
    left.entity.id.localeCompare(right.entity.id)
  );
  return candidates[0]?.entity ?? null;
};
