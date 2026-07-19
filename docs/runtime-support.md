# Runtime support and testing policy

## Promise

Ravel will run where modern JavaScript runs: browsers, Bun, and Node. This does
not mean every package runs everywhere. The boundary is intentional:

| Package class | Browser | Bun | Node |
| --- | --- | --- | --- |
| Ravel Map and core graph/syntax | yes | yes | yes |
| Browser-safe format adapters | yes | yes | yes |
| Notebook/editor integration | yes | yes where embedding makes sense | yes where embedding makes sense |
| Node filesystem/process host | no | only if separately implemented | yes |
| CLI | no | future optional wrapper | yes |

`@ravel/core` is the portability contract. If a feature needs a filesystem,
shell, network policy, cache directory, or console display, it belongs in a
host package rather than core.

## Source and package rules

- Publish portable packages as native ESM with explicit export maps.
- Use TypeScript for types, but compile to browser-compatible ESM; do not make
  a bundler a runtime requirement.
- Do not import `node:*`, use CommonJS, `process`, `Buffer`, or a filesystem in
  portable packages.
- Prefer Web Platform APIs: `URL`, `TextEncoder`, `TextDecoder`, `crypto`,
  `AbortSignal`, and Web Streams when required.
- Pass capabilities explicitly. A core operation that needs I/O receives a
  host interface; it does not discover ambient globals.
- Test behavior, not runtime identity. The same Ravel Map input must yield the
  same program value, diagnostics, graph, and provenance across runtimes.

## Test architecture

Conformance fixtures are the shared source of truth:

```text
fixtures/
  map/       input Ravel Maps and expected validation/diagnostics
  syntax/    chunk bodies and expected syntax trees/errors
  program/   resolved graphs, values, cycles, and provenance
```

Test cases should be plain data plus a runtime-neutral assertion function. Thin
adapters invoke that function from each environment:

| Adapter | Runner |
| --- | --- |
| Node | `node --test` and `node:test` |
| Bun | `bun test` and `bun:test` |
| Browser | a module test page importing the same fixtures and assertion function |

The browser page is both a useful development inspector and the target driven
by browser automation in CI. Select the automation wrapper only when the first
browser test exists; it should launch real Chromium, Firefox, and WebKit-class
browsers where practical, without changing the portable test cases.

The initial browser page is `browser-test/runtime-contract.html`. It imports
the same `runtimeContractFailures` assertion module as the Node and Bun test,
then exposes `data-ravel-test=passed` or `failed` for a future automation
driver.

## Required matrix

Every portable package change must pass:

1. Node 22+ test suite;
2. current Bun test suite;
3. browser conformance suite in at least one modern Chromium-class browser;
4. a periodic cross-browser run for Firefox and WebKit-class coverage.

Before Node, Bun, or browser support is claimed for an API, add at least one
shared fixture exercising it. Add a regression fixture for every portability
bug.

## Current scaffold

The initial runtime-contract test verifies the portable Web Platform baseline
in both Node and Bun. The first core implementation task must add one shared
map fixture, one Node adapter, one Bun adapter, and a browser module-page
adapter together.
