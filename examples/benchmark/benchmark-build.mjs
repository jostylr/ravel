import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadBuildInput } from "@pieceful/ravel-host-node";
import { transformGraph } from "@pieceful/ravel-core";

const input = fileURLToPath(new URL("./ravel-benchmark.toml", import.meta.url));
const requestedIterations = Number(process.env.RAVEL_BENCHMARK_ITERATIONS ?? 20);
const iterations = Number.isSafeInteger(requestedIterations) && requestedIterations > 0 ? requestedIterations : 20;
const samples = [];
let authoredChunks = 0;

for (let iteration = 0; iteration < iterations; iteration += 1) {
  const started = performance.now();
  const loaded = await loadBuildInput(input);
  const program = transformGraph(loaded.pretransform);
  const elapsed = performance.now() - started;
  const errors = program.diagnostics.filter((entry) => entry.severity === "error");
  if (errors.length) throw new Error("Benchmark source is invalid: " + errors.map((entry) => entry.message).join("; "));
  authoredChunks = Object.values(program.chunks).filter((chunk) => !chunk.generated).length;
  if (authoredChunks !== 50) throw new Error("Benchmark must contain exactly 50 authored chunks; found " + authoredChunks + ".");
  samples.push(elapsed);
}

const ordered = [...samples].sort((left, right) => left - right);
const average = samples.reduce((total, value) => total + value, 0) / samples.length;
console.log(JSON.stringify({
  benchmark: "fifty-chunk-assembly",
  iterations,
  chunks: authoredChunks,
  loadAndEvaluateMilliseconds: {
    min: ordered[0],
    median: ordered[Math.floor(ordered.length / 2)],
    mean: average,
    max: ordered.at(-1)
  }
}, null, 2));
