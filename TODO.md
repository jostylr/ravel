# Ravel TODO

## Directive composition core

- [x] Define portable directive IR nodes: `create`, `alias`, `compose`,
  `append`, `newline`, `pipe`, and `pass`.
- [x] Materialize `create("name", compose(...))` as a current-document-scoped
  graph definition. Support local `chunk:minor.type` names such as
  `program:cool.js`.
- [x] Materialize `alias("alternate", _"target")` as a provenance-preserving
  graph node; retain the original target identity in the alias provenance.
- [x] Add staged `compose` evaluation: append references in order, insert one
  newline by default, and make `newline(n)` set the next append separator.
- [x] Implement `pipe(...)` as a transformation of the current accumulator.
- [x] Implement `pass(...)` as a tee: evaluate its transforms/emits for their
  derived nodes while forwarding the unmodified accumulator.
- [x] Scope directive-pipeline `emit("minor.type")` to the surrounding
  `create` identity, matching regular chunk-pipe emission rules.
- [x] Settle directives after all documents/imports and static emissions are
  discovered; allow forward references, then diagnose unresolved names and
  cycles deterministically.

## Markdown directive fences

- [x] Reserve fenced language `ravel` for directive blocks.
- [x] Parse a small command grammar with source ranges: strings, ` _"..." `
  references, nested commands, and multiline balanced calls.
- [x] Translate `in`, `out`, `create`, `alias`, `compose`, `newline`, `pipe`,
  and `pass` into core directive IR only; keep semantics out of the adapter.
- [x] Extend Node imports so `in("other.md")` can recursively load a Markdown
  Ravel Map as well as a JSON map.

## Verification and follow-up

- [x] Add Node, Bun, and browser conformance fixtures for directive creation,
  aliases, newline joining, `pipe`, `pass`, emits, forward references, unknown
  references, and cycles.
- [x] Update the syntax and Markdown-profile guides with the final directive
  grammar and settling behavior.
