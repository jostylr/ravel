# TypeScript bridge uses the in-process Language Service API

- Status: accepted for the first vertical slice
- Date: 2026-07-31
- Checklist: VD-ADR-01, VD-ADR-04, VD-ADR-10, VD-TS-01

## Context

Ravel needs native TypeScript and JavaScript completion, hover, navigation,
diagnostics, symbols, calls, and rename against generated documents that may
never exist on disk. The bridge must keep configured-project state warm, see
unsaved projection versions, and return generated ranges without acquiring an
editor dependency.

The candidates were the TypeScript Language Service API in the Pieceful/Ravel
language-service process, the `tsserver` protocol in a managed child process,
and a third-party TypeScript LSP wrapper.

## Decision

Use the native TypeScript Language Service API in process. The adapter accepts
an injected compiler API, allowing an editor or host to reuse a TypeScript
runtime it already owns. Its asynchronous factory can instead load the
optional `typescript` peer dependency.

The working spike opens stable virtual `.ts`, `.js`, `.tsx`, and `.jsx` files
through a `LanguageServiceHost`. Virtual text overlays filesystem reads;
virtual directories and files participate in ordinary module resolution. The
host parses the selected `tsconfig.json`, retains compiler options and project
references, and adds open projections to the configured root files.

The adapter receives a reduced generated-file record rather than Ravel's full
projection. It sees stable identity and version, language, generated text,
target/artifact/stage, and allowlisted logical path/configuration metadata.
Provenance maps, occurrence trees, authored source, line indexes, and writable
source authority remain in the transport-neutral router.

Both explicit configuration selection and automatic `tsconfig.json` discovery
are confined to a host-supplied `configSearchRoot`. Discovery never walks above
that root, and lexical plus canonical-path checks reject symlink escapes. The
VS Code host sets the search root to the loaded Ravel project root.

The headless native test demonstrates:

- cross-document member completion;
- relative imports and `paths` alias resolution without shadow files;
- hover, signature help, definition, type definition, and references;
- document and workspace symbols;
- incoming and outgoing calls;
- semantic diagnostics after an unsaved versioned change;
- rename across virtual modules;
- auto-import completion details and their additional text edit;
- JSX configuration and all four supported language IDs;
- cooperative cancellation, stale-version rejection, service restart, and
  in-memory document reopen.

## Alternatives

`tsserver` remains a valid future process-isolation option, but adds protocol,
process supervision, restart/backoff, and file-identity complexity without
improving the first bridge's project fidelity. At spike time, no repository
TypeScript runtime or `tsserver` executable was available, so a portable
child-process spike would also have required a new installation. The selected
API is the same project engine behind `tsserver` and directly supports the
required in-memory host.

A third-party LSP wrapper is not selected because it adds a dependency and a
second normalization layer before Ravel's own transport-neutral router. It can
be reconsidered if another editor host requires process isolation and cannot
inject TypeScript.

## Consequences

- The adapter is Node-hosted but the generic bridge and projection packages
  remain editor- and language-neutral.
- TypeScript is optional at package installation time. A host must inject it
  or install the optional peer before creating the adapter. The first VS Code
  host deliberately bundles TypeScript 5.9 so editor behavior does not depend
  on an undocumented path into VS Code's built-in TypeScript extension.
- The compiler API is synchronous. Abort signals are checked before and after
  every operation and exposed through TypeScript's cancellation token, but a
  native operation can stop only at TypeScript cancellation points.
- The VS Code host creates the in-process adapter only for a trusted workspace.
  Ravel-native language features and generated views remain available before
  trust; granting trust reconstructs and resynchronizes the router.
- Configuration discovery is deliberately narrower than TypeScript's ambient
  upward search. A configuration outside `configSearchRoot`, including one
  reached through a symlink, is ignored even if ordinary TypeScript tooling
  would discover it.
- Correct relative-import semantics require the projection's declared output
  path (or a host file-name resolver). The logical virtual URI remains the
  public identity.
- No shadow workspace is needed for the first adapter, so VD-SHD-01 through
  VD-SHD-08 are not applicable to this decision.
- `restart()` reconstructs project services and reopens current in-memory
  documents. A future out-of-process adapter must additionally implement the
  generic deterministic retry/backoff contract.

## Validation evidence

- [`test/language-typescript.test.mjs`](../../test/language-typescript.test.mjs)
  injects a deterministic compiler surface to verify normalized results,
  versions, completion edits, restart, and all four supported language IDs.
- The native case in that file uses a real TypeScript runtime to verify
  configured module resolution, `paths`, JSX, distinct target environments,
  cross-file completion/navigation/symbols/calls/rename, auto-import edits,
  unsaved diagnostics, cancellation, document reopen, and confined explicit
  and discovered configuration paths. It skips when the host neither installs
  nor injects TypeScript; G3 therefore requires a clean-checkout/CI run that
  supplies the optional runtime.
- [`fixtures/virtual-documents/typescript`](../../fixtures/virtual-documents/typescript)
  provides the configured project used by the native harness.
- [`test/language-bridge.test.mjs`](../../test/language-bridge.test.mjs) verifies
  the editor-neutral capability, structured failure, capped-backoff, stale
  version, cancellation, restart, and reopen contracts independently of
  TypeScript.

## Decision boundary and open work

This ADR selects only the backing mechanism for the first TypeScript adapter.
It does not accept every M3–M7 gate and does not decide the long-term virtual
URI name, occurrence identity across source moves, active-target persistence,
imports-piece syntax, editor/LSP transport, or a second language.

The current adapter is in-process, so its `restart()` behavior is implemented
and tested without a child-process supervisor. Capped exponential backoff and
crash/reopen behavior are generic bridge contracts plus fake-bridge tests, not
a production process-recovery implementation. Likewise, the adapter returns
generated edits as proposals; Ravel's separate classifier and editor host must
reverse-map, preview, revalidate, and atomically apply them before M6 can be
considered complete.
