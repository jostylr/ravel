# @pieceful/ravel-js-live

The initial QuickJS/WebAssembly execution provider for Ravel 0.2 development.
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

This first vertical slice enforces QuickJS memory, stack, and time limits. A
terminable outer worker and the broader transform-module virtual filesystem
remain 0.2 implementation work; do not treat the current package as a complete
hostile-code security boundary.

MIT © James Taylor
