# Ravel

Ravel is a graph-based document composition engine whose first application is
literate programming: it assembles named code pieces into artifacts while
retaining a source-linked dependency graph. Ravel 0.1 is a small static-weaving
tool and library, designed to be published as the `@pieceful/ravel-*` npm
packages.

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
- run the current automated suites under both Node and Bun; and
- bundle the portable core and Markdown adapter for the browser harness.

The legacy FizzBuzz migration exercises the whole static path: Markdown
extraction, multiple documents, imports, greedy fragments, transforms,
composition directives, aliases, derived chunks, output planning, filesystem
writing, and execution of the generated JavaScript.

The remaining 0.1 work is completing generated-output provenance coverage,
browser conformance, and final public API/release documentation. See
[the Ravel 0.1 plan](TODO.md)
for the release gate.

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
npm run test:pack           # pack, install, import, and build through tarballs
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
- [Five-minute installed CLI guide](docs/getting-started.md)
- [0.1 contracts and TOML configuration](docs/contracts-and-configuration.md)
- [Generated-output provenance maps](docs/provenance-maps.md)
- [Public JavaScript API](docs/public-api.md)
- [Design plan](docs/design.md)
- [History and predecessor projects](docs/history.md)
- [Ravel Map schema guide](docs/ravel-map-schema.md)
- [Machine-readable Ravel Map schema](schemas/ravel-map.schema.json)
- [Embedded chunk syntax](docs/chunk-syntax.md)
- [Pipes and directives](docs/pipes-and-directives.md)
- [Markdown fenced-block profile](docs/markdown-fences.md)
- [Proof of concept](docs/proof-of-concept.md)
- [Runtime support and testing policy](docs/runtime-support.md)
