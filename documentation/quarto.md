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

The pure bridge composes authored, woven-code, and generated-decoration
mappings. `prepareQuartoProject()` performs the same operation across multiple
documents using one graph, including cross-document `Uses` and `Used by`
links.

## Node project host

```js
import { renderQuartoProject } from "@pieceful/ravel-quarto/node";

const rendered = await renderQuartoProject("./report", {
  to: "html",
  transformVersions: { customTransforms: "2.1.0" },
  providerVersions: { pythonEnvironment: "lock-2026-07" }
});

try {
  if (!rendered.ok) {
    console.error(rendered.diagnostics);
  } else {
    console.log(rendered.outputDirectory);
  }
} finally {
  await rendered.prepared.cleanup();
}
```

The host:

1. rejects a symlinked project root and does not follow project symlinks;
2. copies source and resources to an isolated temporary tree;
3. prepares every `.qmd` against one resolved graph;
4. invokes Quarto with a host-owned output directory and structured log;
5. maps renderer locations through temporary and woven source maps;
6. leaves the authored project untouched.

The caller owns the temporary result and must copy or publish authorized output
before calling `cleanup()`. Generated directories, `.git`, and `node_modules`
are excluded by default. Extra ignored directory names can be supplied.

Quarto projects may declare arbitrary `pre-render` and `post-render` commands.
Ravel detects those declarations and refuses to invoke the project unless the
caller supplies `allowProjectScripts: true`. Quarto documents that these
scripts run in the project directory and receive project input/output
environment variables; see
[Quarto project scripts](https://quarto.org/docs/projects/scripts.html).

All project files contribute SHA-256 dependency records to
`cacheKeyMaterial`. Prepared/authored sources, output-link format, adapter and
bridge versions, transform versions, provider versions, and the discovered
Quarto version are also included. The Node result exposes the SHA-256
`cacheKey`. That key is added as a generated trailing comment to every
temporary `.qmd`, so `freeze: auto` sees changes in non-source inputs while
authored offsets stay stable. Supplying a different `previousCacheKey` also
adds Quarto's `--cache-refresh` option for computation caches.

Quarto cache invalidation normally follows cell source and cache attributes.
Ravel therefore exposes prepared-source cache material rather than relying on
the unmodified `.qmd` alone. See
[Quarto execution and cache management](https://quarto.org/docs/projects/code-execution.html).

The renderer suite exercises static and executable-cell presentation plus a
multi-document project in HTML and PDF. A structured renderer-failure fixture
verifies that a failure in woven code maps to its authored definition.

## Why there is no required Lua filter

The bridge intentionally emits ordinary Markdown, native listing attributes,
and native links before Pandoc builds its AST. A Lua filter would only move
already-generated blocks within that AST; it cannot safely discover or resolve
new pieces after validation. Since the current HTML and PDF output already has
visible captions and working navigation, no filter is required. A small
placement-only filter can still be added later if a concrete output format
needs it. Quarto recommends Lua when AST transformation is actually needed;
see the [filter extension guide](https://quarto.org/docs/extensions/filters.html).

The fixtures under `fixtures/quarto/` exercise native listings, cross
references, pipelines, graph decoration, ownership, pre-execution weaving,
cross-document links, resource copying, HTML, and PDF.
