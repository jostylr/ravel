import path from "node:path";
import { pathToFileURL } from "node:url";
import { BRIDGE_ERROR_CODES, LanguageBridgeError } from "@pieceful/ravel-language-bridge";

const languageExtensions = Object.freeze({
  typescript: ".ts",
  typescriptreact: ".tsx",
  javascript: ".js",
  javascriptreact: ".jsx"
});

const languageScriptKind = (ts, languageId, fileName) => {
  if (languageId === "typescript") return ts.ScriptKind.TS;
  if (languageId === "typescriptreact") return ts.ScriptKind.TSX;
  if (languageId === "javascript") return ts.ScriptKind.JS;
  if (languageId === "javascriptreact") return ts.ScriptKind.JSX;
  return ts.getScriptKindFromFileName?.(fileName) ?? ts.ScriptKind.Unknown;
};

const hash = (text) => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
};

const absolute = (currentDirectory, value) =>
  path.isAbsolute(value) ? path.normalize(value) : path.resolve(currentDirectory, value);

const comparablePath = (ts, value) => {
  const resolved = path.resolve(value);
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
};

const containedIn = (ts, root, candidate) => {
  const relative = path.relative(
    comparablePath(ts, root),
    comparablePath(ts, candidate)
  );
  return relative === "" ||
    relative !== ".." && !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative);
};

// Resolve the nearest existing ancestor so a not-yet-created config beneath a
// symlinked directory is checked against the directory's canonical location.
const canonicalPotentialPath = (ts, value) => {
  const original = path.resolve(value);
  if (typeof ts.sys.realpath !== "function") return original;
  const suffix = [];
  let current = original;
  while (true) {
    const exists = ts.sys.fileExists?.(current) === true ||
      ts.sys.directoryExists?.(current) === true;
    if (exists) {
      try {
        const canonical = ts.sys.realpath(current);
        if (typeof canonical === "string" && canonical.length > 0) {
          return path.resolve(canonical, ...suffix);
        }
      } catch {
        // Continue with the nearest existing parent. A failed realpath must not
        // turn an outside candidate into an allowed path.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return original;
    suffix.unshift(path.basename(current));
    current = parent;
  }
};

const confinedConfigPath = (ts, value, options) => {
  const candidate = absolute(options.currentDirectory, value);
  const root = path.resolve(options.configSearchRoot ?? options.currentDirectory);
  if (!containedIn(ts, root, candidate)) return undefined;
  const canonicalRoot = canonicalPotentialPath(ts, root);
  const canonicalCandidate = canonicalPotentialPath(ts, candidate);
  return containedIn(ts, canonicalRoot, canonicalCandidate)
    ? canonicalCandidate
    : undefined;
};

const discoverConfigPath = (ts, fileName, options) => {
  const root = path.resolve(options.configSearchRoot ?? options.currentDirectory);
  let directory = path.dirname(path.resolve(fileName));
  if (!containedIn(ts, root, directory) ||
      !containedIn(ts, canonicalPotentialPath(ts, root), canonicalPotentialPath(ts, directory))) {
    return undefined;
  }
  while (containedIn(ts, root, directory)) {
    const candidate = path.join(directory, "tsconfig.json");
    if (ts.sys.fileExists(candidate)) {
      const confined = confinedConfigPath(ts, candidate, options);
      if (confined) return confined;
    }
    if (comparablePath(ts, directory) === comparablePath(ts, root)) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
};

const safeRelativeArtifactPath = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      path.isAbsolute(value) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return undefined;
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(".." + path.sep)) {
    return undefined;
  }
  return normalized;
};

export const resolveVirtualFileName = (document, options) => {
  const configured = options.fileNameForDocument?.(document) ??
    document.fileName ?? document.path ?? document.artifactPath ?? document.outputPath ??
    document.metadata?.fileName ?? document.metadata?.artifactPath ?? document.metadata?.outputPath;
  if (typeof configured === "string" && configured.length > 0) {
    return absolute(options.currentDirectory, configured);
  }
  if (document.uri.startsWith("file:")) {
    return options.fileURLToPath(document.uri);
  }
  const artifactPath = safeRelativeArtifactPath(document.artifactId);
  if (artifactPath !== undefined) return path.resolve(options.currentDirectory, artifactPath);
  const extension = languageExtensions[document.languageId] ?? ".txt";
  const base = String(document.artifactId ?? "projection")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "projection";
  return path.join(options.currentDirectory, ".ravel-virtual", hash(document.uri) + "-" + base + extension);
};

export const resolveConfigPath = (ts, document, fileName, options) => {
  const configured = options.configFileForDocument?.(document, fileName) ??
    document.tsconfigPath ?? document.metadata?.tsconfigPath ?? options.tsconfigPath;
  if (typeof configured === "string" && configured.length > 0) {
    const confined = confinedConfigPath(ts, configured, options);
    if (confined) return confined;
  }
  return discoverConfigPath(ts, fileName, options);
};

const inferredOptions = (ts, overrides = {}) => ({
  target: ts.ScriptTarget.ES2022 ?? ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.Node10 ?? ts.ModuleResolutionKind.NodeJs,
  allowJs: true,
  checkJs: true,
  jsx: ts.JsxEmit.Preserve,
  allowNonTsExtensions: true,
  ...overrides
});

const readConfiguredProject = (ts, configPath, overrides) => {
  if (!configPath) return {
    currentDirectory: undefined,
    fileNames: [],
    options: inferredOptions(ts, overrides),
    diagnostics: []
  };
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    return {
      currentDirectory: path.dirname(configPath),
      fileNames: [],
      options: inferredOptions(ts, overrides),
      diagnostics: [read.error]
    };
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
    overrides,
    configPath
  );
  return {
    currentDirectory: path.dirname(configPath),
    fileNames: parsed.fileNames,
    options: { ...parsed.options, allowNonTsExtensions: true },
    diagnostics: parsed.errors ?? [],
    projectReferences: parsed.projectReferences
  };
};

export class TypeScriptProject {
  constructor(ts, key, configPath, options, documentRegistry) {
    this.ts = ts;
    this.key = key;
    this.configPath = configPath;
    this.options = options;
    this.documents = new Map();
    this.uriByCanonicalFile = new Map();
    this.scriptVersionSequence = 0;
    this.projectVersion = 0;
    this.activeSignal = undefined;
    this.configuration = readConfiguredProject(ts, configPath, options.compilerOptions);
    this.currentDirectory = this.configuration.currentDirectory ?? options.currentDirectory;
    this.configuredFiles = new Set(this.configuration.fileNames.map((file) => this.canonical(file)));
    this.host = this.createHost();
    this.service = ts.createLanguageService(this.host, documentRegistry);
  }

  canonical(fileName) {
    const normalized = path.normalize(fileName);
    return this.ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
  }

  uriForFile(fileName) {
    return this.uriByCanonicalFile.get(this.canonical(fileName)) ?? pathToFileURL(fileName).href;
  }

  versionForFile(fileName) {
    return this.documents.get(this.canonical(fileName))?.document.version;
  }

  add(entry) {
    const key = this.canonical(entry.fileName);
    const collision = this.documents.get(key);
    if (collision && collision.uri !== entry.uri) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.DOCUMENT_COLLISION,
        "Two virtual documents resolve to the same TypeScript file: " + entry.fileName + ".",
        { details: { firstUri: collision.uri, secondUri: entry.uri, fileName: entry.fileName } }
      );
    }
    entry.scriptKind = languageScriptKind(this.ts, entry.document.languageId, entry.fileName);
    const documentVersion = String(entry.document.version);
    // TypeScript caches snapshots by the host's script-version token. Ravel
    // document versions may restart after a same-path projection is closed and
    // reopened, so every insertion gets a fresh token, including later reopens.
    entry.scriptVersion = documentVersion + ":r" + String(++this.scriptVersionSequence);
    this.documents.set(key, entry);
    this.uriByCanonicalFile.set(key, entry.uri);
    this.projectVersion += 1;
  }

  remove(entry) {
    const key = this.canonical(entry.fileName);
    this.documents.delete(key);
    this.uriByCanonicalFile.delete(key);
    this.projectVersion += 1;
  }

  createHost() {
    const ts = this.ts;
    const project = this;
    const sys = ts.sys;
    const virtualEntry = (fileName) => project.documents.get(project.canonical(fileName));
    const virtualDirectoryExists = (directory) => {
      const prefix = project.canonical(directory).replace(/[\\/]+$/, "") + path.sep;
      return [...project.documents.keys()].some((fileName) => fileName.startsWith(prefix));
    };
    const virtualDirectories = (directory) => {
      const prefix = project.canonical(directory).replace(/[\\/]+$/, "") + path.sep;
      const directories = new Set();
      for (const fileName of project.documents.keys()) {
        if (!fileName.startsWith(prefix)) continue;
        const remainder = fileName.slice(prefix.length);
        const separator = remainder.indexOf(path.sep);
        if (separator >= 0) directories.add(path.join(directory, remainder.slice(0, separator)));
      }
      return [...directories];
    };
    const host = {
      getCompilationSettings: () => project.configuration.options,
      getCurrentDirectory: () => project.currentDirectory,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getNewLine: () => sys.newLine,
      getProjectReferences: () => project.configuration.projectReferences,
      getProjectVersion: () => String(project.projectVersion),
      getScriptFileNames: () => {
        const configured = project.configuration.fileNames;
        const virtual = [...project.documents.values()].map((entry) => entry.fileName);
        return [...new Set([...configured, ...virtual])];
      },
      getScriptKind: (fileName) => virtualEntry(fileName)?.scriptKind ??
        ts.getScriptKindFromFileName?.(fileName),
      getScriptSnapshot: (fileName) => {
        const entry = virtualEntry(fileName);
        if (entry) return ts.ScriptSnapshot.fromString(entry.document.text);
        const text = sys.readFile(fileName);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getScriptVersion: (fileName) => {
        const entry = virtualEntry(fileName);
        if (entry) return entry.scriptVersion;
        return String(sys.getModifiedTime?.(fileName)?.valueOf() ?? 0);
      },
      fileExists: (fileName) => virtualEntry(fileName) !== undefined || sys.fileExists(fileName),
      readFile: (fileName, encoding) => virtualEntry(fileName)?.document.text ?? sys.readFile(fileName, encoding),
      readDirectory: (...args) => sys.readDirectory(...args),
      directoryExists: (directory) => virtualDirectoryExists(directory) || sys.directoryExists?.(directory) === true,
      getDirectories: (directory) => [...new Set([
        ...(sys.getDirectories?.(directory) ?? []),
        ...virtualDirectories(directory)
      ])],
      realpath: (fileName) => virtualEntry(fileName)?.fileName ?? sys.realpath?.(fileName) ?? fileName,
      useCaseSensitiveFileNames: () => sys.useCaseSensitiveFileNames,
      getCancellationToken: () => ({
        isCancellationRequested: () => project.activeSignal?.aborted === true,
        throwIfCancellationRequested: () => {
          if (!project.activeSignal?.aborted) return;
          if (typeof ts.OperationCanceledException === "function") throw new ts.OperationCanceledException();
          throw project.activeSignal.reason ?? new Error("TypeScript operation cancelled.");
        }
      })
    };
    if (typeof ts.resolveModuleName === "function") {
      host.resolveModuleNames = (moduleNames, containingFile, _reusedNames, redirectedReference, compilerOptions) =>
        moduleNames.map((moduleName) => ts.resolveModuleName(
          moduleName,
          containingFile,
          compilerOptions ?? project.configuration.options,
          host,
          undefined,
          redirectedReference
        ).resolvedModule);
      host.resolveModuleNameLiterals = (moduleLiterals, containingFile, redirectedReference, compilerOptions) =>
        moduleLiterals.map((literal) => ({
          resolvedModule: ts.resolveModuleName(
            literal.text,
            containingFile,
            compilerOptions ?? project.configuration.options,
            host,
            undefined,
            redirectedReference
          ).resolvedModule
        }));
    }
    return host;
  }

  dispose() {
    this.service.dispose();
  }
}
