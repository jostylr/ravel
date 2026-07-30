# Quarto

Quarto is a specialization of modern Markdown, not a separate Ravel source
dialect. `.qmd` files enter through `@pieceful/ravel-markdown`; the
`@pieceful/ravel-quarto` bridge adds graph-aware temporary render source.

The integration follows Quarto's native listing contract. A listing identifier
must begin with `lst-`, while `lst-cap` supplies its visible caption. See
[Quarto code-listing cross references](https://quarto.org/docs/authoring/cross-references.html#code-listings).

## No-extension baseline

The canonical static form is already visible and cross-referenceable without a
Ravel filter:

<pre><code>&#96;&#96;&#96;{#lst-lp-main .javascript .lp-piece lp-id="main" lst-cap="Main program" lp-pipe="trim()"}
console.log(_"helper");
&#96;&#96;&#96;

See @lst-lp-main.</code></pre>

Ravel maps `lp-id="main"` to the semantic piece `main`, keeps
`lst-lp-main` as the rendered anchor, and uses `Main program` as the display
name. If `lp-id` is absent, `#lst-lp-main` infers `main`.

Quarto 1.9 renders the checked-in fixture with numbered “Main program” and
“Helper” listing captions and working `@lst-*` links.

## Graph-aware render preparation

```js
import { prepareQuartoRender } from "@pieceful/ravel-quarto";

const prepared = prepareQuartoRender(source, {
  uri: "analysis.qmd"
});
```

The bridge:

1. parses through the modern Markdown adapter;
2. validates and resolves the Ravel graph;
3. inserts ordinary Markdown `Uses` and `Used by` blocks;
4. appends a piece/dependency index;
5. returns a source map and deterministic cache-key material.

It does not overwrite the authored `.qmd`. Inserted prose is explicitly
generated in the returned source map, while every copied source region retains
an exact authored range. If graph validation fails, the source is returned
unchanged.

The bridge performs compilation before rendering rather than inside a filter.
Quarto recommends Lua for AST filters, but such a filter should only place
already-validated decorations. See the official
[Quarto filter extension guide](https://quarto.org/docs/extensions/filters.html).

## Execution boundary

Curly-language cells are recognized as executable Quarto cells:

<pre><code>&#96;&#96;&#96;{python .lp-piece #lp-analysis lp-id="analysis" ravel-execution-owner="quarto"}
#| lst-label: lst-lp-analysis
#| lst-cap: Analysis

print(_"prepared-data | trim()")
&#96;&#96;&#96;</code></pre>

Cell options remain in the temporary `.qmd` but are excluded from the Ravel
piece body. For `ravel-execution-owner="quarto"`, references are resolved
before Quarto sees the cell. For owner `ravel`, the bridge inserts
`eval: false` unless already present, preventing native double execution.
Combining Quarto ownership with a Ravel `.run` marker is diagnosed.

The pure bridge now composes authored, woven-code, and generated-decoration
mappings. The remaining project-host phase will materialize a complete
temporary source tree, add transform/provider versions to project cache keys,
invoke Quarto, and translate native-engine failures through those maps.

Quarto cache invalidation normally follows cell source and cache attributes.
Ravel therefore exposes prepared-source cache material rather than relying on
the unmodified `.qmd` alone. See
[Quarto execution and cache management](https://quarto.org/docs/projects/code-execution.html).

The fixtures at `fixtures/quarto/static-listing.qmd` and
`fixtures/quarto/executable-cell.qmd` exercise native listings, cross
references, pipelines, graph decoration, ownership, and pre-execution weaving.
