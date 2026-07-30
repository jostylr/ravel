# noweb

`@pieceful/ravel-noweb` is a small, lossless scanner for classic noweb source.
It maps documentation, definitions, repeated fragments, references, and
terminators into the same Ravel Map and graph used by the Markdown adapters.
It does not invoke `notangle`, `noweave`, TeX, or an execution provider.

## Classic syntax

```noweb
The entry point delegates construction of its message.

<<main.js>>=
console.log(<<message>>);
@

<<message>>=
hello
@
```

`<<name>>=` starts a definition, `@` on its own line returns to
documentation, and `<<name>>` inside code is a reference. Repeating the same
definition concatenates its exact body segments in source order. The
documentation immediately before each declaration is retained as narrative
metadata and in the adapter's surface map.

The strict `noweb` dialect does not split pipes. Therefore
`<<name | trim()>>=` is a classic chunk literally named `name | trim()`.

Classic noweb declarations contain no source language. The adapter uses, in
order, a matching pragma, per-name configuration, a default configured
language, or a recognizable filename extension such as `.js`.

## noweb-plus

The `noweb-plus` dialect splits the first unescaped pipe and uses the shared
typed pipeline grammar:

```noweb
<<main | trim()>>=
  <<message | trim()>>
@
```

This spelling is deliberately an extension. Each extended definition or
reference produces a portability warning because classic noweb treats the
pipe and pipeline text as part of the chunk name. Repeated definitions may
declare a pipeline only when their normalized pipelines agree, and the
pipeline runs once after all fragments have been concatenated.

For source that must remain consumable by classic noweb, use a documentation
pragma and enable underscore-quote references:

```noweb
@ %ravel pipeline main | trim()
<<main>>=
_"message | indent(2)"
@
```

The pragma is attached to the next matching definition. Other inert planning
pragmas are:

```noweb
@ %ravel language main | javascript
@ %ravel output main | dist/main.js
@ %ravel run main | provider=quickjs-wasm-worker
```

An output pragma creates an `out` directive. A run pragma records live
metadata. Parsing performs neither operation.

## Node host configuration

`.nw` and `.noweb` inputs select this adapter automatically. A TOML build can
make all policy explicit:

```toml
version = 1

[[files]]
path = "program.nw"
adapter = "noweb"
dialect = "noweb-plus"
references = "both"
language = "javascript"
run = true
provider = "quickjs-wasm-worker"
```

The portable API is:

```js
import { nowebToMap } from "@pieceful/ravel-noweb";

const { map, diagnostics, surface } = nowebToMap(source, {
  uri: "program.nw",
  document: "program",
  dialect: "noweb-plus",
  references: "both"
});
```

`surface.definitions` and `surface.references` retain exact authored ranges,
including the visible `<<…>>` reference delimiters. The core receives an
opt-in reference syntax description so it can build the ordinary reference
AST while leaving each chunk body byte-for-byte as authored.
