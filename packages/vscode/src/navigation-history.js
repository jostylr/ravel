export const sameNavigation = (left, right) => Boolean(
  left && right &&
  left.entityId === right.entityId &&
  left.generatedOffset === right.generatedOffset
);

export const createNavigationHistory = (maximum = 100) => {
  const limit = Number.isInteger(maximum) && maximum > 0 ? maximum : 100;
  const entries = [];
  return {
    get length() {
      return entries.length;
    },
    peek() {
      return entries.at(-1);
    },
    push(entry) {
      if (!entry || sameNavigation(entry, entries.at(-1))) return false;
      entries.push({ ...entry });
      if (entries.length > limit) entries.shift();
      return true;
    },
    pop() {
      return entries.pop();
    },
    clear() {
      entries.length = 0;
    }
  };
};
