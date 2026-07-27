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

The provider statically discovers literal `ch("...")` dependencies,
`load("...")` resources, and static module imports. Computed names, dynamic
imports, unapproved modules, and dynamic code generation are rejected. Values
supplied by `ch` and `load` are serialized copies and are deeply frozen inside
the QuickJS realm.

```js
const csv = load("cool.csv");
const rows = csv.trim().split("\n").map((line) => line.split(","));
export default rows;
```

`load` reads only a resource snapshot supplied by the host. It is not a
filesystem operation.

## Importing helper modules

Live blocks have no ambient npm, URL, or filesystem module resolver. A host
creates a provider with an immutable registry of approved ESM source:

```js
const provider = createJavaScriptLiveProvider({
  modules: {
    "@ravel/csv": `
      export const parseCsv = (text) =>
        text.trim().split(/\\r?\\n/).map((line) => line.split(","));
    `
  }
});
```

The block can then import that exact name:

```js
import { parseCsv } from "@ravel/csv";
export default parseCsv(load("cool.csv"));
```

An npm library must first be bundled by trusted host tooling into
QuickJS-compatible ESM. The resulting source—not a package path or live host
object—is copied to the worker once during provider configuration. Its imports
can resolve only to other entries in the same registry. This is suitable for
pure-JavaScript CSV libraries; packages requiring Node built-ins, native
addons, or filesystem access need the later transform-module/VFS layer.

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

The provider keeps a QuickJS Wasm module warm inside a dedicated Node or browser
worker, while creating a fresh QuickJS runtime for every execution. It sets
memory, stack, interrupt, and serialized-output limits. It installs no Node
globals, filesystem, network, timers, console, or QuickJS `std`/`os`. Its
module loader can return only pre-registered source strings.

Timeout, cancellation, worker errors, and a failed interrupt terminate the
outer worker, and a subsequent run starts a replacement. Pending-job quotas,
broader adversarial tests, and the planned read-only virtual filesystem for
approved transform modules remain before this can claim a complete hostile-code
security boundary.
