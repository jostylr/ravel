# @pieceful/ravel-transforms

Built-in pipeline transforms for [Ravel](https://github.com/jostylr/ravel):
CommonMark rendering and data templates. The Node host, the CLI, and the
browser host register them automatically, so a document can write
`_"notes.md | markdown"` with no configuration.

```sh
npm install @pieceful/ravel-transforms
```

| Transform | Effect |
| --- | --- |
| `markdown` | Render CommonMark to HTML. Raw HTML is escaped unless called as `markdown({"html": true})`. |
| `template(...)` | Fill `{{ name }}`, `{{ name \| html }}`, and `{{#each list}}…{{/each}}` from object, JSON-text, or `'key', value` arguments. A missing value is an error. |
| `json` | Wrap text as a JSON string literal. |

`template` reports which output came from the template and which from each
argument, so Ravel's provenance maps keep exact source ranges for layout text
and point inserted values back at their source.

Each export follows the core transform contract
`(value, { arguments }) => string`, so the functions can also be used directly
or passed to `transformGraph(map, { transforms })`. See the
[transforms and collections guide](https://ravel.jostylr.com/transforms-and-collections.html).

MIT © James Taylor
