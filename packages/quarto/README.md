# `@pieceful/ravel-quarto`

Pure build and render preparation for Quarto documents backed by the modern
Markdown adapter. It does not define another source dialect and does not invoke
Quarto, Pandoc, Jupyter, Knitr, or Ravel execution providers.

```js
import { prepareQuartoRender } from "@pieceful/ravel-quarto";

const prepared = prepareQuartoRender(source, {
  uri: "analysis.qmd"
});
```

`prepared.source` is a temporary Quarto source with ordinary Markdown
`Uses`/`Used by` graph navigation and a piece index. `prepared.sourceMap`
composes generated offsets back to the authored `.qmd`; inserted decorations
are explicitly marked generated. The authored source is never changed.

Quarto-owned executable cells are woven before native execution. Cell options
stay in the temporary source but outside the Ravel piece body. Ravel-owned
cells receive `eval: false`, and a cell cannot simultaneously request Quarto
ownership and Ravel `.run`.

Use native Quarto listing labels and captions for the no-extension baseline:

````markdown
```{#lst-lp-main .javascript .lp-piece lp-id="main" lst-cap="Main program"}
console.log(_"helper");
```
````
