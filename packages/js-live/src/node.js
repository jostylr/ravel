import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { build as bundleWithEsbuild } from "esbuild";

const packageExportPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/i;

const fallbackSource = (uri = "<ravel-config>") => ({
  uri,
  range: {
    start: { line: 0, column: 0, offset: 0 },
    end: { line: 0, column: 0, offset: 0 }
  }
});

/** Expected failure while preparing a configured package for QuickJS. */
export class JavaScriptModulePreparationError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map((entry) => entry.message).join(" "));
    this.name = "JavaScriptModulePreparationError";
    this.diagnostics = diagnostics;
  }
}

const preparationError = (message, source) => new JavaScriptModulePreparationError([{
  code: "RJL140",
  severity: "error",
  message,
  source: source?.uri ? source : fallbackSource()
}]);

/**
 * Bundle explicitly allowlisted, already-installed package exports for a
 * closed live-JavaScript module registry. Package code is read but not run.
 */
export const prepareJavaScriptModules = async (declarations, {
  rootDirectory,
  moduleEntries = 100,
  moduleBytes = 8 * 1024 * 1024
} = {}) => {
  if (!Array.isArray(declarations)) throw new TypeError("Live module declarations must be an array.");
  if (declarations.length > moduleEntries) {
    throw preparationError(
      "Live module count exceeds the configured limit of " + moduleEntries + ".",
      declarations[0]?.source
    );
  }
  if (typeof rootDirectory !== "string" || !rootDirectory) {
    throw new TypeError("rootDirectory must be a non-empty string.");
  }
  const root = resolve(rootDirectory);
  const modules = {};
  let bytes = 0;

  for (const declaration of declarations) {
    const source = declaration?.source;
    const specifier = declaration?.specifier;
    const packageExport = declaration?.from;
    if (typeof specifier !== "string" || !specifier ||
        typeof packageExport !== "string" || !packageExportPattern.test(packageExport)) {
      throw preparationError("Invalid live JavaScript module declaration.", source);
    }
    if (Object.hasOwn(modules, specifier)) {
      throw preparationError("Duplicate live JavaScript module specifier: " + specifier, source);
    }
    let result;
    try {
      result = await bundleWithEsbuild({
        absWorkingDir: root,
        entryPoints: [packageExport],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2023",
        packages: "bundle",
        legalComments: "none",
        logLevel: "silent"
      });
    } catch (error) {
      const detail = error?.errors?.[0]?.text ?? error?.message ?? String(error);
      throw preparationError(
        "Unable to prepare live module " + specifier + " from " + packageExport + ": " + detail,
        source
      );
    }
    if (result.outputFiles?.length !== 1) {
      throw preparationError("Live module " + specifier + " did not produce one ESM bundle.", source);
    }
    const bundled = result.outputFiles[0].text;
    bytes += Buffer.byteLength(bundled, "utf8");
    if (bytes > moduleBytes) {
      throw preparationError(
        "Live module source exceeds the configured limit of " + moduleBytes + " bytes.",
        source
      );
    }
    modules[specifier] = bundled;
  }
  return modules;
};
