# Runtime support and testing policy

This document records the implemented 0.1 support policy. Explorer, notebook,
and editor work mentioned elsewhere is post-0.1 and is not part of this matrix.

## Promise

Ravel will run where modern JavaScript runs: browsers, Bun, and Node. This does
not mean every package runs everywhere. The boundary is intentional:

| Package class | Browser | Bun | Node |
| --- | --- | --- | --- |
| Ravel Map and core graph/syntax | yes | yes | yes |
| Browser-safe format adapters | yes | yes | yes |
| Notebook/editor integration | post-0.1 | post-0.1 | post-0.1 |
| Node filesystem/process host | no | only if separately implemented | yes |
| CLI | no | future optional wrapper | yes |

`@pieceful/ravel-core` is the portability contract. If a feature needs a filesystem,
shell, network policy, cache directory, or console display, it belongs in a
host package rather than core.

## Source and package rules

- Publish portable packages as native ESM with explicit export maps.
- Publish browser-compatible ESM with checked handwritten `.d.ts` declarations;
  do not make TypeScript or a bundler a runtime requirement.
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
by Playwright automation in CI. `npm run test:browser` bundles the Markdown
adapter, serves the self-contained pages from a loopback-only server, and checks
both pages in headless Chromium.

The initial browser page is `browser-test/runtime-contract.html`. It imports
the same `runtimeContractFailures` assertion module as the Node and Bun test,
then exposes `data-ravel-test=passed` or `failed` for the automation driver.

## Required matrix

Every portable package change must pass:

1. Node 22+ test suite;
2. current Bun test suite;
3. browser conformance suite in Playwright Chromium.

Chromium is the intentionally narrow 0.1 browser policy. Firefox and WebKit
coverage may be added later, but their absence must not be described as tested
cross-browser support.

Before Node, Bun, or browser support is claimed for an API, add at least one
shared fixture exercising it. Add a regression fixture for every portability
bug.

## Current coverage

`browser-test/shared/runtime-contract.mjs` is shared by the Node and Bun test
and the runtime browser page. The bundled Markdown page exercises fenced chunk
extraction, directives, graph evaluation, and built-in transforms through the
same portable packages used by the Node and Bun suites. The broader fixture
corpus lives in `test/` and `fixtures/`; additions should include a regression
case in every relevant runtime.
