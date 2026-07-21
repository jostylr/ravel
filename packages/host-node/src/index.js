import { lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import { combineMaps } from "../../core/src/index.js";
import { markdownToMap } from "../../markdown/src/index.js";

const missing = (error) => error?.code === "ENOENT";

const containedIn = (root, target) => {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path));
};

/** Reject every symlink component at or beneath the declared Ravel root. */
const assertNoSymlinks = async (root, path, description) => {
  if (!containedIn(root, path)) throw new Error(description + " escapes the Ravel root: " + path);
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    if (entry.isSymbolicLink()) throw new Error(description + " must not traverse a symbolic link: " + current);
  }
};

const assertDirectory = async (path, description) => {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) throw new Error(description + " must not be a symbolic link: " + path);
  if (!entry.isDirectory()) throw new Error(description + " must be a directory: " + path);
};

/** Create a declared output root without accepting a symlink in its new path. */
const ensureDeclaredDirectory = async (path, description) => {
  const missingParts = [];
  let current = resolve(path);
  while (true) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error(description + " must not be a symbolic link: " + current);
      if (!entry.isDirectory()) throw new Error(description + " must be a directory: " + current);
      break;
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missingParts.unshift(basename(current));
      current = parent;
    }
  }
  for (const part of missingParts) {
    current = join(current, part);
    await mkdir(current);
    await assertDirectory(current, description);
  }
};

const scopedPath = async (root, path, description) => {
  const target = resolve(root, path);
  if (!containedIn(root, target)) throw new Error(description + " escapes the Ravel root: " + path);
  await assertNoSymlinks(root, target, description);
  return target;
};

const createInputScope = async (rootDirectory) => {
  const root = resolve(rootDirectory);
  await assertDirectory(root, "Ravel root");
  return { root, path: (path, description) => scopedPath(root, path, description) };
};

const ensureDirectoryTree = async (root, target, description) => {
  if (!containedIn(root, target)) throw new Error(description + " escapes the Ravel root: " + target);
  await assertDirectory(root, "Ravel root");
  let current = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, part);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (!missing(error)) throw error;
      await mkdir(current);
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink()) throw new Error(description + " must not traverse a symbolic link: " + current);
    if (!entry.isDirectory()) throw new Error(description + " requires a directory path: " + current);
  }
};

const createOutputScope = async (outputDirectory, rootDirectory) => {
  const root = resolve(rootDirectory);
  const output = resolve(outputDirectory);
  if (!containedIn(root, output)) throw new Error("Output directory escapes the Ravel root: " + outputDirectory);
  await ensureDeclaredDirectory(root, "Ravel root");
  await ensureDirectoryTree(root, output, "Output directory");
  return { root: output, path: (path, description) => scopedPath(output, path, description) };
};

const readMap = async (path) => JSON.parse(await readFile(path, "utf8"));

const loadMarkdownFile = async (path, options = {}) => markdownToMap(
  await readFile(path, "utf8"),
  { uri: path, document: options.document, mode: options.mode }
);

const collectPretransformMaps = async (entryPath, entryOptions = {}, scope) => {
  const activeScope = scope ?? await createInputScope(dirname(resolve(entryPath)));
  const visited = new Set();
  const maps = [];
  const diagnostics = [];

  const visit = async (path, options = {}) => {
    const absolutePath = await activeScope.path(path, "Ravel input");
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    const extension = extname(absolutePath).toLowerCase();
    let map;
    if (extension === ".json") {
      map = await readMap(absolutePath);
    } else if (extension === ".md" || extension === ".markdown" || extension === ".mdown") {
      const result = await loadMarkdownFile(absolutePath, options);
      map = result.map;
      diagnostics.push(...result.diagnostics);
    } else {
      throw new Error("Ravel in directive must target a .json map or Markdown file: " + absolutePath);
    }
    for (const directive of map.directives ?? []) {
      if (directive.kind !== "in") continue;
      const target = directive.target ?? directive.name;
      if (typeof target !== "string" || !target) {
        throw new Error("in directive requires target in " + absolutePath);
      }
      await visit(resolve(dirname(absolutePath), target));
    }
    maps.push(map);
  };

  await visit(entryPath, entryOptions);
  return { maps, diagnostics, rootDirectory: activeScope.root };
};

export const loadPretransformGraph = async (entryPath, options = {}) => {
  const collected = await collectPretransformMaps(entryPath, options);
  const graph = combineMaps(collected.maps);
  graph.diagnostics.push(...collected.diagnostics);
  return graph;
};

const configSource = (uri) => ({
  uri,
  range: {
    start: { line: 0, column: 0, offset: 0 },
    end: { line: 0, column: 0, offset: 0 }
  }
});

const requireString = (value, description) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(description + " must be a non-empty string.");
  }
  return value;
};

export const loadTomlBuild = async (configPath) => {
  const absoluteConfig = resolve(configPath);
  const scope = await createInputScope(dirname(absoluteConfig));
  const configFile = await scope.path(absoluteConfig, "Ravel TOML config");
  const config = parseToml(await readFile(configFile, "utf8"));
  if (config.version !== 1) throw new Error("Ravel TOML config version must be 1: " + absoluteConfig);
  if (!Array.isArray(config.files) || config.files.length === 0) {
    throw new Error("Ravel TOML config requires one or more [[files]] entries: " + absoluteConfig);
  }
  if (!config.build || typeof config.build !== "object") {
    throw new Error("Ravel TOML config requires a [build] table: " + absoluteConfig);
  }
  const outDirectory = requireString(config.build.out_dir, "build.out_dir");
  const baseDirectory = scope.root;
  const results = await Promise.all(config.files.map(async (file, index) => {
    if (!file || typeof file !== "object") throw new Error("files[" + index + "] must be a table.");
    const path = requireString(file.path, "files[" + index + "].path");
    if (file.document !== undefined) requireString(file.document, "files[" + index + "].document");
    const mode = file.mode ?? "opt-in";
    return collectPretransformMaps(resolve(baseDirectory, path), { document: file.document, mode }, scope);
  }));
  const pretransform = combineMaps(results.flatMap((result) => result.maps));
  pretransform.diagnostics.push(...results.flatMap((result) => result.diagnostics));
  for (const output of config.outputs ?? []) {
    if (!output || typeof output !== "object") throw new Error("Each [[outputs]] entry must be a table.");
    pretransform.directives.push({
      kind: "out",
      name: requireString(output.name, "outputs.name"),
      from: requireString(output.from, "outputs.from"),
      source: configSource(absoluteConfig)
    });
  }
  return {
    pretransform,
    outputDirectory: await scope.path(outDirectory, "build.out_dir"),
    rootDirectory: scope.root
  };
};

/** Load a JSON map, one Markdown document, or a single Ravel TOML build run. */
export const loadBuildInput = async (inputPath, options = {}) => {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".toml") return loadTomlBuild(inputPath);
  if (extension === ".md" || extension === ".markdown" || extension === ".mdown") {
    const rootDirectory = dirname(resolve(inputPath));
    return {
      pretransform: await loadPretransformGraph(resolve(inputPath), options),
      outputDirectory: undefined,
      rootDirectory
    };
  }
  if (extension === ".json") {
    return {
      pretransform: await loadPretransformGraph(inputPath),
      outputDirectory: undefined,
      rootDirectory: dirname(resolve(inputPath))
    };
  }
  throw new Error("Ravel input must be a .json map, Markdown document, or .toml build config: " + inputPath);
};

const safeDestination = (outputDirectory, name) => {
  if (isAbsolute(name)) throw new Error("Deliverable name must be relative: " + name);
  const root = resolve(outputDirectory);
  const destination = resolve(root, name);
  if (!containedIn(root, destination)) {
    throw new Error("Deliverable escapes output directory: " + name);
  }
  return destination;
};

export const writeDeliverables = async (program, outputDirectory, { rootDirectory = outputDirectory } = {}) => {
  const scope = await createOutputScope(outputDirectory, rootDirectory);
  const written = [];
  for (const deliverable of Object.values(program.deliverables)) {
    const destination = safeDestination(scope.root, deliverable.name);
    await ensureDirectoryTree(scope.root, dirname(destination), "Deliverable path");
    await assertNoSymlinks(scope.root, destination, "Deliverable path");
    await writeFile(destination, deliverable.value, "utf8");
    written.push(destination);
  }
  return written;
};

export const writeGraph = async (program, path, { rootDirectory = dirname(resolve(path)) } = {}) => {
  const scope = await createOutputScope(rootDirectory, rootDirectory);
  const destination = await scope.path(path, "Graph path");
  await ensureDirectoryTree(scope.root, dirname(destination), "Graph path");
  await assertNoSymlinks(scope.root, destination, "Graph path");
  await writeFile(destination, JSON.stringify(program, null, 2) + "\n", "utf8");
};
