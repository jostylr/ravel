import { parse } from "acorn";

const reservedBindings = new Set(["ch", "load"]);
const dynamicCodeBindings = new Set(["eval", "Function"]);

export const diagnostic = (code, message, source) => ({
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

export const analyzeJavaScript = ({ source, sourceLocation, availableModules }) => {
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
    return { version: 1, dependencies: [], resources: [], modules: [], diagnostics };
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
  const modules = new Map();
  const reportedBindings = new Set();
  const reportedDynamicCode = new Set();
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
  const reportDynamicCode = (node) => {
    const key = node.start + ":" + node.end;
    if (reportedDynamicCode.has(key)) return;
    reportedDynamicCode.add(key);
    diagnostics.push(diagnostic(
      "RJL106",
      "Dynamic code generation is unavailable in live JavaScript.",
      sourceAt(sourceLocation, source, node.start, node.end)
    ));
  };

  walk(program, (node) => {
    if (node.type === "Identifier" && node.name.startsWith("__ravel")) {
      reportBinding(node.name, node);
    }
    if (node.type === "Identifier" && dynamicCodeBindings.has(node.name)) {
      reportDynamicCode(node);
    }
    if (node.type === "MemberExpression" && node.computed &&
        node.property.type === "Literal" && dynamicCodeBindings.has(node.property.value)) {
      reportDynamicCode(node);
    }
    if (node.type === "ImportDeclaration") {
      const specifier = node.source.value;
      const entry = {
        specifier,
        source: sourceAt(sourceLocation, source, node.source.start, node.source.end)
      };
      modules.set(specifier, entry);
      if (availableModules && !availableModules.has(specifier)) {
        diagnostics.push(diagnostic(
          "RJL108",
          "Live JavaScript module is not approved: " + specifier,
          entry.source
        ));
      }
      for (const imported of node.specifiers) reportBinding(imported.local.name, imported.local);
    }
    if (node.type === "ImportExpression" || node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") {
      diagnostics.push(diagnostic(
        "RJL104",
        "Dynamic imports, named exports, and export forwarding are unavailable in live JavaScript.",
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
    if (callName !== "ch" && callName !== "load") return;
    const argument = node.arguments[0];
    if (node.arguments.length !== 1 || argument?.type !== "Literal" ||
        typeof argument.value !== "string") {
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
    version: 1,
    dependencies: [...dependencies.values()],
    resources: [...resources.values()],
    modules: [...modules.values()],
    diagnostics
  };
};
