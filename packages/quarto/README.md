# `@pieceful/ravel-quarto`

Pure build and render preparation for Quarto documents backed by the modern
Markdown adapter. The portable main entry does not define another source
dialect or invoke Quarto, Pandoc, Jupyter, Knitr, or Ravel execution providers.

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

For a complete project, the Node host copies the project to an isolated
temporary directory, prepares every `.qmd` against one graph, and invokes
Quarto only in that copy:

```js
import { renderQuartoProject } from "@pieceful/ravel-quarto/node";

const rendered = await renderQuartoProject("report", { to: "html" });
try {
  if (!rendered.ok) console.error(rendered.diagnostics);
  else console.log(rendered.outputDirectory);
} finally {
  await rendered.prepared.cleanup();
}
```

The returned output remains in the temporary tree until `cleanup()` is called.
Copy or publish it through an authorized host first. Project `pre-render` and
`post-render` scripts are refused unless `allowProjectScripts: true` is
explicitly supplied. The derived project cache key is stamped into temporary
sources; pass `previousCacheKey` to request Quarto cache refresh when it
changes.

Use native Quarto listing labels and captions for the no-extension baseline:

````markdown
```{#lst-lp-main .javascript .lp-piece lp-id="main" lst-cap="Main program"}
console.log(_"helper");
```
````
