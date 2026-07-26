# @pieceful/ravel

Ravel's Node.js command-line interface builds static literate-programming
projects from Markdown, Ravel Maps, or a `ravel.toml` project configuration.

```sh
npm install --save-dev @pieceful/ravel
npx ravel check ravel.toml
npx ravel build ravel.toml
```

Use `check` to validate without writing, `inspect` to view chunks, graph, trace,
and provenance, and `build` to write declared deliverables and managed output
metadata. `--clean`, `refresh`, `--dry-run`, and `--backup` make output lifecycle
actions explicit and reviewable.

Requires Node.js 22 or newer. This is the Node-only host and CLI; it never
executes JavaScript, shell commands, or network requests from source documents.

See the [Ravel documentation](https://ravel.jostylr.com/) for installation,
configuration, command reference, and examples.

MIT © James Taylor
