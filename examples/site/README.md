# Site example

A small static site: one shared layout, a home page that lists every page, and
a folder of Markdown pages that each become an HTML page.

```sh
npx ravel build            # from this directory; or, from the repository root:
npm run ravel -- build --config examples/site/ravel.toml
```

The output is written to `.ravel/build/site/`:

```text
index.html
style.css
pages/about.html
pages/notes/first.html
```

What it uses:

- **`[[collections]]`** turns each file matching `pages/**/*.md` into a page.
  Front matter supplies `title` and `summary`; `slug` overrides the file name.
- **`markdown` and `template`** are built in. The collection pipes each body
  through `markdown | smartquotes` and fills `layout.html` with `template`.
- **`[[transforms]]`** registers `transforms/smartquotes.mjs`, an ordinary ES
  module. It runs as host code, so register only modules you trust.
- **`pages::index.json`** lists every page, which `home-template.html` loops
  over with `{{#each pages}}`.

Each output has a `.ravelmap` sidecar. For `pages/about.html`, the layout text
maps exactly to `site.md`, the title back to the page's front matter, and the
body back to `pages/about.md`.
