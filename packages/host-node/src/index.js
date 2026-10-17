import { lstat, readFile, readdir, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  combineMaps,
  createBuildProvenanceMap,
  createDeliverableProvenanceMap,
  provenanceMapVersion
} from "@pieceful/ravel-core";
import { asciidocToMap } from "@pieceful/ravel-asciidoc";
import { htmlToMap } from "@pieceful/ravel-html";
import { markdownToMap, parseFrontMatter } from "@pieceful/ravel-markdown";
import { isLitproMarkdown, litproMarkdownToMap } from "@pieceful/ravel-markdown-litpro";
import { assertRavelMap } from "@pieceful/ravel-map";
import { mystToMap } from "@pieceful/ravel-myst";
import { nowebToMap } from "@pieceful/ravel-noweb";
import { orgToMap } from "@pieceful/ravel-org";
import { builtinTransforms } from "@pieceful/ravel-transforms";
import { pathToFileURL } from "node:url";

const missing = (error) => error?.code === "ENOENT";
const componentPattern = /^[a-z][a-z0-9-]*$/;

const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The Ravel input operation was cancelled.", "AbortError");
};

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

const overlayText = (overlays, path) => {
  if (!overlays) return undefined;
  const key = resolve(path);
  const entry = overlays instanceof Map ? overlays.get(key) : overlays[key];
  if (typeof entry === "string") return entry;
  return typeof entry?.text === "string" ? entry.text : undefined;
};

const overlaysWithText = (overlays, path, text) => {
  const captured = overlays instanceof Map
    ? new Map(overlays)
    : new Map(Object.entries(overlays ?? {}).map(([key, value]) => [resolve(key), value]));
  captured.set(resolve(path), { text });
  return captured;
};

const readInputText = async (path, description, code, overlays) => {
  const overlay = overlayText(overlays, path);
  if (overlay !== undefined) return overlay;
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

const readMap = async (path, overlays) => {
  const text = await readInputText(path, "Ravel Map", "RM201", overlays);
  let map;
  try {
    map = JSON.parse(text);
  } catch (error) {
    throw inputError("RM201", "Invalid JSON Ravel Map: " + (error?.message ?? String(error)), path);
  }
  return assertRavelMap(map, { uri: path });
};

const loadMarkdownFile = async (path, options = {}, overlays) => {
  const text = await readInputText(path, "Markdown input", "RM201", overlays);
  if (options.adapter === "markdown-litpro" || options.profile === "litpro" ||
      (options.adapter === undefined && options.profile === undefined && isLitproMarkdown(text))) {
    return litproMarkdownToMap(text, {
      uri: path,
      document: options.document,
      dialect: options.dialect,
      headings: options.headings
    });
  }
  return markdownToMap(text, {
    uri: path,
    document: options.document,
    mode: options.mode,
    profile: options.profile
  });
};

const loadNowebFile = async (path, options = {}, overlays) => {
  const text = await readInputText(path, "noweb input", "RM201", overlays);
  return nowebToMap(text, {
    uri: path,
    document: options.document,
    dialect: options.dialect,
    references: options.references,
    language: options.language,
    run: options.run,
    provider: options.provider
  });
};

const loadOrgFile = async (path, options = {}, overlays) => {
  const text = await readInputText(path, "Org input", "RM201", overlays);
  return orgToMap(text, {
    uri: path,
    document: options.document,
    references: options.references,
    nowebPipes: options.nowebPipes,
    executionOwner: options.executionOwner,
    run: options.run,
    provider: options.provider
  });
};

const loadMystFile = async (path, options = {}, overlays) => {
  const text = await readInputText(path, "MyST input", "RM201", overlays);
  return mystToMap(text, {
    uri: path,
    document: options.document,
    executionOwner: options.executionOwner,
    run: options.run,
    provider: options.provider
  });
};

const loadAsciiDocFile = async (path, options = {}, overlays) => {
  const text = await readInputText(path, "AsciiDoc input", "RM201", overlays);
  return asciidocToMap(text, {
    uri: path,
    document: options.document,
    run: options.run,
    provider: options.provider
  });
};

const loadHtmlFile = async (path, options = {}, overlays) => {
  const text = await readInputText(path, "HTML input", "RM201", overlays);
  return htmlToMap(text, {
    uri: path,
    document: options.document,
    run: options.run,
    provider: options.provider
  });
};

const collectPretransformMaps = async (
  entryPath,
  entryOptions = {},
  scope,
  overlays = entryOptions.overlays
) => {
  const signal = entryOptions.signal;
  throwIfAborted(signal);
  const activeScope = scope ?? await createInputScope(dirname(resolve(entryPath)));
  const visited = new Set();
  const maps = [];
  const mapPaths = [];
  const diagnostics = [];
  const authoredSourcePaths = new Set();
  const authoredSourceTexts = new Map();
  let containsJsonMaps = false;

  const visit = async (path, options = {}) => {
    throwIfAborted(signal);
    const absolutePath = await activeScope.path(path, "Ravel input");
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    const extension = extname(absolutePath).toLowerCase();
    let map;
    let sourceOverlays = overlays;
    let sourceText;
    const mystExtension = absolutePath.toLowerCase().endsWith(".myst.md");
    if (extension === ".json") {
      containsJsonMaps = true;
      map = await readMap(absolutePath, overlays);
    } else if (mystExtension || options.adapter === "myst") {
      authoredSourcePaths.add(absolutePath);
      sourceText = await readInputText(absolutePath, "MyST input", "RM201", overlays);
      sourceOverlays = overlaysWithText(overlays, absolutePath, sourceText);
      const result = await loadMystFile(absolutePath, options, sourceOverlays);
      map = result.map;
      diagnostics.push(...result.diagnostics);
      assertRavelMap(map, { uri: absolutePath });
    } else if (extension === ".adoc" || extension === ".asciidoc" ||
        options.adapter === "asciidoc") {
      authoredSourcePaths.add(absolutePath);
      sourceText = await readInputText(absolutePath, "AsciiDoc input", "RM201", overlays);
      sourceOverlays = overlaysWithText(overlays, absolutePath, sourceText);
      const result = await loadAsciiDocFile(absolutePath, options, sourceOverlays);
      map = result.map;
      diagnostics.push(...result.diagnostics);
      assertRavelMap(map, { uri: absolutePath });
    } else if (extension === ".html" || extension === ".htm" ||
        options.adapter === "html") {
      authoredSourcePaths.add(absolutePath);
      sourceText = await readInputText(absolutePath, "HTML input", "RM201", overlays);
      sourceOverlays = overlaysWithText(overlays, absolutePath, sourceText);
      const result = await loadHtmlFile(absolutePath, options, sourceOverlays);
      map = result.map;
      diagnostics.push(...result.diagnostics);
      assertRavelMap(map, { uri: absolutePath });
    } else if (extension === ".org" || options.adapter === "org") {
      authoredSourcePaths.add(absolutePath);
      sourceText = await readInputText(absolutePath, "Org input", "RM201", overlays);
      sourceOverlays = overlaysWithText(overlays, absolutePath, sourceText);
      const result = await loadOrgFile(absolutePath, options, sourceOverlays);
      map = result.map;
      diagnostics.push(...result.diagnostics);
      assertRavelMap(map, { uri: absolutePath });
    } else if (extension === ".nw" || extension === ".noweb" || options.adapter === "noweb") {
      authoredSourcePaths.add(absolutePath);
      sourceText = await readInputText(absolutePath, "noweb input", "RM201", overlays);
      sourceOverlays = overlaysWithText(overlays, absolutePath, sourceText);
      const result = await loadNowebFile(absolutePath, options, sourceOverlays);
      map = result.map;
      diagnostics.push(...result.diagnostics);
      assertRavelMap(map, { uri: absolutePath });
    } else if (extension === ".md" || extension === ".markdown" || extension === ".mdown" || extension === ".qmd") {
      authoredSourcePaths.add(absolutePath);
      sourceText = await readInputText(absolutePath, "Markdown input", "RM201", overlays);
      sourceOverlays = overlaysWithText(overlays, absolutePath, sourceText);
      const result = await loadMarkdownFile(absolutePath, {
        ...options,
        profile: options.profile ?? (extension === ".qmd" ? "modern" : undefined)
      }, sourceOverlays);
      map = result.map;
      diagnostics.push(...result.diagnostics);
      assertRavelMap(map, { uri: absolutePath });
    } else {
      throw inputError("RH101", "Ravel input must be a .json map or supported markup source.", absolutePath);
    }
    if (sourceText !== undefined) authoredSourceTexts.set(absolutePath, sourceText);
    throwIfAborted(signal);
    for (const directive of map.directives ?? []) {
      if (directive.kind !== "in") continue;
      const target = directive.target ?? directive.name;
      if (typeof target !== "string" || !target) {
        throw inputError("RH102", "in directive requires a target path.", directive.source?.uri ?? absolutePath);
      }
      const adapter = directive.metadata?.adapter;
      const alias = directive.metadata?.legacy?.alias;
      await visit(resolve(dirname(absolutePath), target), {
        ...(adapter ? { adapter } : {}),
        ...(directive.metadata?.dialect ? { dialect: directive.metadata.dialect } : {}),
        ...(typeof alias === "string" && alias ? { document: alias } : {})
      });
    }
    maps.push(map);
    mapPaths.push(absolutePath);
  };

  await visit(entryPath, entryOptions);
  throwIfAborted(signal);
  return {
    maps,
    mapPaths,
    diagnostics,
    rootDirectory: activeScope.root,
    authoredSourcePaths: [...authoredSourcePaths].sort(),
    authoredSourceTexts,
    loadedInputPaths: [...visited].sort(),
    containsJsonMaps
  };
};

const graphFromCollectedMaps = (collected) => {
  const graph = combineMaps(collected.maps);
  graph.diagnostics.push(...collected.diagnostics);
  return relativizeSourceUris(graph, collected.rootDirectory);
};

const authoredSourceUris = (collected) => collected.authoredSourcePaths
  .map((path) => relative(collected.rootDirectory, path).split(sep).join("/"))
  .sort();

const loadedInputUris = (collected) => collected.loadedInputPaths
  .map((path) => relative(collected.rootDirectory, path).split(sep).join("/"))
  .sort();

const authoredSourceTexts = (collected) => Object.fromEntries(
  [...collected.authoredSourceTexts.entries()]
    .map(([path, text]) => [
      relative(collected.rootDirectory, path).split(sep).join("/"),
      text
    ])
    .sort(([left], [right]) => left.localeCompare(right))
);

export const loadPretransformGraph = async (entryPath, options = {}) => {
  throwIfAborted(options.signal);
  const collected = await collectPretransformMaps(
    resolve(entryPath),
    options,
    undefined,
    options.overlays
  );
  throwIfAborted(options.signal);
  return graphFromCollectedMaps(collected);
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

// Names core evaluates itself; a project transform cannot replace them.
const coreTransformNames = new Set([
  "concat", "trim", "normalize-eol", "indent", "dedent", "replace", "quote-reference",
  "jsontext", "emit", "text", "ch", "delay"
]);

/**
 * Load `[[transforms]]` entries: project-local ES modules whose export is a
 * `(value, context) => string` function. These run as ordinary Node code with
 * the host's privileges, so they are configured only in the TOML file, never by
 * a document. Ravel's built-in transforms are always available and a project
 * module may replace one of them (for example to use another Markdown engine).
 */
const loadProjectTransforms = async (entries, scope, absoluteConfig) => {
  const transforms = { ...builtinTransforms };
  if (entries === undefined) return transforms;
  if (!Array.isArray(entries)) throw inputError("RC102", "transforms must contain [[transforms]] entries.", absoluteConfig);
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const path = "transforms[" + index + "]";
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw inputError("RC102", path + " must be a table.", absoluteConfig);
    reportUnknownKeys(entry, new Set(["name", "module", "export"]), path, absoluteConfig);
    const name = requireConfigString(entry.name, path + ".name", absoluteConfig);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw inputError("RC102", path + ".name must be a lowercase transform name such as \"markdown-it\".", absoluteConfig);
    if (coreTransformNames.has(name)) throw inputError("RC102", path + ".name " + JSON.stringify(name) + " is a core command and cannot be replaced.", absoluteConfig);
    if (seen.has(name)) throw inputError("RC102", path + ".name " + JSON.stringify(name) + " is defined more than once.", absoluteConfig);
    seen.add(name);
    const modulePath = await scope.path(requireConfigString(entry.module, path + ".module", absoluteConfig), path + ".module");
    const exportName = entry.export === undefined ? "default" : requireConfigString(entry.export, path + ".export", absoluteConfig);
    let namespace;
    try {
      // The content hash keeps a long-lived host (an editor) from reusing a
      // stale module after the file changes.
      const url = pathToFileURL(modulePath);
      url.search = "ravel=" + contentHash(await readFile(modulePath, "utf8")).slice(0, 16);
      namespace = await import(url.href);
    } catch (error) {
      throw inputError("RC103", path + " could not load " + modulePath + ": " + (error?.message ?? String(error)), absoluteConfig);
    }
    const transform = namespace[exportName];
    if (typeof transform !== "function") {
      throw inputError("RC103", path + " module " + modulePath + " has no function export " + JSON.stringify(exportName) + ".", absoluteConfig);
    }
    transforms[name] = transform;
  }
  return transforms;
};

const escapeRegExp = (value) => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** Translate a `/`-separated glob (`*`, `**`, `?`) into an anchored RegExp. */
const globPattern = (glob) => {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      pattern += slash ? "(?:[^/]+/)*" : ".*";
      index += slash ? 2 : 1;
    } else if (character === "*") pattern += "[^/]*";
    else if (character === "?") pattern += "[^/]";
    else pattern += escapeRegExp(character);
  }
  return new RegExp("^" + pattern + "$");
};

/**
 * List files under `root` matching `glob`, in a deterministic code-point
 * order. Dot-files and dot-directories are skipped; a symbolic link anywhere
 * in the walk is an error, as everywhere else in the Node host.
 */
const globFiles = async (root, glob, description) => {
  if (isAbsolute(glob) || glob.split("/").includes("..")) {
    throw new Error(description + " must be a relative glob inside the Ravel root: " + glob);
  }
  const segments = glob.split("/");
  const firstWild = segments.findIndex((segment) => /[*?]/.test(segment));
  const base = firstWild === -1 ? segments.slice(0, -1) : segments.slice(0, firstWild);
  const start = join(root, ...base);
  const matcher = globPattern(glob);
  const matches = [];
  const walk = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(description + " must not traverse a symbolic link: " + path);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && matcher.test(portableRelative(root, path))) matches.push(path);
    }
  };
  await assertNoSymlinks(root, start, description);
  await walk(start);
  return matches.sort((left, right) => {
    const a = portableRelative(root, left);
    const b = portableRelative(root, right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
};

const positionAt = (text, offset) => {
  let line = 0;
  let lineStart = 0;
  for (let index = text.indexOf("\n"); index !== -1 && index < offset; index = text.indexOf("\n", index + 1)) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart, offset };
};

const slugify = (value) => String(value).toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const fillPattern = (pattern, values, description, configPath) => pattern.replace(/\{([a-z][a-z0-9_-]*)\}/gi, (match, key) => {
  const value = values[key];
  if (value === undefined || value === null || typeof value === "object") {
    throw inputError("RC104", description + " uses {" + key + "}, which is not a text value for this item.", configPath);
  }
  return String(value);
});

/**
 * Expand `[[collections]]`: every file matching `glob` becomes an item
 * document with a `body` chunk (the text after any front matter, mapped to its
 * exact source range), a `data.json` chunk (front matter plus slug, name, path,
 * and output), and a `page` chunk that pipes the body through `pipe` and, when
 * `layout` names a chunk, fills that layout with `template`. Each item gets one
 * `out` directive from the `out` pattern. A `<name>::index.json` chunk lists
 * every item's data, in order, for index pages.
 */
const loadCollections = async (entries, scope, absoluteConfig, overlays) => {
  const empty = { maps: [], inputPaths: [], texts: new Map() };
  if (entries === undefined) return empty;
  if (!Array.isArray(entries)) throw inputError("RC102", "collections must contain [[collections]] entries.", absoluteConfig);
  const maps = [];
  const inputPaths = [];
  const texts = new Map();
  const names = new Set();
  const configUri = portableRelative(scope.root, absoluteConfig);
  for (const [index, entry] of entries.entries()) {
    const path = "collections[" + index + "]";
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw inputError("RC102", path + " must be a table.", absoluteConfig);
    reportUnknownKeys(entry, new Set(["name", "glob", "out", "layout", "pipe", "references"]), path, absoluteConfig);
    const name = requireConfigString(entry.name, path + ".name", absoluteConfig);
    if (!componentPattern.test(name)) throw inputError("RC102", path + ".name must be a lowercase identifier such as \"pages\".", absoluteConfig);
    if (names.has(name)) throw inputError("RC102", path + ".name " + JSON.stringify(name) + " is used by more than one collection.", absoluteConfig);
    names.add(name);
    const glob = requireConfigString(entry.glob, path + ".glob", absoluteConfig);
    const outPattern = requireConfigString(entry.out, path + ".out", absoluteConfig);
    const layout = entry.layout === undefined ? null : requireConfigString(entry.layout, path + ".layout", absoluteConfig);
    const pipe = entry.pipe === undefined ? "markdown" : entry.pipe;
    if (typeof pipe !== "string") throw inputError("RC102", path + ".pipe must be a pipeline string such as \"markdown\" or \"\".", absoluteConfig);
    if (entry.references !== undefined && typeof entry.references !== "boolean") {
      throw inputError("RC102", path + ".references must be true or false.", absoluteConfig);
    }
    for (const [field, value] of [["layout", layout ?? ""], ["pipe", pipe]]) {
      if (value.includes("`")) throw inputError("RC102", path + "." + field + " must not contain a backtick.", absoluteConfig);
    }
    let files;
    try {
      files = await globFiles(scope.root, glob, path + ".glob");
    } catch (error) {
      throw inputError("RC104", error.message, absoluteConfig);
    }
    const items = [];
    const slugs = new Map();
    for (const file of files) {
      const uri = portableRelative(scope.root, file);
      const text = await readInputText(file, "collection item", "RC101", overlays);
      let front;
      try {
        front = parseFrontMatter(text);
      } catch (error) {
        throw inputError("RC104", "Invalid front matter in " + uri + ": " + (error?.message ?? String(error)), file);
      }
      const data = front.data ?? {};
      if (typeof data !== "object" || Array.isArray(data)) throw inputError("RC104", "Front matter in " + uri + " must be a mapping.", file);
      const stem = basename(uri, extname(uri));
      const slug = slugify(typeof data.slug === "string" ? data.slug : stem);
      if (!slug) throw inputError("RC104", "Could not derive a slug for " + uri + "; add a `slug` to its front matter.", file);
      if (slugs.has(slug)) throw inputError("RC104", uri + " and " + slugs.get(slug) + " both produce the slug " + JSON.stringify(slug) + " in collection " + name + ".", file);
      slugs.set(slug, uri);
      const dir = dirname(uri) === "." ? "" : dirname(uri);
      const values = { ...data, slug, name: stem, dir, path: uri.slice(0, uri.length - extname(uri).length) };
      const output = fillPattern(outPattern, values, path + ".out", absoluteConfig);
      items.push({ file, uri, text, front, data: { ...data, slug, name: stem, dir, path: uri, out: output, collection: name }, output });
    }
    const sourceAt = (uri, text, start, end) => ({ uri, range: { start: positionAt(text, start), end: positionAt(text, end) } });
    const literalSyntax = (enabled) => ({ data: { ravel: { referenceSyntax: { underscore: enabled } } } });
    for (const item of items) {
      const document = name + "-" + item.data.slug;
      if (!componentPattern.test(document)) throw inputError("RC104", "Collection item " + item.uri + " produces the invalid document id " + document + ".", item.file);
      const chunk = (chunkName, type, body, source, metadata) => ({
        id: document + "::" + chunkName + (type ? "." + type : ""),
        identity: { document, chunk: chunkName, minor: null, type },
        name: chunkName,
        body,
        definitionPipeline: [],
        metadata,
        source
      });
      const bodySource = sourceAt(item.uri, item.text, item.front.bodyStart, item.text.length);
      const frontSource = sourceAt(item.uri, item.text, 0, item.front.end);
      const content = "ch('" + document + "::body" + (pipe.trim() ? " | " + pipe.trim() : "") + "')";
      const page = layout
        ? "_`" + layout + " | template(ch('" + document + "::data.json'), 'content', " + content + ")`"
        : "_`" + document + "::body" + (pipe.trim() ? " | " + pipe.trim() : "") + "`";
      maps.push({
        version: 1,
        document: { id: document, uri: item.uri, format: "ravel-collection-item-v1" },
        chunks: [
          chunk("body", null, item.text.slice(item.front.bodyStart), bodySource, { language: "markdown", tags: ["collection"], ...literalSyntax(entry.references === true) }),
          chunk("data", "json", JSON.stringify(item.data, null, 2) + "\n", frontSource, { language: "json", tags: ["collection"], ...literalSyntax(false) })
        ],
        directives: [
          { kind: "create", document, name: "page", body: page, source: configSource(absoluteConfig) },
          { kind: "out", name: item.output, from: document + "::page", source: configSource(absoluteConfig) }
        ]
      });
      inputPaths.push(item.file);
      texts.set(item.file, item.text);
    }
    maps.push({
      version: 1,
      document: { id: name, uri: configUri, format: "ravel-collection-index-v1" },
      chunks: [{
        id: name + "::index.json",
        identity: { document: name, chunk: "index", minor: null, type: "json" },
        name: "index",
        body: JSON.stringify(items.map((item) => item.data), null, 2) + "\n",
        definitionPipeline: [],
        metadata: { language: "json", tags: ["collection"], ...literalSyntax(false) },
        source: configSource(absoluteConfig)
      }],
      directives: []
    });
  }
  return { maps, inputPaths, texts };
};

const loadLiveConfiguration = async (
  live,
  scope,
  configPath,
  overlays,
  { readResources = true } = {}
) => {
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
  const resourceResults = await Promise.all((live.resources ?? []).map(async (entry, index) => {
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
    const declaration = { name, path, source: configSource(configPath) };
    if (!readResources) return { declaration };
    return {
      declaration,
      entry: [name, await readInputText(
        absolutePath,
        "live resource",
        "RC103",
        overlays
      )]
    };
  }));

  return {
    modules,
    resources: Object.fromEntries(resourceResults.flatMap((result) =>
      result.entry ? [result.entry] : []
    )),
    resourceDeclarations: resourceResults.map(({ declaration }) => declaration)
  };
};

export const loadTomlBuild = async (configPath, options = {}) => {
  throwIfAborted(options.signal);
  const absoluteConfig = resolve(configPath);
  const scope = await createInputScope(dirname(absoluteConfig));
  const configFile = await scope.path(absoluteConfig, "Ravel TOML config");
  let config;
  try {
    config = parseToml(await readInputText(
      configFile,
      "Ravel TOML config",
      "RC101",
      options.overlays
    ));
    throwIfAborted(options.signal);
  } catch (error) {
    if (Array.isArray(error?.diagnostics)) throw error;
    throw inputError("RC101", "Invalid Ravel TOML config: " + (error?.message ?? String(error)), absoluteConfig);
  }
  reportUnknownKeys(config, new Set(["version", "files", "collections", "build", "outputs", "live", "transforms"]), "config", absoluteConfig);
  if (config.version !== 1) throw inputError("RC102", "version must be 1.", absoluteConfig);
  if (config.files !== undefined && !Array.isArray(config.files)) {
    throw inputError("RC102", "files must contain [[files]] entries.", absoluteConfig);
  }
  if (!config.files?.length && !config.collections?.length) {
    throw inputError("RC102", "files must contain one or more [[files]] entries, or the config must define [[collections]].", absoluteConfig);
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
  const live = await loadLiveConfiguration(
    config.live,
    scope,
    absoluteConfig,
    options.overlays,
    { readResources: options.readLiveResources !== false }
  );
  const results = await Promise.all((config.files ?? []).map(async (file, index) => {
    if (!file || typeof file !== "object") throw inputError("RC102", "files[" + index + "] must be a table.", absoluteConfig);
    reportUnknownKeys(file, new Set([
      "path", "document", "mode", "profile", "adapter", "dialect",
      "references", "language", "noweb_pipes", "execution_owner", "run", "provider"
    ]), "files[" + index + "]", absoluteConfig);
    const path = requireConfigString(file.path, "files[" + index + "].path", absoluteConfig);
    if (file.document !== undefined) requireConfigString(file.document, "files[" + index + "].document", absoluteConfig);
    const mode = file.mode ?? "opt-in";
    if (!["opt-in", "primary"].includes(mode)) throw inputError("RC102", "files[" + index + "].mode must be opt-in or primary.", absoluteConfig);
    const profile = file.profile;
    if (profile !== undefined && !["fences", "modern", "litpro"].includes(profile)) {
      throw inputError("RC102", "files[" + index + "].profile must be fences, modern, or litpro.", absoluteConfig);
    }
    const adapter = file.adapter;
    if (adapter !== undefined && !["asciidoc", "html", "markdown", "markdown-litpro", "myst", "noweb", "org"].includes(adapter)) {
      throw inputError("RC102", "files[" + index + "].adapter must be asciidoc, html, markdown, markdown-litpro, myst, noweb, or org.", absoluteConfig);
    }
    const dialect = file.dialect;
    const supportedDialects = adapter === "noweb"
      ? ["noweb", "noweb-plus"]
      : adapter === "asciidoc" || adapter === "html" ||
          adapter === "org" || adapter === "myst"
        ? []
        : ["litpro-2017", "pieceful-2020", "litpro-plus"];
    if (dialect !== undefined && !supportedDialects.includes(dialect)) {
      throw inputError("RC102", "files[" + index + "].dialect is not supported by its adapter.", absoluteConfig);
    }
    const references = file.references;
    const supportedReferences = adapter === "org"
      ? ["org-noweb", "underscore-quote", "both"]
      : ["noweb", "underscore-quote", "both"];
    if (references !== undefined && !supportedReferences.includes(references)) {
      throw inputError("RC102", "files[" + index + "].references is not supported by its adapter.", absoluteConfig);
    }
    if (file.language !== undefined) requireConfigString(file.language, "files[" + index + "].language", absoluteConfig);
    if (file.noweb_pipes !== undefined && typeof file.noweb_pipes !== "boolean") {
      throw inputError("RC102", "files[" + index + "].noweb_pipes must be true or false.", absoluteConfig);
    }
    const executionOwner = file.execution_owner;
    const supportedExecutionOwners = adapter === "myst"
      ? ["myst", "ravel"]
      : ["org", "ravel"];
    if (executionOwner !== undefined && !supportedExecutionOwners.includes(executionOwner)) {
      throw inputError(
        "RC102",
        "files[" + index + "].execution_owner is not supported by its adapter.",
        absoluteConfig
      );
    }
    if (file.run !== undefined && typeof file.run !== "boolean") {
      throw inputError("RC102", "files[" + index + "].run must be true or false.", absoluteConfig);
    }
    if (file.provider !== undefined) requireConfigString(file.provider, "files[" + index + "].provider", absoluteConfig);
    if (file.language !== undefined && adapter !== "noweb") {
      throw inputError("RC102", "files[" + index + "].language currently requires adapter = \"noweb\".", absoluteConfig);
    }
    if (file.noweb_pipes !== undefined && adapter !== "org") {
      throw inputError("RC102", "noweb_pipes requires adapter = \"org\".", absoluteConfig);
    }
    if (executionOwner !== undefined && !["org", "myst"].includes(adapter)) {
      throw inputError("RC102", "execution_owner requires adapter = \"org\" or \"myst\".", absoluteConfig);
    }
    if (references !== undefined && !["noweb", "org"].includes(adapter)) {
      throw inputError("RC102", "references requires adapter = \"noweb\" or \"org\".", absoluteConfig);
    }
    if ((file.run !== undefined || file.provider !== undefined) &&
        !["asciidoc", "html", "noweb", "org", "myst"].includes(adapter)) {
      throw inputError("RC102", "run and provider settings require adapter = \"asciidoc\", \"html\", \"noweb\", \"org\", or \"myst\".", absoluteConfig);
    }
    return collectPretransformMaps(resolve(baseDirectory, path), {
      document: file.document,
      mode,
      profile,
      adapter,
      dialect,
      references,
      language: file.language,
      nowebPipes: file.noweb_pipes,
      executionOwner,
      run: file.run,
      provider: file.provider,
      signal: options.signal
    }, scope, options.overlays);
  }));
  throwIfAborted(options.signal);
  // Several [[files]] may import the same document; load it once, keeping the
  // first occurrence in configuration order.
  const seenMapPaths = new Set();
  const collections = await loadCollections(config.collections, scope, absoluteConfig, options.overlays);
  const pretransform = combineMaps([...results.flatMap((result) => result.maps.filter((_, index) => {
    const path = result.mapPaths[index];
    if (seenMapPaths.has(path)) return false;
    seenMapPaths.add(path);
    return true;
  })), ...collections.maps]);
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
    authoredSourceUris: [...new Set([
      ...results.flatMap(authoredSourceUris),
      ...collections.inputPaths.map((path) => portableRelative(scope.root, path))
    ])].sort(),
    authoredSourceTexts: Object.assign({}, ...results.map(authoredSourceTexts), Object.fromEntries(
      [...collections.texts.entries()].map(([path, text]) => [portableRelative(scope.root, path), text])
    )),
    loadedInputUris: [...new Set([
      relative(scope.root, absoluteConfig).split(sep).join("/"),
      ...results.flatMap(loadedInputUris),
      ...collections.inputPaths.map((path) => portableRelative(scope.root, path))
    ])].sort(),
    sourceEditsAllowed: results.every((result) => !result.containsJsonMaps),
    ...(outDirectory === undefined ? {} : { outputDirectory: await scope.path(outDirectory, "build.out_dir") }),
    rootDirectory: scope.root,
    buildOptions: {
      clean: build.clean === true,
      backup: build.backup ?? false
    },
    transforms: await loadProjectTransforms(config.transforms, scope, absoluteConfig),
    ...(live ? { live } : {})
  };
};

/** Load a JSON map, one markup source document, or a Ravel TOML build run. */
export const loadBuildInput = async (inputPath, options = {}) => {
  throwIfAborted(options.signal);
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".toml") return loadTomlBuild(inputPath, options);
  if (extension === ".md" || extension === ".markdown" || extension === ".mdown" || extension === ".qmd" ||
      extension === ".nw" || extension === ".noweb" || extension === ".org" ||
      extension === ".adoc" || extension === ".asciidoc" ||
      extension === ".html" || extension === ".htm" || extension === ".json") {
    const collected = await collectPretransformMaps(
      resolve(inputPath),
      options,
      undefined,
      options.overlays
    );
    throwIfAborted(options.signal);
    return {
      pretransform: graphFromCollectedMaps(collected),
      outputDirectory: undefined,
      rootDirectory: collected.rootDirectory,
      authoredSourceUris: authoredSourceUris(collected),
      authoredSourceTexts: authoredSourceTexts(collected),
      loadedInputUris: loadedInputUris(collected),
      sourceEditsAllowed: !collected.containsJsonMaps,
      transforms: { ...builtinTransforms }
    };
  }
  throw inputError("RH101", "Ravel input must be a .json map, supported markup document, or .toml build config.", inputPath);
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
  // Compare case-insensitively so a plan is portable to macOS and Windows,
  // where `README.md` and `readme.md` name the same file.
  const destinations = new Set([manifestName, textManifestName].map((name) => safeDestination(root, name).toLowerCase()));
  const claim = (destination, message) => {
    const key = destination.toLowerCase();
    if (destinations.has(key)) throw new Error(message);
    destinations.add(key);
  };
  const deliverables = orderedDeliverables(program).map((deliverable) => {
    const destination = safeDestination(root, deliverable.name);
    claim(destination, "Deliverable collides with another output or Ravel's manifest (names are compared case-insensitively): " + deliverable.name);
    const hasProvenance = Array.isArray(deliverable.segments);
    const ravelmap = hasProvenance ? sidecarName(deliverable.name) : null;
    if (ravelmap) {
      claim(safeDestination(root, ravelmap), "A deliverable provenance map collides with another output: " + ravelmap);
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
    claim(safeDestination(root, aggregateProvenanceName), "The aggregate provenance map collides with another output: " + aggregateProvenanceName);
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
      // Record the entry before writing so a failed write still removes its temporary file.
      staged.push({ ...entry, exists, temporary, backup, committed: false, backedUp: false });
      await writeFile(temporary, entry.value, "utf8");
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
    // Restore every entry even if one restoration fails, then report the
    // original failure with any rollback problems attached.
    const rollbackErrors = [];
    for (const entry of staged.slice().reverse()) {
      for (const step of [
        () => entry.committed && removeIfPresent(entry.destination),
        () => entry.backedUp && rename(entry.backup, entry.destination),
        () => removeIfPresent(entry.temporary)
      ]) {
        try {
          await step();
        } catch (rollbackError) {
          if (!missing(rollbackError)) rollbackErrors.push(rollbackError);
        }
      }
    }
    if (rollbackErrors.length) {
      error.message += " (rollback incomplete: " + rollbackErrors.map((entry) => entry.message).join("; ") + ")";
      error.rollbackErrors = rollbackErrors;
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
  clean = false,
  generatedAt = new Date().toISOString()
} = {}) => {
  const scope = await createOutputScope(outputDirectory, rootDirectory);
  const plan = planDeliverables(program, scope.root);
  // With `clean`, previously managed files are removed only after the new
  // build has committed, so a failed write keeps the last good output.
  const previous = clean ? await readManifest(scope.root, rootDirectory) : null;
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
  // Remove previously managed deliverables (and their sidecars) that this
  // build no longer produces; files it rewrote were already replaced.
  const active = new Set(plan.deliverables.map((deliverable) => deliverable.name));
  const supersededDeliverables = previous
    ? managedDeliverables(previous.manifest).filter((deliverable) => !active.has(deliverable.name))
    : [];
  const superseded = supersededDeliverables.flatMap((deliverable) => [
    safeDestination(scope.root, deliverable.name),
    ...(deliverable.ravelmap ? [safeDestination(scope.root, deliverable.ravelmap)] : [])
  ]);
  if (previous?.manifest.provenance?.aggregate && !aggregateEntry.length) {
    superseded.push(safeDestination(scope.root, previous.manifest.provenance.aggregate));
  }
  await removeManagedTargets(scope, superseded);
  return {
    written: deliverableEntries.map((entry) => entry.destination),
    removed: supersededDeliverables.map((deliverable) => ({
      name: deliverable.name,
      path: portableRelative(scope.root, safeDestination(scope.root, deliverable.name)),
      from: deliverable.from ?? null
    })).sort((left, right) => left.name.localeCompare(right.name)),
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

/** Delete managed files only after every path component passes the symlink policy. */
const removeManagedTargets = async (scope, targets) => {
  for (const target of targets) {
    await assertNoSymlinks(scope.root, target, "Managed output path");
    await existingFile(target, "Managed output path");
  }
  for (const target of targets) await removeIfPresent(target);
};

const managedTargets = (root, manifest) => [
  ...managedDeliverables(manifest).flatMap((deliverable) => [
    safeDestination(root, deliverable.name),
    ...(deliverable.ravelmap ? [safeDestination(root, deliverable.ravelmap)] : [])
  ]),
  ...(manifest.provenance?.aggregate ? [safeDestination(root, manifest.provenance.aggregate)] : [])
];

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
  await removeManagedTargets(scope, targets);
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
    // Deflate when it helps; tiny or incompressible files stay stored.
    const deflated = deflateRawSync(file.value);
    const method = deflated.length < size ? 8 : 0;
    const data = method === 8 ? deflated : file.value;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(time, 12);
    directory.writeUInt16LE(date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + data.length;
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

/** Read the files named by the previous manifest; unmanaged neighbors are never archived. */
const collectBackupFiles = async (root, manifest) => {
  const targets = [
    ...managedTargets(root, manifest),
    safeDestination(root, manifestName),
    safeDestination(root, textManifestName)
  ];
  const files = [];
  for (const path of [...new Set(targets)].sort()) {
    await assertNoSymlinks(root, path, "Backup output");
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    if (!stat.isFile()) throw new Error("Backup output must be a file: " + path);
    files.push({ name: portableRelative(root, path), value: await readFile(path), mtime: stat.mtime });
  }
  return files;
};

/** Describe a backup archive without writing it, including no-overwrite checks. */
export const planOutputBackup = async (outputDirectory, {
  outputRootDirectory = outputDirectory,
  backupRootDirectory = outputRootDirectory,
  backupPath,
  timestampName = false
} = {}) => {
  const output = resolve(outputDirectory);
  const previous = await readManifest(output, outputRootDirectory);
  // A first build has nothing to protect, so there is nothing to archive.
  if (!previous) return { outputDirectory: output, path: null, skipped: "no previous Ravel build" };
  const builtAt = previous.manifest.builtAt;
  const timestamp = Date.parse(builtAt);
  if (!Number.isFinite(timestamp)) throw new Error("Build manifest has no valid build timestamp for backup: " + previous.path);
  const backupRoot = resolve(backupRootDirectory);
  await assertDirectory(backupRoot, "Backup root");
  const seconds = Math.floor(timestamp / 1000);
  const named = backupPath === undefined ? null : await scopedPath(backupRoot, backupPath, "Backup path");
  if (named && extname(named).toLowerCase() !== ".zip") throw new Error("Backup file must have a .zip extension: " + named);
  // A derived name is reused by every build, so it never blocks one: when the
  // name is taken (two builds in one second, or a retry after a failed write),
  // a numeric suffix keeps every archive. An explicit name must be new.
  const derived = named === null || timestampName;
  const base = named === null
    ? join(backupRoot, "backups", basename(output) + "-" + seconds)
    : timestampName ? named.slice(0, -extname(named).length) + "-" + seconds : named.slice(0, -extname(named).length);
  let path = base + ".zip";
  for (let attempt = 2; ; attempt += 1) {
    if (!containedIn(backupRoot, path)) throw new Error("Backup path escapes the Ravel root: " + path);
    await assertNoSymlinks(backupRoot, path, "Backup path");
    if (!await existingFile(path, "Backup file")) break;
    if (!derived) throw new Error("Backup file already exists: " + path);
    path = base + "-" + attempt + ".zip";
  }
  return { outputDirectory: output, path, manifest: previous, builtAt };
};

/** Archive the complete current output tree before it is cleaned or replaced. */
export const createOutputBackup = async (outputDirectory, options = {}) => {
  const plan = await planOutputBackup(outputDirectory, options);
  if (!plan.path) return { path: null, files: [], skipped: plan.skipped };
  const backupRoot = resolve(options.backupRootDirectory ?? options.outputRootDirectory ?? outputDirectory);
  await ensureDirectoryTree(backupRoot, dirname(plan.path), "Backup path");
  if (await existingFile(plan.path, "Backup file")) throw new Error("Backup file already exists: " + plan.path);
  const files = await collectBackupFiles(plan.outputDirectory, plan.manifest.manifest);
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
