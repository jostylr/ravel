const tokenize = (text) =>
  String(text).match(/\r\n|\n|[ \t]+|[\p{L}\p{N}_]+|./gu) ?? [];

const coalesce = (parts) => {
  const result = [];
  for (const part of parts) {
    if (!part.text) continue;
    const previous = result.at(-1);
    if (previous?.type === part.type) previous.text += part.text;
    else result.push({ ...part });
  }
  return result;
};

const fallbackDiff = (before, after) => [
  ...(before.length ? [{ type: "removed", text: before.join("") }] : []),
  ...(after.length ? [{ type: "added", text: after.join("") }] : [])
];

const backtrack = (trace, before, after) => {
  let x = before.length;
  let y = after.length;
  const reversed = [];

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const diagonal = x - y;
    const paths = trace[distance];
    const previousDiagonal = diagonal === -distance ||
      (diagonal !== distance &&
        (paths.get(diagonal - 1) ?? -Infinity) <
        (paths.get(diagonal + 1) ?? -Infinity))
      ? diagonal + 1
      : diagonal - 1;
    const previousX = paths.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reversed.push({ type: "equal", text: before[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (distance === 0) break;
    if (x === previousX) {
      reversed.push({ type: "added", text: after[y - 1] });
      y -= 1;
    } else {
      reversed.push({ type: "removed", text: before[x - 1] });
      x -= 1;
    }
  }

  return coalesce(reversed.reverse());
};

const boundedMyersDiff = (before, after, maximumDistance) => {
  const maximum = before.length + after.length;
  let paths = new Map([[1, 0]]);
  const trace = [];

  for (let distance = 0;
    distance <= maximum && distance <= maximumDistance;
    distance += 1) {
    trace.push(new Map(paths));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x = diagonal === -distance ||
        (diagonal !== distance &&
          (paths.get(diagonal - 1) ?? -Infinity) <
          (paths.get(diagonal + 1) ?? -Infinity))
        ? paths.get(diagonal + 1) ?? 0
        : (paths.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      paths.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        return backtrack(trace, before, after);
      }
    }
  }
  return null;
};

export const diffText = (beforeText, afterText, options = {}) => {
  const before = tokenize(beforeText);
  const after = tokenize(afterText);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length &&
    before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) {
    suffix += 1;
  }

  const beforeMiddle = before.slice(prefix, before.length - suffix);
  const afterMiddle = after.slice(prefix, after.length - suffix);
  const maximumDistance = Number.isInteger(options.maxEditDistance)
    ? Math.max(0, options.maxEditDistance)
    : 500;
  const middle = boundedMyersDiff(beforeMiddle, afterMiddle, maximumDistance) ??
    fallbackDiff(beforeMiddle, afterMiddle);
  return coalesce([
    ...(prefix ? [{ type: "equal", text: before.slice(0, prefix).join("") }] : []),
    ...middle,
    ...(suffix ? [{ type: "equal", text: before.slice(-suffix).join("") }] : [])
  ]);
};
