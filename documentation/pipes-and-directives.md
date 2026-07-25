# Ravel pipes and directives reference

This is the reference for the implemented Ravel pipe commands and Markdown
`ravel`-fence directives. The examples below are deliberately small and are
mirrored by the Node tests named in [Verification](#verification).

## Two places pipes occur

An embedded substitution starts with an underscore and a matching quote. It
resolves a chunk, then sends its value through a left-to-right pipe:

```text
_"source | trim() | indent(2)"
```

The prior value is the implicit first input to an ordinary transform. A fenced
chunk may also declare a definition pipeline, which transforms the completed
chunk itself:

````markdown
```pug {.ravel #page pipe="pug()"}
html
  body hello
```
````

Definition-transform implementations belong to a host or a separate transform
package. Core receives them explicitly:

```js
transformGraph(map, { transforms: { pug, markdown } });
```

The core owns scheduling, resolution, diagnostics, and trace snapshots; it does
not import Pug, Markdown, or another language compiler.

## Ordinary transforms

Core provides these transforms. A host can register more, such as the
`capitalize`, `pug`, and `markdown` examples in the tests.

| Command | Result |
| --- | --- |
| `concat()` | Leaves the incoming value unchanged. |
| `trim()` | Removes leading and trailing whitespace. |
| `normalize-eol()` | Converts CRLF and CR line endings to LF. |
| `indent(n)` | Prefixes nonempty lines with `n` spaces. |
| `dedent()` | Removes the smallest common indentation from nonempty lines. |
| `replace(search, replacement)` | Replaces all literal occurrences. |
| `quote-reference()` | Changes `_(quote)` starts into escaped literal text. |

`indent(n)` changes the value before it is placed into its caller, so it
prefixes every nonempty line, including the first. Embedded substitutions also
apply automatic use-site continuation indentation: later nonblank lines inherit
the containing source line's leading whitespace. See the chunk syntax guide for
an example.

For example, if `source` is `"  value  \n"`:

```text
_"source | trim() | indent(2)"
```

produces `"  value"`.

Arguments are normally JSON-like literals. An ordinary transform may also take
`text(...)` and `ch(...)` arguments; those are evaluated before the transform
is invoked:

```text
_"source | surround(text('['), ch('source'))"
```

Here a host-provided `surround` command receives the literal `"["` and the
value of `source` as its two arguments.

## Value-producing commands: `text` and `ch`

Unlike ordinary transforms, these commands discard the incoming value and start
with a new one.

### `text([string])`

`text` produces its argument literally. It accepts zero or one string:

```text
_"source | text('cool') | capitalize()"  # Cool
_"source | text()"                       # empty string
_"|text('cool')|capitalize()"            # Cool
```

The leading-pipe form has no starting chunk. It is valid only when the first
command is `text(...)` or `ch(...)`.

### `ch(expression)`

`ch` evaluates a quoted Ravel chunk expression and makes that result the new
incoming value. Its argument has no underscore prefix because `ch` marks it
unambiguously as a chunk expression:

```text
_"source | ch('other | trim()')"
_`|ch('|text("cool")|capitalize()')`
```

The second example starts the inner expression with `text`, then passes it to a
host-provided `capitalize` transform. `ch` is also valid as an ordinary
transform argument, as shown in the `surround` example above.

## Delayed substitution: `delay`

`delay` preserves a safe placeholder through one or more definition-transform
phases, then replaces it with a literal value or a chunk result. It is the only
command with a restricted position:

```text
_"|delay(ch('content.markdown | markdown()'), 1, 'RAVELSAFE')"
_"|delay(text('literal after phase one'), 1)"
_"|delay('another literal', 1)"
```

Its parameters are:

1. A string, `text(...)`, or `ch(...)` value.
2. Optional positive phase number; defaults to `1`.
3. Optional alphanumeric safe symbol. Without it, Ravel creates one.

The `ch(...)` form defers evaluation of a chunk. A bare string or `text(...)`
defers literal text. For a Pug/Markdown-shaped build, the Pug source contains a
safe placeholder during the Pug phase; after Pug creates HTML, Ravel evaluates
the Markdown chunk and replaces the marker.

`delay` must be the complete top-level expression. These are errors:

```text
_"source | delay(ch('content'))"
_"|delay(ch('content'))|capitalize()"
_"|ch('|delay(ch("content"))')"
```

This prevents accidental delayed work inside an ordinary transform argument or
inside a nested chunk pipeline. If a transform removes or duplicates the safe
symbol, Ravel reports an error. Intermediate `protected-input`,
`transform-output`, and `fulfilled-output` values remain available under
`program.trace.chunks[chunkId]`.

## Derived chunks: `emit`

`emit` is a pipe tee: it leaves the incoming value unchanged and also declares
an immutable, local derived chunk using the preceding part of the pipe.

```text
_`widget | dedent() | emit('clean', {
  "language": "typescript",
  "tags": ["generated"]
})`
```

Inside `guide::widget`, this creates `guide::widget:clean`. The suffix may be:

| Suffix | Generated identity |
| --- | --- |
| `"minor"` | Same document/chunk, new minor, no type. |
| `"minor.type"` | Same document/chunk, new minor and type. |
| `".type"` | Same document/chunk/minor, new type. |

An emitted chunk cannot change document or base-chunk identity, overwrite an
existing chunk, or be made from a document-less global chunk.

## Directives in a `ravel` fence

Directives build graph structure and deliverables. They are written in a fenced
block whose language is exactly `ravel`:

````markdown
```ravel
in("shared.md")

create("program:stage.js", compose(
  _"source.text",
  pass(trim(), emit("observed.js")),
  pipe(trim(), emit("min.js"), indent(2))
))

alias("public.js", _"program:stage.js")
out("dist/stage.js", _"public.js")
```
````

### Graph and output directives

| Directive | Meaning |
| --- | --- |
| `in("file.md")` | Loads and merges another Markdown or JSON Ravel Map before evaluation. |
| `create("name", compose(...))` | Creates a document-local generated chunk. |
| `alias("name", _"target")` | Creates another document-local name for an existing chunk. |
| `out("path", _"target")` | Plans a named deliverable from a fully qualified target. |

`create` and `alias` names are local to the surrounding document. For example,
in document `guide`, `create("program:stage.js", ...)` creates
`guide::program:stage.js`. `out` qualifies a local reference with that same
document before creating the deliverable.

### `compose` steps

`compose(...)` starts with an empty accumulator and processes its steps in
order:

| Step | Meaning |
| --- | --- |
| `_<quote>reference<quote>` or `append(_<quote>reference<quote>)` | Append the referenced chunk. |
| `newline(n)` | Set the separator before the next append to `n` newlines; default is one. |
| `pipe(commands...)` | Transform the accumulator and keep the transformed value. |
| `pass(commands...)` | Transform the accumulator only for nested `emit`s, then keep the original value. |

The `create` example above demonstrates both `pass` and `pipe`. Given source
text `"  value  \n"`, it produces:

| Chunk | Value |
| --- | --- |
| `program:stage.js` | `"  value"` |
| `program:observed.js` | `"value"` |
| `program:min.js` | `"value"` |

`pass` is useful for recording an observed derived form without changing the
main composition. `pipe` changes the main accumulator after its commands run.

## Verification

These examples correspond to tested behavior:

| Topic | Test |
| --- | --- |
| Reference transforms and `emit` | `test/core-graph.test.mjs`: “transforms references, expands emit chunks, and plans out deliverables”. |
| `create`, `alias`, `pipe`, `pass`, and `newline` | `test/core-graph.test.mjs`: “create imposes…” and “compose pipe transforms…”. |
| Definition phases and delayed substitution | `test/core-graph.test.mjs`: “definition pipelines execute around delayed substitutions…”. |
| `text`, `ch`, command arguments, and `text()` | `test/core-graph.test.mjs`: “text and ch reset a pipeline…”. |
| Isolated `delay` validation | `test/core-graph.test.mjs`: “delay is permitted only…”. |
| External Pug-like and Markdown-like transforms | `test/host-node.test.mjs`: “external language transforms run before delayed content is fulfilled”. |
| Markdown directive-fence translation | `test/markdown-adapter.test.mjs`: “ravel fences translate directives…”. |

Run the complete set with:

```sh
npm test
```
