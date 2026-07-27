import { parse } from "acorn";
import { getQuickJS } from "quickjs-emscripten";
import { analyzeJavaScript, diagnostic } from "./analyzer.js";

let quickJSPromise;

export const prepareQuickJS = () => {
  quickJSPromise ??= getQuickJS();
  return quickJSPromise;
};

const bootstrapSource = (inputs, resources) => {
  const inputJson = JSON.stringify(inputs);
  const resourceJson = JSON.stringify(resources);
  return `(() => {
"use strict";
const O = Object;
const J = JSON;
const keys = O.keys;
const descriptor = O.getOwnPropertyDescriptor;
const prototype = O.getPrototypeOf;
const objectPrototype = O.prototype;
const A = Array;
const arrayPrototype = A.prototype;
const isArray = A.isArray;
const isFiniteNumber = Number.isFinite;
const isSafeInteger = Number.isSafeInteger;
const S = Set;
const ownKeys = Reflect.ownKeys;
const hasOwn = O.hasOwn;
const stringify = J.stringify;
const inputs = J.parse(${JSON.stringify(inputJson)});
const resources = J.parse(${JSON.stringify(resourceJson)});
const freeze = (value, seen = new S()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of keys(value)) freeze(value[key], seen);
  return O.freeze(value);
};
freeze(inputs);
freeze(resources);
const ch = (name) => {
  if (typeof name !== "string" || !hasOwn(inputs, name)) {
    throw new Error("Unknown live dependency: " + String(name));
  }
  return inputs[name];
};
const load = (name) => {
  if (typeof name !== "string" || !hasOwn(resources, name)) {
    throw new Error("Unknown live resource: " + String(name));
  }
  return resources[name];
};
const validate = (value, path = "$", seen = new S()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!isFiniteNumber(value)) throw new TypeError(path + " must be a finite number.");
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(path + " has unsupported type " + typeof value + ".");
  }
  if (seen.has(value)) throw new TypeError(path + " contains a cycle.");
  seen.add(value);
  if (!isArray(value) && prototype(value) !== objectPrototype && prototype(value) !== null) {
    throw new TypeError(path + " must be a plain record.");
  }
  if (isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!hasOwn(value, index)) throw new TypeError(path + " must not contain array holes.");
      const itemDescriptor = descriptor(value, index);
      if (!itemDescriptor || !itemDescriptor.enumerable ||
          itemDescriptor.get || itemDescriptor.set) {
        throw new TypeError(path + "[" + index + "] must be an enumerable data property.");
      }
      validate(value[index], path + "[" + index + "]", seen);
    }
    for (const key of ownKeys(value)) {
      if (key === "length") continue;
      const index = typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)
        ? Number(key)
        : -1;
      if (!isSafeInteger(index) || index < 0 || index >= value.length) {
        throw new TypeError(path + " has a non-index array property.");
      }
    }
    seen.delete(value);
    return;
  }
  for (const key of ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(path + " must not contain symbol keys.");
    const valueDescriptor = descriptor(value, key);
    if (!valueDescriptor || !valueDescriptor.enumerable ||
        valueDescriptor.get || valueDescriptor.set) {
      throw new TypeError(path + "." + key + " must be an enumerable data property.");
    }
    validate(value[key], path + "." + key, seen);
  }
  seen.delete(value);
};
const bridge = O.freeze({ ch, load, validate, stringify });
O.defineProperty(globalThis, "__ravelBridge", {
  value: bridge,
  configurable: false,
  enumerable: false,
  writable: false
});
O.freeze(objectPrototype);
O.freeze(arrayPrototype);
O.freeze(J);
O.freeze(Number);
O.freeze(Reflect);
O.freeze(S.prototype);
})()`;
};

const moduleSource = (source) => {
  const program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const exportNode = program.body.at(-1);
  if (!exportNode || exportNode.type !== "ExportDefaultDeclaration") return null;
  const declaration = source.slice(exportNode.declaration.start, exportNode.declaration.end);
  const beforeExport = source.slice(0, exportNode.start);
  return `const {
  ch,
  load,
  validate: __ravelValidate,
  stringify: __ravelStringify
} = globalThis.__ravelBridge;
${beforeExport}
const __ravelValue = (${declaration});
__ravelValidate(__ravelValue);
export default __ravelStringify(__ravelValue);`;
};

const quickJSError = (error) => {
  if (error && typeof error === "object") {
    const name = error.name ? String(error.name) + ": " : "";
    return name + (error.message ?? JSON.stringify(error));
  }
  return String(error);
};

const unwrapResult = (context, runtime, result) => {
  if (result.error) {
    runtime.setMemoryLimit(-1);
    const error = context.dump(result.error);
    result.error.dispose();
    throw error;
  }
  return result.value;
};

const utf8Bytes = (value) => new TextEncoder().encode(value).byteLength;

export const executeQuickJS = async ({ request, options = {}, modules = {} }) => {
  const started = performance.now();
  const availableModules = new Set(Object.keys(modules));
  const analysis = analyzeJavaScript({
    source: request.source,
    sourceLocation: request.sourceLocation,
    availableModules
  });
  if (analysis.diagnostics.length) {
    return {
      ok: false,
      hasExport: false,
      diagnostics: analysis.diagnostics,
      durationMs: performance.now() - started
    };
  }
  const entrySource = moduleSource(request.source);
  if (!entrySource) {
    return {
      ok: false,
      hasExport: false,
      diagnostics: [diagnostic(
        "RJL101",
        "A live JavaScript block must contain exactly one final export default.",
        request.sourceLocation
      )],
      durationMs: performance.now() - started
    };
  }

  const timeoutMs = request.limits?.timeoutMs ?? options.timeoutMs ?? 1000;
  const deadline = Date.now() + timeoutMs;
  const QuickJS = await prepareQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(request.limits?.memoryBytes ?? options.memoryBytes ?? 32 * 1024 * 1024);
  runtime.setMaxStackSize(request.limits?.stackBytes ?? options.stackBytes ?? 512 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  runtime.setModuleLoader(
    (moduleName) => {
      if (!Object.hasOwn(modules, moduleName)) {
        throw new Error("Live JavaScript module is not approved: " + moduleName);
      }
      return modules[moduleName];
    },
    (_baseModuleName, requestedName) => requestedName
  );
  const context = runtime.newContext();

  try {
    const bootstrap = context.evalCode(bootstrapSource(
      request.inputs ?? {},
      request.resources ?? {}
    ), "ravel:bootstrap", { type: "global", strict: true });
    unwrapResult(context, runtime, bootstrap).dispose();

    const evaluated = context.evalCode(
      entrySource,
      request.sourceLocation?.uri ?? request.id ?? "ravel:entry",
      { type: "module" }
    );
    const exportsHandle = unwrapResult(context, runtime, evaluated);
    const exportsValue = context.dump(exportsHandle);
    exportsHandle.dispose();
    const serialized = exportsValue?.default;
    if (typeof serialized !== "string") {
      throw new TypeError("Live JavaScript module did not return a serialized default export.");
    }
    const maxOutputBytes = request.limits?.outputBytes ??
      options.outputBytes ??
      8 * 1024 * 1024;
    if (utf8Bytes(serialized) > maxOutputBytes) {
      return {
        ok: false,
        hasExport: true,
        diagnostics: [diagnostic(
          "RJL122",
          "Live JavaScript output exceeded " + maxOutputBytes + " bytes.",
          request.sourceLocation
        )],
        durationMs: performance.now() - started
      };
    }
    return {
      ok: true,
      hasExport: true,
      serialized,
      diagnostics: [],
      durationMs: performance.now() - started
    };
  } catch (error) {
    const timedOut = Date.now() >= deadline;
    return {
      ok: false,
      hasExport: true,
      diagnostics: [diagnostic(
        timedOut ? "RJL120" : "RJL110",
        timedOut
          ? "Live JavaScript execution exceeded " + timeoutMs + " ms."
          : "Live JavaScript failed: " + quickJSError(error),
        request.sourceLocation
      )],
      durationMs: performance.now() - started
    };
  } finally {
    context.dispose();
    runtime.dispose();
  }
};
