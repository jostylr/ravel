# Ravel

Ravel is a working, pre-0.1 literate-programming engine for assembling named
code pieces into artifacts while retaining a source-linked dependency graph.
It is currently a small static-weaving tool and an experimental library. The
packages are wired for local npm-workspace development, but have not yet been
published as a 0.1 release.

Ravel separates source-format policy from program composition:

```text
Markdown, JSON Ravel Maps, or editor-produced maps
                         ↓
                     Ravel Map
                         ↓
          chunk parser and graph evaluator
                         ↓
                    Ravel Program
                         ↓
        deliverables, diagnostics, provenance, trace
```

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
- load Markdown or JSON Ravel Maps with `in`;
- define graph structure with `create`, `compose`, `alias`, `pipe`, and `pass`;
- plan named outputs with `out` or TOML `[[outputs]]` entries;
- inspect a completed graph or write deliverables through the Node CLI;
- report source-linked parsing, resolution, transform, and cycle diagnostics;
- reject input/output path escapes and symbolic-link traversal;
- run the current 26-test suite under both Node and Bun; and
- bundle the portable core and Markdown adapter for the browser harness.

The legacy FizzBuzz migration exercises the whole static path: Markdown
extraction, multiple documents, imports, greedy fragments, transforms,
composition directives, aliases, derived chunks, output planning, filesystem
writing, and execution of the generated JavaScript.

Ravel is not yet 0.1 because runtime Ravel Map validation is incomplete, CLI
diagnostics are mostly raw JSON or stack traces, generated artifacts do not yet
carry segment-level source maps, and browser conformance is not automated. See
[the Ravel 0.1 plan](TODO.md) for the release gate.

## Requirements and setup

- Node.js 22 or newer
- npm
- Bun is optional and used only for the portability test command

From this directory:

```sh
npm install
npm test
npm run validate:schema
```

The workspace packages expose local entry points and an installed `ravel`
executable after `npm install`. Until 0.1 packaging is complete, invoke the
CLI through the local workspace script:

```sh
npm run ravel -- --help
node -e 'import("@pieceful/ravel-core").then(() => console.log("local workspace import works"))'
```

`npm install` links the `@pieceful/ravel-*` packages from `packages/` into the
local workspace. It does not download these Ravel packages from npm. The
package metadata, exports, and CLI `bin` entry are already shaped for later
publishing.

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

Generated local runs live below `.ravel/runs/` and are ignored by Git.
Successful builds write `.ravel-manifest.json` beside their deliverables; it
records the planned artifact paths, source chunks, byte counts, and SHA-256
hashes.

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

See the [Markdown profile](docs/markdown-fences.md) and
[pipes and directives reference](docs/pipes-and-directives.md) for the full
implemented syntax.

## Architecture

```text
packages/
  core/       portable chunk syntax, graph evaluation, diagnostics, provenance
  markdown/   portable Markdown fenced-block adapter
  host-node/  scoped filesystem input, TOML builds, and artifact writing
  cli/        development command-line entry point
  map/        Ravel Map public metadata and structural validation
schemas/      Ravel Map JSON Schema
examples/     proof-of-concept and migration builds
fixtures/     Markdown, map, and configuration cases
test/         Node/Bun test suite
browser-test/ browser portability harnesses
docs/         design and language documentation
```

Portable packages use native ESM and Web Platform APIs. Filesystem and process
behavior belongs in `host-node`; the core and Markdown adapter do not import
Node-only APIs.

## Development commands

```sh
npm test                    # complete Node test suite
npm run test:bun            # same test files under Bun
npm run validate:schema     # structural validation of checked-in map examples
npm run build:browser-test  # bundle the Markdown browser harness
```

The browser command currently builds the harness but does not launch a browser.
Automated browser execution is part of the 0.1 plan.

## Current scope and intentional limits

Ravel 0.1 is scoped to dependable static composition. It does not need plugins,
additional source formats, notebook execution, an LSP, parameterized chunks,
conditional build profiles, shell/network effects, or incremental compilation
to meet that milestone.

Those are possible later extensions of the same Ravel Map and graph model. The
immediate work is to make the existing static path validated, installable,
explainable, reproducible, and pleasant to use.

## Documentation

- [Ravel 0.1 implementation plan](TODO.md)
- [Design plan](docs/design.md)
- [History and predecessor projects](docs/history.md)
- [Ravel Map schema guide](docs/ravel-map-schema.md)
- [Machine-readable Ravel Map schema](schemas/ravel-map.schema.json)
- [Embedded chunk syntax](docs/chunk-syntax.md)
- [Pipes and directives](docs/pipes-and-directives.md)
- [Markdown fenced-block profile](docs/markdown-fences.md)
- [Proof of concept](docs/proof-of-concept.md)
- [Runtime support and testing policy](docs/runtime-support.md)
