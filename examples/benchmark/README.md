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
