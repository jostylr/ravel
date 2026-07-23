# Public JavaScript API

Ravel 0.1 favors small, function-oriented packages. The exports described here
are public contracts; internal object properties not described here may change
within the 0.1 line. Each library package ships a handwritten `index.d.ts` file
alongside its JavaScript entry point.

## `@pieceful/ravel-map`

Use this package at adapter, editor, and host boundaries.

- `validateRavelMap(map, { uri? })` returns diagnostics without throwing.
- `assertRavelMap(map, { uri? })` returns a valid map or throws
  `RavelMapValidationError`, whose `diagnostics` property is portable data.
- `RAVEL_MAP_VERSION`, `RAVEL_MAP_SCHEMA_ID`, and `RAVEL_MAP_SCHEMA` identify
  the version-1 interchange contract.
- `@pieceful/ravel-map/schema` is the JSON Schema module.

## `@pieceful/ravel-markdown`

- `markdownToMap(text, { uri?, document?, mode? })` converts the documented
  Markdown fenced profile to `{ map, diagnostics }`. `mode` is `"opt-in"` or
  `"primary"`.

## `@pieceful/ravel-core`

- `parseChunkId` and `formatChunkId` convert canonical chunk identities.
- `parseChunk` parses an individual chunk body into portable syntax data.
- `combineMaps(maps)` constructs the pre-transform graph.
- `transformGraph(graph, { transforms? })` evaluates that graph and returns the
  program, deliverables, diagnostics, dependencies, and trace.

The `@pieceful/ravel-core/directives` entry point exposes constructors for the
portable directive IR. Custom transforms are functions that receive a string
value and return a string; a failed or non-string result becomes a diagnostic.

## `@pieceful/ravel-host-node`

This Node-only package performs scoped filesystem input and artifact work.

- `loadBuildInput` and `loadTomlBuild` load direct files or version-1 TOML runs.
- `planDeliverables`, `writeBuildArtifacts`, and `createBuildManifest` support
  managed artifact production.
- `cleanManagedArtifacts`, `refreshStaleArtifacts`, `planOutputBackup`, and
  `createOutputBackup` implement the safe managed-output lifecycle.

Expected input/configuration failures throw `RavelInputError` with portable
diagnostics. Filesystem failures remain ordinary host errors.

## `@pieceful/ravel`

This package is the installed `ravel` executable. Its programmatic import is
side-effect free for package tooling, but it intentionally exposes no parallel
JavaScript command API in 0.1; use the CLI contract instead.
