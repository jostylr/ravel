# `@pieceful/ravel-language-bridge`

Editor-neutral contracts for connecting Ravel virtual documents to native
target-language services. A bridge advertises its actual request capabilities,
keeps stable generated documents open, and returns generated locations for the
trusted Ravel routing layer to map back to literate source.

The package does not depend on an editor API, filesystem, language, or Ravel's
projection implementation.

## Adapter boundary

The minimum document contract is deliberately small:

```js
{
  uri: "pieceful-virtual://demo/web/dist%2Fapp.ts/assembled/typescript",
  version: 4,
  languageId: "typescript",
  text: "export const answer = 42;\n"
}
```

`id`, `snapshotId`, `targetId`, `artifactId`, `stage`, and target-project hints
are optional. The router supplies an allowlisted generated-file view; it does
not expose source text, source versions, provenance mappings, occurrence
trees, or projection indexes. An adapter must not require those fields or try
to map results back to authored files. It returns ranges in the generated URI,
and the router owns all provenance decisions.

Every range and position is an absolute, zero-based UTF-16 code-unit offset in
the exact virtual document version that handled the request. Ordinary target
project files may use `file:` URIs; an open generated file must use its stable
logical virtual URI.

## Capabilities and a minimal adapter

Declare every accepted `languageId` and every supported request/stage pair.
Unsupported requests remain explicitly false; hosts must query capabilities
instead of inferring support from a language name.

```js
import {
  BRIDGE_ERROR_CODES,
  LanguageBridgeError,
  createBridgeCapabilities,
  requireLanguageRequestSupport,
  throwIfAborted
} from "@pieceful/ravel-language-bridge";

const documents = new Map();

export const bridge = {
  languageIds: ["typescript", "javascript"],
  capabilities: createBridgeCapabilities({
    completion: {
      stages: ["assembled", "transformed"],
      triggerCharacters: ["."]
    },
    hover: { stages: ["assembled", "transformed", "emitted"] },
    definition: { stages: ["assembled", "transformed", "emitted"] }
  }),

  async open(document, signal) {
    throwIfAborted(signal);
    documents.set(document.uri, document);
  },

  async change(previous, next, changes, signal) {
    throwIfAborted(signal);
    if (documents.get(previous.uri)?.version !== previous.version ||
        next.version <= previous.version) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.VERSION_REGRESSION,
        "Virtual document versions must advance."
      );
    }
    // `next` is authoritative; `changes` is only an optimization hint.
    documents.set(next.uri, next);
  },

  async close(document) {
    documents.delete(document.uri);
  },

  async request(request, context, signal) {
    throwIfAborted(signal);
    requireLanguageRequestSupport(bridge, request, context);
    const document = documents.get(request.documentUri);
    if (!document || document.version !== context.version) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.STALE_DOCUMENT,
        "The requested virtual document version is not open.",
        { retryable: true }
      );
    }
    return nativeServiceRequest(document, request, signal);
  }
};
```

Passing `true` to `createBridgeCapabilities()` is shorthand for support at the
`assembled` stage. Use the object form whenever triggers, completion resolve,
workspace-symbol support, or multiple stages matter.

The backing implementation may be an in-memory language API, open-document
protocol, supervised process, editor service, or allowlisted shadow workspace.
The adapter owns target configuration, module resolution, standard libraries,
filesystem overlays, and any target process. The projection and routing
packages provide only generated documents and request context.

## Document and request lifecycle

- `open` receives the first retained version of a stable URI.
- `change` receives the acknowledged previous document, the immutable next
  document, and optional text changes. The complete `next.text` is
  authoritative; reject version regressions and URI collisions.
- Cancellation before a native mutation commits publishes no bridge document.
  If cancellation is observed after `open` or `change` commits, retain the
  committed document before settling so adapter and native-service state cannot
  diverge.
- `close` removes the retained document and its text.
- `request` must reject unknown, closed, or stale documents and return results
  only for `context.version`.
- Every potentially long operation observes `AbortSignal`, including native
  project setup. `throwIfAborted()` converts cancellation to a retryable
  `BRIDGE_ABORTED` error.
- `dispose` cancels work, releases native resources, and forgets retained text.

Expected failures use `LanguageBridgeError` and a stable
`BRIDGE_ERROR_CODES` value. Mark an error retryable only when reopening or
restarting against the same request could succeed. Keep `details` structured
and content-redacted; authored text and generated file contents do not belong
in logs or lifecycle events. `bridgeError()` converts an unexpected native
failure at the adapter boundary.

## Normalized results

- Definitions, type definitions, and references return generated
  `{ uri, range }` locations. References can identify writes and definitions.
- Diagnostics return `{ uri, range, code, severity, message, source, related }`.
- Document/workspace symbols and call hierarchy items retain their generated
  URI and ranges.
- Rename and completion code actions group text edits by generated URI. They
  are proposals only: never apply them in the adapter. The routing layer must
  reverse-map and classify every edit first.

The complete discriminated `LanguageRequest` union and conditional
`LanguageResponse` mapping are exported in the package declarations.

## Process-backed adapter contract

`ProcessBackedLanguageBridge` is an interface and lifecycle policy for an
adapter that owns an external service. This package does not spawn a process or
provide a production supervisor. A conforming adapter emits lifecycle
transitions through `stopped`, `starting`, `ready`, `failed`, `restarting`, and
`disposed`. A crash rejects pending requests with a retryable, redacted
`BRIDGE_CRASHED` error. The adapter's supervisor uses
`createRestartPolicy()`/`restartDelay()` and never overlaps restart attempts.

After a replacement process starts, reopen the latest retained version of every
document that was open at the crash. Enter `ready` only after all opens are
acknowledged. Exhausting `maximumAttempts` leaves the adapter failed; explicit
`restart()` starts a new attempt sequence. Disposal cancels timers, closes the
process, forgets document text, and permanently enters `disposed`.

`@pieceful/ravel-language-bridge/testing` exports a deterministic fake bridge
for adapter, routing, cancellation, stale-version, crash, restart, and
document-reopen tests.

MIT © James Taylor
