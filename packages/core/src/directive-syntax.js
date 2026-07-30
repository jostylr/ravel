const diagnostic = (message, source) => ({
  code: "RM104",
  severity: "error",
  message,
  source
});

const stringValue = (value) => {
  if (value.startsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return value;
};

const tokenize = (text, sourceAt, diagnostics) => {
  const result = [];
  let index = 0;
  const add = (type, value, start, end) =>
    result.push({ type, value, start, end, source: sourceAt(start, end) });
  const readString = (start, reference = false) => {
    const quote = text[index];
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) break;
      index += 1;
    }
    if (index >= text.length) {
      diagnostics.push(diagnostic(
        "Unterminated directive string.",
        sourceAt(start, text.length)
      ));
      return;
    }
    const raw = text.slice(start + (reference ? 1 : 0), index + 1);
    const value = stringValue(raw);
    if (typeof value !== "string") {
      diagnostics.push(diagnostic(
        "Malformed directive string.",
        sourceAt(start, index + 1)
      ));
    } else {
      add(reference ? "reference" : "string", value, start, index + 1);
    }
    index += 1;
  };

  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "_" &&
        (text[index + 1] === "\"" || text[index + 1] === "'")) {
      const start = index;
      index += 1;
      readString(start, true);
    } else if (character === "\"" || character === "'") {
      const start = index;
      readString(start);
    } else if (/[a-z]/.test(character)) {
      const start = index;
      index += 1;
      while (/[a-z0-9-]/.test(text[index] ?? "")) index += 1;
      add("identifier", text.slice(start, index), start, index);
    } else if (/[0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (/[0-9]/.test(text[index] ?? "")) index += 1;
      add("number", Number(text.slice(start, index)), start, index);
    } else if (character === "(" || character === ")" ||
        character === "," || character === ";") {
      add(character, character, index, index + 1);
      index += 1;
    } else {
      diagnostics.push(diagnostic(
        "Unexpected directive character: " + character,
        sourceAt(index, index + 1)
      ));
      index += 1;
    }
  }
  return result;
};

const commandsFrom = (text, sourceAt, diagnostics) => {
  const tokens = tokenize(text, sourceAt, diagnostics);
  let index = 0;
  const current = () => tokens[index];
  const take = (type) => {
    if (current()?.type === type) return tokens[index++];
    return null;
  };
  const error = (message, token = current()) => diagnostics.push(diagnostic(
    message,
    token?.source ?? sourceAt(text.length, text.length)
  ));

  const expression = () => {
    const token = current();
    if (!token) return null;
    if (token.type === "string" || token.type === "reference" ||
        token.type === "number") {
      index += 1;
      return { type: token.type, value: token.value, source: token.source };
    }
    if (token.type !== "identifier") {
      error("Expected a directive value.");
      return null;
    }
    index += 1;
    const name = token.value;
    if (!take("(")) {
      error("Directive names must be followed by (...).", current() ?? token);
      return null;
    }
    const argumentsValue = [];
    if (!take(")")) {
      while (true) {
        const value = expression();
        if (!value) return null;
        argumentsValue.push(value);
        if (take(")")) break;
        if (!take(",")) {
          error("Expected , or ) in directive call.");
          return null;
        }
      }
    }
    const end = tokens[index - 1]?.end ?? token.end;
    return {
      type: "call",
      name,
      arguments: argumentsValue,
      source: sourceAt(token.start, end)
    };
  };

  const commands = [];
  while (index < tokens.length) {
    const command = expression();
    if (!command) {
      index += 1;
      continue;
    }
    if (command.type !== "call") {
      error("Top-level directive entries must be calls.", command);
    } else {
      commands.push(command);
    }
    take(";");
  }
  return commands;
};

const pipelineCall = (call, diagnostics) => {
  if (call.type !== "call") {
    diagnostics.push(diagnostic(
      "pipe and pass accept command calls only.",
      call.source
    ));
    return null;
  }
  if (call.name === "emit") {
    if (call.arguments.length !== 1 ||
        call.arguments[0].type !== "string") {
      diagnostics.push(diagnostic(
        "emit requires one string suffix.",
        call.source
      ));
      return null;
    }
    return {
      type: "emit",
      suffix: call.arguments[0].value,
      metadata: {},
      source: call.source
    };
  }
  if (call.arguments.some((argument) =>
    argument.type !== "string" && argument.type !== "number"
  )) {
    diagnostics.push(diagnostic(
      "Transform arguments must be strings or numbers.",
      call.source
    ));
    return null;
  }
  return {
    type: "transform",
    name: call.name,
    arguments: call.arguments.map((argument) => argument.value),
    source: call.source
  };
};

const composeStep = (value, diagnostics) => {
  if (value.type === "reference") {
    return {
      kind: "append",
      reference: value.value,
      source: value.source
    };
  }
  if (value.type !== "call") {
    diagnostics.push(diagnostic(
      "compose accepts references or directive calls.",
      value.source
    ));
    return null;
  }
  if (value.name === "newline") {
    if (value.arguments.length !== 1 ||
        value.arguments[0].type !== "number" ||
        value.arguments[0].value < 0) {
      diagnostics.push(diagnostic(
        "newline requires one non-negative integer.",
        value.source
      ));
      return null;
    }
    return {
      kind: "newline",
      count: value.arguments[0].value,
      source: value.source
    };
  }
  if (value.name === "append") {
    if (value.arguments.length !== 1 ||
        value.arguments[0].type !== "reference") {
      diagnostics.push(diagnostic(
        "append requires one quoted reference.",
        value.source
      ));
      return null;
    }
    return {
      kind: "append",
      reference: value.arguments[0].value,
      source: value.source
    };
  }
  if (value.name === "pipe" || value.name === "pass") {
    const steps = value.arguments.map((argument) =>
      pipelineCall(argument, diagnostics)
    );
    return steps.some((step) => !step)
      ? null
      : { kind: value.name, steps, source: value.source };
  }
  diagnostics.push(diagnostic(
    "Unknown compose step: " + value.name,
    value.source
  ));
  return null;
};

const directiveFrom = (command, document, diagnostics) => {
  const args = command.arguments;
  if (command.name === "create") {
    if (args.length !== 2 || args[0].type !== "string" ||
        args[1].type !== "call" || args[1].name !== "compose") {
      diagnostics.push(diagnostic(
        "create requires a local name and compose(...).",
        command.source
      ));
      return null;
    }
    const steps = args[1].arguments.map((value) =>
      composeStep(value, diagnostics)
    );
    return steps.some((step) => !step)
      ? null
      : {
          kind: "create",
          document,
          name: args[0].value,
          compose: steps,
          source: command.source
        };
  }
  if (command.name === "alias") {
    if (args.length !== 2 || args[0].type !== "string" ||
        args[1].type !== "reference") {
      diagnostics.push(diagnostic(
        "alias requires a local name and quoted reference.",
        command.source
      ));
      return null;
    }
    return {
      kind: "alias",
      document,
      name: args[0].value,
      reference: args[1].value,
      source: command.source
    };
  }
  if (command.name === "in") {
    if (args.length !== 1 || args[0].type !== "string") {
      diagnostics.push(diagnostic(
        "in requires one file path string.",
        command.source
      ));
      return null;
    }
    return { kind: "in", target: args[0].value, source: command.source };
  }
  if (command.name === "out") {
    if (args.length !== 2 || args[0].type !== "string" ||
        args[1].type !== "reference") {
      diagnostics.push(diagnostic(
        "out requires a file name and quoted reference.",
        command.source
      ));
      return null;
    }
    const from = args[1].value.includes("::")
      ? args[1].value
      : document + "::" + args[1].value;
    return {
      kind: "out",
      name: args[0].value,
      from,
      source: command.source
    };
  }
  diagnostics.push(diagnostic(
    "Unknown Ravel directive: " + command.name,
    command.source
  ));
  return null;
};

export const parseRavelDirectiveBlock = (
  text,
  { document, sourceAt }
) => {
  const diagnostics = [];
  const commands = commandsFrom(text, sourceAt, diagnostics);
  const directives = commands
    .map((command) => directiveFrom(command, document, diagnostics))
    .filter(Boolean);
  return { directives, diagnostics };
};
