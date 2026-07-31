export const mappingKinds = new Set([
  "exact",
  "anchored",
  "transformed",
  "opaque",
  "synthetic"
]);

export const projectionStages = new Set([
  "authoring",
  "assembled",
  "transformed",
  "emitted"
]);

export const affinities = new Set(["left", "right", "none"]);

export const isInteger = (value) => Number.isInteger(value);

export const validOffsetRange = (range, { allowEmpty = true } = {}) =>
  range !== null && typeof range === "object" &&
  isInteger(range.start) && range.start >= 0 &&
  isInteger(range.end) && range.end >= range.start &&
  (allowEmpty || range.end > range.start);

export const clone = (value) => {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
};

export const deepFreeze = (value, seen = new Set()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export const stableStringify = (value) => {
  const visit = (entry) => {
    if (entry === null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return "[" + entry.map(visit).join(",") + "]";
    return "{" + Object.keys(entry).sort(compareText)
      .map((key) => JSON.stringify(key) + ":" + visit(entry[key]))
      .join(",") + "}";
  };
  return visit(value);
};

/** A deterministic, portable content hash. This is an identity checksum, not cryptography. */
export const stableHash = (value) => {
  const text = typeof value === "string" ? value : stableStringify(value);
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + (index & 255);
    second = Math.imul(second, 3266489917);
  }
  return (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0");
};

export const abortError = (message = "Projection operation was aborted.") => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

export const throwIfAborted = (signal) => {
  if (signal?.aborted) throw signal.reason?.name === "AbortError"
    ? signal.reason
    : abortError(typeof signal.reason === "string" ? signal.reason : undefined);
};

export const sourceOffset = (position) => isInteger(position) ? position : position?.offset;

export const sourceRangeOffsets = (source) => {
  const range = source?.range ?? source;
  const start = sourceOffset(range?.start);
  const end = sourceOffset(range?.end);
  return isInteger(start) && isInteger(end) && start >= 0 && end >= start
    ? { start, end }
    : null;
};

export const sourceLocation = (source) => {
  if (!source || typeof source.uri !== "string") return undefined;
  const offsets = sourceRangeOffsets(source);
  if (!offsets) return undefined;
  const start = source.range?.start ?? { line: 0, column: 0, offset: offsets.start };
  const end = source.range?.end ?? { line: 0, column: 0, offset: offsets.end };
  return clone({
    uri: source.uri,
    range: {
      start: {
        line: isInteger(start.line) ? start.line : 0,
        column: isInteger(start.column) ? start.column : 0,
        offset: offsets.start
      },
      end: {
        line: isInteger(end.line) ? end.line : 0,
        column: isInteger(end.column) ? end.column : 0,
        offset: offsets.end
      }
    }
  });
};

export const advancePosition = (start, text, count) => {
  let line = start.line;
  let column = start.column;
  for (let index = 0; index < count; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column, offset: start.offset + count };
};

export const sliceSourceLocation = (source, text, start, end) => {
  const normalized = sourceLocation(source);
  if (!normalized) return undefined;
  return {
    uri: normalized.uri,
    range: {
      start: advancePosition(normalized.range.start, text, start),
      end: advancePosition(normalized.range.start, text, end)
    }
  };
};

export const sameSourceLocation = (left, right) => stableStringify(left) === stableStringify(right);

export const rangesOverlap = (left, right, { includeBoundary = false } = {}) =>
  includeBoundary
    ? left.start <= right.end && right.start <= left.end
    : left.start < right.end && right.start < left.end;

export const containsOffset = (range, offset, affinity = "none") => {
  if (range.start === range.end) return offset === range.start;
  if (offset > range.start && offset < range.end) return true;
  if (offset === range.start) return affinity !== "left";
  if (offset === range.end) return affinity !== "right";
  return false;
};

export const encodeUriPart = (value) => encodeURIComponent(String(value));

export const encodeVirtualPath = (value) => String(value).split("/")
  .map((part) => encodeURIComponent(part))
  .join("/");

export const defaultCapabilities = (stage) => deepFreeze(stage === "emitted"
  ? { navigation: true, diagnostics: true, completion: false, writableEdits: false }
  : { navigation: true, diagnostics: true, completion: true, writableEdits: true });
