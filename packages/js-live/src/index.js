import { parse } from "acorn";
import { getQuickJS } from "quickjs-emscripten";

const providerId = "quickjs-wasm";
const providerVersion = "0.1.1";
const reservedBindings = new Set(["ch", "load"]);

const diagnostic = (code, message, source) => ({
  code,
  severity: "error",
  message,
  source
});

const advance = (start, text) => {
  let line = start.line;
  let column = start.column;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column, offset: start.offset + text.length };
};

const sourceAt = (sourceLocation, source, start, end = start) => ({
  uri: sourceLocation.uri,
  range: {
    start: advance(sourceLocation.range.start, source.slice(0, start)),
    end: advance(sourceLocation.range.start, source.slice(0, end))
  }
});

const bindingNames = (pattern, names = []) => {
  if (!pattern || typeof pattern !== "object") return names;
  if (pattern.type === "Identifier") names.push(pattern.name);
  else if (pattern.type === "RestElement") bindingNames(pattern.argument, names);
  else if (pattern.type === "AssignmentPattern") bindingNames(pattern.left, names);
  else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) bindingNames(element, names);
  } else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      bindingNames(property.type === "RestElement" ? property.argument : property.value, names);
    }
  }
  return names;
};

const walk = (node, visit) => {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else {
      walk(value, visit);
    }
  }
};

const analyzeJavaScript = ({ source, sourceLocation }) => {
  const diagnostics = [];
  let program;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true
    });
  } catch (error) {
    const start = Number.isInteger(error?.pos) ? error.pos : 0;
    diagnostics.push(diagnostic(
      "RJL100",
      "JavaScript syntax error: " + (error?.message ?? String(error)),
      sourceAt(sourceLocation, source, start, start + 1)
    ));
    return { dependencies: [], resources: [], diagnostics };
  }

  const defaults = program.body.filter((node) => node.type === "ExportDefaultDeclaration");
  if (defaults.length !== 1) {
    diagnostics.push(diagnostic(
      "RJL101",
      "A live JavaScript block must contain exactly one export default.",
      sourceLocation
    ));
  } else if (program.body.at(-1) !== defaults[0]) {
    diagnostics.push(diagnostic(
      "RJL102",
      "export default must be the final top-level statement.",
      sourceAt(sourceLocation, source, defaults[0].start, defaults[0].end)
    ));
  }

  const dependencies = new Map();
  const resources = new Map();
  const reportedBindings = new Set();
  const reportBinding = (name, node) => {
    if (reservedBindings.has(name) || name.startsWith("__ravel")) {
      const key = name + ":" + node.start + ":" + node.end;
      if (reportedBindings.has(key)) return;
      reportedBindings.add(key);
      diagnostics.push(diagnostic(
        "RJL103",
        "Live JavaScript cannot declare, assign, or access the reserved binding " + name + ".",
        sourceAt(sourceLocation, source, node.start, node.end)
      ));
    }
  };

  walk(program, (node) => {
    if (node.type === "Identifier" && node.name.startsWith("__ravel")) {
      reportBinding(node.name, node);
    }
    if (node.type === "ImportDeclaration" || node.type === "ImportExpression" ||
        node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      diagnostics.push(diagnostic(
        "RJL104",
        "Module imports and named exports are unavailable in the initial live JavaScript profile.",
        sourceAt(sourceLocation, source, node.start, node.end)
      ));
    }
    if (node.type === "AwaitExpression") {
      diagnostics.push(diagnostic(
        "RJL105",
        "await is unavailable in the initial synchronous live JavaScript profile.",
        sourceAt(sourceLocation, source, node.start, node.end)
      ));
    }
    if (node.type === "VariableDeclarator") {
      for (const name of bindingNames(node.id)) reportBinding(name, node.id);
    }
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression") {
      if (node.id) reportBinding(node.id.name, node.id);
      for (const parameter of node.params) {
        for (const name of bindingNames(parameter)) reportBinding(name, parameter);
      }
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.id) reportBinding(node.id.name, node.id);
    }
    if (node.type === "CatchClause") {
      for (const name of bindingNames(node.param)) reportBinding(name, node.param);
    }
    if (node.type === "AssignmentExpression") {
      for (const name of bindingNames(node.left)) reportBinding(name, node.left);
    }
    if (node.type === "UpdateExpression") {
      for (const name of bindingNames(node.argument)) reportBinding(name, node.argument);
    }

    const callName = node.type === "CallExpression" && node.callee.type === "Identifier"
      ? node.callee.name
      : null;
    if (callName === "eval" || callName === "Function" ||
        (node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "Function")) {
      diagnostics.push(diagnostic(
        "RJL106",
        "Dynamic code generation is unavailable in live JavaScript.",
        sourceAt(sourceLocation, source, node.start, node.end)
      ));
    }
    if (callName !== "ch" && callName !== "load") return;
    const argument = node.arguments[0];
    if (node.arguments.length !== 1 || argument?.type !== "Literal" || typeof argument.value !== "string") {
      diagnostics.push(diagnostic(
        "RJL107",
        callName + " requires one static string literal.",
        sourceAt(sourceLocation, source, node.start, node.end)
      ));
      return;
    }
    const entry = {
      ...(callName === "ch" ? { reference: argument.value } : { name: argument.value }),
      source: sourceAt(sourceLocation, source, node.start, node.end)
    };
    (callName === "ch" ? dependencies : resources).set(argument.value, entry);
  });

  return {
    dependencies: [...dependencies.values()],
    resources: [...resources.values()],
    diagnostics
  };
};

const wrapperSource = (source, sourceLocation, inputs, resources) => {
  const analysis = analyzeJavaScript({ source, sourceLocation });
  const exportNode = analysis.diagnostics.length
    ? null
    : parse(source, { ecmaVersion: "latest", sourceType: "module" }).body.at(-1);
  if (!exportNode || exportNode.type !== "ExportDefaultDeclaration") return { analysis, wrapper: null };
  const declaration = source.slice(exportNode.declaration.start, exportNode.declaration.end);
  const beforeExport = source.slice(0, exportNode.start);
  const inputJson = JSON.stringify(inputs);
  const resourceJson = JSON.stringify(resources);
  const wrapper = `(() => {
"use strict";
const __ravelObject = Object;
const __ravelJson = JSON;
const __ravelKeys = __ravelObject.keys;
const __ravelDescriptor = __ravelObject.getOwnPropertyDescriptor;
const __ravelPrototype = __ravelObject.getPrototypeOf;
const __ravelObjectPrototype = __ravelObject.prototype;
const __ravelArray = Array;
const __ravelArrayPrototype = __ravelArray.prototype;
const __ravelIsArray = __ravelArray.isArray;
const __ravelIsFinite = Number.isFinite;
const __ravelIsSafeInteger = Number.isSafeInteger;
const __ravelSet = Set;
const __ravelOwnKeys = Reflect.ownKeys;
const __ravelHasOwn = __ravelObject.hasOwn;
const __ravelStringify = __ravelJson.stringify;
const __ravelInputs = __ravelJson.parse(${JSON.stringify(inputJson)});
const __ravelResources = __ravelJson.parse(${JSON.stringify(resourceJson)});
const __ravelFreeze = (value, seen = new __ravelSet()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of __ravelKeys(value)) __ravelFreeze(value[key], seen);
  return __ravelObject.freeze(value);
};
__ravelFreeze(__ravelInputs);
__ravelFreeze(__ravelResources);
__ravelObject.freeze(__ravelObjectPrototype);
__ravelObject.freeze(__ravelArrayPrototype);
__ravelObject.freeze(__ravelJson);
__ravelObject.freeze(Number);
__ravelObject.freeze(Reflect);
__ravelObject.freeze(__ravelSet.prototype);
const ch = (name) => {
  if (typeof name !== "string" || !__ravelHasOwn(__ravelInputs, name)) {
    throw new Error("Unknown live dependency: " + String(name));
  }
  return __ravelInputs[name];
};
const load = (name) => {
  if (typeof name !== "string" || !__ravelHasOwn(__ravelResources, name)) {
    throw new Error("Unknown live resource: " + String(name));
  }
  return __ravelResources[name];
};
const __ravelValidate = (value, path = "$", seen = new __ravelSet()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!__ravelIsFinite(value)) throw new TypeError(path + " must be a finite number.");
    return;
  }
  if (typeof value !== "object") throw new TypeError(path + " has unsupported type " + typeof value + ".");
  if (seen.has(value)) throw new TypeError(path + " contains a cycle.");
  seen.add(value);
  if (!__ravelIsArray(value) && __ravelPrototype(value) !== __ravelObjectPrototype &&
      __ravelPrototype(value) !== null) {
    throw new TypeError(path + " must be a plain record.");
  }
  if (__ravelIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!__ravelHasOwn(value, index)) {
        throw new TypeError(path + " must not contain array holes.");
      }
      const descriptor = __ravelDescriptor(value, index);
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new TypeError(path + "[" + index + "] must be an enumerable data property.");
      }
      __ravelValidate(value[index], path + "[" + index + "]", seen);
    }
    for (const key of __ravelOwnKeys(value)) {
      if (key === "length") continue;
      const index = typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key) ? Number(key) : -1;
      if (!__ravelIsSafeInteger(index) || index < 0 || index >= value.length) {
        throw new TypeError(path + " has a non-index array property.");
      }
    }
    seen.delete(value);
    return;
  }
  for (const key of __ravelOwnKeys(value)) {
    if (typeof key !== "string") throw new TypeError(path + " must not contain symbol keys.");
    const descriptor = __ravelDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) {
      throw new TypeError(path + "." + key + " must be an enumerable data property.");
    }
    __ravelValidate(value[key], path + "." + key, seen);
  }
  seen.delete(value);
};
${beforeExport}
const __ravelValue = (${declaration});
__ravelValidate(__ravelValue);
return __ravelStringify(__ravelValue);
})()`;
  return { analysis, wrapper };
};

const quickJSError = (error) => {
  if (error && typeof error === "object") {
    const name = error.name ? String(error.name) + ": " : "";
    return name + (error.message ?? JSON.stringify(error));
  }
  return String(error);
};

export const createJavaScriptLiveProvider = (options = {}) => ({
  id: options.id ?? providerId,
  version: providerVersion,
  languages: options.languages ?? ["js", "javascript"],
  analyze: analyzeJavaScript,
  execute: async (request) => {
    const started = performance.now();
    const prepared = wrapperSource(
      request.source,
      request.sourceLocation,
      request.inputs ?? {},
      request.resources ?? {}
    );
    if (!prepared.wrapper || prepared.analysis.diagnostics.length) {
      return {
        ok: false,
        hasExport: false,
        diagnostics: prepared.analysis.diagnostics,
        durationMs: performance.now() - started
      };
    }
    const timeoutMs = request.limits?.timeoutMs ?? options.timeoutMs ?? 1000;
    const QuickJS = await getQuickJS();
    const deadline = Date.now() + timeoutMs;
    let serialized;
    try {
      serialized = QuickJS.evalCode(prepared.wrapper, {
        memoryLimitBytes: request.limits?.memoryBytes ?? options.memoryBytes ?? 32 * 1024 * 1024,
        maxStackSizeBytes: request.limits?.stackBytes ?? options.stackBytes ?? 512 * 1024,
        shouldInterrupt: () => request.signal?.aborted === true || Date.now() >= deadline
      });
    } catch (error) {
      const durationMs = performance.now() - started;
      return {
        ok: false,
        hasExport: true,
        diagnostics: [diagnostic(
          request.signal?.aborted ? "RJL121" : Date.now() >= deadline ? "RJL120" : "RJL110",
          request.signal?.aborted
            ? "Live JavaScript execution was cancelled."
            : Date.now() >= deadline
              ? "Live JavaScript execution exceeded " + timeoutMs + " ms."
              : "Live JavaScript failed: " + quickJSError(error),
          request.sourceLocation
        )],
        durationMs
      };
    }
    const durationMs = performance.now() - started;
    return {
      ok: true,
      hasExport: true,
      serialized,
      diagnostics: [],
      durationMs
    };
  }
});

export const javascriptLiveProvider = createJavaScriptLiveProvider();
