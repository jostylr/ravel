import { deepFreeze, isInteger } from "./internal.js";

const encodings = new Set(["utf-8", "utf-16", "utf-32"]);

const unitsFor = (text, encoding) => {
  if (encoding === "utf-16") return text.length;
  let units = 0;
  for (const character of text) {
    if (encoding === "utf-32") units += 1;
    else {
      const code = character.codePointAt(0);
      units += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
  }
  return units;
};

const contentEnd = (index, line) => {
  const start = index.lineStarts[line];
  const next = index.lineStarts[line + 1] ?? index.text.length;
  let end = next;
  if (end > start && index.text[end - 1] === "\n") end -= 1;
  if (end > start && index.text[end - 1] === "\r") end -= 1;
  return end;
};

export const createLineIndex = (text = "") => {
  if (typeof text !== "string") text = String(text ?? "");
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") lineStarts.push(index + 1);
  }
  return deepFreeze({ text, textLength: text.length, lineStarts });
};

const lineAt = (index, offset) => {
  let low = 0;
  let high = index.lineStarts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (index.lineStarts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low;
};

export const positionAt = (index, offset, encoding = "utf-16") => {
  if (!index || typeof index.text !== "string" || !isInteger(offset) ||
      offset < 0 || offset > index.text.length || !encodings.has(encoding)) {
    return { ok: false, reason: "invalid-position" };
  }
  const line = lineAt(index, offset);
  const end = contentEnd(index, line);
  const safeOffset = Math.min(offset, end);
  return {
    ok: true,
    position: {
      line,
      character: unitsFor(index.text.slice(index.lineStarts[line], safeOffset), encoding),
      offset
    }
  };
};

export const offsetAt = (index, position, encoding = "utf-16") => {
  if (!index || typeof index.text !== "string" || !position ||
      !isInteger(position.line) || position.line < 0 ||
      !isInteger(position.character) || position.character < 0 ||
      position.line >= index.lineStarts.length || !encodings.has(encoding)) {
    return { ok: false, reason: "invalid-position" };
  }
  const start = index.lineStarts[position.line];
  const end = contentEnd(index, position.line);
  if (position.character === 0) return { ok: true, offset: start };
  if (encoding === "utf-16") {
    if (position.character > end - start) return { ok: false, reason: "character-out-of-range" };
    const offset = start + position.character;
    if (offset > start && offset < end) {
      const previous = index.text.charCodeAt(offset - 1);
      const current = index.text.charCodeAt(offset);
      if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
        return { ok: false, reason: "split-character" };
      }
    }
    return { ok: true, offset };
  }

  let units = 0;
  let offset = start;
  for (const character of index.text.slice(start, end)) {
    const width = character.length;
    const next = unitsFor(character, encoding);
    if (units + next > position.character) return { ok: false, reason: "split-character" };
    units += next;
    offset += width;
    if (units === position.character) return { ok: true, offset };
  }
  return { ok: false, reason: "character-out-of-range" };
};

export const lineRangeAt = (index, line) => {
  if (!index || !isInteger(line) || line < 0 || line >= index.lineStarts.length) {
    return { ok: false, reason: "invalid-line" };
  }
  return {
    ok: true,
    range: {
      start: index.lineStarts[line],
      end: index.lineStarts[line + 1] ?? index.text.length
    }
  };
};

export const lineWindow = (index, range, surroundingLines = 3) => {
  if (!index || !range || !isInteger(range.start) || !isInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end > index.text.length) {
    return { ok: false, reason: "invalid-range" };
  }
  const count = isInteger(surroundingLines) && surroundingLines >= 0 ? surroundingLines : 3;
  const first = Math.max(0, lineAt(index, range.start) - count);
  const lastOffset = range.end > range.start ? range.end - 1 : range.end;
  const last = Math.min(index.lineStarts.length - 1, lineAt(index, lastOffset) + count);
  return {
    ok: true,
    range: {
      start: index.lineStarts[first],
      end: index.lineStarts[last + 1] ?? index.text.length
    }
  };
};
