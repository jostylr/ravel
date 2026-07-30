# LitPro Markdown

`@pieceful/ravel-markdown-litpro` is the independent compatibility adapter for
historical LitPro and Pieceful CommonMark documents. It intentionally preserves
the old heading model instead of treating it as a mode of modern Markdown.

## Heading structure

The default `legacy` heading mode interprets:

- H1-H4 as peer major pieces;
- H5 as a child of the latest major, written `major/child`;
- H6 as a grandchild, written `major/child/grandchild`;
- an H6 without an H5 as `major//grandchild`;
- `[minor]()` as `current/path:minor`;
- `[^]()` as a return from a minor to the active heading piece.

Repeated headings and repeated minor links reopen the same piece and concatenate
their code blocks in source order. Both fenced and indented Markdown code blocks
are fragments.

Legacy relative references remain structural:

```text
_"./child"
_"../sibling"
_"../../major"
_":minor"
_"../:minor"
_"other-document::major/child:minor"
```

Heading display text is retained. Its semantic components are normalized to
lowercase hyphenated IDs so they can cross the Ravel Map boundary, while slash
and colon structure remains intact.

## Dialects

| Dialect | Heading pipelines | Repeated pipelines |
| --- | --- | --- |
| `litpro-2017` | diagnosed and disabled | disabled |
| `pieceful-2020` | enabled | accumulated in declaration order |
| `litpro-plus` | enabled | must agree; applied once after concatenation |

`litpro-plus` is the default. The configurable heading modes are `legacy`,
`flat`, and `none`. With `none`, headings are narrative and an explicit
`language lp:name | pipeline()` fence can still declare a piece.

```yaml
lp:
  adapter: markdown-litpro
  document: book
  dialect: litpro-plus
  headings:
    mode: legacy
    major: [1, 2, 3, 4]
    child: 5
    grandchild: 6
    pipelines: true
```

## Directives and live blocks

Historical `save:` and `out:` links become portable `out` plans. `load:` links
become `in` plans and preserve their aliases for the Node host. Other legacy
directives and `<!--+ ... -->` instructions are retained as inert metadata;
the adapter never evaluates them or grants filesystem, shell, network, or
JavaScript authority.

Fences may use `.run` and `provider=...`. As with every Ravel adapter, those
fields are execution declarations only. Parsing does not run the code.

Counted substitutions such as `\1_"piece"` use the core definition-phase delay
mechanism and retain source locations.

## Node host configuration

```toml
version = 1

[[files]]
path = "book.md"
adapter = "markdown-litpro"
dialect = "litpro-2017"
```

The package is browser-safe and can also be called directly:

```js
import { litproMarkdownToMap } from "@pieceful/ravel-markdown-litpro";

const { map, diagnostics, surface } = litproMarkdownToMap(source, {
  uri: "book.md",
  dialect: "litpro-plus"
});
```
