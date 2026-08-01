# `@pieceful/ravel-myst`

Lossless MyST Markdown source adapter for [Ravel](https://github.com/jostylr/ravel). It recognizes canonical
`{ravel:piece}` directives, the short `{piece}` alias, `{ravel}` graph
directives, and native MyST `{code}`, `{code-block}`, and `{code-cell}`
fallbacks carrying an `lp-*` label.

Install `@pieceful/ravel-myst-plugin` alongside this adapter when MyST itself
should render the custom directives. The plugin owns presentation;
this package continues to own Ravel semantics and exact source mapping.

```js
import { mystToMap } from "@pieceful/ravel-myst";

const { map, diagnostics, surface } = mystToMap(source, {
  uri: "program.myst.md",
  document: "program",
});
```

The `{ravel:piece}` argument accepts the shared name-and-pipeline grammar. Its
`:language:`, `:caption:`, and `:label:` options map to language, visible name,
and stable MyST anchor:

````markdown
```{ravel:piece} main | normalize-eol() | trim()
:language: javascript
:caption: Main program
:label: lp-main

console.log(_"helper");
```
````

A native fallback uses `{code}` or `{code-block}` with `:label: lp-main` and
`:caption:`. `{code-cell}` blocks with an `lp-*` label additionally preserve
notebook tags, page front matter, and an inert execution plan. Parsing never
invokes MyST or Jupyter.

MyST links, `{ref}`/`{numref}` roles, and `@label` shorthand are recorded as
navigation to rendered piece anchors. They do not become code-composition
references. Piece bodies use Ravel's underscore-quote syntax for composition.

MyST owns notebook execution by default. To run a piece through Ravel's live
provider instead, select `executionOwner: "ravel"` and explicitly request
`run`; this prevents both engines from claiming the same cell.
