import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { combineMaps } from "../../core/src/index.js";

const readMap = async (path) => JSON.parse(await readFile(path, "utf8"));

export const loadPretransformGraph = async (entryPath) => {
  const visited = new Set();
  const maps = [];

  const visit = async (path) => {
    const absolutePath = resolve(path);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    const map = await readMap(absolutePath);
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

  await visit(entryPath);
  return combineMaps(maps);
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

