# Ravel

Ravel is a graph-based document composition engine whose first application is
literate programming: it assembles named code pieces into artifacts while
retaining a source-linked dependency graph. Ravel 0.1 is a small static-weaving
tool and library, designed to be published as the `@pieceful/ravel-*` npm
packages.

Ravel separates source-format policy from program composition:

```text
Markdown, MyST, Org, noweb, JSON Ravel Maps, or editor-produced maps
                         ↓
                     Ravel Map
                         ↓
          chunk parser and graph evaluator
                         ↓
                    Ravel Program
                         ↓
        deliverables, diagnostics, provenance, trace
```

## Documentation

The guides, language reference, API reference, configuration reference, and
examples live at [ravel.jostylr.com](https://ravel.jostylr.com/).

## Published packages

| Package | Purpose |
| --- | --- |
| [@pieceful/ravel](https://www.npmjs.com/package/@pieceful/ravel) | Node.js CLI for checking, inspecting, and building Ravel projects. |
| [@pieceful/ravel-core](https://www.npmjs.com/package/@pieceful/ravel-core) | Portable chunk parser, graph evaluator, diagnostics, and provenance engine. |
| [@pieceful/ravel-map](https://www.npmjs.com/package/@pieceful/ravel-map) | Versioned Ravel Map schema, validation, and diagnostic contract. |
| [@pieceful/ravel-asciidoc](https://www.npmjs.com/package/@pieceful/ravel-asciidoc) | Lossless AsciiDoc sections, attributed blocks, containers, cross-references, and graph-directive macros. |
| [@pieceful/ravel-html](https://www.npmjs.com/package/@pieceful/ravel-html) | Script-free semantic HTML sections, figures, entity-aware code fragments, navigation, and directive links. |
| [@pieceful/ravel-markdown](https://www.npmjs.com/package/@pieceful/ravel-markdown) | Portable adapter that extracts Ravel Maps from Markdown fences and directives. |
| [@pieceful/ravel-markdown-litpro](https://www.npmjs.com/package/@pieceful/ravel-markdown-litpro) | Historical H1-H6, minor-block, and legacy-directive Markdown adapter. |
| [@pieceful/ravel-myst](https://www.npmjs.com/package/@pieceful/ravel-myst) | Lossless MyST pieces, native code fallbacks, cross-reference, and notebook-cell adapter. |
| [@pieceful/ravel-myst-plugin](https://www.npmjs.com/package/@pieceful/ravel-myst-plugin) | Native MyST `{ravel:piece}` and `{ravel}` rendering with visible names, pipelines, labels, and optional code cells. |
| [@pieceful/ravel-noweb](https://www.npmjs.com/package/@pieceful/ravel-noweb) | Lossless strict-noweb and pipe-extended noweb-plus adapter. |
| [@pieceful/ravel-org](https://www.npmjs.com/package/@pieceful/ravel-org) | Lossless Org/Babel names, groups, references, metadata, and ownership adapter. |
| [@pieceful/ravel-quarto](https://www.npmjs.com/package/@pieceful/ravel-quarto) | Portable Quarto graph preparation plus an isolated Node project renderer, cache inputs, and temporary-source maps. |
| [@pieceful/ravel-host-node](https://www.npmjs.com/package/@pieceful/ravel-host-node) | Node filesystem host for project loading, safe artifact writes, manifests, and backups. |
| `@pieceful/ravel-js-live` (0.2 development) | Worker-backed QuickJS/Wasm provider plus Node-only preparation of allowlisted npm modules. |

The implemented vertical slice is intentionally safe and deterministic in
spirit: parsing and graph evaluation do not evaluate document JavaScript or
shell commands, and the Node host confines declared inputs and outputs to an
explicit filesystem root.

## Project status

Ravel can currently:

- extract explicitly named, source-ranged chunks from Markdown fences;
- preserve ordinary prose and non-Ravel examples as normal Markdown;
- join contiguous fenced fragments with an explicit greedy mode;
- resolve local, global, cross-document, minor, and typed chunk addresses;
- compose chunks with underscore-quoted references;
- apply built-in definition-time and use-site transforms;
- create derived chunks with `emit`;
- load supported markup sources or JSON Ravel Maps with `in`;
- define graph structure with `create`, `compose`, `alias`, `pipe`, and `pass`;
- plan named outputs with `out` or TOML `[[outputs]]` entries;
- inspect a completed graph or write deliverables through the Node CLI;
- run explicitly marked JavaScript blocks through QuickJS/Wasm without giving
  them Node or filesystem access;
- report source-linked parsing, resolution, transform, and cycle diagnostics;
- reject input/output path escapes and symbolic-link traversal;
- run the current automated suites under Node and Bun;
- run the browser harnesses in headless Chromium; and
- pack, install, import, and build through the publishable npm tarballs.

The legacy FizzBuzz migration exercises the whole static path: Markdown
extraction, multiple documents, imports, greedy fragments, transforms,
composition directives, aliases, derived chunks, output planning, filesystem
writing, and execution of the generated JavaScript.

The remaining 0.1 work is release verification and publication, rather than a
new language feature. See [the Ravel 0.1 plan](TODO.md) and the
[release checklist](documentation/release-checklist.md) for the release gate.
The language-neutral live-execution contract, QuickJS/Wasm provider, sandboxed
transform-module work, and the source-linked Explorer with VS Code integration
are planned in the
[Ravel 0.2 implementation plan](TODO-0.2.md).

The first 0.2 live-code vertical slice is now under development. Named
Markdown fences can opt in with `.run`; portable core planning resolves
`ch("chunk")` value dependencies and `load("resource")` snapshots; and the new
`@pieceful/ravel-js-live` workspace package evaluates one final JSON-compatible
`export default` in a fresh, limited QuickJS/Wasm runtime behind a terminable
worker. Hosts may register immutable ESM source under approved import names,
without exposing npm or filesystem resolution. Live-to-live dependencies keep
copied data values; `build` materializes raw string exports, entire JSON values
through `jsontext()`, or selected object keys through `jsontext("key")` before
ordinary pipes and outputs. See the
[live-execution design and current safety boundary](documentation/live-execution.md).

Try the complete portable pipeline in the
[live browser playground](https://ravel.jostylr.com/playground/): edit a
single-file FizzBuzz document, render its generated artifact, and navigate its
source provenance without uploading or saving files.

## Requirements and setup

- Node.js 22 or newer
- npm
- Bun is optional and used only for the portability test command
- Quarto is optional and required only to rebuild the documentation site

From this directory:

```sh
npm install
npm test
npm run test:myst-plugin
npm run validate:schema
```

The workspace packages expose local entry points and an installed `ravel`
executable after `npm install`. Invoke the local workspace CLI with:

```sh
npm run ravel -- --help
node -e 'import("@pieceful/ravel-core").then(() => console.log("local workspace import works"))'
```

`npm install` links the `@pieceful/ravel-*` packages from `packages/` into the
local workspace. It does not download these Ravel packages from npm. The
package metadata, exports, and CLI `bin` entry match the publishable packages.

## Try the current CLI

Validate a project without writing outputs:

```sh
npm run ravel -- check examples/poc/project.ravel-map.json
```

Inspect a primary-Ravel Markdown document without writing files:

```sh
npm run ravel -- inspect fixtures/markdown/guide.md --mode primary
```

For ordinary graph questions, use a focused view instead of the full program
dump:

```sh
npm run ravel -- inspect examples/poc/project.ravel-map.json --chunks
npm run ravel -- inspect examples/poc/project.ravel-map.json --graph
npm run ravel -- inspect examples/poc/project.ravel-map.json --trace --json
npm run ravel -- inspect examples/poc/project.ravel-map.json \
  --provenance dist/greeting.js --generated-offset 0
```

Build the JSON-map proof of concept and save its completed graph:

```sh
npm run ravel -- build examples/poc/project.ravel-map.json \
  --out-dir .ravel/runs/poc \
  --graph .ravel/runs/poc/program.json
```

Preview the exact deliverables, content hashes, and manifest location without
writing files:

```sh
npm run ravel -- build examples/poc/project.ravel-map.json \
  --out-dir .ravel/runs/poc \
  --dry-run --json
```

Build a multi-document Markdown project described by TOML:

```sh
npm run ravel -- build --config fixtures/markdown/ravel-web.toml
```

Build and run the larger migration example:

```sh
npm run ravel -- build --config examples/migration/ravel-fizzbuzz.toml
node examples/migration/.ravel/runs/legacy-fizzbuzz-migration/dist/fizzbuzz.js
```

Run the live CSV example, which installs `csv-parse` in the example project,
allowlists its browser-compatible sync export in TOML, and returns values
without writing files:

```sh
cd examples/live-modules
npm install
npm run live
npm run build
```

Build the [50-chunk assembly benchmark](examples/benchmark/README.md) when you
need a repeatable timing fixture for imports, nested substitutions, directives,
and graph evaluation:

```sh
npm run benchmark:assembly
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml
```

Generated local runs live below `.ravel/runs/` and are ignored by Git.
Successful builds write two manifests beside their deliverables:

- `.ravel-manifest.json` is the machine-readable record of current and stale
  managed outputs, source chunks, byte counts, and SHA-256 hashes.
- `.manifest.txt` is a readable inventory with the build time, current files,
  their producing chunk references, and retained stale files grouped with the
  time they became stale.

A normal build reports stale managed outputs but deliberately retains them.
Use `--clean` to remove every file named by the prior manifest, then perform a
fresh build. It never removes arbitrary files in the output directory. To
remove only the retained stale files later, use `refresh`; both operations can
be previewed safely. Add `--backup [file.zip]` to snapshot the complete current
output tree before Ravel cleans or replaces anything. A named archive must not
already exist, and backups require the prior Ravel manifest that identifies the
managed output. Without a name, Ravel writes
`backups/<output-directory>-<manifest-build-unix-timestamp>.zip` beneath the
source/config root. `--dry-run` validates and reports the planned archive but
does not create it:

```sh
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml --clean --dry-run
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml --clean
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml --backup backups/before-refresh.zip --clean
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml --backup --dry-run
npm run ravel -- refresh examples/benchmark/.ravel/runs/fifty-chunk-assembly-benchmark --dry-run
npm run ravel -- refresh examples/benchmark/.ravel/runs/fifty-chunk-assembly-benchmark
```

## Minimal Markdown example

````markdown
---
ravel:
  document: greeting
---

# Greeting

The implementation is described in narrative order, independently of its
assembly order.

```javascript {.ravel #message}
const message = "Hello from Ravel";
```

```javascript {.ravel #main}
_"message.javascript"
console.log(message);
```

```ravel
out("dist/greeting.js", _"main.javascript")
```
````

Save the document as `greeting.md`, then build it with:

```sh
npm run ravel -- build greeting.md --out-dir .ravel/runs/greeting
```

The Markdown adapter has two modes:

- `opt-in` is the default; unnamed fences remain ordinary examples.
- `primary` requires every non-excluded fence to be a named Ravel chunk, a
  valid greedy continuation, or explicitly marked `.no-ravel`.

See the [Markdown profile](documentation/markdown-fences.md) and
[pipes and directives reference](documentation/pipes-and-directives.md) for the full
implemented syntax.

## Architecture

```text
packages/
  core/       portable chunk syntax, graph evaluation, diagnostics, provenance
  markdown/   portable Markdown fenced-block adapter
  host-node/  scoped filesystem input, TOML builds, and artifact writing
  host-browser/private in-memory adapter and live CodeMirror playground
  cli/        development command-line entry point
  map/        Ravel Map public metadata and structural validation
  explorer/   proposed portable graph, provenance, and change explorer
  vscode/     proposed VS Code host for Explorer and source-linked editing
schemas/      Ravel Map JSON Schema
examples/     proof-of-concept and migration builds
fixtures/     Markdown, map, and configuration cases
test/         Node/Bun test suite
browser-test/ browser portability harnesses
documentation/ Quarto source for design and language documentation
docs/         compiled documentation and browser playground for GitHub Pages
```

Portable packages use native ESM and Web Platform APIs. Filesystem and process
behavior belongs in `host-node`; the core and Markdown adapter do not import
Node-only APIs.

## Development commands

```sh
npm test                    # complete Node test suite
npm run test:bun            # same test files under Bun
npm run validate:schema     # structural validation of checked-in map examples
npm run test:browser         # bundle and execute browser harnesses in Chromium
npm run test:pack           # pack, install, import, and build through tarballs
npm run build:site          # render Quarto docs and bundle the browser playground
```

The browser test downloads a Playwright Chromium binary on first use. CI installs
that binary explicitly before running the same command.

## Current scope and intentional limits

Ravel 0.1 is scoped to dependable static composition. It does not need plugins,
additional source formats, notebook execution, an LSP, parameterized chunks,
conditional build profiles, shell/network effects, or incremental compilation
to meet that milestone.

Those are possible later extensions of the same Ravel Map and graph model. The
immediate work is to make the existing static path validated, installable,
explainable, reproducible, and pleasant to use.

## Project participation

Issues with a small reproduction are welcome at
[jostylr/ravel](https://github.com/jostylr/ravel/issues). Ravel is not currently
soliciting external contributions or operating a formal contributor program;
that policy may change after the 0.1 release.
