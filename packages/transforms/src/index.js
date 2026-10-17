// Built-in, portable pipeline transforms. Each transform follows the core
// contract `(value, { arguments }) => string` and throws to report a problem;
// core turns a throw into a source-linked RV121 diagnostic.
import { micromark } from "micromark";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const parseObjectText = (value) => {
  if (typeof value !== "string" || !/^\s*\{/.test(value)) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// A keyed value that is the JSON text of a list or object (for example a
// `ch('pages::index.json')` argument) is used as data; other text stays text.
const parseListOrObjectText = (value) => {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
};

/**
 * Render CommonMark to HTML. Raw HTML in the source is escaped unless the
 * first argument is `{ "html": true }`, because Markdown often comes from
 * content authors rather than template authors.
 */
export const markdown = (value, { arguments: args = [] } = {}) => {
  const [options = {}] = args;
  if (args.length > 1 || !isPlainObject(options)) throw new Error("markdown accepts at most one options object such as {\"html\": true}.");
  return micromark(value, { allowDangerousHtml: options.html === true });
};

/**
 * Merge template arguments into one data object. Arguments are read left to
 * right: an object (a literal or the JSON text of an object, e.g. from a
 * `ch('data.json')` argument) is merged in; any other string names a key and
 * the following argument is its value (JSON text of a list or object becomes
 * that list or object). Each top-level key remembers which
 * argument supplied it, so a host can attribute inserted text to its source.
 */
export const templateData = (args) => templateScope(args).data;

const templateScope = (args) => {
  const data = {};
  const origins = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const object = isPlainObject(argument) ? argument : parseObjectText(argument);
    if (object) {
      Object.assign(data, object);
      for (const key of Object.keys(object)) origins[key] = { argument: index, whole: false };
      continue;
    }
    if (typeof argument !== "string" || index + 1 >= args.length) {
      throw new Error("template arguments must be objects, JSON object text, or a key followed by its value.");
    }
    const value = parseListOrObjectText(args[index + 1]);
    data[argument] = value;
    origins[argument] = { argument: index + 1, whole: typeof value === "string" };
    index += 1;
  }
  return { data, origins };
};

const tagPattern = /\\\{\{|\{\{\s*(?:(#each)\s+([A-Za-z_][\w-]*(?:\.[\w-]+)*)|(\/each)|(this|[A-Za-z_][\w-]*(?:\.[\w-]+)*)(?:\s*\|\s*(html))?)\s*\}\}/g;

// Parse a template into literal ranges, values, and `#each` blocks.
const parseTemplate = (text) => {
  const root = { children: [] };
  const stack = [root];
  let cursor = 0;
  const literal = (start, end) => {
    if (end > start) stack.at(-1).children.push({ type: "literal", start, end });
  };
  for (const match of text.matchAll(tagPattern)) {
    literal(cursor, match.index);
    cursor = match.index + match[0].length;
    if (match[0] === "\\{{") {
      stack.at(-1).children.push({ type: "text", value: "{{" });
    } else if (match[1]) {
      const block = { type: "each", path: match[2], children: [] };
      stack.at(-1).children.push(block);
      stack.push(block);
    } else if (match[3]) {
      if (stack.length === 1) throw new Error("template has {{/each}} without a matching {{#each}}.");
      stack.pop();
    } else {
      stack.at(-1).children.push({ type: "value", path: match[4], filter: match[5] ?? null });
    }
  }
  if (stack.length > 1) throw new Error("template has {{#each " + stack.at(-1).path + "}} without {{/each}}.");
  literal(cursor, text.length);
  return root.children;
};

const resolvePath = (scopes, path) => {
  const [head, ...rest] = path.split(".");
  for (const scope of scopes) {
    let current;
    if (head === "this") current = scope.value;
    else if (isPlainObject(scope.value) && Object.hasOwn(scope.value, head)) current = scope.value[head];
    else continue;
    for (const part of rest) {
      if (!(isPlainObject(current) || Array.isArray(current)) || !Object.hasOwn(current, part)) return { found: false };
      current = current[part];
    }
    return { found: true, value: current, origin: scope.origin ?? scope.origins?.[head] };
  }
  return { found: false };
};

/**
 * Fill a template. `{{ name }}` inserts a value (dotted paths reach nested
 * values; objects and arrays are inserted as JSON), `{{ name | html }}`
 * escapes HTML, `{{#each list}}…{{/each}}` repeats its body for every item
 * (inside it, `{{ this }}` is the item and plain names look in the item first),
 * and `\{{` writes a literal `{{`. A missing value is an error rather than an
 * empty string so a typo cannot silently drop content. Values are inserted as
 * text without escaping.
 *
 * Given `{ parts: true }` in the context (Ravel core does this), the result is
 * `{ parts }` describing which output text came from the template itself and
 * which from an argument, so provenance can point at both.
 */
export const template = (value, context = {}) => {
  const { arguments: args = [] } = context;
  const { data, origins } = templateScope(args);
  const parts = [];
  const render = (nodes, scopes) => {
    for (const node of nodes) {
      if (node.type === "literal") parts.push({ input: [node.start, node.end] });
      else if (node.type === "text") parts.push(node.value);
      else if (node.type === "value") {
        const resolved = resolvePath(scopes, node.path);
        if (!resolved.found || resolved.value === undefined || resolved.value === null) {
          throw new Error("template has no value for {{ " + node.path + " }}.");
        }
        const raw = typeof resolved.value === "string" ? resolved.value : JSON.stringify(resolved.value);
        const text = node.filter === "html" ? escapeHtml(raw) : raw;
        const origin = resolved.origin;
        if (origin?.whole && node.filter !== "html" && node.path.indexOf(".") === -1 && text === args[origin.argument]) {
          parts.push({ argument: origin.argument, start: 0, end: text.length });
        } else if (origin) {
          parts.push({ text, argument: origin.argument });
        } else {
          parts.push(text);
        }
      } else {
        const resolved = resolvePath(scopes, node.path);
        if (!resolved.found || !Array.isArray(resolved.value)) {
          throw new Error("template {{#each " + node.path + "}} needs a list.");
        }
        for (const item of resolved.value) {
          render(node.children, [{ value: item, origin: resolved.origin && { argument: resolved.origin.argument, whole: false } }, ...scopes]);
        }
      }
    }
  };
  render(parseTemplate(value), [{ value: data, origins }]);
  if (context.parts === true) return { parts };
  return parts.map((part) => typeof part === "string" ? part
    : part.input ? value.slice(part.input[0], part.input[1])
      : part.text ?? args[part.argument].slice(part.start, part.end)).join("");
};

export const escapeHtml = (value) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

/** Wrap a value as a JSON string literal, for embedding text in JSON chunks. */
export const json = (value, { arguments: args = [] } = {}) => {
  if (args.length) throw new Error("json accepts no arguments.");
  return JSON.stringify(value);
};

/** The transforms Ravel hosts register by default. */
export const builtinTransforms = Object.freeze({ markdown, template, json });
