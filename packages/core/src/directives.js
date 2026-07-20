// Portable directive IR. Adapters only construct these values; core owns their meaning.
export const directiveKinds = new Set(["create", "alias", "in", "out"]);

export const compose = (steps, source) => ({ kind: "compose", steps, source });
export const append = (reference, source) => ({ kind: "append", reference, source });
export const newline = (count, source) => ({ kind: "newline", count, source });
export const pipe = (steps, source) => ({ kind: "pipe", steps, source });
export const pass = (steps, source) => ({ kind: "pass", steps, source });

/**
 * A create name is document-local: `program:cool.js` becomes the surrounding
 * document's canonical chunk identity. Alias is intentionally the only
 * directive that may introduce an alternate graph name for an existing node.
 */
export const createDirective = (name, value, source) => ({ kind: "create", name, value, source });
export const aliasDirective = (name, reference, source) => ({ kind: "alias", name, reference, source });
