import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import {
  prepareQuartoProject,
  remapQuartoDiagnostic,
  stampQuartoProjectCache
} from "./index.js";

const run = promisify(execFile);
const defaultIgnoredDirectories = new Set([
  ".git",
  ".quarto",
  ".ravel-quarto",
  "_book",
  "_site",
  "node_modules"
]);

const outputExtensionFor = (format) => {
  if (!format) return null;
  if (["html", "revealjs", "dashboard"].includes(format)) return "html";
  if (format === "pdf" || format === "beamer") return "pdf";
  if (format === "docx") return "docx";
  if (format === "pptx") return "pptx";
  if (format === "epub") return "epub";
  return null;
};

const portablePath = (value) => String(value).replace(/\\/g, "/");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const point = { line: 0, column: 0, offset: 0 };
const source = (uri) => ({
  uri,
  range: { start: point, end: point }
});
const diagnostic = (code, message, uri, metadata) => ({
  code,
  severity: "error",
  message,
  source: source(uri),
  ...(metadata ? { metadata } : {})
});

export class QuartoHostError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map((entry) => entry.message).join(" "));
    this.name = "QuartoHostError";
    this.diagnostics = diagnostics;
  }
}

const containedIn = (root, target) => {
  const path = relative(root, target);
  return path === "" ||
    (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path));
};

const assertProjectDirectory = async (directory) => {
  const root = resolve(directory);
  let entry;
  try {
    entry = await lstat(root);
  } catch (error) {
    throw new QuartoHostError([
      diagnostic(
        "RQ301",
        "Unable to read the Quarto project directory: " +
          (error?.code ?? error?.message ?? String(error)),
        root
      )
    ]);
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new QuartoHostError([
      diagnostic(
        "RQ301",
        "The Quarto project root must be a real directory.",
        root
      )
    ]);
  }
  return root;
};

const collectFiles = async (
  root,
  directory,
  ignoredDirectories,
  files = []
) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new QuartoHostError([
        diagnostic(
          "RQ301",
          "Quarto project preparation does not follow symbolic links: " +
            portablePath(relative(root, path)),
          portablePath(relative(root, path))
        )
      ]);
    }
    if (entry.isDirectory()) {
      await collectFiles(root, path, ignoredDirectories, files);
    } else if (entry.isFile()) {
      files.push({
        path,
        relativePath: portablePath(relative(root, path))
      });
    }
  }
  return files;
};

const projectScripts = (files) => {
  const config = files.find((entry) => entry.relativePath === "_quarto.yml" ||
    entry.relativePath === "_quarto.yaml");
  if (!config) return [];
  let parsed;
  try {
    parsed = parseYaml(config.text);
  } catch (error) {
    throw new QuartoHostError([
      diagnostic(
        "RQ301",
        "Unable to parse Quarto project configuration: " +
          (error?.message ?? String(error)),
        config.relativePath
      )
    ]);
  }
  const declarations = [];
  for (const key of ["pre-render", "post-render"]) {
    if (parsed?.project?.[key] !== undefined) {
      declarations.push({
        kind: key,
        value: parsed.project[key]
      });
    }
  }
  return declarations;
};

const quartoVersion = async (
  command,
  commandArguments,
  cwd,
  environment
) => {
  try {
    const result = await run(command, [...commandArguments, "--version"], {
      cwd,
      env: environment,
      maxBuffer: 1024 * 1024
    });
    return result.stdout.trim();
  } catch (error) {
    throw new QuartoHostError([
      diagnostic(
        "RQ301",
        "Unable to run Quarto: " +
          (error?.stderr?.trim() || error?.message || String(error)),
        cwd
      )
    ]);
  }
};

const writePreparedTree = async (temporaryDirectory, files, project) => {
  const byUri = new Map(project.documents.map((entry) => [
    entry.uri,
    entry
  ]));
  for (const file of files) {
    const destination = join(
      temporaryDirectory,
      ...file.relativePath.split("/")
    );
    if (!containedIn(temporaryDirectory, destination)) {
      throw new QuartoHostError([
        diagnostic("RQ301", "Temporary Quarto path escapes its root.", file.relativePath)
      ]);
    }
    await mkdir(dirname(destination), { recursive: true });
    const prepared = byUri.get(file.relativePath);
    if (prepared) {
      await writeFile(destination, prepared.preparedSource, "utf8");
      prepared.temporaryUri = destination;
    } else {
      await copyFile(file.path, destination);
      await chmod(destination, file.mode);
    }
  }
  const manifest = {
    version: 1,
    kind: "ravel-quarto-project",
    cacheKey: hash(project.cacheKeyMaterial),
    documents: project.documents.map((entry) => ({
      uri: entry.uri,
      temporaryUri: portablePath(relative(temporaryDirectory, entry.temporaryUri)),
      sourceMap: entry.sourceMap
    }))
  };
  await writeFile(
    join(temporaryDirectory, ".ravel-quarto.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
};

/**
 * Copy and prepare a complete Quarto project without invoking its renderer.
 * Generated directories and node_modules are excluded by default.
 */
export const prepareQuartoProjectDirectory = async (
  projectDirectory,
  options = {}
) => {
  const root = await assertProjectDirectory(projectDirectory);
  const ignoredDirectories = new Set([
    ...defaultIgnoredDirectories,
    ...(options.ignoredDirectories ?? [])
  ]);
  const fileEntries = await collectFiles(
    root,
    root,
    ignoredDirectories
  );
  const files = await Promise.all(fileEntries.map(async (entry) => {
    const value = await readFile(entry.path);
    const stat = await lstat(entry.path);
    return {
      ...entry,
      value,
      text: value.toString("utf8"),
      mode: stat.mode,
      sha256: hash(value)
    };
  }));
  const qmd = files.filter((entry) =>
    extname(entry.relativePath).toLowerCase() === ".qmd"
  );
  if (!qmd.length) {
    throw new QuartoHostError([
      diagnostic("RQ301", "The Quarto project contains no .qmd documents.", root)
    ]);
  }
  const dependencies = files.map((entry) => ({
    path: entry.relativePath,
    sha256: entry.sha256
  }));
  const preparedProject = prepareQuartoProject(qmd.map((entry) => ({
    uri: entry.relativePath,
    source: entry.text
  })), {
    includeIndex: options.includeIndex,
    indexScope: options.indexScope,
    outputExtension: options.outputExtension ??
      outputExtensionFor(options.to),
    transforms: options.transforms,
    transformVersions: options.transformVersions,
    providerVersions: {
      ...(options.providerVersions ?? {}),
      ...(options.quartoVersion
        ? { quarto: options.quartoVersion }
        : {})
    },
    dependencies
  });
  const cacheKey = hash(preparedProject.cacheKeyMaterial);
  const project = stampQuartoProjectCache(preparedProject, cacheKey);
  const scripts = projectScripts(files);
  const temporaryParent = resolve(options.temporaryRoot ?? tmpdir());
  await mkdir(temporaryParent, { recursive: true });
  const temporaryDirectory = await mkdtemp(
    join(temporaryParent, "ravel-quarto-")
  );
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(temporaryDirectory, { recursive: true, force: true });
  };
  try {
    await writePreparedTree(temporaryDirectory, files, project);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    ...project,
    projectDirectory: root,
    temporaryDirectory,
    files: files.map((entry) => ({
      path: entry.relativePath,
      sha256: entry.sha256
    })),
    projectScripts: scripts,
    cacheKey,
    cleanup
  };
};

const forbiddenArgument = /^(?:--output(?:-dir)?|--log(?:-format)?)(?:=|$)/;

const normalizedRenderInput = (prepared, input) => {
  if (input === undefined) return null;
  const target = resolve(prepared.temporaryDirectory, input);
  if (!containedIn(prepared.temporaryDirectory, target)) {
    throw new QuartoHostError([
      diagnostic("RQ301", "Quarto render input escapes the temporary project.", input)
    ]);
  }
  return portablePath(relative(prepared.temporaryDirectory, target));
};

const logMessages = async (path) => {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return text.split(/\r?\n/)
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
};

const locationPattern = /^(.+?\.qmd):(\d+)(?::(\d+))?/gm;

const rendererDiagnostics = async (
  prepared,
  logPath,
  stderr,
  failure
) => {
  const messages = await logMessages(logPath);
  const candidates = [
    ...messages
      .filter((entry) => (entry.level ?? 0) >= 30)
      .map((entry) => entry.msg),
    stderr
  ].filter(Boolean);
  const diagnostics = [];
  const seen = new Set();
  for (const message of candidates) {
    for (const match of message.matchAll(locationPattern)) {
      let file = portablePath(match[1].trim());
      if (isAbsolute(file)) {
        file = portablePath(relative(prepared.temporaryDirectory, file));
      }
      const key = [file, match[2], match[3] ?? "1", message.trim()].join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(remapQuartoDiagnostic({
        code: "RQ201",
        severity: "error",
        message: message.trim(),
        file,
        line: Number(match[2]),
        column: match[3] === undefined ? 1 : Number(match[3])
      }, prepared));
    }
  }
  if (diagnostics.length) return diagnostics;
  return [diagnostic(
    "RQ301",
    "Quarto render failed: " +
      (stderr.trim() || failure?.message || "unknown renderer failure"),
    prepared.projectDirectory,
    { ravel: { temporaryDirectory: prepared.temporaryDirectory } }
  )];
};

/**
 * Invoke Quarto only against an already prepared temporary project.
 * The caller owns the returned project handle and must call cleanup().
 */
export const renderPreparedQuartoProject = async (
  prepared,
  options = {}
) => {
  if (prepared.diagnostics.some((entry) => entry.severity === "error")) {
    return {
      ok: false,
      diagnostics: prepared.diagnostics,
      prepared
    };
  }
  if (prepared.projectScripts.length && options.allowProjectScripts !== true) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        "RQ302",
        "Quarto project scripts require allowProjectScripts: true.",
        "_quarto.yml",
        { ravel: { scripts: prepared.projectScripts } }
      )],
      prepared
    };
  }
  const extraArguments = options.args ?? [];
  if (extraArguments.some((entry) => forbiddenArgument.test(entry))) {
    throw new QuartoHostError([
      diagnostic(
        "RQ301",
        "Quarto host arguments may not override output or structured-log paths.",
        prepared.projectDirectory
      )
    ]);
  }
  const command = options.command ?? "quarto";
  const commandArguments = options.commandArguments ?? [];
  const input = normalizedRenderInput(prepared, options.input);
  const outputName = ".ravel-quarto-output";
  const outputDirectory = join(prepared.temporaryDirectory, outputName);
  const logPath = join(prepared.temporaryDirectory, ".ravel-quarto-log.jsonl");
  const argumentsValue = [
    ...commandArguments,
    "render",
    ...(input ? [input] : []),
    ...(options.to ? ["--to", options.to] : []),
    "--output-dir",
    outputName,
    "--log",
    logPath,
    "--log-format",
    "json-stream",
    ...(options.previousCacheKey &&
        options.previousCacheKey !== prepared.cacheKey
      ? ["--cache-refresh"]
      : []),
    ...extraArguments
  ];
  try {
    const result = await run(command, argumentsValue, {
      cwd: prepared.temporaryDirectory,
      env: {
        ...process.env,
        ...(options.environment ?? {})
      },
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024
    });
    return {
      ok: true,
      diagnostics: [],
      stdout: result.stdout,
      stderr: result.stderr,
      outputDirectory,
      logPath,
      prepared
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: await rendererDiagnostics(
        prepared,
        logPath,
        error?.stderr ?? "",
        error
      ),
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      outputDirectory,
      logPath,
      prepared
    };
  }
};

/** Prepare a temporary project, discover Quarto's version, and render it. */
export const renderQuartoProject = async (
  projectDirectory,
  options = {}
) => {
  const command = options.command ?? "quarto";
  const commandArguments = options.commandArguments ?? [];
  const environment = {
    ...process.env,
    ...(options.environment ?? {})
  };
  const version = options.quartoVersion ?? await quartoVersion(
    command,
    commandArguments,
    resolve(projectDirectory),
    environment
  );
  const prepared = await prepareQuartoProjectDirectory(projectDirectory, {
    ...options,
    quartoVersion: version
  });
  try {
    const rendered = await renderPreparedQuartoProject(prepared, options);
    return { ...rendered, quartoVersion: version };
  } catch (error) {
    await prepared.cleanup();
    throw error;
  }
};
