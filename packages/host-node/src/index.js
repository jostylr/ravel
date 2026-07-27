import { lstat, readFile, readdir, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  combineMaps,
  createBuildProvenanceMap,
  createDeliverableProvenanceMap,
  provenanceMapVersion
} from "@pieceful/ravel-core";
import { markdownToMap } from "@pieceful/ravel-markdown";
import { assertRavelMap } from "@pieceful/ravel-map";

const missing = (error) => error?.code === "ENOENT";

const inputSource = (uri) => ({
  uri: typeof uri === "string" && uri.length ? uri : "<ravel-input>",
  range: {
    start: { line: 0, column: 0, offset: 0 },
    end: { line: 0, column: 0, offset: 0 }
  }
});

/** Expected source/configuration failure with portable CLI/editor diagnostics. */
export class RavelInputError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map((entry) => entry.message).join(" "));
    this.name = "RavelInputError";
    this.diagnostics = diagnostics;
  }
}

const inputError = (code, message, uri) => new RavelInputError([{
  code,
  severity: "error",
  message,
  source: inputSource(uri)
}]);

const readInputText = async (path, description, code) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw inputError(code, "Unable to read " + description + ": " + (error?.code ?? error?.message ?? String(error)), path);
  }
};

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

const readMap = async (path) => {
  const text = await readInputText(path, "Ravel Map", "RM201");
  let map;
  try {
    map = JSON.parse(text);
  } catch (error) {
    throw inputError("RM201", "Invalid JSON Ravel Map: " + (error?.message ?? String(error)), path);
  }
  return assertRavelMap(map, { uri: path });
};

const loadMarkdownFile = async (path, options = {}) => markdownToMap(
  await readInputText(path, "Markdown input", "RM201"),
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
      throw inputError("RH101", "Ravel input must be a .json map or Markdown file.", absolutePath);
    }
    for (const directive of map.directives ?? []) {
      if (directive.kind !== "in") continue;
      const target = directive.target ?? directive.name;
      if (typeof target !== "string" || !target) {
        throw inputError("RH102", "in directive requires a target path.", directive.source?.uri ?? absolutePath);
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

const configSource = inputSource;

const requireConfigString = (value, description, configPath) => {
  if (typeof value !== "string" || value.length === 0) {
    throw inputError("RC102", description + " must be a non-empty string.", configPath);
  }
  return value;
};

const reportUnknownKeys = (value, allowed, description, configPath) => {
  for (const key of Object.keys(value ?? {})) {
    if (!allowed.has(key)) throw inputError("RC102", description + "." + key + " is not a supported configuration field.", configPath);
  }
};

const loadLiveConfiguration = async (live, scope, configPath) => {
  if (live === undefined) return undefined;
  if (!live || typeof live !== "object" || Array.isArray(live)) {
    throw inputError("RC102", "live must be a [live] table.", configPath);
  }
  reportUnknownKeys(live, new Set(["modules", "resources"]), "live", configPath);
  if (live.modules !== undefined && !Array.isArray(live.modules)) {
    throw inputError("RC102", "live.modules must contain [[live.modules]] entries.", configPath);
  }
  if (live.resources !== undefined && !Array.isArray(live.resources)) {
    throw inputError("RC102", "live.resources must contain [[live.resources]] entries.", configPath);
  }

  const moduleSpecifiers = new Set();
  const modules = (live.modules ?? []).map((entry, index) => {
    const description = "live.modules[" + index + "]";
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw inputError("RC102", description + " must be a table.", configPath);
    }
    reportUnknownKeys(entry, new Set(["specifier", "from"]), description, configPath);
    const specifier = requireConfigString(entry.specifier, description + ".specifier", configPath);
    const from = requireConfigString(entry.from, description + ".from", configPath);
    if (moduleSpecifiers.has(specifier)) {
      throw inputError("RC102", "Duplicate live module specifier: " + specifier, configPath);
    }
    moduleSpecifiers.add(specifier);
    return { specifier, from, source: configSource(configPath) };
  });

  const resourceNames = new Set();
  const resourceEntries = await Promise.all((live.resources ?? []).map(async (entry, index) => {
    const description = "live.resources[" + index + "]";
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw inputError("RC102", description + " must be a table.", configPath);
    }
    reportUnknownKeys(entry, new Set(["name", "path"]), description, configPath);
    const name = requireConfigString(entry.name, description + ".name", configPath);
    const path = requireConfigString(entry.path, description + ".path", configPath);
    if (resourceNames.has(name)) {
      throw inputError("RC102", "Duplicate live resource name: " + name, configPath);
    }
    resourceNames.add(name);
    const absolutePath = await scope.path(path, description + ".path");
    return [name, await readInputText(absolutePath, "live resource", "RC103")];
  }));

  return { modules, resources: Object.fromEntries(resourceEntries) };
};

export const loadTomlBuild = async (configPath) => {
  const absoluteConfig = resolve(configPath);
  const scope = await createInputScope(dirname(absoluteConfig));
  const configFile = await scope.path(absoluteConfig, "Ravel TOML config");
  let config;
  try {
    config = parseToml(await readInputText(configFile, "Ravel TOML config", "RC101"));
  } catch (error) {
    if (Array.isArray(error?.diagnostics)) throw error;
    throw inputError("RC101", "Invalid Ravel TOML config: " + (error?.message ?? String(error)), absoluteConfig);
  }
  reportUnknownKeys(config, new Set(["version", "files", "build", "outputs", "live"]), "config", absoluteConfig);
  if (config.version !== 1) throw inputError("RC102", "version must be 1.", absoluteConfig);
  if (!Array.isArray(config.files) || config.files.length === 0) {
    throw inputError("RC102", "files must contain one or more [[files]] entries.", absoluteConfig);
  }
  if (config.build !== undefined && (!config.build || typeof config.build !== "object" || Array.isArray(config.build))) {
    throw inputError("RC102", "build must be a [build] table.", absoluteConfig);
  }
  const build = config.build ?? {};
  reportUnknownKeys(build, new Set(["name", "out_dir", "clean", "backup"]), "build", absoluteConfig);
  if (build.name !== undefined) requireConfigString(build.name, "build.name", absoluteConfig);
  if (build.clean !== undefined && typeof build.clean !== "boolean") {
    throw inputError("RC102", "build.clean must be true or false.", absoluteConfig);
  }
  if (build.backup !== undefined && typeof build.backup !== "boolean" &&
      (typeof build.backup !== "string" || build.backup.length === 0)) {
    throw inputError("RC102", "build.backup must be true, false, or a non-empty .zip path.", absoluteConfig);
  }
  if (typeof build.backup === "string" && extname(build.backup).toLowerCase() !== ".zip") {
    throw inputError("RC102", "build.backup must name a .zip file.", absoluteConfig);
  }
  const outDirectory = build.out_dir === undefined
    ? undefined
    : requireConfigString(build.out_dir, "build.out_dir", absoluteConfig);
  const baseDirectory = scope.root;
  const live = await loadLiveConfiguration(config.live, scope, absoluteConfig);
  const results = await Promise.all(config.files.map(async (file, index) => {
    if (!file || typeof file !== "object") throw inputError("RC102", "files[" + index + "] must be a table.", absoluteConfig);
    reportUnknownKeys(file, new Set(["path", "document", "mode"]), "files[" + index + "]", absoluteConfig);
    const path = requireConfigString(file.path, "files[" + index + "].path", absoluteConfig);
    if (file.document !== undefined) requireConfigString(file.document, "files[" + index + "].document", absoluteConfig);
    const mode = file.mode ?? "opt-in";
    if (!["opt-in", "primary"].includes(mode)) throw inputError("RC102", "files[" + index + "].mode must be opt-in or primary.", absoluteConfig);
    return collectPretransformMaps(resolve(baseDirectory, path), { document: file.document, mode }, scope);
  }));
  const pretransform = combineMaps(results.flatMap((result) => result.maps));
  pretransform.diagnostics.push(...results.flatMap((result) => result.diagnostics));
  for (const output of config.outputs ?? []) {
    if (!output || typeof output !== "object") throw inputError("RC102", "Each [[outputs]] entry must be a table.", absoluteConfig);
    reportUnknownKeys(output, new Set(["name", "from"]), "outputs", absoluteConfig);
    pretransform.directives.push({
      kind: "out",
      name: requireConfigString(output.name, "outputs.name", absoluteConfig),
      from: requireConfigString(output.from, "outputs.from", absoluteConfig),
      source: configSource(absoluteConfig)
    });
  }
  return {
    pretransform: relativizeSourceUris(pretransform, scope.root),
    ...(outDirectory === undefined ? {} : { outputDirectory: await scope.path(outDirectory, "build.out_dir") }),
    rootDirectory: scope.root,
    buildOptions: {
      clean: build.clean === true,
      backup: build.backup ?? false
    },
    ...(live ? { live } : {})
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
  throw inputError("RH101", "Ravel input must be a .json map, Markdown document, or .toml build config.", inputPath);
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

const portableRelative = (root, target) => relative(root, target).split(sep).join("/");

const contentHash = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const orderedDeliverables = (program) => Object.values(program.deliverables ?? [])
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name));

const manifestName = ".ravel-manifest.json";
const textManifestName = ".manifest.txt";
const aggregateProvenanceName = ".ravelmap";
const sidecarName = (name) => name + ".ravelmap";

/** Build a deterministic, non-writing description of artifact output. */
export const planDeliverables = (program, outputDirectory) => {
  const root = resolve(outputDirectory);
  const destinations = new Set();
  const deliverables = orderedDeliverables(program).map((deliverable) => {
    const destination = safeDestination(root, deliverable.name);
    if (destinations.has(destination)) throw new Error("Multiple deliverables resolve to the same destination: " + deliverable.name);
    destinations.add(destination);
    const hasProvenance = Array.isArray(deliverable.segments);
    const ravelmap = hasProvenance ? sidecarName(deliverable.name) : null;
    if (ravelmap) {
      const mapDestination = safeDestination(root, ravelmap);
      if (destinations.has(mapDestination)) {
        throw new Error("A deliverable provenance map collides with another output: " + ravelmap);
      }
      destinations.add(mapDestination);
    }
    return {
      name: deliverable.name,
      path: portableRelative(root, destination),
      from: deliverable.from,
      bytes: Buffer.byteLength(deliverable.value, "utf8"),
      sha256: contentHash(deliverable.value),
      ...(ravelmap ? { ravelmap } : {})
    };
  });
  if (deliverables.some((deliverable) => deliverable.ravelmap)) {
    const aggregateDestination = safeDestination(root, aggregateProvenanceName);
    if (destinations.has(aggregateDestination)) {
      throw new Error("The aggregate provenance map collides with another output: " + aggregateProvenanceName);
    }
  }
  return {
    version: 1,
    outputDirectory: root,
    manifest: join(root, manifestName),
    deliverables
  };
};

const readManifest = async (outputDirectory, rootDirectory) => {
  const root = resolve(rootDirectory);
  const output = resolve(outputDirectory);
  if (!containedIn(root, output)) throw new Error("Output directory escapes the Ravel root: " + outputDirectory);
  let rootEntry;
  try {
    rootEntry = await lstat(root);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (rootEntry.isSymbolicLink()) throw new Error("Ravel root must not be a symbolic link: " + root);
  if (!rootEntry.isDirectory()) throw new Error("Ravel root must be a directory: " + root);
  await assertNoSymlinks(root, output, "Output directory");
  let outputEntry;
  try {
    outputEntry = await lstat(output);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (outputEntry.isSymbolicLink()) throw new Error("Output directory must not be a symbolic link: " + output);
  if (!outputEntry.isDirectory()) throw new Error("Output directory must be a directory: " + output);
  const path = safeDestination(output, manifestName);
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (entry.isSymbolicLink()) throw new Error("Build manifest path must not be a symbolic link: " + path);
  if (!entry.isFile()) throw new Error("Build manifest path must be a file: " + path);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error("Build manifest is not valid JSON: " + path + " (" + error.message + ")");
  }
  if (![1, 2].includes(manifest?.version) || !Array.isArray(manifest.deliverables) ||
      manifest.deliverables.some((deliverable) => typeof deliverable?.name !== "string") ||
      (manifest.stale !== undefined && (!Array.isArray(manifest.stale) ||
        manifest.stale.some((deliverable) => typeof deliverable?.name !== "string")))) {
    throw new Error("Build manifest has an unsupported shape: " + path);
  }
  return { path, manifest };
};

/** List deliverables recorded by the previous successful build but absent now. */
export const planStaleDeliverables = async (program, outputDirectory, {
  rootDirectory = outputDirectory,
  staleSince = new Date().toISOString()
} = {}) => {
  const plan = planDeliverables(program, outputDirectory);
  const previous = await readManifest(plan.outputDirectory, rootDirectory);
  if (!previous) return [];
  const active = new Set(plan.deliverables.map((deliverable) => deliverable.name));
  const prior = [...previous.manifest.deliverables, ...(previous.manifest.stale ?? [])];
  return prior
    .filter((deliverable) => !active.has(deliverable.name))
    .filter((deliverable, index, entries) => entries.findIndex((entry) => entry.name === deliverable.name) === index)
    .map((deliverable) => ({
      name: deliverable.name,
      path: portableRelative(plan.outputDirectory, safeDestination(plan.outputDirectory, deliverable.name)),
      from: deliverable.from ?? null,
      staleSince: deliverable.staleSince ?? staleSince,
      ...(deliverable.ravelmap ? { ravelmap: deliverable.ravelmap } : {})
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
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
    // A committed artifact set is already durable. Backup cleanup is best
    // effort: failing here must not enter rollback after an earlier backup has
    // been removed, because that could discard an otherwise valid commit.
    for (const entry of staged) {
      if (!entry.backedUp) continue;
      try {
        await removeIfPresent(entry.backup);
      } catch {
        // Leave an unreachable sibling backup for a later manual cleanup.
      }
    }
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

export const createBuildManifest = (program, outputDirectory, { stale = [], builtAt } = {}) => {
  const plan = planDeliverables(program, outputDirectory);
  const hasProvenance = plan.deliverables.some((deliverable) => deliverable.ravelmap);
  return {
    version: 2,
    ravelVersion: program.version ?? 1,
    outputDirectory: plan.outputDirectory,
    deliverables: plan.deliverables,
    stale: stale.map((deliverable) => ({
      name: deliverable.name,
      path: deliverable.path,
      from: deliverable.from ?? null,
      staleSince: deliverable.staleSince,
      ...(deliverable.ravelmap ? { ravelmap: deliverable.ravelmap } : {})
    })),
    ...(hasProvenance ? {
      provenance: { version: provenanceMapVersion, aggregate: aggregateProvenanceName }
    } : {}),
    ...(builtAt ? { builtAt } : {}),
    result: "success"
  };
};

const formatTextManifest = (manifest, generatedAt = new Date().toISOString()) => {
  const lines = ["Ravel managed output manifest", "Generated: " + generatedAt, "", "Current files:"];
  for (const deliverable of manifest.deliverables) {
    lines.push("  " + deliverable.path + " (" + deliverable.from + ")");
    if (deliverable.ravelmap) lines.push("    provenance: " + deliverable.ravelmap);
  }
  if (manifest.provenance?.aggregate) {
    lines.push("  Aggregate provenance: " + manifest.provenance.aggregate);
  }
  if (manifest.stale.length) {
    lines.push("", "Stale files (retained):");
    const byDate = new Map();
    for (const deliverable of manifest.stale) {
      const date = deliverable.staleSince ?? "unknown time";
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(deliverable);
    }
    for (const [date, deliverables] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push("  Since " + date + ":");
      for (const deliverable of deliverables) {
        lines.push("    " + deliverable.path + " (" + (deliverable.from ?? "previous build") + ")");
        if (deliverable.ravelmap) lines.push("      provenance: " + deliverable.ravelmap);
      }
    }
  }
  return lines.join("\n") + "\n";
};

const writeManifestFiles = async (scope, manifest, generatedAt, description = "Build manifest path") => {
  const jsonDestination = safeDestination(scope.root, manifestName);
  const textDestination = safeDestination(scope.root, textManifestName);
  await writeFilesAtomically(scope, [
    { destination: jsonDestination, value: JSON.stringify(manifest, null, 2) + "\n" },
    { destination: textDestination, value: formatTextManifest(manifest, generatedAt) }
  ], description);
  return { path: jsonDestination, textPath: textDestination, manifest };
};

export const writeBuildManifest = async (program, outputDirectory, {
  rootDirectory = outputDirectory,
  generatedAt = new Date().toISOString()
} = {}) => {
  const scope = await createOutputScope(outputDirectory, rootDirectory);
  const manifest = createBuildManifest(program, scope.root, { builtAt: generatedAt });
  return writeManifestFiles(scope, manifest, generatedAt);
};

/** Commit every deliverable and its success manifest in one filesystem transaction. */
export const writeBuildArtifacts = async (program, outputDirectory, {
  rootDirectory = outputDirectory,
  stale = [],
  generatedAt = new Date().toISOString()
} = {}) => {
  const scope = await createOutputScope(outputDirectory, rootDirectory);
  const plan = planDeliverables(program, scope.root);
  const manifest = createBuildManifest(program, scope.root, { stale, builtAt: generatedAt });
  const deliverableEntries = plan.deliverables.map((deliverable) => ({
    destination: safeDestination(scope.root, deliverable.name),
    value: program.deliverables[deliverable.name].value
  }));
  const provenanceEntries = plan.deliverables
    .filter((deliverable) => deliverable.ravelmap)
    .map((deliverable) => ({
      destination: safeDestination(scope.root, deliverable.ravelmap),
      value: JSON.stringify(
        createDeliverableProvenanceMap(program.deliverables[deliverable.name]),
        null,
        2
      ) + "\n"
    }));
  const aggregateEntry = provenanceEntries.length ? [{
    destination: safeDestination(scope.root, aggregateProvenanceName),
    value: JSON.stringify(createBuildProvenanceMap(program), null, 2) + "\n"
  }] : [];
  const manifestDestination = safeDestination(scope.root, manifestName);
  const textManifestDestination = safeDestination(scope.root, textManifestName);
  await writeFilesAtomically(scope, [
    ...deliverableEntries,
    ...provenanceEntries,
    ...aggregateEntry,
    { destination: manifestDestination, value: JSON.stringify(manifest, null, 2) + "\n" },
    { destination: textManifestDestination, value: formatTextManifest(manifest, generatedAt) }
  ], "Build artifact path");
  return {
    written: deliverableEntries.map((entry) => entry.destination),
    provenance: {
      sidecars: provenanceEntries.map((entry) => entry.destination),
      aggregate: aggregateEntry[0]?.destination ?? null
    },
    manifest: { path: manifestDestination, textPath: textManifestDestination, manifest }
  };
};

const managedDeliverables = (manifest) => [...manifest.deliverables, ...(manifest.stale ?? [])]
  .filter((deliverable, index, entries) => entries.findIndex((entry) => entry.name === deliverable.name) === index);

const planManagedRemoval = async (outputDirectory, rootDirectory, staleOnly) => {
  const previous = await readManifest(outputDirectory, rootDirectory);
  if (!previous) return { outputDirectory: resolve(outputDirectory), manifest: null, deliverables: [] };
  const deliverables = (staleOnly ? previous.manifest.stale ?? [] : managedDeliverables(previous.manifest))
    .map((deliverable) => ({
      name: deliverable.name,
      path: portableRelative(resolve(outputDirectory), safeDestination(resolve(outputDirectory), deliverable.name)),
      from: deliverable.from ?? null,
      staleSince: deliverable.staleSince,
      ...(deliverable.ravelmap ? { ravelmap: deliverable.ravelmap } : {})
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    outputDirectory: resolve(outputDirectory),
    manifest: previous,
    deliverables,
    aggregate: staleOnly ? null : previous.manifest.provenance?.aggregate ?? null
  };
};

const removeManagedFiles = async (plan, rootDirectory, dryRun, removeManifest) => {
  if (!plan.manifest || dryRun) return { removed: plan.deliverables, manifestRemoved: false };
  const scope = await createOutputScope(plan.outputDirectory, rootDirectory);
  const targets = [
    ...plan.deliverables.flatMap((deliverable) => [
      safeDestination(scope.root, deliverable.name),
      ...(deliverable.ravelmap ? [safeDestination(scope.root, deliverable.ravelmap)] : [])
    ]),
    ...(plan.aggregate ? [safeDestination(scope.root, plan.aggregate)] : []),
    ...(removeManifest ? [safeDestination(scope.root, manifestName), safeDestination(scope.root, textManifestName)] : [])
  ];
  for (const target of targets) await existingFile(target, "Managed output path");
  for (const target of targets) await removeIfPresent(target);
  return { removed: plan.deliverables, manifestRemoved: removeManifest };
};

/** Remove all files named by a prior manifest, never arbitrary output files. */
export const cleanManagedArtifacts = async (outputDirectory, {
  rootDirectory = outputDirectory,
  dryRun = false
} = {}) => {
  const plan = await planManagedRemoval(outputDirectory, rootDirectory, false);
  return { ...(await removeManagedFiles(plan, rootDirectory, dryRun, true)), outputDirectory: plan.outputDirectory };
};

/** Remove only stale manifest entries and rewrite the manifest with none remaining. */
export const refreshStaleArtifacts = async (outputDirectory, {
  rootDirectory = outputDirectory,
  dryRun = false,
  generatedAt = new Date().toISOString()
} = {}) => {
  const plan = await planManagedRemoval(outputDirectory, rootDirectory, true);
  if (!plan.manifest || dryRun) return { removed: plan.deliverables, outputDirectory: plan.outputDirectory, dryRun };
  const result = await removeManagedFiles(plan, rootDirectory, false, false);
  const scope = await createOutputScope(plan.outputDirectory, rootDirectory);
  const manifest = { ...plan.manifest.manifest, version: 2, stale: [] };
  await writeManifestFiles(scope, manifest, generatedAt);
  return { ...result, outputDirectory: plan.outputDirectory, dryRun: false };
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (value) => {
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const zipDateTime = (date) => {
  const value = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2)
  };
};

const zipArchive = (files) => {
  if (files.length > 0xffff) throw new Error("Backup archive has too many files for ZIP: " + files.length);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const size = file.value.length;
    if (name.length > 0xffff || size > 0xffffffff || offset > 0xffffffff) {
      throw new Error("Backup archive contains a ZIP64-sized file: " + file.name);
    }
    const { date, time } = zipDateTime(file.mtime);
    const crc = crc32(file.value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, file.value);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(time, 12);
    directory.writeUInt16LE(date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(size, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + size;
  }
  const centralSize = central.reduce((size, value) => size + value.length, 0);
  if (offset + centralSize > 0xffffffff) throw new Error("Backup archive is too large for ZIP without ZIP64 support.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...central, end]);
};

const collectBackupFiles = async (root, directory = root) => {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("Backup output must not traverse a symbolic link: " + path);
    if (stat.isDirectory()) files.push(...await collectBackupFiles(root, path));
    else if (stat.isFile()) files.push({
      name: relative(root, path).split(sep).join("/"),
      value: await readFile(path),
      mtime: stat.mtime
    });
    else throw new Error("Backup output must contain only files and directories: " + path);
  }
  return files;
};

/** Describe a backup archive without writing it, including no-overwrite checks. */
export const planOutputBackup = async (outputDirectory, {
  outputRootDirectory = outputDirectory,
  backupRootDirectory = outputRootDirectory,
  backupPath
} = {}) => {
  const output = resolve(outputDirectory);
  const previous = await readManifest(output, outputRootDirectory);
  if (!previous) throw new Error("Cannot create a backup without an existing Ravel build manifest: " + output);
  const builtAt = previous.manifest.builtAt;
  const timestamp = Date.parse(builtAt);
  if (!Number.isFinite(timestamp)) throw new Error("Build manifest has no valid build timestamp for backup: " + previous.path);
  const backupRoot = resolve(backupRootDirectory);
  await assertDirectory(backupRoot, "Backup root");
  const path = backupPath === undefined
    ? join(backupRoot, "backups", basename(output) + "-" + Math.floor(timestamp / 1000) + ".zip")
    : await scopedPath(backupRoot, backupPath, "Backup path");
  if (extname(path).toLowerCase() !== ".zip") throw new Error("Backup file must have a .zip extension: " + path);
  if (!containedIn(backupRoot, path)) throw new Error("Backup path escapes the Ravel root: " + path);
  await assertNoSymlinks(backupRoot, path, "Backup path");
  if (await existingFile(path, "Backup file")) throw new Error("Backup file already exists: " + path);
  return { outputDirectory: output, path, manifest: previous, builtAt };
};

/** Archive the complete current output tree before it is cleaned or replaced. */
export const createOutputBackup = async (outputDirectory, options = {}) => {
  const plan = await planOutputBackup(outputDirectory, options);
  const backupRoot = resolve(options.backupRootDirectory ?? options.outputRootDirectory ?? outputDirectory);
  await ensureDirectoryTree(backupRoot, dirname(plan.path), "Backup path");
  if (await existingFile(plan.path, "Backup file")) throw new Error("Backup file already exists: " + plan.path);
  const files = await collectBackupFiles(plan.outputDirectory);
  const temporary = join(dirname(plan.path), "." + basename(plan.path) + ".ravel-stage-" + randomUUID());
  try {
    await writeFile(temporary, zipArchive(files));
    await rename(temporary, plan.path);
  } catch (error) {
    await removeIfPresent(temporary);
    throw error;
  }
  return { path: plan.path, files: files.map((file) => file.name), builtAt: plan.builtAt };
};

export const writeGraph = async (program, path, { rootDirectory = dirname(resolve(path)) } = {}) => {
  const scope = await createOutputScope(rootDirectory, rootDirectory);
  const destination = await scope.path(path, "Graph path");
  await ensureDirectoryTree(scope.root, dirname(destination), "Graph path");
  await assertNoSymlinks(scope.root, destination, "Graph path");
  await writeFile(destination, JSON.stringify(program, null, 2) + "\n", "utf8");
};
