# @pieceful/ravel

Ravel's Node.js command-line interface builds static literate-programming
projects from supported markup sources—including Markdown, MyST, Org, and
noweb—Ravel Maps, or a `ravel.toml` project configuration.

```sh
npm install --save-dev @pieceful/ravel
npx ravel check ravel.toml
npx ravel build ravel.toml
```

Use `check` to validate without writing, `inspect` to view chunks, graph, trace,
and provenance, `run` to execute explicitly marked live blocks without writing,
and `build` to execute live blocks before writing declared deliverables and
managed output metadata.
`--clean`, `refresh`, `--dry-run`, and `--backup` make output lifecycle actions
explicit and reviewable.

Requires Node.js 22 or newer. `check` and `inspect` never execute source
JavaScript. The explicit `run` command and live-enabled `build` use the
capability-limited `@pieceful/ravel-js-live` QuickJS/Wasm provider; it does not
expose Node, shell, network, or filesystem access to a live block.

See the [Ravel documentation](https://ravel.jostylr.com/) for installation,
configuration, command reference, and examples.

MIT © James Taylor
