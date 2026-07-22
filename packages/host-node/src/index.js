import { lstat, readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import { combineMaps } from "@pieceful/ravel-core";
import { markdownToMap } from "@pieceful/ravel-markdown";
import { assertRavelMap } from "@pieceful/ravel-map";

const missing = (error) => error?.code === "ENOENT";

const containedIn = (root, target) => {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path));
};

/** Keep persisted source locations portable and avoid exposing absolute paths. */
const relativeSourceUri = (root, uri) => {
  if (typeof uri !== "string" || !isAbsolute(uri)) return uri;
  const path = relative(root, uri);
  if (containedIn(root, uri)) return path || ".";
  return "<external>/" + basename(uri);
};

const normalizeSource = (source, root) => {
  if (source && typeof source === "object") source.uri = relativeSourceUri(root, source.uri);
};

/** Rewrite source-bearing IR fields in place after filesystem loading is complete. */
const relativizeSourceUris = (graph, root) => {
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.source) normalizeSource(value.source, root);
    for (const [key, child] of Object.entries(value)) {
      if (key !== "source") visit(child);
    }
  };
  for (const document of graph.documents ?? []) {
    document.uri = relativeSourceUri(root, document.uri);
  }
  visit(graph.chunks);
  visit(graph.directives);
  return graph;
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

const readMap = async (path) => assertRavelMap(JSON.parse(await readFile(path, "utf8")), { uri: path });

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
      assertRavelMap(map, { uri: absolutePath });
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
  const collected = await collectPretransformMaps(resolve(entryPath), options);
  const graph = combineMaps(collected.maps);
  graph.diagnostics.push(...collected.diagnostics);
  return relativizeSourceUris(graph, collected.rootDirectory);
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
    pretransform: relativizeSourceUris(pretransform, scope.root),
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

const contentHash = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const orderedDeliverables = (program) => Object.values(program.deliverables ?? [])
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name));

/** Build a deterministic, non-writing description of artifact output. */
export const planDeliverables = (program, outputDirectory) => {
  const root = resolve(outputDirectory);
  const destinations = new Set();
  const deliverables = orderedDeliverables(program).map((deliverable) => {
    const destination = safeDestination(root, deliverable.name);
    if (destinations.has(destination)) throw new Error("Multiple deliverables resolve to the same destination: " + deliverable.name);
    destinations.add(destination);
    return {
      name: deliverable.name,
      path: relative(root, destination),
      from: deliverable.from,
      bytes: Buffer.byteLength(deliverable.value, "utf8"),
      sha256: contentHash(deliverable.value)
    };
  });
  return {
    version: 1,
    outputDirectory: root,
    manifest: join(root, ".ravel-manifest.json"),
    deliverables
  };
};

const existingFile = async (path, description) => {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new Error(description + " must not be a symbolic link: " + path);
    if (!entry.isFile()) throw new Error(description + " must be a file when it already exists: " + path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
};

const removeIfPresent = async (path) => {
  try {
    await unlink(path);
  } catch (error) {
    if (!missing(error)) throw error;
  }
};

/** Stage all files before committing any replacement, with rollback on failure. */
const writeFilesAtomically = async (scope, entries, description) => {
  const staged = [];
  try {
    for (const entry of entries) {
      await ensureDirectoryTree(scope.root, dirname(entry.destination), description);
      await assertNoSymlinks(scope.root, entry.destination, description);
      const exists = await existingFile(entry.destination, description);
      const token = randomUUID();
      const temporary = join(dirname(entry.destination), "." + basename(entry.destination) + ".ravel-stage-" + token);
      const backup = join(dirname(entry.destination), "." + basename(entry.destination) + ".ravel-backup-" + token);
      await writeFile(temporary, entry.value, "utf8");
      staged.push({ ...entry, exists, temporary, backup, committed: false, backedUp: false });
    }

    for (const entry of staged) {
      if (entry.exists) {
        await rename(entry.destination, entry.backup);
        entry.backedUp = true;
      }
      await rename(entry.temporary, entry.destination);
      entry.committed = true;
    }
    for (const entry of staged) if (entry.backedUp) await removeIfPresent(entry.backup);
  } catch (error) {
    for (const entry of staged.slice().reverse()) {
      if (entry.committed) await removeIfPresent(entry.destination);
      if (entry.backedUp) {
        try {
          await rename(entry.backup, entry.destination);
        } catch (rollbackError) {
          if (!missing(rollbackError)) throw rollbackError;
        }
      }
      await removeIfPresent(entry.temporary);
    }
    throw error;
  }
};

export const writeDeliverables = async (program, outputDirectory, { rootDirectory = outputDirectory } = {}) => {
  const scope = await createOutputScope(outputDirectory, rootDirectory);
  const plan = planDeliverables(program, scope.root);
  const entries = plan.deliverables.map((deliverable) => ({
    destination: safeDestination(scope.root, deliverable.name),
    value: program.deliverables[deliverable.name].value
  }));
  await writeFilesAtomically(scope, entries, "Deliverable path");
  return entries.map((entry) => entry.destination);
};

export const createBuildManifest = (program, outputDirectory) => {
  const plan = planDeliverables(program, outputDirectory);
  return {
    version: 1,
    ravelVersion: program.version ?? 1,
    outputDirectory: plan.outputDirectory,
    deliverables: plan.deliverables,
    result: "success"
  };
};

export const writeBuildManifest = async (program, outputDirectory, { rootDirectory = outputDirectory } = {}) => {
  const scope = await createOutputScope(outputDirectory, rootDirectory);
  const manifest = createBuildManifest(program, scope.root);
  const destination = safeDestination(scope.root, ".ravel-manifest.json");
  await writeFilesAtomically(scope, [{ destination, value: JSON.stringify(manifest, null, 2) + "\n" }], "Build manifest path");
  return { path: destination, manifest };
};

export const writeGraph = async (program, path, { rootDirectory = dirname(resolve(path)) } = {}) => {
  const scope = await createOutputScope(rootDirectory, rootDirectory);
  const destination = await scope.path(path, "Graph path");
  await ensureDirectoryTree(scope.root, dirname(destination), "Graph path");
  await assertNoSymlinks(scope.root, destination, "Graph path");
  await writeFile(destination, JSON.stringify(program, null, 2) + "\n", "utf8");
};
