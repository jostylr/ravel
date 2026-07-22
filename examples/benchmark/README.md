# Fifty-chunk assembly benchmark

This is a runnable, static timing fixture with exactly 50 authored Markdown
chunks: 16 in `benchmark-library.md` and 34 in `benchmark-50.md`. The entry
document imports the library, layers substitutions through API and program
assembly chunks, then uses `create`, `compose`, `append`, `newline`, `pass`,
`pipe`, `emit`, `alias`, and `out` to create three direct artifacts. The TOML
configuration contributes a fourth output declaration.

The chunks also exercise built-in substitution transforms: `text`, `ch`,
`delay`, `trim`, `dedent`, `normalize-eol`, and `replace`.

From the `ravel` directory, build and run the assembled program:

```sh
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml
node examples/benchmark/.ravel/runs/fifty-chunk-assembly-benchmark/dist/benchmark.js
```

For a write-free timing loop of Markdown loading, map combination, chunk
resolution, substitutions, directive evaluation, and graph creation:

```sh
npm run benchmark:assembly
RAVEL_BENCHMARK_ITERATIONS=100 npm run benchmark:assembly
```

The timing script reports JSON so a CI job can retain or compare its results.
It deliberately does not write artifacts: use the first command to include
filesystem staging, manifest creation, and artifact writing in a separate
end-to-end measurement.

## Inspecting the assembled graph

The benchmark is also a useful inspection fixture. Every command below reads
the TOML project, so it includes the imported library document. Source paths
in JSON results are relative to the benchmark directory rather than absolute
checkout paths.

Show the compact chunk inventory. Its JSON form includes direct dependencies,
the authored reference text, and source ranges for each substitution:

```sh
npm run ravel -- inspect --config examples/benchmark/ravel-benchmark.toml --chunks
node packages/cli/src/index.js inspect --config examples/benchmark/ravel-benchmark.toml --chunks --json
```

Show the dependency graph and output targets:

```sh
npm run ravel -- inspect --config examples/benchmark/ravel-benchmark.toml --graph
```

The human graph prints `dependent ← dependency`: the large assembled chunk is
on the left and the contributing chunks feed into it from the right. In JSON,
the same relationship is represented explicitly by each chunk's
`dependencies` array.

Validate without writing and receive stable machine-readable diagnostics:

```sh
npm run ravel -- check --config examples/benchmark/ravel-benchmark.toml --json
```

The clean benchmark reports `"diagnostics": []`. To investigate a bad
reference or configuration, run the same command after making the intentional
change; diagnostics include the root-relative path, line, column, code, and
message. Add `--debug` only when diagnosing an unexpected internal error.

Preview the output plan, source chunks, byte counts, and hashes without
writing any artifacts:

```sh
npm run ravel -- build --config examples/benchmark/ravel-benchmark.toml --dry-run --json
```

## Evaluation traces

`inspect --trace` records the post-substitution value at each definition
pipeline phase. It is intentionally verbose: most chunks have a single
`protected-input` snapshot, while the delayed-note chunk shows its safe token,
the `concat()` transform result, and the fulfilled literal.

Use the direct executable form when piping JSON to another program:

```sh
node packages/cli/src/index.js inspect \
  --config examples/benchmark/ravel-benchmark.toml \
  --trace --json \
  | jq '.chunks["benchmark::benchmark:delayed-note.js"]'
```

`npm run ravel --` is the recommended interactive wrapper. npm prints its own
script banner before the command's JSON, however, which makes a raw pipe to
`jq` invalid JSON. The `node packages/cli/src/index.js` form invokes the same
CLI implementation directly and leaves stdout as pure JSON. Alternatively,
use `npm run --silent ravel -- ...`; the `--silent` flag suppresses npm's
banner while retaining the workspace-script lookup.

To retain the complete program, including chunks, direct reference ranges,
deliverables, traces, and diagnostics, write a graph snapshot during a normal
build:

```sh
npm run ravel -- build \
  --config examples/benchmark/ravel-benchmark.toml \
  --graph .ravel/runs/fifty-chunk-assembly-benchmark/program.json
```

This is graph-level inspection, not yet a generated-source map: precise
generated-position-to-source queries remain planned provenance work for 0.1.
