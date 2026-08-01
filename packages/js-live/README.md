# @pieceful/ravel-js-live

The QuickJS/WebAssembly execution provider for Ravel 0.2.
It analyzes ordinary `js` and `javascript` chunks marked `.run`, resolves their
declared `ch("...")` and `load("...")` inputs through Ravel core, and evaluates
them without Node, filesystem, network, console, or output capabilities.

```sh
npm install @pieceful/ravel-core @pieceful/ravel-js-live
```

Register the provider with core after ordinary Ravel composition:

```js
import { executeLiveProgram } from "@pieceful/ravel-core";
import { javascriptLiveProvider } from "@pieceful/ravel-js-live";

const result = await executeLiveProgram(program, {
  providers: [javascriptLiveProvider],
  resources: { "cool.csv": "name,value\nalpha,1\n" }
});
```

Live modules must end with exactly one `export default`. The value may be any
JSON-compatible value, including an empty string, empty collection, `false`,
`0`, or `null`. Inputs are copied and deeply frozen before evaluation.

QuickJS runs in a persistent Node or browser worker so its compiled Wasm module
stays warm. Every evaluation still creates a fresh QuickJS runtime. Timeout,
cancellation, worker failure, or an unresponsive interrupt terminates the
outer worker; the provider creates a replacement for a later run. Call
`provider.dispose()` when a provider is no longer needed.

## Approved modules

Live code cannot resolve npm packages, paths, or URLs. A host may instead
register immutable, QuickJS-compatible ES module source:

```js
import { createJavaScriptLiveProvider } from "@pieceful/ravel-js-live";

const provider = createJavaScriptLiveProvider({
  modules: {
    "@ravel/csv": `
      export const parseCsv = (text) =>
        text.trim().split(/\\r?\\n/).map((line) => line.split(","));
    `
  }
});
```

The live block can then use a normal static import:

```js
import { parseCsv } from "@ravel/csv";
export default parseCsv(load("cool.csv"));
```

For an npm CSV parser, the host must first bundle its pure-JavaScript dependency
graph into one ESM source string and register that string under an approved
specifier. Native addons, Node built-ins, dynamic imports, package resolution,
and filesystem loading remain unavailable.

Node hosts can bundle explicitly allowlisted, already-installed package exports
without executing them:

```js
import { prepareJavaScriptModules } from "@pieceful/ravel-js-live/node";

const modules = await prepareJavaScriptModules([
  { specifier: "@ravel/csv", from: "csv-parse/browser/esm/sync" }
], { rootDirectory: projectDirectory });
```

The `node` subpath is deliberately separate from the browser-safe provider
entry. Ravel does not install packages or run package lifecycle scripts.

Browser builds should emit `@pieceful/ravel-js-live/worker-browser` as a
separate module-worker entry and place the release-sync
`emscripten-module.wasm` asset beside that worker bundle. Supply the emitted
worker through `workerFactory` when a bundler cannot preserve the package's
default `new URL(..., import.meta.url)` worker location.

The worker boundary, memory/stack/time/output limits, immutable data boundary,
and closed module registry provide layered isolation. Pending-job quotas,
broader adversarial review, transform modules, and a virtual filesystem are
deferred to 0.3, so this package does not claim a complete hostile-code
sandbox.

MIT © James Taylor
