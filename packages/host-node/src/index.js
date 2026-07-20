import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { combineMaps } from "../../core/src/index.js";
import { markdownToMap } from "../../markdown/src/index.js";

const readMap = async (path) => JSON.parse(await readFile(path, "utf8"));

const loadMarkdownFile = async (path, options = {}) => markdownToMap(
  await readFile(path, "utf8"),
  { uri: path, document: options.document, mode: options.mode }
);

const collectPretransformMaps = async (entryPath, entryOptions = {}) => {
  const visited = new Set();
  const maps = [];
  const diagnostics = [];

  const visit = async (path, options = {}) => {
    const absolutePath = resolve(path);
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
  return { maps, diagnostics };
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
  const config = parseToml(await readFile(absoluteConfig, "utf8"));
  if (config.version !== 1) throw new Error("Ravel TOML config version must be 1: " + absoluteConfig);
  if (!Array.isArray(config.files) || config.files.length === 0) {
    throw new Error("Ravel TOML config requires one or more [[files]] entries: " + absoluteConfig);
  }
  if (!config.build || typeof config.build !== "object") {
    throw new Error("Ravel TOML config requires a [build] table: " + absoluteConfig);
  }
  const outDirectory = requireString(config.build.out_dir, "build.out_dir");
  const baseDirectory = dirname(absoluteConfig);
  const results = await Promise.all(config.files.map(async (file, index) => {
    if (!file || typeof file !== "object") throw new Error("files[" + index + "] must be a table.");
    const path = requireString(file.path, "files[" + index + "].path");
    if (file.document !== undefined) requireString(file.document, "files[" + index + "].document");
    const mode = file.mode ?? "opt-in";
    return collectPretransformMaps(resolve(baseDirectory, path), { document: file.document, mode });
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
  return { pretransform, outputDirectory: resolve(baseDirectory, outDirectory) };
};

/** Load a JSON map, one Markdown document, or a single Ravel TOML build run. */
export const loadBuildInput = async (inputPath, options = {}) => {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".toml") return loadTomlBuild(inputPath);
  if (extension === ".md" || extension === ".markdown" || extension === ".mdown") {
    return {
      pretransform: await loadPretransformGraph(resolve(inputPath), options),
      outputDirectory: undefined
    };
  }
  if (extension === ".json") {
    return { pretransform: await loadPretransformGraph(inputPath), outputDirectory: undefined };
  }
  throw new Error("Ravel input must be a .json map, Markdown document, or .toml build config: " + inputPath);
};

const safeDestination = (outputDirectory, name) => {
  if (isAbsolute(name)) throw new Error("Deliverable name must be relative: " + name);
  const root = resolve(outputDirectory);
  const destination = resolve(root, name);
  if (relative(root, destination).startsWith("..")) {
    throw new Error("Deliverable escapes output directory: " + name);
  }
  return destination;
};

export const writeDeliverables = async (program, outputDirectory) => {
  const written = [];
  for (const deliverable of Object.values(program.deliverables)) {
    const destination = safeDestination(outputDirectory, deliverable.name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, deliverable.value, "utf8");
    written.push(destination);
  }
  return written;
};

export const writeGraph = async (program, path) => {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, JSON.stringify(program, null, 2) + "\n", "utf8");
};
