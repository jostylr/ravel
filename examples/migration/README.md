# Legacy FizzBuzz migration

This runnable example extracts the compact old-style
[`FizzBuzz`](../../../tests/tests-full/fizzbuzz/fizzbuzz.md) document as a
useful migration specimen.  Its generated JavaScript keeps the old program's
intent while correcting its undeclared loop variable and making the helper a
normal declaration rather than an anonymous block value.

Run it from the `ravel` directory:

```sh
node packages/cli/src/index.js build --config examples/migration/ravel-fizzbuzz.toml
node examples/migration/.ravel/runs/legacy-fizzbuzz-migration/dist/fizzbuzz.js
```

The build writes the directive-declared `fizzbuzz.js`, `fizzbuzz-source.js`,
and `fizzbuzz-compact.js`, plus `fizzbuzz-via-config.js` from the TOML output
declaration. All four contain runnable JavaScript; `source` records the
`pass` branch and `compact` records the `pipe` branch as derived chunks in the
program graph.

| Legacy construct | Ravel representation | Status |
| --- | --- | --- |
| Heading-derived `Structure` and named sections | Explicit `#program--minor` fenced chunks | Representable, but intentionally explicit |
| Indented code blocks | Language fences with `.ravel` | Representable after a mechanical fence conversion |
| `_"named block"` composition | `_"program:minor.js"` source-linked references | Representable |
| A block extended across locations | `.greedy` adjacent same-language fences and `.end` | Representable for contiguous fragments |
| `save:` link directives | `out()` directive or `[[outputs]]` TOML declaration | Representable as a planned, host-written deliverable |
| Link-driven `jshint` pipe | No built-in equivalent | Keep in a separate lint/tool step |
| `evil` evaluation pipe | No equivalent in the safe static core | Deliberately unsupported |
| Heading scope, raw-document commands, H5/H6 behavior | No Markdown-heading semantics | Deliberately unsupported by this adapter |
| Arbitrary custom directives, async load/save events | Not in the first static vertical slice | Requires a future host/effect adapter |

The example also deliberately exercises front-matter document identity,
primary mode with `.no-ravel`, a document import, definition transforms,
greedy fragments, local and cross-document references, `create`, `compose`,
`newline`, `pass`, `pipe`, `emit`, `alias`, direct `out`, and a TOML output.

This means it is not a byte-for-byte parser conversion: the legacy adapter
inferred code identity from Markdown structure and ran arbitrary command
pipelines, while the Ravel adapter extracts an explicit static graph.  The
mapping preserves the reusable weaving model and makes the incompatible
runtime-oriented parts visible instead of silently changing their meaning.
