# Transforms and collections

Ravel 0.3 adds two things that make content projects practical: transforms
you can use in any pipeline, and collections that turn a folder of files into
one output per file. The runnable [`examples/site`](https://github.com/jostylr/ravel/tree/main/examples/site)
project uses both.

## Built-in transforms

These are available in every project with no configuration, in the CLI, the
Node host, and the browser host.

| Transform | Effect |
| --- | --- |
| `markdown` | Render CommonMark to HTML. Raw HTML in the source is escaped; write `markdown({"html": true})` to pass it through. |
| `template(...)` | Fill placeholders in the piped text from data arguments. |
| `json` | Wrap text as a JSON string literal, for embedding text inside a JSON chunk. |

```text
_"notes.md | markdown"
_"layout.html | template(ch('page.json'), 'content', ch('notes.md | markdown'))"
```

### Template syntax

| Syntax | Meaning |
| --- | --- |
| `{{ name }}` | Insert a value as text. Dotted paths such as `{{ author.name }}` reach nested values; objects and lists are inserted as JSON. |
| `{{ name \| html }}` | Insert a value with `& < > " '` escaped. |
| `{{#each list}}…{{/each}}` | Repeat the body for every item. Inside, `{{ this }}` is the item and plain names look in the item first, then outward. |
| `\{{` | A literal `{{`. |

A placeholder with no value is an error, not an empty string, so a typo cannot
silently drop content.

`template` reads its arguments left to right. An object — a literal such as
`{"site": "Notes"}` or the JSON text of an object, such as `ch('page.json')` —
is merged into the data. Any other text names a key, and the next argument is
its value; if that value is the JSON text of a list or object (for example
`ch('pages::index.json')`), it is used as that list or object.

### Provenance through templates

`template` tells Ravel which output text came from the template and which from
each argument. In a generated page, the layout's text keeps an **exact**
mapping to the layout chunk, and each inserted value is attributed to the chunk
it came from — the page's front matter, or its Markdown body. Use
`ravel inspect <config> --provenance <page>` to follow any position back.

## Project transforms: `[[transforms]]`

Register your own transform, or replace a built-in one, with an ES module in
your project:

```toml
[[transforms]]
name = "smartquotes"
module = "transforms/smartquotes.mjs"   # relative to the project root

[[transforms]]
name = "markdown"                        # replaces the built-in
module = "transforms/markdown-it.mjs"
export = "render"                        # default: the default export
```

The export must be a function `(value, context) => string`, where
`context.arguments` holds the step's evaluated arguments. Throwing reports a
source-linked `RV121` error at the pipeline step. A module may import any npm
package installed in the project, which is how you use a library such as
`markdown-it` with your own options:

```js
// transforms/markdown-it.mjs
import MarkdownIt from "markdown-it";
const md = new MarkdownIt({ html: true, typographer: true });
export const render = (value) => md.render(value);
```

Core commands (`trim`, `indent`, `replace`, `jsontext`, `ch`, `text`, `emit`,
…) cannot be replaced.

**Trust.** Project transforms run as ordinary Node code with your user's
privileges, every time the project is checked or built. They can only be
declared in `ravel.toml`, never by a document, but you should review them as
you would a build script before building a checkout you did not write. This is
different from `.run` blocks, which run inside the isolated QuickJS sandbox
described in [live execution](live-execution.md); an npm module can also be
used there through `[[live.modules]]`, but only from inside a live block.

A transform may optionally return `{ parts }` instead of a string to keep
provenance; see the [public API](public-api.md#custom-transforms).

## Collections: `[[collections]]`

A collection turns every file matching a pattern into one output, through a
shared layout:

```toml
[build]
out_dir = "build"

[[files]]
path = "site.md"                 # defines site::layout.html

[[collections]]
name = "pages"
glob = "pages/**/*.md"
out = "{dir}/{slug}.html"
layout = "site::layout.html"
pipe = "markdown"
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Lowercase identifier. Item documents are named `<name>-<slug>`; the index is `<name>::index.json`. |
| `glob` | yes | Files to collect, relative to the project root. `*` and `?` stay within one folder; `**/` crosses folders. Dot-files are skipped, symbolic links are an error, and items are processed in a fixed, sorted order. |
| `out` | yes | Output path for each item, relative to `out_dir`. Placeholders: `{slug}`, `{name}` (file name without extension), `{dir}` (the file's folder), `{path}` (the file path without extension), and any text value from front matter. |
| `layout` | no | A chunk address to fill with `template`. Without it, each output is the piped body. |
| `pipe` | no | Pipeline applied to each body. Defaults to `"markdown"`; use `""` for none, or chain steps such as `"markdown \| smartquotes"`. |
| `references` | no | `true` lets item bodies use `_"…"` references to other chunks. Defaults to `false`, so prose is taken literally. |

For each item, Ravel creates:

- `<name>-<slug>::body`: the text after any front matter, mapped exactly to its
  place in the file;
- `<name>-<slug>::data.json`: the front matter plus `slug`, `name`, `dir`,
  `path`, `out`, and `collection` (here `path` keeps the extension);
- `<name>-<slug>::page`: the body through `pipe`, filled into `layout` with
  `content` set to the result and every `data.json` field available; and
- an `out` directive writing `page` to the item's `out` path.

`slug` comes from front matter when present, otherwise from the file name
(lowercased, with runs of other characters turned into `-`). Two items with the
same slug, invalid YAML front matter, or an `out` placeholder with no value are
configuration errors that name the file.

`<name>::index.json` lists every item's `data.json`, in order, for index pages:

````markdown
```html {.ravel #home}
_"home-template.html | template('pages', ch('pages::index.json'))"
```
````

with `home-template.html` containing
`{{#each pages}}<li><a href="/{{ out }}">{{ title }}</a></li>{{/each}}`.

A config may contain only collections; `[[files]]` is then optional.

## Not yet included

Watch mode, copying static assets, image processing, and link checking are not
part of Ravel. Run them as separate steps around `ravel build`. See the
[roadmap](https://github.com/jostylr/ravel/blob/main/ROADMAP.md).
