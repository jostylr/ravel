# Ravel virtual documents and generated-code navigation — design specification

**Status:** Implementation baseline; partial through M7
**Date:** 2026-07-31
**Audience:** Ravel core, projection, language tooling, editor, and Rix
implementers
**Implementation checklist:** [virtual-documents-checklist-07-31-26.md](virtual-documents-checklist-07-31-26.md)

This specification was drafted under the **Pieceful** working name. Remaining
uses of “Pieceful” refer to the same product and model now implemented as
**Ravel**; the public package names use `@pieceful/ravel-*`.

## 1. Summary

Ravel will provide native code intelligence while a user edits a literate
document by projecting the current immutable Piece Document into one or more
ordinary, language-specific virtual documents. A target language service sees
the projected program as normal source code. Ravel translates positions,
diagnostics, navigation results, and safe edits between that generated program
and the original literate source.

The same projection data powers a read-only generated-code view. A user can
open or peek an expansion, see the region contributed by the current piece,
move among multiple occurrences, and inspect the complete expansion path from
artifact root to source fragment.

This design does not implement a new completion or type-analysis engine.
Ravel owns literate semantics, assembly, provenance, and request routing;
the target language's established tools continue to own language semantics.

The central contract is:

> For every analysis-stage character that came from author source, Ravel can
> identify its source range and expansion occurrence; for every author range,
> Ravel can identify every current generated occurrence. Unmapped generated
> text is explicitly synthetic and is never silently edited back into source.

### 1.1 Current implementation profile

The implementation follows the layering in this specification, with one naming
change: transport-neutral routing lives in `language-service`; there is not yet
a JSON-RPC/LSP transport package.

| Layer | Current package | Implemented boundary |
| --- | --- | --- |
| Literate model and provenance | [`@pieceful/ravel-core`](packages/core/README.md) | Immutable evaluated program, dependency graph, structured source locations, and deliverable provenance consumed by projection. |
| Projection | [`@pieceful/ravel-projection`](packages/projection/README.md) | Browser-safe virtual documents, bidirectional mappings, occurrences, generated context, incremental deltas, and transform maps. |
| Adapter contract | [`@pieceful/ravel-language-bridge`](packages/language-bridge/README.md) | Editor-neutral capabilities, normalized requests/results, lifecycle policy, structured failure, and deterministic fake. |
| First native adapter | [`@pieceful/ravel-language-typescript`](packages/language-typescript/README.md) | In-process TypeScript Language Service with configured-project and in-memory file overlays. |
| Routing and edit safety | [`@pieceful/ravel-language-service`](packages/language-service/README.md) | Headless source/virtual request routing, Ravel-native semantics, diagnostic mapping, call mapping, and workspace-edit classification. |
| First rich host | [`@pieceful/ravel-vscode`](packages/vscode/README.md) | Explorer, generated-document commands and context overlays, current-projection TypeScript/JavaScript providers, persisted document target/artifact and piece occurrence selection, exact-safe rename, diagnostics, and call hierarchy. Preview/structural edits and full Extension Host acceptance remain incomplete. |

The implementation/evidence matrix in the [companion checklist](virtual-documents-checklist-07-31-26.md#implementation-status--2026-07-31)
is the status authority. This specification remains normative; the presence of
a package or unit test does not by itself satisfy an editor acceptance gate.

## 2. Normative language

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** express
requirements in this specification. They are used to distinguish correctness
requirements from recommended implementation choices.

## 3. Goals

The system MUST support:

1. Completion, hover, signature help, and semantic diagnostics while the
   literate document contains unsaved edits.
2. Target-language go-to-definition and find-references across piece
   boundaries.
3. Piece-aware go-to-definition and references for Pieceful substitutions,
   directives, piece IDs, and artifact roots.
4. Mapping compiler, linter, and language-service diagnostics back to precise
   literate source ranges with expansion context.
5. Read-only generated documents with current-piece highlighting, occurrence
   navigation, and expansion breadcrumbs.
6. Safe source edits for operations whose target ranges map exactly, including
   basic completion edits and symbol rename.
7. Explicit handling of pieces expanded in multiple artifacts or semantic
   contexts.
8. Incremental recomputation, cancellation, and stable document identity so
   interactive latency is practical.
9. Multiple target-language integrations without placing editor or language
   service dependencies in `core`.
10. Operation without executing document effects or untrusted code.

## 4. Non-goals

The first implementation will not:

- Make every arbitrary text transform safely reversible.
- infer a destination for target-language edits that address synthetic text;
- guarantee identical language-service behavior across all editors;
- replace debuggers or runtime stack-frame source maps;
- execute notebook cells as part of completion or projection;
- provide semantic completion for a piece that has no analyzable language or
  program context;
- make final minified or binary artifacts pleasant authoring surfaces; or
- support every language server before the TypeScript/JavaScript vertical slice
  proves the adapter contract.

Runtime debugging may compose its source maps with this system later, but it is
not required for the first editor milestone.

## 5. User experience

### 5.1 Editing a code fragment

When the cursor is in an LP-marked code fence, Pieceful MUST determine the
containing piece, language, active analysis target, and corresponding generated
occurrence. The target-language service receives the current projected text and
the translated cursor position. Results are translated back into the literate
document.

From the user's perspective, member completion, parameter hints, hover types,
definitions, references, and ordinary language diagnostics behave as if the
assembled program were being edited directly.

### 5.2 Pieceful constructs

Pieceful's own language service handles constructs the target language cannot
understand:

- piece declaration IDs and display names;
- `_"piece"` substitutions and pipelines;
- derive, rewrite, read, write, execute, and report directives;
- unknown, ambiguous, duplicate, or cyclic piece references;
- artifact roots and expansion paths; and
- transform names and argument schemas.

Hovering a substitution SHOULD show the referenced piece, language, abbreviated
value, dependents, and generated occurrences. Definition MUST navigate to the
piece declaration. References MUST include both substitution sites and relevant
directives.

### 5.3 Generated-code context

At a piece declaration, source fragment, substitution, diagnostic, or mapped
symbol, a user MUST be able to invoke:

- **Peek generated occurrence**;
- **Open generated document**;
- **Show all generated occurrences**; and
- **Show expansion path**.

The generated view MUST:

- use the current unsaved snapshot;
- be read-only by default;
- highlight the exact occurrence selected by the user;
- distinguish text from the selected piece, descendant pieces, other pieces,
  transforms, and synthetic scaffolding;
- show the artifact, stage, target, snapshot version, and expansion breadcrumb;
- allow next/previous navigation when the source appears more than once; and
- navigate from generated text back to its best source range.

A suggested breadcrumb is:

```text
dist/server.ts › main › routes › request-handler › literal fragment
```

CodeLens above a piece MAY summarize its status:

```text
Used in 3 artifacts · 5 expansions · 2 incoming calls
```

### 5.4 Ambiguous contexts

A source piece can have several generated occurrences with different imports,
types, wrappers, or build options. The system MUST NOT silently choose a
semantically different occurrence when more than one is plausible.

An editor session therefore has an **active analysis target**, selected in this
order:

1. an explicit user selection for the document or piece;
2. the target associated with the open generated view;
3. the sole artifact containing the piece;
4. a declared default target in project configuration; or
5. no target, producing a target-selection action rather than misleading
   semantic results.

If several occurrences within the active target are semantically equivalent,
the adapter MAY choose one and record the equivalence. If completion results
are requested from multiple contexts, identical results MAY be merged;
conflicting results MUST be labeled by target or occurrence.

An active target does not implicitly select one of several artifacts. When a
source position maps to multiple artifacts in the same target, the router MUST
request or restore an explicit artifact choice unless the adapter has declared
those occurrences semantically equivalent. Lexical artifact ordering is not a
semantic selection policy. The current router returns `target-required` with
artifact-qualified candidates in this case.

The current router applies the same fail-closed rule when several distinct
occurrences remain inside one target and artifact. It returns an occurrence
ambiguity and accepts a persisted projection/occurrence choice; only duplicate
candidates with identical routing context are collapsed.

The VS Code host persists the broad target/artifact choice at document scope
and the exact projection/occurrence choice at piece scope. Piece scope has
priority over document scope, and a selection for one piece must not influence
routing in another piece. Either scope is invalidated when its selected context
disappears.

## 6. Architecture

The target workspace has a projection and routing layer between the graph
engine and editor integration:

```text
ravel/
  packages/
    core/                 Piece Document, graph, evaluation, diagnostics
    markdown/             source adapter with precise ranges
    projection/           virtual documents, occurrences, bidirectional maps
    language-bridge/      target-language service adapter contracts
    language-typescript/  first native language adapter
    language-service/     transport-neutral routing and safe edit policy
    vscode/               generated views and VS Code-specific UX
```

A future LSP package can adapt `language-service` to JSON-RPC. Syntax may move
to a dedicated package, and notebook/Rix support remains planned at M8; neither
boundary exists as a standalone package in the current tree.

`projection` MUST depend only on browser-safe Pieceful model packages. It MUST
NOT spawn processes, access the filesystem, or import an editor API.

`language-bridge` defines a host-facing interface. Individual adapters MAY use
an in-process language API, a child language-server process, an editor-provided
language service, or a shadow workspace. These integration choices MUST NOT
leak into `core` or `projection`.

`language-service` owns Ravel-native semantics and transport-neutral request
translation. A future `lsp` adapter can expose that contract without moving
mapping policy into transport code. An editor-specific package MAY provide
richer generated views or use an already installed target-language extension,
but correctness cannot depend on UI-only state.

### 6.1 Data flow

```text
source edit
  -> format adapter incremental parse
  -> immutable Piece Document snapshot
  -> dependency invalidation
  -> analysis-stage projection(s)
  -> target-language document update
  -> language request/result
  -> reverse mapping and deduplication
  -> editor response and generated-context UI
```

Effects are excluded from this flow. Projection evaluates only parsing,
resolution, assembly, and registered pure transforms required to obtain the
analysis stage.

## 7. Core projection model

### 7.1 Identifiers

All identifiers MUST be stable across edits that do not change the identified
semantic object.

```ts
type SnapshotId = string;
type ProjectionId = string;
type ArtifactId = string;
type TargetId = string;
type PieceId = string;
type OccurrenceId = string;

type ProjectionStage =
  | "authoring"
  | "assembled"
  | "transformed"
  | "emitted";
```

- `SnapshotId` identifies an immutable graph state.
- `ProjectionId` identifies one artifact, target, stage, and language
  combination.
- `OccurrenceId` identifies one expansion of a piece within a projection.
- IDs MUST NOT be based solely on line numbers or byte offsets.
- Moving a source fragment SHOULD retain its semantic ID when the adapter can
  establish identity safely.

### 7.2 Virtual document

```ts
type VirtualDocument = {
  id: ProjectionId;
  uri: string;
  snapshotId: SnapshotId;
  version: number;
  artifactId: ArtifactId;
  targetId: TargetId;
  stage: ProjectionStage;
  languageId: string;
  text: string;
  mappings: readonly ProjectionSegment[];
  occurrences: readonly ExpansionOccurrence[];
  lineIndex: LineIndex;
  contentHash: string;
};
```

The `version` MUST increase monotonically for a stable virtual URI. A stale
language-service result MUST be discarded or mapped only against the exact
snapshot and version that produced it.

### 7.3 Mapping segments

```ts
type MappingKind =
  | "exact"
  | "anchored"
  | "transformed"
  | "opaque"
  | "synthetic";

type ProjectionSegment = {
  virtual: OffsetRange;
  source?: SourceRange;
  pieceId?: PieceId;
  occurrenceId?: OccurrenceId;
  expansionPath: readonly PieceId[];
  kind: MappingKind;
  startAffinity?: "left" | "right";
  endAffinity?: "left" | "right";
  transformChain?: readonly TransformStep[];
};

type ExpansionOccurrence = {
  id: OccurrenceId;
  pieceId: PieceId;
  projectionId: ProjectionId;
  virtual: OffsetRange;
  invocationSource?: SourceRange;
  expansionPath: readonly PieceId[];
  parentOccurrenceId?: OccurrenceId;
};
```

Ranges are half-open. Zero-width anchors are permitted only where an insertion
policy is explicitly defined.

Cursor positions at a segment boundary require an affinity because the same
offset can be the end of one origin and the start of another. Projection
construction MUST preserve enough syntax context to choose the literal being
edited. A completion at the end of a source literal normally has left affinity;
one at the beginning normally has right affinity. If syntax context and stored
affinity cannot select one exact origin, the mapping returns every candidate
and a writable operation is refused until the ambiguity is resolved.

The implementation MUST maintain:

- an interval index from virtual offsets to segments;
- a reverse interval index from source URI and offsets to segments;
- an occurrence tree for expansion breadcrumbs; and
- a line index for every source and virtual document version.

### 7.4 Mapping kinds

**Exact** means offsets can be translated character-for-character, accounting
for line-ending normalization recorded by the segment.

**Anchored** means a generated range corresponds to a source construct but not
character-for-character. Navigation and diagnostics can return the source
anchor; arbitrary text edits cannot.

**Transformed** means a transform supplied a composable source map. Supported
operations depend on that map's capabilities.

**Opaque** means provenance is known only at piece, fragment, or transform-step
granularity. Diagnostics navigate to that range and include related
information; edits are not reversible.

**Synthetic** means the text has no author-source range. It can participate in
target-language analysis but MUST NOT receive an automatic source edit.

Adjacent segments MAY be coalesced only when their mapping behavior,
occurrence, source continuity, expansion path, and transform chain are
equivalent.

### 7.5 Position encoding

Internally, projection APIs SHOULD use absolute offsets plus immutable line
indexes. The LSP boundary MUST honor the negotiated position encoding. The
first TypeScript implementation MAY use UTF-16 offsets internally because
JavaScript strings and common TypeScript tooling use them, but tests MUST cover
non-BMP characters, combining characters, tabs, CRLF, and final lines without a
newline.

## 8. Projection stages

One final artifact is not necessarily the correct document for every tool.
Pieceful MUST model pipeline stages explicitly.

1. **Authoring stage:** source-language fragments with enough assembled context
   to analyze them; preferred for completion and rename.
2. **Assembled stage:** all piece references expanded, before language-changing
   or destructive transforms; preferred for target-language semantic analysis.
3. **Transformed stage:** after a source-mapped formatter, transpiler, or other
   mapped transform; useful for validation and preview.
4. **Emitted stage:** final artifact; may be minified, bundled, or otherwise
   inappropriate for editing.

The adapter MUST declare which stage supports each capability. A TypeScript
artifact transpiled to JavaScript, for example, uses the assembled TypeScript
projection for completion and may use emitted JavaScript only for preview or
runtime mapping.

An unreachable piece with no artifact root MAY be analyzed using a declared
analysis harness. Harness text is synthetic. The editor MUST identify harness
results as provisional. Pieceful MUST NOT invent a harness when doing so could
change module or scope semantics without informing the user.

## 9. Virtual URI and filesystem policy

The logical URI format SHOULD be stable and opaque to users:

```text
pieceful-virtual://<workspace-id>/<target>/<artifact>/<stage>/<path>
```

The current implementation retains the `pieceful-virtual` scheme for
compatibility. Workspace, target, artifact, and stage components are escaped;
snapshot and language-service versions are deliberately excluded. Stable URI
and refresh behavior are covered by projection and VS Code registry tests. The
long-term scheme name and occurrence-identity stability across source moves
remain ADR work and are not declared complete by this implementation choice.

Logical identity MUST NOT include the snapshot version. Language services keep
one document open and receive monotonically versioned changes.

Target integrations have three permitted backing modes:

1. **In-memory host:** preferred when the language API supports virtual files,
   project configuration, and module resolution.
2. **Open-document bridge:** send `open`/`change`/`close` notifications to a
   language server while preserving a stable file-like identity.
3. **Shadow workspace:** materialize stable files beneath an ignored,
   tool-owned project directory when the target requires filesystem presence.

A shadow workspace MUST:

- remain separate from declared build artifacts;
- contain a manifest identifying it as generated and disposable;
- use atomic replacement;
- preserve stable paths across edits;
- never be included in source control;
- avoid triggering Pieceful's own source watcher recursively; and
- be removable without loss of author data.

Shadow files are an adapter fallback. The public APIs and mappings always use
logical virtual document identities.

## 10. Language bridge contract

```ts
interface LanguageBridge {
  readonly languageIds: readonly string[];
  readonly capabilities: BridgeCapabilities;

  open(document: VirtualDocument, signal: AbortSignal): Promise<void>;
  change(
    previous: VirtualDocument,
    next: VirtualDocument,
    changes: readonly TextChange[],
    signal: AbortSignal,
  ): Promise<void>;
  close(document: VirtualDocument): Promise<void>;

  request<T extends LanguageRequest>(
    request: T,
    context: BridgeRequestContext,
    signal: AbortSignal,
  ): Promise<LanguageResponse<T>>;
}
```

An adapter MUST report its real capabilities; the router MUST NOT infer support
from the language name. The bridge owns target-specific project discovery,
configuration, standard library selection, module resolution, and process
lifecycle.

The bridge boundary is intentionally narrower than a projection. An adapter
receives the stable generated-document identity, snapshot/version, target,
artifact, stage, language, generated text, and the small allowlist of logical
path/configuration metadata needed by native tooling. It does not receive
provenance mappings, occurrence trees, authored source text, source line
indexes, writable-source authority, or router internals. Reverse mapping and
edit authorization remain on the trusted projection/router side.

The first adapter SHOULD support TypeScript and JavaScript through the native
TypeScript project/language service. The implementation decision is recorded
in the accepted [TypeScript bridge ADR](documentation/adr/typescript-language-service-api.md):
the first vertical slice uses the in-process Language Service API with
in-memory overlays. A managed `tsserver` adapter remains a possible future
isolation mode rather than a prerequisite for this adapter.

Lifecycle cancellation MUST preserve one authoritative state. If cancellation
is observed before a bridge mutation commits, no document/project mutation is
published. If it is observed after native `open` or `change` state commits, the
bridge records that committed state before settling the operation; otherwise a
later request could validate against a document version the native service did
not retain, or vice versa. The TypeScript adapter has focused tests for both
boundaries.

## 11. Request routing and result mapping

### 11.1 General request algorithm

For a target-language request, the router MUST:

1. capture the source document version and Pieceful snapshot;
2. locate the source fragment and candidate occurrences;
3. select or request an active target according to section 5.4;
4. choose a projection stage that supports the requested capability;
5. map the source position or range into the chosen occurrence;
6. synchronize that virtual document with the language bridge;
7. issue a cancellable request tagged with projection version;
8. reject stale results;
9. map all returned locations and edits back to source where possible;
10. attach generated-context metadata for non-source or ambiguous results; and
11. deduplicate the response without discarding distinct semantic contexts.

### 11.2 Completion, hover, and signature help

Completion and signature help require an exact cursor mapping. If no exact
mapping exists, Pieceful returns Pieceful-native suggestions or no semantic
result. It MUST NOT move the request to a nearby generated position silently.

Completion text edits are applied automatically only when every affected range
has one exact, contiguous, writable source mapping. Additional edits, especially
imports, follow section 12.

The primary completion replacement and prepare-rename ranges are special:
reverse mapping MUST be constrained to the projection occurrence selected for
the request. They can be exposed as authored ranges only when that context has
one unique writable exact/identity destination. A plausible destination found
through a sibling occurrence is not safe, and an ambiguous primary destination
remains generated-only.

Hover content SHOULD include the target and expansion path when the same source
has context-dependent types.

### 11.3 Definition and type definition

A generated definition location is mapped as follows:

1. exact or transformed source location;
2. anchored piece or transform source with generated location as related data;
3. generated-document location when the definition is synthetic, external, or
   has no author source.

Pieceful definitions and target-language definitions MAY both be returned when
the cursor is on syntax meaningful to both systems, but the UI MUST label them.

### 11.4 References and document/workspace symbols

References from repeated expansions MUST be grouped by original source range.
The response records occurrence count and target set. An editor can initially
show one source reference and allow expansion into generated occurrences.

Generated symbols are mapped to their defining source pieces where possible.
Piece declarations are always Pieceful document symbols even if the target
language cannot parse their contents.

### 11.5 Diagnostics

Target diagnostics MUST carry:

- target and artifact IDs;
- projection stage and version;
- mapped primary source range when available;
- generated range;
- expansion path;
- mapping quality; and
- related source ranges for invocation sites or opaque transforms.

Diagnostics arising from several identical expansions SHOULD be deduplicated by
source range, diagnostic identity, message, and semantic target. The rendered
diagnostic states the number and names of affected occurrences. Diagnostics
that differ by target configuration MUST remain distinct.

When diagnostics are requested projection by projection, the request MUST
retain both projection and occurrence identity. A diagnostic anchor chosen from
the same target/artifact is not sufficient when another occurrence overlaps the
source position. Publication MUST also prove that the project, source capture,
and diagnostic generation are still current; failure from an old project MUST
NOT clear diagnostics already published by the active project.

A diagnostic wholly inside synthetic text appears in the generated view and is
anchored to the narrowest responsible piece, artifact declaration, or project
configuration. It MUST be labeled as generated-context diagnostics.

### 11.6 Call and type hierarchy

Language-service call hierarchy and type hierarchy locations are reverse-mapped
like references. The source-level result MUST retain occurrence metadata so the
UI can distinguish:

- one source call expanded multiple times;
- several source calls to the same symbol; and
- target-dependent call relationships.

The generated-context UI SHOULD show both the semantic call edge and the
Pieceful expansion path. These are different relationships and MUST NOT be
collapsed into one graph edge.

Call-item `selectionRange` is semantically significant: it identifies the name
or span at which follow-up incoming/outgoing requests must be made. When a call
item is reverse-mapped, the selection range MUST be reverse-mapped separately,
must remain within the mapped item range, and MUST fall back to that item range
rather than retain a generated offset. The editor carries target, artifact,
and occurrence context with the mapped item so the follow-up request is routed
back to the same semantic context.

## 12. Editing and refactoring policy

Target-language tools may return workspace edits covering one or many virtual
documents. Pieceful classifies every edit before applying any of them.

### 12.1 Automatically applicable

An edit MAY be applied automatically only when:

- its expected projection and source versions are still current;
- the host supplies an authoritative, nonnegative current version for every
  source document in the operation;
- every source URI belongs to the host's explicit writable-source allowlist;
- its complete range maps exactly to one writable source range;
- the replacement does not cross fragment or occurrence boundaries;
- several generated edits mapping to the same source request the same change;
  and
- no edit in the atomic operation is rejected.

Missing authority is not permission. A closed file, unversioned file, absent
writability callback, or mapping explicitly marked non-writable makes an
automatic operation fail closed. A future preview workflow may reopen and
revalidate such a file, but the direct-edit path MUST NOT assume disk state is
current. Hosts MUST also bound document count, edit count, and replacement text
accepted from a target-language response; the current classifier rejects more
than 128 documents, 5,000 edits, or 1,000,000 replacement UTF-16 code units by
default, with explicit lower host overrides available for tests or policy.

### 12.2 Requires preview or Pieceful action

An edit requires a preview or specialized action when it:

- spans several source fragments;
- maps through an anchored or source-mapped transform;
- maps to different source ranges in different occurrences;
- changes a Pieceful reference or declaration indirectly; or
- needs a policy choice such as selecting an import piece.

### 12.3 Rejected as a direct edit

An edit MUST NOT be written directly when it targets:

- synthetic scaffolding;
- an opaque transform output;
- a final artifact with no reverse mapping;
- an external dependency outside the authorized workspace; or
- a stale snapshot.

The rejection SHOULD provide an actionable explanation rather than silently
dropping the edit.

### 12.4 Imports and generated preambles

Projects SHOULD be able to declare an `imports`, `preamble`, or equivalent
piece for each artifact or language. When a language service requests an import
in synthetic generated space, Pieceful offers an explicit action:

```text
Add import to piece "imports"
Choose destination piece…
Create an imports piece for this artifact
```

Pieceful MUST NOT guess an author location merely because it is textually near
the start of the generated document.

### 12.5 Rename

Rename is atomic. Pieceful MUST:

1. collect all generated edits for the selected semantic target;
2. reverse-map them;
3. collapse identical edits caused by repeated expansion;
4. detect conflicting replacements for one source range;
5. include Pieceful reference syntax only when renaming a piece ID rather than
   a target-language symbol;
6. present a preview for multi-document or non-exact changes; and
7. apply nothing if any required edit is unsafe.

## 13. Transform mapping contract

Every transform used before or within an analysis stage MUST declare one of:

```ts
type TransformMappingCapability =
  | { kind: "identity" }
  | { kind: "offset"; map: OffsetMap }
  | { kind: "source-map"; map: ComposableSourceMap }
  | { kind: "opaque" };
```

- Identity transforms preserve exact mappings.
- Offset transforms such as indentation or EOL normalization provide an exact
  composable offset map.
- Formatters and transpilers SHOULD provide standard or equivalent source maps.
- Opaque transforms retain piece-level provenance but disable precise
  completion/edit mapping after that step.

Source maps MUST be composed across transform stages without discarding the
Pieceful occurrence and expansion path. If a transform changes the language,
the pipeline MUST open a new language-specific projection stage.

## 14. Incrementality, caching, and concurrency

An edit creates a new immutable document snapshot. The implementation SHOULD:

- incrementally reparse only affected format nodes;
- preserve piece IDs for unchanged declarations;
- invalidate the edited piece, its transitive dependents, and affected artifact
  projections;
- reuse unchanged projection text, line indexes, mappings, and occurrences;
- compute minimal text changes for language bridges that benefit from them;
- debounce background work while allowing explicit completion to request an
  immediate snapshot;
- cancel superseded projection and language requests; and
- retain bounded recent snapshots only while outstanding requests refer to
  them.

Suggested initial performance budgets, measured on a warm 100,000-line project,
are:

| Operation | Initial p95 budget |
| --- | ---: |
| Source edit to updated Piece Document | 50 ms |
| Projection update for one affected artifact | 100 ms |
| Pieceful routing/mapping overhead for completion | 50 ms |
| Generated-view refresh after projection exists | 50 ms |
| Background update before yielding to cancellation | 25 ms |

Target-language processing time is measured separately. These are engineering
budgets to validate during the vertical slice, not compatibility guarantees.

The current in-process router uses a deliberately conservative consistency
boundary: a complete native request (candidate selection, compatible-document
synchronization, native execution, stale validation, and mapping) is serialized
against projection updates. Per-document lifecycle queues prevent duplicate
open/change/close operations, while an aborted queued caller settles promptly
without bypassing the internal ordering. Broader request concurrency can be
reintroduced only with a generation covering every synchronized sibling.

## 15. Generated-context presentation model

The projection layer exposes presentation-neutral data:

```ts
type GeneratedContext = {
  projection: VirtualDocument;
  selectedOccurrenceId: OccurrenceId;
  visibleRange: OffsetRange;
  highlights: readonly GeneratedHighlight[];
  breadcrumb: readonly ExpansionBreadcrumbItem[];
  siblings: readonly OccurrenceSummary[];
};
```

An editor adapter decides whether this appears as a peek panel, side editor,
inline overlay, or Rix pane. The underlying generated document and occurrence
selection MUST be the same across presentations.

Highlight categories are:

- selected source fragment;
- other fragments in the selected piece occurrence;
- descendant piece expansions;
- surrounding artifact context;
- transformed text; and
- synthetic text.

Generated views SHOULD preserve syntax coloring by assigning the target
language ID. Decorations and breadcrumbs MUST remain valid only for the exact
projection version; the view refreshes or marks itself stale after an edit.
The editor's currently loaded virtual text MUST also equal the registry's
current projection text before decorations, breadcrumbs, or return-to-source
navigation are presented. This closes the interval in which provider metadata
has advanced but the editor has not yet consumed its change event.

## 16. Project and configuration semantics

Language semantics depend on project configuration, not only generated text.
Each analysis target MUST define or resolve:

- workspace/project root;
- target language and version;
- artifact roots;
- compiler/interpreter options;
- module resolution base and path aliases;
- environment libraries and type stubs;
- analysis projection stage;
- optional harness and preamble pieces; and
- backing mode allowed for its language adapter.

Project discovery MUST be confined to a host-selected configuration search
root. An explicit `tsconfig.json` and an automatically discovered one are both
rejected when their lexical or canonical path escapes that root; discovery
does not walk above it, including through symlinks. The VS Code implementation
uses the loaded Ravel project root as the TypeScript `configSearchRoot`.

Configuration is declarative. Opening an editor MUST NOT execute document code,
shell commands, fetches, or write effects. A target that lacks required trusted
configuration reports a Pieceful diagnostic and may still provide syntax-only
features.

## 17. Security and trust

Editor analysis is a restricted host mode:

- Parsing, graph resolution, projection, and mapping run without ambient I/O.
- Only registered pure transforms approved for analysis may run.
- Effects remain planned data and are never committed by completion or
  navigation.
- Target-language services receive only the workspace and virtual/shadow files
  allowed by the host.
- Shadow workspaces use an allowlisted root.
- Language-server processes inherit a deliberately constructed environment.
- Logs and traces MUST redact source text unless the user enables content
  capture.

Untrusted workspaces MAY disable process-backed language adapters while still
providing Pieceful syntax, graph diagnostics, and generated previews.

The VS Code implementation applies the stronger rule to its in-process
TypeScript adapter as well: no target-language bridge is constructed until the
workspace is trusted. Granting trust resets and resynchronizes the router.
Ravel-native parsing, graph navigation, diagnostics, and generated views do not
depend on that bridge and remain available.

Write and source-navigation authority is derived from inputs the host actually
loaded as authored non-JSON documents. In-memory overlays, including an
overlay for a JSON Ravel Map, are honored during evaluation. However, a source
URI merely asserted inside JSON map data does not add that file to the authored
allowlist and does not make it writable. Paths must also remain beneath the
canonical project root; symlink and URI-scheme checks are applied before an
editor location or edit is created. Because JSON map provenance is supplied
data rather than ranges produced by a source adapter in the current load, the
presence of any JSON map makes the VS Code project's automatic source-edit
policy read-only. This deliberately conservative rule also covers a JSON map
that imports an otherwise authored markup source. A separate loaded-input
invalidation list includes JSON maps and the project configuration, so this
write restriction does not prevent dirty map overlays from refreshing current
projections.

The VS Code host captures one immutable editor snapshot and derives both build
overlays and projection source text/version metadata from it. Every open buffer,
including a clean buffer, participates in evaluation. Relevant open/close,
text, version, or dirty-state changes invalidate the capture; synchronization
retries and then fails closed before registry publication or writable language
features. Automatic edits additionally require equality between the selected
projection's captured source version, the project capture, and the current
editor document version.

The Node host also returns the exact text consumed for each authored non-JSON
input. A read-only navigation result may adopt a source that was closed during
evaluation and subsequently opened only when the new editor document is clean
and byte-for-byte equal to that retained text. This exception prevents an
ordinary definition, diagnostic, call, or generated-to-source navigation from
invalidating itself merely by opening its destination. It does not create a
source version or writable authority: completion, rename, and every automatic
workspace edit continue to require the strict captured open-document state.

Configuration-path confinement is not yet a complete TypeScript filesystem
sandbox. In a trusted workspace, native configuration processing, project
references, standard module resolution, and declaration lookup still delegate
to TypeScript's filesystem host and may read dependencies outside the Ravel
project root. Target-result navigation remains root-confined, but an explicit
file-access-root policy is required before the M7 security gate can close.

## 18. Observability

Projection and routing SHOULD emit optional structured trace events through the
existing proposed `TraceSink` boundary:

- snapshot created and pieces invalidated;
- projection started, reused, completed, cancelled, or failed;
- bridge opened, changed, restarted, or closed a document;
- request routed with source, target, stage, and occurrence IDs;
- response mapped with exact, anchored, opaque, and synthetic result counts;
- stale response discarded; and
- edit classified, previewed, applied, or rejected.

Normal operation MUST NOT log source text or write to `console` from core
packages.

## 19. Failure and degradation behavior

| Failure | Required behavior |
| --- | --- |
| Pieceful parse or graph error | Return Pieceful diagnostics; project unaffected pieces when safe. A last-good affected projection may be displayed as stale but MUST NOT be presented as current or used for writable operations. |
| No artifact contains the piece | Offer configured harness or explain that only syntax features are available. |
| Several incompatible targets contain the piece | Request/offer target selection and show target-qualified results. |
| Language bridge unavailable | Preserve Pieceful features and report target-language features as unavailable. |
| Language service crashes | Restart with backoff, reopen current projections, and avoid losing source edits. |
| Projection result becomes stale | Discard it and schedule/request the current version. |
| Mapping is opaque | Anchor diagnostics to provenance; disable precise edit operations. |
| Result points to synthetic text | Open generated context and the narrowest responsible source anchor. |
| Shadow write fails | Fall back only to a supported mode; otherwise explain the adapter limitation. |
| Transform fails | Emit a source-linked transform diagnostic and do not send partial invalid text as current. |

## 20. Public projection API sketch

```ts
interface ProjectionService {
  update(snapshot: PieceGraphSnapshot, signal: AbortSignal): Promise<ProjectionDelta>;

  getProjection(id: ProjectionId): VirtualDocument | undefined;
  listProjectionsForSource(range: SourceRange): readonly ProjectionMatch[];
  listOccurrences(pieceId: PieceId, targetId?: TargetId): readonly ExpansionOccurrence[];

  toVirtual(
    source: SourcePosition,
    selection: ProjectionSelection,
  ): readonly VirtualPositionMatch[];

  toSource(
    projectionId: ProjectionId,
    virtual: OffsetRange,
  ): readonly SourceRangeMatch[];

  generatedContext(
    occurrenceId: OccurrenceId,
    options?: GeneratedContextOptions,
  ): GeneratedContext;
}
```

Mapping methods return arrays because one source location can have many
occurrences and a transformed generated range can have multiple related
origins. Callers MUST handle zero, one, or many matches explicitly.

## 21. Testing strategy

### 21.1 Mapping conformance

Table-driven and property-based tests MUST cover:

- exact round trips for literals;
- nested substitutions and repeated pieces;
- empty pieces and zero-width insertions;
- indentation, dedentation, and EOL normalization;
- mixed newline styles and Unicode position encoding;
- adjacent segment coalescing;
- transform-map composition;
- opaque and synthetic fallback behavior; and
- stale versions and cancelled computations.

For every exact segment and valid offset `p`:

```text
toSource(toVirtual(p, occurrence)) = p
```

The inverse is occurrence-qualified; an unqualified source position can map to
several virtual positions.

### 21.2 Language feature integration

The TypeScript fixture suite MUST demonstrate:

- member completion using a type defined in another piece;
- signature help across nested substitutions;
- go-to-definition from one piece into another;
- find-references deduplicated across repeated expansion;
- source-mapped type and syntax diagnostics;
- incoming and outgoing calls mapped to source pieces;
- local rename across pieces;
- an import edit routed to a declared imports piece;
- rejection of an edit to synthetic wrapper text;
- two targets producing different hover or completion results; and
- correct operation with unsaved source changes.

### 21.3 Editor acceptance

Automated editor tests SHOULD verify commands, target selection, read-only
generated views, highlighting, breadcrumbs, next/previous occurrence, stale
view refresh, source navigation, cancellation, and graceful bridge failure.

### 21.4 Performance and soak tests

Fixtures SHOULD include a deep expansion chain, a wide dependency graph, a
piece repeated hundreds of times, a large unrelated edit, and rapid edits while
completion requests are in flight. Tests record Pieceful overhead separately
from target-language service time.

## 22. Compatibility and rollout

The projection system consumes the public Piece Document and does not depend on
Markdown syntax. Legacy v1 documents can receive editor support after
`compat-v1` translates them into the same source-mapped model. Compatibility
translation MUST preserve original ranges and mark approximations.

Rollout order:

1. headless projection and mapping library;
2. TypeScript/JavaScript bridge test harness;
3. Pieceful LSP completion, hover, definitions, and diagnostics;
4. VS Code generated view and target selector;
5. safe completion edits and rename;
6. references, call hierarchy, and multi-target UX;
7. Rix integration; and
8. second language adapter to validate generality.

## 23. Decisions to record as ADRs

The implementation must resolve these decisions with short spikes and ADRs:

1. TypeScript bridge mechanism: language-service API, `tsserver`, or LSP
   wrapper.
2. Logical URI encoding and stable projection identity.
3. Internal position encoding and line-index representation.
4. Mapping interval/index data structure.
5. Active-target persistence and configuration syntax.
6. Shadow workspace location, lifecycle, and watcher exclusion.
7. Import/preamble piece declaration syntax.
8. Standard transform-map interface and source-map composition library.
9. Cross-editor boundary between Pieceful LSP and editor-specific target
   language forwarding.
10. The second language adapter used as the portability test.

As of 2026-07-31, decision 1 is accepted in
[`documentation/adr/typescript-language-service-api.md`](documentation/adr/typescript-language-service-api.md).
The code has provisional, tested choices for URI encoding, UTF-16 bridge
offsets plus portable line indexes, transform-map normalization, and active
target serialization. Those choices still require their own stability and
configuration ADRs before the corresponding M0 boxes are checked. Import-piece
syntax, cross-editor/LSP transport, and the M8 second language remain open.

## 24. Definition of done for the vertical slice

The first TypeScript/JavaScript vertical slice is complete only when:

- an unsaved edit in an LP fence updates a stable virtual document;
- native member completion understands types assembled from another piece;
- go-to-definition crosses a piece boundary and lands in the Markdown source;
- target-language diagnostics point to the exact author range and display the
  expansion breadcrumb;
- a generated view highlights the selected piece occurrence and navigates among
  repeats;
- a local symbol rename is safely reverse-mapped and deduplicated;
- ambiguous target contexts are exposed rather than silently selected;
- synthetic and opaque edits are rejected with actionable alternatives;
- cancellation and stale-response tests pass;
- no document effect executes during analysis; and
- measured Pieceful overhead meets the agreed interactive budgets or an ADR
  documents revised evidence-based budgets.

**Current status:** this definition of done is not yet met. The repository has
headless projection, native TypeScript, routing, a VS Code provider route,
generated documents, persisted document and piece-scoped target context,
exact-safe completion/rename behavior, and call hierarchy. It still lacks a
portable LSP transport, preview/import/piece-ID edit workflows, full Extension
Host acceptance, and the performance, resilience, security, and accessibility
gate evidence.

The implemented generated-view route now preserves the originating source
selection, so an exact fragment receives a distinct `selected-fragment`
overlay while piece, descendant, transform, and synthetic categories remain
visible. Call hierarchy separately reverse-maps `selectionRange` and uses it
for follow-up requests. Generated presentation requires exact registry/editor
text equality, and read-only navigation can adopt only a clean, byte-identical
evaluated destination. These close concrete integration races; they do not
substitute for the remaining G5/G7 end-to-end and accessibility evidence.

The first repeatable 100,000-line harness run on Node 26.5.0 (darwin/arm64)
measured 137 ms cold projection, 121 ms warm incremental projection, 47 ms for
10,000 virtual-to-source lookups, and 42 ms for 10,000 source-to-virtual
lookups. These are development observations, not release thresholds; use
`npm run benchmark:virtual-documents -- --json` to reproduce them.
