# Markdown fenced-block profile

`markdown+ravel-fences-v1` is the first Ravel format adapter. It treats only
fenced code blocks as chunks; headings, links, and prose have no effect on
chunk identity.

## Named chunks

Use Pandoc-style attributes after a fence language:

````markdown
```typescript {.ravel #compiler--what type=ts .browser}
export function compile() {}
```
````

This produces `document::compiler:what.ts`. The first bare word is the display
language (`typescript`); it becomes the default Ravel type when `type` is not
present. `#name` supplies the chunk component. `#name--minor` is a shorthand
for a chunk/minor pair; use `chunk=name--with-double-hyphens` when the base
chunk literally contains `--`. Explicit `minor=` and `type=` override defaults.

`.ravel`, `.no-ravel`, `.greedy`, and `.end` are reserved control classes.
Other classes become chunk tags. A named `#chunk` fence is Ravel even without
`.ravel`; use `.ravel` to make this visible, and it is required for `.greedy`.

## Greedy continuation

A `.greedy` named fence may be followed by plain fences of the same language.
Their bodies are joined in source order and recorded as chunk fragments:

````markdown
```typescript {.ravel #compiler .greedy}
export const first = true;
```

```typescript
export const second = true;
```

```typescript {.end}
export const last = true;
```
````

The `.end` fence is included, then closes greedy mode. A different-language
fence, a `.no-ravel` fence, or a new named/Ravel fence closes greedy mode before
that fence is processed.

## Document identity and modes

Document identity is selected in this order: CLI `--document`, TOML
`files.document`, YAML front matter (`ravel.document`), then a normalized source
filename stem. The adapter has two modes:

- `opt-in` (default): unnamed fences are ordinary Markdown examples.
- `primary`: every non-excluded fence must start a named Ravel chunk or be a
  valid greedy continuation; use `.no-ravel` for ordinary examples.

## Definition pipes

The profile accepts `pipe="..."` and retains the text at
`metadata.data.ravel.definitionPipe` in its Ravel Map output. Definition-time
pipeline evaluation—including definition-time `emit`—is deliberately not yet
enabled in core. It needs a staged evaluator so a generated sibling can refer to
the source chunk’s value without creating a self-cycle. The retained field makes
the authoring syntax stable while that core feature is implemented.

## One TOML build run

A TOML file represents one build run and can list multiple Markdown files:

```toml
version = 1

[build]
name = "web"
out_dir = "dist/web"

[[files]]
path = "docs/guide.md"
document = "guide"
mode = "primary"

[[files]]
path = "docs/runtime.md"
document = "runtime"

[[outputs]]
name = "dist/main.js"
from = "guide::main.javascript"
```

Run `ravel build --config ravel-web.toml`. Paths, including `build.out_dir`, are
resolved relative to the TOML file. Use a separate TOML for a different build
pathway; configs are not merged.

For one document, use `ravel build guide.md --out-dir dist` or inspect without
writing with `ravel inspect guide.md --mode primary`.
