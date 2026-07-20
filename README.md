# Ravel

Ravel is a literate-programming system for weaving named code pieces into
artifacts and unraveling artifacts into an explainable, source-linked
dependency graph.

It works with Markdown, other text formats, and live notebook/editor
environments. Format adapters produce a common Ravel Map. The core parses
syntax inside chunks, resolves the graph, reports diagnostics, and plans
authorized effects.

    source format or Rix blocks
              ↓
          Ravel Map
              ↓
    chunk parser and graph resolver
              ↓
        Ravel Program
              ↓
    artifacts, notebook state, trace graph

Ravel is at the design-and-scaffolding stage. The initial scope is a small,
safe static-weaving vertical slice; notebook execution and more adapters share
the same core model.

## Repository guide

- [Design plan](docs/design.md)
- [History](docs/history.md)
- [Ravel Map schema guide](docs/ravel-map-schema.md)
- [Embedded chunk syntax guide](docs/chunk-syntax.md)
- [Pipes and directives reference](docs/pipes-and-directives.md)
- [Markdown fenced-block profile](docs/markdown-fences.md)
- [Executable proof of concept](docs/proof-of-concept.md)
- [Machine-readable Ravel Map schema](schemas/ravel-map.schema.json)

## Layout

    packages/
      map/          Ravel Map types and schema helpers
      core/         chunk parser, resolver, graph evaluator, diagnostics
      markdown/     Markdown profile adapters
      host-node/    Node filesystem and cache capabilities
      cli/          command-line interface
    schemas/        published interchange schemas
    examples/       small examples
    fixtures/       map, syntax, and compatibility cases
    docs/           design and language documentation

## Development

Ravel intentionally has no dependencies yet. Its Node host targets Node 22+;
the portable packages are designed for modern browsers and Bun as well. npm
workspaces are the initial package-management path. Once tests are added:

    npm test
    npm run test:bun
    npm run validate:schema

The schema example currently uses a dependency-free structural validator. A full
JSON Schema validator can be added with the first implementation package.

## Proof of concept

The initial graph evaluator and Node CLI are working. Build the joined-map,
emission, and deliverables example with:

    node packages/cli/src/index.js build examples/poc/project.ravel-map.json \
      --out-dir .ravel/runs/poc \
      --graph .ravel/runs/poc/program.json

See [the proof-of-concept guide](docs/proof-of-concept.md) for its graph model
and generated outputs.

See [runtime support](docs/runtime-support.md) for the portability and test
policy.

Markdown fences and single-run TOML configurations now work as well. See the
[Markdown fenced-block profile](docs/markdown-fences.md), then try:

    node packages/cli/src/index.js inspect fixtures/markdown/guide.md --mode primary
    node packages/cli/src/index.js build --config fixtures/markdown/ravel-web.toml
