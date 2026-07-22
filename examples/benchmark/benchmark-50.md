---
ravel:
  document: benchmark
---

# Fifty-chunk assembly benchmark

This is a deliberately broad static-weaving fixture. Together with
`benchmark-library.md`, it contains exactly 50 authored chunks: 16 library
chunks and 34 benchmark chunks. The final JavaScript artifact is assembled
through several layers of chunk substitution, rather than by merely appending
all fences in document order.

```ravel
in("benchmark-library.md")

create("assembly.js", compose(
  _"benchmark:program-parts.js",
  newline(2),
  append(_"benchmark:entrypoint.js"),
  pass(trim(), emit("captured.js")),
  pipe(normalize-eol(), emit("normalized.js"))
))

alias("public.js", _"assembly.js")
out("dist/benchmark.js", _"public.js")
out("dist/benchmark-captured.js", _"assembly:captured.js")
out("dist/benchmark-normalized.js", _"assembly:normalized.js")
```

## Configuration chunks

`text`, `replace`, and `ch` appear below as part of normal JavaScript
generation. The value-only configuration chunk is deliberately substituted
into the declaration rather than emitted as a top-level program fragment.

```javascript {.ravel #benchmark--name type=js}
const benchmarkName = _"|text('`Ravel 50-chunk assembly timing benchmark`') | replace('timing', 'composition')";
```

```javascript {.ravel #benchmark--configuration-value type=js}
{ size: 2500, rounds: 12, seed: 0x5eed1234 }
```

```javascript {.ravel #benchmark--configuration type=js}
const benchmarkConfiguration = _"|ch('benchmark:configuration-value.js')";
```

```javascript {.ravel #benchmark--delayed-note type=js pipe="concat()"}
const benchmarkNote = _"|delay(text('`A literal restored after the definition pipeline`'), 1, 'BENCHMARKNOTE')";
```

## Dataset preparation chunks

```javascript {.ravel #data--create-values type=js}
function createValues(configuration) {
  const random = createRandom(configuration.seed);
  return Array.from(
    { length: configuration.size },
    (_, index) => Math.floor(random() * 100000) + index % 17
  );
}
```

```javascript {.ravel #data--map-values type=js}
function mapValues(values) {
  return values.map((value, index) => (value * 31 + index * 7) % 100003);
}
```

```javascript {.ravel #data--filter-values type=js}
function filterValues(values) {
  return values.filter((value, index) => (value + index) % 3 !== 0);
}
```

```javascript {.ravel #data--sort-values type=js}
function sortValues(values) {
  return [...values].sort((left, right) => left - right);
}
```

```javascript {.ravel #data--prepare type=js}
_"data:create-values.js"

_"data:map-values.js"

_"data:filter-values.js"

_"data:sort-values.js"

function prepareValues(configuration) {
  return sortValues(filterValues(mapValues(createValues(configuration))));
}
```

## Workload chunks

```javascript {.ravel #work--checksum type=js}
function checksum(values) {
  return values.reduce((state, value, index) => (state + value * (index + 3)) % 1000003, 0);
}
```

```javascript {.ravel #work--fold type=js}
function foldedTotal(values) {
  let result = 0;
  for (const value of values) result = (result * 33 + value) % 2147483647;
  return result;
}
```

```javascript {.ravel #work--simulate type=js}
_"work:checksum.js"

_"work:fold.js"

function simulateWork(values) {
  return checksum(values) ^ foldedTotal(values);
}
```

## Timing chunks

```javascript {.ravel #timing--measure type=js}
function measure(label, operation) {
  const now = createClock();
  const started = now();
  const value = operation();
  return { label, value, milliseconds: now() - started };
}
```

```javascript {.ravel #timing--warmup type=js}
function warmup(operation, iterations = 3) {
  let value;
  for (let iteration = 0; iteration < iterations; iteration += 1) value = operation();
  return value;
}
```

```javascript {.ravel #timing--sample type=js}
function sample(label, operation) {
  return measure(label, operation);
}
```

```javascript {.ravel #timing--samples type=js}
_"timing:measure.js"

_"timing:warmup.js"

_"timing:sample.js"

function collectSamples(label, operation, rounds) {
  return Array.from({ length: rounds }, () => sample(label, operation));
}
```

## Reporting chunks

```javascript {.ravel #report--title type=js}
function renderTitle(name) {
  return benchmarkBanner(name);
}
```

```javascript {.ravel #report--configuration type=js}
function renderConfiguration(configuration) {
  return "size=" + configuration.size + ", rounds=" + configuration.rounds + ", seed=" + configuration.seed;
}
```

```javascript {.ravel #report--measurement type=js}
function renderMeasurement(measurement) {
  return measurement.label + " result=" + measurement.value;
}
```

```javascript {.ravel #report--summary type=js}
function renderSummary(samples) {
  return formatSummary("milliseconds", samples.map((entry) => entry.milliseconds));
}
```

```javascript {.ravel #report--footer type=js}
function renderFooter() {
  return "Static assembly only; no source code was evaluated while building.";
}
```

```javascript {.ravel #report--render type=js}
_"report:title.js"

_"report:configuration.js"

_"report:measurement.js"

_"report:summary.js"

_"report:footer.js"

function renderReport(name, configuration, samples) {
  return [
    renderTitle(name),
    renderConfiguration(configuration),
    renderMeasurement(samples.at(-1)),
    renderSummary(samples),
    renderFooter()
  ].join("\n");
}
```

## Runner chunks

```javascript {.ravel #runner--execute type=js}
function executeBenchmark(values, configuration) {
  warmup(() => simulateWork(values));
  return collectSamples("simulateWork", () => simulateWork(values), configuration.rounds);
}
```

```javascript {.ravel #runner--verify type=js}
function verifyBenchmark(values, samples) {
  verify(values.length > 0, "prepared values are present");
  verify(samples.length > 0, "at least one measurement was recorded");
  verify(samples.every((entry) => Number.isFinite(entry.milliseconds)), "measurements are finite");
}
```

```javascript {.ravel #runner--report type=js}
function reportBenchmark(configuration, samples) {
  console.log(renderReport(benchmarkName, configuration, samples));
  console.log(benchmarkNote);
}
```

```javascript {.ravel #runner--main type=js}
function main() {
  const values = prepareValues(benchmarkConfiguration);
  const samples = executeBenchmark(values, benchmarkConfiguration);
  verifyBenchmark(values, samples);
  reportBenchmark(benchmarkConfiguration, samples);
}
```

## Assembly layers

The next six chunks provide the intentionally nested graph. The final program
substitutes `program-parts`, which substitutes APIs, which in turn substitute
individual functions from this document and the imported library.

```javascript {.ravel #benchmark--library-api type=js}
_"benchmark-library::library:banner.js | trim()"

_"benchmark-library::library:clamp.js"

_"benchmark-library::library:sum.js"

_"benchmark-library::library:minimum.js"

_"benchmark-library::library:maximum.js"

_"benchmark-library::library:mean.js"

_"benchmark-library::library:variance.js"

_"benchmark-library::library:standard-deviation.js"

_"benchmark-library::library:median.js"

_"benchmark-library::library:percentile.js"

_"benchmark-library::library:format-number.js"

_"benchmark-library::library:format-summary.js"

_"benchmark-library::library:next-random.js"

_"benchmark-library::library:create-random.js"

_"benchmark-library::library:create-clock.js"

_"benchmark-library::library:verify.js"
```

```javascript {.ravel #benchmark--data-api type=js}
_"data:prepare.js | dedent()"
```

```javascript {.ravel #benchmark--work-api type=js}
_"work:simulate.js"
```

```javascript {.ravel #benchmark--timing-api type=js}
_"timing:samples.js"
```

```javascript {.ravel #benchmark--report-api type=js}
_"report:render.js"
```

```javascript {.ravel #benchmark--runner-api type=js}
_"runner:execute.js"

_"runner:verify.js"

_"runner:report.js"

_"runner:main.js"
```

```javascript {.ravel #benchmark--program-parts type=js}
_"benchmark:name.js"

_"benchmark:configuration.js"

_"benchmark:delayed-note.js"

_"benchmark:library-api.js"

_"benchmark:data-api.js"

_"benchmark:work-api.js"

_"benchmark:timing-api.js"

_"benchmark:report-api.js"

_"benchmark:runner-api.js"
```

```javascript {.ravel #benchmark--entrypoint type=js}
main();
```
