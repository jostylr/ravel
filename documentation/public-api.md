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

- `markdownToMap(text, options)` converts the compatibility fence profile or
  explicitly selected modern profile to `{ map, diagnostics }`.
- `modernMarkdownToMap(text, options)` parses heading-owned and named-fence
  modern Markdown.

## `@pieceful/ravel-markdown-litpro`

- `litproMarkdownToMap(text, options)` parses the independent historical
  adapter and returns `{ map, diagnostics, surface }`.
- `options.dialect` selects `litpro-2017`, `pieceful-2020`, or `litpro-plus`.
- `options.headings` selects or configures `legacy`, `flat`, or `none` heading
  semantics.
- `isLitproMarkdown(text)` detects an explicit `lp.adapter: markdown-litpro`
  front-matter selection without making a host parse Markdown configuration.

## `@pieceful/ravel-core`

- `parseChunkId` and `formatChunkId` convert canonical chunk identities.
- `parseChunk` parses an individual chunk body into portable syntax data.
- `parseDefinitionPipeline` gives source adapters the shared definition-time
  transform grammar without evaluating a pipeline.
- `combineMaps(maps)` constructs the pre-transform graph.
- `transformGraph(graph, { transforms?, deferLiveResults?, liveResults? })`
  evaluates that graph and returns the program, deliverables, diagnostics,
  dependencies, and trace. Hosts use `deferLiveResults` before execution and
  pass the completed execution result as `liveResults` for ordinary text
  materialization.
- `planLiveExecutions(program, { providers })` performs the language-neutral
  analysis and dependency-planning stage for chunks marked executable.
- `executeLiveProgram(program, { providers, resources?, limits?, signal? })`
  executes that plan asynchronously and returns portable values, canonical
  serialization, statuses, and diagnostics.
- `ravelValueIssue`, `serializeRavelValue`, and `cloneRavelValue` implement the
  recursive data boundary shared by execution providers.
- `createDeliverableProvenanceMap(deliverable)` and
  `createBuildProvenanceMap(program)` construct version-1 sidecar and aggregate
  generated-output maps.
- `sourceAtGeneratedOffset(map, offset)` and
  `generatedRangesForSource(map, uri, offset)` provide forward and reverse
  provenance lookup. Exact results include a corresponding offset; coarse
  results retain the best attributable range without claiming character identity.
- `generatedRangesForSourceRange(map, uri, range)` maps a half-open source
  range, while `explainGeneratedOffset(program, deliverable, offset)` adds the
  definition, references, and dependency path.
- `provenanceMapVersion` identifies the generated provenance contract.

The `@pieceful/ravel-core/directives` entry point exposes constructors for the
portable directive IR. Custom transforms are functions that receive a string
value and return a string; a failed or non-string result becomes a diagnostic.

## `@pieceful/ravel-js-live` (0.2 development)

- `javascriptLiveProvider` is the shared QuickJS/WebAssembly provider for `js`
  and `javascript`.
- `createJavaScriptLiveProvider(options?)` creates a provider with configured
  memory, stack, execution-time, output, worker, and approved-module limits.
  `options.modules` maps exact import specifiers to immutable ESM source;
  `options.workerFactory` integrates a host's emitted browser worker.
- A provider keeps its Wasm module warm behind a terminable worker, creates a
  fresh QuickJS runtime for each execution, and exposes `dispose()`.

The provider parses modules before execution, accepts one final
`export default`, exposes literal `ch("...")` and `load("...")` lookups over
immutable copied data, and resolves static imports only from the approved
registry. See [Live execution](live-execution.md) for the profile and current
security boundary.

The Node-only `@pieceful/ravel-js-live/node` subpath exports
`prepareJavaScriptModules`. It bundles installed package exports explicitly
allowlisted by a host into the immutable ESM-source registry.

## `@pieceful/ravel-host-node`

This Node-only package performs scoped filesystem input and artifact work.

- `loadBuildInput` and `loadTomlBuild` load direct files or version-1 TOML runs.
- `planDeliverables`, `writeBuildArtifacts`, and `createBuildManifest` support
  managed artifact production. A managed build writes a `.ravelmap` sidecar for
  every deliverable and an aggregate `.ravelmap` bundle.
- `cleanManagedArtifacts`, `refreshStaleArtifacts`, `planOutputBackup`, and
  `createOutputBackup` implement the safe managed-output lifecycle.

Expected input/configuration failures throw `RavelInputError` with portable
diagnostics. Filesystem failures remain ordinary host errors.

## `@pieceful/ravel`

This package is the installed `ravel` executable. Its programmatic import is
side-effect free for package tooling, but it intentionally exposes no parallel
JavaScript command API in 0.1; use the CLI contract instead.
