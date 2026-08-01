# @pieceful/ravel-core

The portable composition engine behind Ravel. It parses chunk references,
resolves the dependency graph, evaluates static composition, reports
source-linked diagnostics, and creates provenance maps for generated output.

```sh
npm install @pieceful/ravel-core
```

Use this package when embedding Ravel in a browser, Bun, Node, or another host.
It is native ESM and deliberately has no filesystem, process, shell, or network
capabilities. Pair it with an adapter such as `@pieceful/ravel-markdown` and a
host that supplies any I/O you need.

`parseRavelDirectiveBlock` is the shared source-mapped parser for graph
directive bodies. Markdown `ravel` fences and MyST `{ravel}` directives use
this same grammar.

The documented public functions include `combineMaps`, `transformGraph`, the
generated/source provenance query helpers, and the 0.2
`planLiveExecutions` / `executeLiveProgram` provider boundary. Core selects and
schedules providers but does not import a language runtime. Requires Node.js 22
or newer when used in Node.

See the [Ravel documentation](https://ravel.jostylr.com/) for the public API,
Ravel Map contract, chunk syntax, and provenance format.

MIT © James Taylor
