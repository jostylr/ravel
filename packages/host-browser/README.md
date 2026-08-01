# `@pieceful/ravel-host-browser`

An in-memory, browser-safe Ravel host for rendering one Markdown document into
a Ravel Map, completed program, generated deliverables, diagnostics, and
provenance maps.

```sh
npm install @pieceful/ravel-host-browser
```

```js
import { renderMarkdownDocument } from "@pieceful/ravel-host-browser";

const result = renderMarkdownDocument(`
---
ravel:
  document: greeting
---

\`\`\`javascript {.ravel #main type=js}
console.log("Hello from Ravel");
\`\`\`

\`\`\`ravel
out("dist/greeting.js", _"main.js")
\`\`\`
`, { uri: "greeting.md" });

if (!result.ok) {
  console.error(result.diagnostics);
} else {
  console.log(result.deliverables[0].value);
  console.log(result.deliverables[0].provenanceMap);
}
```

`BrowserRenderResult` always returns structured diagnostics instead of throwing
for authored source errors. On success it contains the parsed map, completed
`RavelProgram`, and every declared deliverable with a provenance map. Use the
program with `@pieceful/ravel-explorer` when you want a bounded dependency
graph in a browser UI.

## Boundary

This host has no filesystem, network, project loading, artifact writing, or
live `.run` execution capability. It evaluates one caller-supplied Markdown
string using the explicit opt-in Markdown profile by default. Its optional
`transforms` are trusted synchronous functions supplied by the embedding
application; a document cannot register or discover them.

The [Ravel playground](https://ravel.jostylr.com/playground/) is a complete
browser example built with this package.
