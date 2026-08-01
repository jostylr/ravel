# `@pieceful/ravel-language-service`

Editor-neutral routing between authored [Ravel](https://github.com/jostylr/ravel) locations, virtual projections,
and native target-language bridges. It also classifies generated workspace
edits before an editor host is allowed to modify authored documents.

The package uses absolute UTF-16 offsets at its portable boundary. An editor or
LSP host converts line/character positions with the projection line indexes.
It does not execute Ravel effects and never writes source, deliverables, or
shadow files.

## Request routing

```js
import { createLanguageRouter } from "@pieceful/ravel-language-service";

const router = createLanguageRouter({
  projectionService,
  bridges: [typescriptBridge],
  trace: (event) => telemetry.event(event),
});

await router.update(snapshot, abortSignal);

const response = await router.request(
  "completion",
  { uri: "guide.md", offset: 120 },
  {
    targetId: "web",
    artifactId: "dist/app.ts",
    request: { options: { includeCompletionsForModuleExports: true } },
  },
  abortSignal,
);

if (response.status === "ok") {
  showCompletions(response.result.items);
}
```

For a selected source location the router:

1. finds every matching projection occurrence;
2. selects a target, artifact, stage, and optional occurrence;
3. synchronizes all same-target, same-stage documents supported by the bridge;
4. sends only the generated-document contract to the bridge; and
5. maps locations and ranges back to authored source while retaining generated
   context on the normalized result.

The bridge never receives provenance maps, authored source text, source line
indexes, or source versions.

### Ambiguity is a host decision

If a source position occurs in multiple targets and neither `targetId` nor a
matching `defaultTargetId` selects one, the response is
`{ status: "target-required", candidates }`. Multiple artifacts in the chosen
target also return `target-required` until the host supplies `artifactId`;
there is no silent first-artifact fallback. Use `listTargets()` to populate a
picker and persist only a deliberate host/user choice. `stage` and
`occurrenceId` can further pin the generated context.

Several exact occurrences remaining in one target and artifact also return
`target-required`, with `ambiguityKind: "occurrence"`, until the host supplies
the selected `projectionId`/`occurrenceId`. Duplicate mapping candidates are
collapsed only when their routing context is identical; generated text
equality is not treated as semantic equivalence.

Other non-throwing statuses are `unmapped`, `exact-mapping-required`,
`bridge-unavailable`, and `capability-unavailable`. Completion, completion
details, signature help, prepare-rename, and rename require an exact cursor
mapping. Navigation requests can retain coarser generated context.

### Cancellation, versions, and failures

Pass an `AbortSignal` through both `update()` and `request()`. The router does
not publish a superseded projection update, forwards cancellation to bridge
open/change/request work, and checks cancellation again before returning.
After a native response, it verifies that the selected projection version is
still current. A stale response throws retryable `BRIDGE_STALE_DOCUMENT`
instead of being mapped into the new snapshot.

The current router serializes each complete request against projection updates:
candidate selection, compatible-document synchronization, native execution,
stale validation, and reverse mapping share one consistency boundary.
Per-bridge/per-document queues prevent duplicate or out-of-order
open/change/close operations. A queued caller can still observe cancellation
promptly; its already-enqueued operation stays ordered and checks the same
signal before doing work.

A retryable bridge error is retried once by default when the bridge implements
`restart()`; set `maximumRetries` in request options to change that bound.
Cancellation is never treated as a crash and never restarts the bridge.
Capability and routing outcomes use the statuses above. Lifecycle, native, and
stale failures throw structured `LanguageBridgeError` values for the host to
surface or suppress deliberately.

Call `dispose()` to dispose registered bridges and forget synchronized virtual
documents. `registerBridge()` returns an unregister function for dynamic host
integrations.

## Safe workspace-edit policy

Native rename and completion code actions are never directly applicable.
`router.request()` attaches `classifiedEdit` to those responses, or a host can
call `classifyWorkspaceEdit()` directly:

```js
import {
  classifyWorkspaceEdit,
  validateSourceEditVersions,
} from "@pieceful/ravel-language-service";

const classified = classifyWorkspaceEdit(generatedWorkspaceEdit, {
  projectionService,
  sourceVersions: new Map([["guide.md", 17]]),
  isWritableSource(uri) {
    // Canonicalize the URI, resolve symlinks, and check an explicit workspace
    // allowlist here. A string-prefix check is not sufficient.
    return writableSourceUris.has(canonicalSourceUri(uri));
  },
  limits: {
    documents: 32,
    edits: 2_000,
    replacementTextCodeUnits: 250_000,
  },
});

if (classified.applicable) {
  const versions = currentOpenDocumentVersions();
  const checked = validateSourceEditVersions(classified.sourceEdit, versions);
  if (checked.valid) applyAtomically(classified.sourceEdit);
}
```

Automatic application is fail-closed. Every edit must:

- target a currently known virtual document and, when supplied, its current
  projection version;
- map to exactly one `exact`/`identity` authored range;
- have both a writable mapping and a projection stage that allows writable
  edits;
- pass the host's `isWritableSource(uri)` allowlist; and
- carry a known, non-negative current authored version from `sourceVersions`.

Completion replacement spans and prepare-rename ranges are reverse-mapped only
through the projection occurrence selected for the request. The router exposes
an authored primary range only when that context produces one unique writable
`exact`/`identity` destination; zero or several destinations remain
generated-only, so a host cannot accidentally apply a plausible range from a
sibling expansion.

The callback is the security boundary for write scope. It should compare
canonical paths/URIs against explicit workspace roots and account for symlinks,
case rules, and URI encoding. Omitting either the callback or a source version
rejects the edit. Immediately before applying, call
`validateSourceEditVersions()` with freshly read versions and apply all
documents atomically; a missing or changed version makes validation fail.

Classification outcomes are:

| Classification | Meaning                                                                                                                                                        | Host behavior                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `automatic`    | Every entry passed all exactness, writability, version, conflict, and size checks.                                                                             | May apply only when `applicable === true` and final version validation succeeds. |
| `preview`      | Provenance exists but is ambiguous, anchored, transformed, or otherwise non-exact.                                                                             | Show context/preview; do not apply the returned partial edit set.                |
| `action`       | Synthetic text can be routed only through an explicit `importDestination` policy.                                                                              | Offer a separate, host-defined action; do not treat it as a text edit.           |
| `rejected`     | The proposal is stale, opaque, synthetic without policy, unmapped, outside the allowlist, conflicting, malformed, oversized, or contains a resource operation. | Do not apply. Surface a safe reason when useful.                                 |

The overall classification is the strictest entry. Even if `sourceEdit`
contains individually exact entries, never partially apply it when the overall
classification is not `automatic`. Identical edits caused by repeated
expansion are deduplicated; overlapping non-identical authored edits are
rejected. Generated create/rename/delete operations are always rejected.

Default limits are 128 documents, 5,000 edits, and 1,000,000 replacement-text
UTF-16 code units. Hosts can lower these positive limits. Limits bound proposal
classification, not native service execution, so adapters should enforce their
own resource budgets too.

MIT © James Taylor
