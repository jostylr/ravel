import { TypeScriptLanguageBridge } from "./typescript-bridge.js";

const isTypeScriptApi = (value) =>
  value && typeof value.createLanguageService === "function" &&
  value.ScriptSnapshot && value.sys;

const normalizeTypeScriptApi = (module) => {
  if (isTypeScriptApi(module)) return module;
  if (isTypeScriptApi(module?.default)) return module.default;
  throw new TypeError("The supplied module is not a TypeScript compiler API.");
};

/**
 * Create a bridge with an already loaded TypeScript compiler API.
 *
 * This entry point is useful to hosts that already own a TypeScript runtime,
 * including editors and deterministic tests.
 */
export const createTypeScriptLanguageBridgeWithApi = (typescript, options = {}) =>
  new TypeScriptLanguageBridge(normalizeTypeScriptApi(typescript), options);

/**
 * Load the optional TypeScript peer dependency and create a bridge.
 */
export const createTypeScriptLanguageBridge = async (options = {}) => {
  if (options.typescript !== undefined) {
    return createTypeScriptLanguageBridgeWithApi(options.typescript, options);
  }
  const specifier = options.typescriptModule ?? "typescript";
  let module;
  try {
    module = options.loadTypeScript
      ? await options.loadTypeScript(specifier)
      : await import(specifier);
  } catch (error) {
    const failure = new Error(
      "TypeScript is not available. Install the optional `typescript` peer dependency or pass `options.typescript`.",
      { cause: error }
    );
    failure.code = "TYPESCRIPT_NOT_AVAILABLE";
    throw failure;
  }
  return createTypeScriptLanguageBridgeWithApi(module, options);
};

export { TypeScriptLanguageBridge } from "./typescript-bridge.js";
