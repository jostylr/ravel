---
ravel:
  document: benchmark-library
---

# Benchmark support library

This document contributes 16 small chunks to the assembly benchmark. They are
kept separate from the workload document so each benchmark iteration also
exercises a Markdown `in(...)` import and cross-document substitutions.

```javascript {.ravel #library--banner type=js}
function benchmarkBanner(title) {
  return "\n== " + title + " ==";
}
```

```javascript {.ravel #library--clamp type=js}
function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}
```

```javascript {.ravel #library--sum type=js}
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
```

```javascript {.ravel #library--minimum type=js}
function minimum(values) {
  return Math.min(...values);
}
```

```javascript {.ravel #library--maximum type=js}
function maximum(values) {
  return Math.max(...values);
}
```

```javascript {.ravel #library--mean type=js}
function mean(values) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
```

```javascript {.ravel #library--variance type=js}
function variance(values) {
  const average = mean(values);
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
}
```

```javascript {.ravel #library--standard-deviation type=js}
function standardDeviation(values) {
  return Math.sqrt(variance(values));
}
```

```javascript {.ravel #library--median type=js}
function median(values) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}
```

```javascript {.ravel #library--percentile type=js}
function percentile(sortedValues, ratio) {
  const index = Math.floor(clamp(ratio, 0, 1) * (sortedValues.length - 1));
  return sortedValues[index];
}
```

```javascript {.ravel #library--format-number type=js}
function formatNumber(value) {
  return Number(value).toFixed(3);
}
```

```javascript {.ravel #library--format-summary type=js}
function formatSummary(label, values) {
  const ordered = [...values].sort((left, right) => left - right);
  return label + ": " + [
    "min=" + formatNumber(minimum(ordered)),
    "median=" + formatNumber(median(ordered)),
    "mean=" + formatNumber(mean(ordered)),
    "p95=" + formatNumber(percentile(ordered, 0.95)),
    "max=" + formatNumber(maximum(ordered)),
    "sd=" + formatNumber(standardDeviation(ordered))
  ].join(", ");
}
```

```javascript {.ravel #library--next-random type=js}
function nextRandom(state) {
  return (state * 1664525 + 1013904223) >>> 0;
}
```

```javascript {.ravel #library--create-random type=js}
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = nextRandom(state);
    return state / 0x100000000;
  };
}
```

```javascript {.ravel #library--create-clock type=js}
function createClock() {
  return () => performance.now();
}
```

```javascript {.ravel #library--verify type=js}
function verify(condition, message) {
  if (!condition) throw new Error("Benchmark verification failed: " + message);
}
```
