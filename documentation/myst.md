# MyST Markdown

`@pieceful/ravel-myst` maps MyST directives, anchors, captions, code, and
notebook-cell metadata into a Ravel Map without invoking MyST, Jupyter, or a
language runtime. The scanner preserves directive bodies and source ranges
exactly.

The separate `@pieceful/ravel-myst-plugin` package teaches MyST how to render
the custom `{ravel:piece}` and `{ravel}` directives. Keeping it separate means
parsing Ravel source does not require MyST, while a MyST project can opt into
native presentation.

MyST permits both colon and backtick directive fences, arguments after the
directive name, and `:key: value` options. See the official
[syntax overview](https://mystmd.org/guide/syntax-overview),
[code-block guide](https://mystmd.org/guide/code), and
[cross-reference guide](https://mystmd.org/guide/cross-references).

## Piece directives

~~~~markdown
```{ravel:piece} main | normalize-eol() | trim()
:language: javascript
:caption: Main program
:label: lp-main

console.log(_"format-greeting");
```
~~~~

The argument before the first unescaped pipe is the authored piece name.
`:label:` supplies both the stable MyST anchor and the semantic ID after an
optional `lp-` prefix is removed. `:caption:` is the visible name and
`:language:` controls highlighting and language metadata. Omitting a label
infers the ID from the argument and produces an informational stability
diagnostic.

The pipeline is parsed with Ravel's shared typed grammar and runs once after
all fragments have been concatenated. Both colon and backtick fences work,
although MyST recommends backticks for code-like directive bodies.

`{piece}` remains a short alias for `{ravel:piece}`. The namespaced spelling is
canonical and avoids collisions with unrelated MyST plugins.

## Native Ravel rendering plugin

Install the adapter and renderer independently:

```sh
npm install @pieceful/ravel-myst @pieceful/ravel-myst-plugin
```

Register the plugin in `myst.yml`:

```yaml
project:
  plugins:
    - node_modules/@pieceful/ravel-myst-plugin/plugin.mjs
```

The plugin turns `{ravel:piece}` into standard MyST code, container, caption,
and code-cell nodes. MyST therefore supplies syntax highlighting and ordinary
label-based cross references. The class `ravel-piece` is added for theme
customization, the caption defaults to `Piece: <name>`, and the definition
pipeline is displayed beside it unless `:show-pipeline: false` is set.

The `{ravel}` directive is the MyST equivalent of Markdown's fenced `ravel`
language. Its body contains `in`, `create`, `alias`, and `out` graph
directives:

~~~~markdown
:::{ravel}
out("dist/main.js", _"main")
:::
~~~~

The plugin renders that body as visible, static Ravel code. The adapter parses
it through the same graph-directive grammar used by ordinary Markdown. The
plugin itself does not construct the Ravel graph, resolve code-composition
references, weave outputs, or execute live code.

## Native no-plugin fallback

A MyST installation without the Ravel plugin can render and cross-reference
the built-in code directive directly:

~~~~markdown
```{code-block} javascript
:label: lp-format-greeting
:caption: Greeting formatter

function formatGreeting() {
  return "hello";
}
```

See [](#lp-format-greeting).
~~~~

`{code}` is equivalent. Ravel recognizes these native directives only when
their label starts with `lp-`, so ordinary examples remain ordinary MyST
content. The label provides the semantic name, and a caption is required for a
visible piece name. This fallback intentionally has no Ravel-only pipeline
option.

## Composition and document navigation

Code composition remains explicit inside a piece:

```javascript
console.log(_"format-greeting | trim()");
```

MyST links such as `[](#lp-main)`, `{ref}` roles, and `@lp-main` shorthand are
recorded in `surface.navigation` with exact ranges. They point readers to
rendered anchors but never splice code. Underscore-quote uses are recorded in
`surface.references` and are the only MyST form that enters Ravel's dependency
graph.

## Notebook cells and live blocks

MyST's documented `{code-cell}` directive, front-matter `kernelspec`, and cell
`:tags:` are retained:

~~~~markdown
---
kernelspec:
  name: python3
  display_name: Python 3
---

```{code-cell} python
:label: lp-analysis
:caption: Analysis
:tags: [hide-output]

print("hello")
```
~~~~

The adapter emits an inert `myst-code-cell` effect plan. MyST owns it by
default. A custom `{ravel:piece}` can request the same mapping with `:cell:`.

Ravel live execution is deliberately separate. A cell runs through Ravel only
when its owner is explicitly `ravel` and `run` is requested. Ownership
may be selected directly on a piece:

~~~~markdown
```{ravel:piece} analysis
:language: javascript
:cell:
:execution-owner: ravel
:run:
:provider: quickjs-wasm-worker

export default { answer: 42 };
```
~~~~

The rendering plugin keeps this form static in MyST, while the adapter records
the Ravel live request. The same policy can be supplied through the portable
API:

```js
import { mystToMap } from "@pieceful/ravel-myst";

const { map, diagnostics, surface } = mystToMap(source, {
  uri: "program.myst.md",
  document: "program",
  executionOwner: "ravel",
  run: true,
  provider: "quickjs-wasm-worker"
});
```

## Node host configuration

Files ending in `.myst.md` select this adapter automatically. An ordinary
`.md` file can select it explicitly:

```toml
version = 1

[[files]]
path = "program.md"
adapter = "myst"
execution_owner = "ravel"
run = true
provider = "quickjs-wasm-worker"
```

`execution_owner = "myst"` retains native notebook authority. Parsing never
executes a cell, fetches a cross-reference, or renders a document.

The checked-in `fixtures/myst/fallback.myst.md` compatibility fixture uses only
built-in MyST directives. `fixtures/myst/plugin-project` is a native MyST
project that exercises visible pipelines, labels, cross references, native
cells, graph directives, and Ravel-owned cells. Run `npm run test:myst-plugin` to build and
inspect its transformed MyST document.
