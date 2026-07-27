# Live execution (0.2 development)

Ravel's live-execution stage runs after ordinary source composition. It is
language-neutral: core plans value dependencies and resources, while a
registered provider owns parsing and evaluation for a particular language.
Parsing Markdown or constructing a Ravel Map never executes code.

The initial provider is `@pieceful/ravel-js-live`, which evaluates `js` and
`javascript` with QuickJS compiled to WebAssembly.

## Executable fences

Use the fence's real language and add `.run` plus a stable chunk name:

````markdown
```js {.run #source}
export default [1, 2, 3];
```

```javascript {.run #double}
const values = ch("source");
export default values.map((value) => value * 2);
```
````

`.run` implies that the explicitly named fence is a Ravel chunk. The adapter
stores `metadata.language` for highlighting and
`metadata.data.ravel.run: true` for execution planning; it does not name
QuickJS or any other provider. An unmarked JavaScript fence is not executable.
When more than one provider accepts a language, `provider=provider-id` can
select one explicitly on the fence.

Within one document, `ch("source")` resolves an untyped name when exactly one
chunk with that name exists. A typed reference such as `ch("source.js")` is
also valid. Ambiguous or missing references are planning errors.

## JavaScript live profile

A live JavaScript module must contain exactly one top-level `export default`,
and it must be the final statement. Its value can be `null`, a boolean, a finite
number, a string, an array, or a string-keyed plain object containing those
values recursively. This includes `""`, `[]`, `{}`, `false`, and `0`.

Missing exports and non-data values such as `undefined`, functions, symbols,
bigints, non-finite numbers, cycles, accessors, and class instances are errors.
Functions may be defined and used during a run, but they cannot cross an
execution boundary.

The provider statically discovers literal `ch("...")` dependencies and
`load("...")` resources. Computed names, imports, dynamic imports, and dynamic
code generation are rejected. Values supplied by `ch` and `load` are serialized
copies and are deeply frozen inside the QuickJS realm.

```js
const csv = load("cool.csv");
const rows = csv.trim().split("\n").map((line) => line.split(","));
export default rows;
```

`load` reads only a resource snapshot supplied by the host. It is not a
filesystem operation.

## Portable API

Core exports two asynchronous-stage helpers without changing the synchronous
0.1 composition API:

- `planLiveExecutions(program, { providers })` selects providers, analyzes
  executable chunks, resolves dependencies, and diagnoses live cycles.
- `executeLiveProgram(program, { providers, resources?, limits?, signal? })`
  evaluates the planned graph and returns per-chunk values, canonical serialized
  text, statuses, and diagnostics.

Providers implement a stable ID, version, language aliases, `analyze(request)`,
and `execute(request)`. A provider receives composed source, copied inputs,
copied resources, limits, source identity, a run ID, and an optional
`AbortSignal`. This boundary is intentionally independent of JavaScript so a
future RiX or other WebAssembly-backed provider can use the same planner.

Successful results are data; they do not write files. A later host/directive
stage may explicitly encode a string as text or a value as JSON and route it to
an output.

## Current safety boundary

The initial provider creates a fresh QuickJS runtime for every execution and
sets memory, stack, and interrupt deadlines. It installs no Node globals,
filesystem, network, timers, console, QuickJS `std`/`os`, or general module
loader.

This is the first 0.2 vertical slice, not yet the complete hostile-code
boundary. Execution still needs a terminable outer browser/Node worker,
output-size and pending-job quotas, broader adversarial tests, and the planned
read-only virtual filesystem for approved transform modules.
