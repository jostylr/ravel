# Markdown fenced-block profile

`markdown+ravel-fences-v1` is the first Ravel format adapter. It treats only
fenced code blocks as chunks; headings, links, and prose have no effect on
chunk identity.

The opt-in 0.2 modern profile, `markdown+ravel-modern-v1`, additionally lets
H2-H6 headings own unnamed fences while named fences continue to own only
themselves. Select it with `modernMarkdownToMap`, `profile: "modern"`, or
`lp.adapter: markdown` in YAML front matter. This explicit selection preserves
the published fence-only behavior of existing `markdownToMap` calls.

````markdown
## Main program | trim()

```javascript
first();
```

```javascript lp:helper | normalize-eol()
helper();
```

```javascript
third();
```
````

`main-program` contains the first and third bodies; `helper` contains the
middle body. A pipeline may instead appear after the language of the first
unnamed fence. Pandoc/Quarto attribute forms use `.lp-piece`, `#lp-name`,
`lp-title`, `lp-pipe`, and `.lp-fragment lp-for="name"`. Fragment languages
and original info strings are retained in adapter metadata. A heading-owned
fence may use `.run` and `provider=...`; these are still declarative execution
metadata and never cause adapter-time execution.

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

`.ravel`, `.run`, `.no-ravel`, `.greedy`, and `.end` are reserved control classes.
Other classes become chunk tags. A named `#chunk` fence is Ravel even without
`.ravel`; use `.ravel` to make this visible, and it is required for `.greedy`.

In 0.2 development, `.run` marks an explicitly named chunk for the separate
live-execution stage and implies `.ravel`. The language token remains available
for syntax highlighting and provider selection. `.run` does not execute during
Markdown parsing, and a language token alone never opts a block into execution.
The CLI's `run` and `build` commands execute marked blocks; `check` and
`inspect` do not. During a build, live strings can enter ordinary Ravel
processing directly. `jsontext()` serializes complete non-string live values,
while `jsontext("key")` selects one top-level object value.
See [Live execution](live-execution.md).

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

The profile parses `pipe="..."` into the chunk's `definitionPipeline` and also
retains the authored text at `metadata.data.ravel.definitionPipe`. The core runs
the pipeline after ordinary substitutions have been protected. Built-in core
transforms work directly; language transforms are supplied by a host or a
separate transform package through `transformGraph(map, { transforms })`.

For example, a Node Pug package may register a `pug` transform without making
the portable core depend on Pug. `emit(...)` remains retained metadata here;
definition-time graph emission is not part of this phase runner.

## Directive fences

Reserve the fenced language `ravel` for graph directives. A directive fence is
not a source chunk, regardless of Markdown mode. Its commands may be separated
by newlines or semicolons; calls can span lines and nest normally.

````markdown
```ravel
in("shared.md")

create("program:browser.js", compose(
  _"shared::preamble.javascript",
  newline(2),
  _"main.javascript",
  pass(trim(), emit("observed.js")),
  pipe(trim(), emit("min.js"), indent(2))
))

alias("public.js", _"program:browser.js")
out("dist/program.js", _"public.js")
```
````

The directive expression grammar is deliberately small:

    Command     = Identifier "(" [ Expression { "," Expression } ] ")"
    Expression  = String | Number | QuotedReference | Command
    QuotedReference = "_" String

`create(name, compose(...))` requires a document-local `name`, such as
`program:browser.js`; the adapter supplies the document component. A reference
inside `compose` appends its completed chunk value. `newline(n)` changes only
the separator before the next appended reference (the default is one newline).
`pipe(...)` replaces the composition accumulator with its transformed value.
`pass(...)` runs the same transform/emit sequence but forwards the original
accumulator, which makes it a useful tee.

Transform calls currently accept string and number arguments. `emit("minor")`,
`emit("minor.type")`, and `emit(".type")` follow the normal local emit rules:
they retain the create node’s document and base chunk. `alias` is the deliberate
way to introduce another graph name; its program provenance points back to the
original target. `out` receives a file-like name and a quoted chunk reference;
local references are qualified with the enclosing document by the adapter.

All Markdown documents and `in(...)` imports are mapped before directive
evaluation. Thus forward references work regardless of source order. After the
graph settles, missing references and cycles produce ordinary source-linked
diagnostics. The Node host accepts both `.md`/`.markdown` and JSON Ravel Maps
as `in` targets; paths resolve relative to the directive’s source document.

## Filesystem boundary

Every build has a filesystem root. For a TOML run it is the directory
containing the TOML file; for a direct Markdown or JSON run it is the
directory containing the initial file. `[[files]]` paths and Markdown
`in(...)` imports must stay under that root. Absolute paths and `..` traversal
that escape it, and any symbolic link at or below that root, are rejected.

`build.out_dir`, directive/TOML deliverable names, and `--graph` writes are
also confined to that root. Deliverable names remain relative to
`build.out_dir`. The explicit CLI `--out-dir` flag is the exception: it may
select a new output root anywhere, but output below that chosen root still
cannot escape it or traverse a symbolic link.

## One TOML build run

A TOML file represents one build run and can list multiple Markdown files:

```toml
version = 1

[build]
name = "web"
out_dir = "dist/web"
clean = false
# backup = true
# backup = "backups/web-before-clean.zip"

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

Run `ravel build --config ravel-web.toml`. A project file named `ravel.toml` can
instead be run with plain `ravel`. Paths, including `build.out_dir`, are
resolved relative to the TOML file and must remain below its directory. Use a
separate TOML for a different build pathway; configs are not merged.

For one document, use `ravel build guide.md --out-dir dist` or inspect without
writing with `ravel inspect guide.md --mode primary`.
