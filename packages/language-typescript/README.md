# `@pieceful/ravel-language-typescript`

An in-process native TypeScript/JavaScript language-service bridge for Ravel
virtual documents. It keeps TypeScript project state warm and normalizes native
results to generated-document URIs and zero-based UTF-16 offset ranges. Ravel's
routing layer is responsible for translating those ranges back to literate
source.

## Runtime setup

TypeScript is an optional peer dependency so an editor or host may inject the
compiler API it already owns:

```js
import { createTypeScriptLanguageBridgeWithApi } from
  "@pieceful/ravel-language-typescript";

const bridge = createTypeScriptLanguageBridgeWithApi(typescript, {
  currentDirectory: workspaceRoot,
  configSearchRoot: workspaceRoot
});
```

The asynchronous `createTypeScriptLanguageBridge()` factory loads the
`typescript` package when no API is injected. It reports
`TYPESCRIPT_NOT_AVAILABLE` with an actionable message when neither is
available.

## Virtual file and project identity

Each document must keep a stable `uri` and monotonically increasing `version`.
For correct relative-import semantics it should also provide its declared
artifact location in `fileName`, `path`, `artifactPath`, or `outputPath`. A
host can instead provide `fileNameForDocument(document)`. Projection objects
need no extra field: a safe relative `artifactId` such as `dist/app.ts` is the
default declared artifact location. Absolute artifact IDs, URI-like IDs, and
paths that escape the workspace are rejected and receive an isolated in-memory
fallback path.

The bridge selects a project in this order:

1. `configFileForDocument(document, fileName)`;
2. `document.tsconfigPath` or `document.metadata.tsconfigPath`;
3. the bridge-level `tsconfigPath`;
4. the nearest `tsconfig.json` above the declared artifact path; or
5. an inferred project with safe TypeScript/JavaScript analysis defaults.

Configuration lookup is confined to `configSearchRoot`, which defaults to
`currentDirectory`; a relative value is resolved from `currentDirectory`.
Upward discovery stops at that root. Explicit paths from a document, bridge
option, or host callback are ignored when their lexical or canonical filesystem
location is outside the root; lookup then falls back to a confined nearest
config or an inferred project. This also prevents a config symlink beneath the
root from selecting a file outside it. A host may widen the root deliberately
when one trusted TypeScript project spans several workspace folders.

`configSearchRoot` confines configuration selection; it is not a complete
filesystem sandbox. Once a trusted host enables the adapter, TypeScript's
configured-file processing, project references, standard library, module, and
declaration resolution use the native filesystem host and may read dependencies
outside that root. Hosts that need a stronger boundary must provide an explicit
file-access-root policy or a more isolated adapter; this adapter does not yet
implement such a filesystem sandbox. Ravel's VS Code host still confines
locations returned to the editor, but this native read boundary keeps the
strict M7 security gate open.

Configured compiler options, path aliases, JSX mode, project references,
standard libraries, and declaration packages are delegated to the native
TypeScript project service. Open virtual files overlay filesystem reads and
participate in ordinary module resolution without being written to disk.
Each Ravel target-and-stage pair owns an isolated TypeScript project and
document registry, even when two projections use the same `tsconfig.json` and
artifact path. This prevents browser/server targets and authoring/assembled
stages from contaminating one another while keeping each analysis context warm
across edits. Moving an open document to another stage also moves it to that
stage's project before later requests are served.

The supported language IDs are `typescript`, `typescriptreact`, `javascript`,
and `javascriptreact`. Semantic operations support authoring and assembled
projections. Emitted or destructive transformed projections are intentionally
not advertised for editable language features.

## Lifecycle and cancellation

`change` rejects stale updates and version regressions. Requests can carry an
exact document version and are discarded when superseded. TypeScript's
cancellation token observes the request's `AbortSignal`; because the compiler
API is synchronous, cancellation is cooperative at native cancellation points
and is checked again before returning a response.

Open/change cancellation is commit-aware. Cancellation before project mutation
publishes no document. If cancellation arrives after a project mutation commits,
the bridge records the same committed entry before settling, so its retained
document map and TypeScript project cannot diverge. Script versions include a
per-project insertion sequence as well as the Ravel document version, ensuring
a reopened or moved virtual file receives a fresh native snapshot identity.

`restart()` rebuilds language services and reopens every current in-memory
document. `dispose()` releases services and forgets document text. This adapter
does not spawn a process and does not require a shadow workspace.
