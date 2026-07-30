# Ravel Explorer design

## Status

This document specifies Workstream E of the
[Ravel 0.2 implementation plan](../TODO-0.2.md). Milestones 0 through 6 in the
[`Explorer backlog`](../EXPLORER-TODO.md) are release-binding for 0.2; the
experimental Composer milestone is deferred beyond 0.2.

## Product statement

Ravel Explorer makes a Ravel program navigable as a relationship between source,
graph structure, transformations, and generated artifacts.

The primary workflow is:

1. Select a chunk, reference, transform, or generated range.
2. See the smallest useful graph that explains it.
3. Reveal the corresponding range in the normal source editor.
4. Make a small source or transform edit in a temporary overlay.
5. Re-evaluate without writing artifacts.
6. Inspect the graph, diagnostic, provenance, and generated-output differences.
7. Apply the source edit through the host editor, or discard it.

The Explorer is not a second source of truth. Markdown, Ravel Maps, and project
configuration remain canonical. A visual operation is editable only when it has
an unambiguous source representation.

## Goals

- Navigate projects too large to understand as one flat node-link diagram.
- Answer "where did this come from?" and "what will this affect?" from either
  source or generated output.
- Preserve document, chunk, transform, provenance, and deliverable distinctions
  instead of reducing everything to an untyped dependency edge.
- Link graph selection bidirectionally with an ordinary VS Code Markdown editor.
- Preview small source and transform edits without writing build artifacts.
- Show graph, diagnostic, provenance, trace, and output changes before applying
  an edit.
- Keep the Explorer UI portable enough to run in a VS Code webview or a local
  browser host.
- Remain useful with tens of thousands of underlying graph entities by querying,
  aggregating, and focusing rather than rendering all entities at once.
- Make exact versus coarse provenance visible and use it as an editing-safety
  boundary.

## Non-goals for the first implementation

- Replacing the Markdown editor with a custom visual editor.
- Treating node positions as program semantics.
- Editing generated artifacts as if every generated character had one writable
  source location.
- Arbitrary edge creation or deletion without a defined Ravel source spelling.
- Notebook execution, kernels, or capability-gated shell and network effects.
- Collaborative editing or a remote graph service.
- A general-purpose graph visualization package independent of Ravel concepts.

## Packages

### `@pieceful/ravel-explorer`

Proposed directory: `packages/explorer/`

This is a portable ESM package. It owns:

- versioned Explorer snapshot and host-message types;
- graph projection and focused-subgraph queries over public Ravel data;
- Explorer selection, lens, filter, expansion, and perspective state;
- Cytoscape.js rendering and styles;
- ELK layout adaptation;
- aggregated boundary-edge calculation for collapsed groups;
- source, output, provenance, trace, diagnostics, and change panels;
- a browser-host interface with no direct filesystem or VS Code dependency.

The initial package may contain both projection logic and the web UI. Split
`explorer-model` and `explorer-ui` only if another consumer demonstrates that
the separation is useful.

Expected dependencies:

- `@pieceful/ravel-core` for public program and provenance contracts;
- Cytoscape.js for graph interaction;
- the Cytoscape ELK adapter and its `elkjs` dependency for hierarchical layout.

Folding and aggregate boundary edges remain projection operations. The
prototype deliberately does not depend on the unmaintained Cytoscape
expand/collapse extension.

It must not import `vscode`, `node:*`, access the filesystem, execute transforms
on its own, or write source files.

### `@pieceful/ravel-vscode`

Proposed directory: `packages/vscode/`

This is the VS Code extension and host adapter. It owns:

- `Ravel: Open Explorer` and related commands;
- project discovery and selection;
- a webview panel opened beside a normal text editor;
- loading and evaluating the authoritative project through the Node host;
- synchronization with open, dirty, and changed text documents;
- reveal, selection, decoration, and editor-focus behavior;
- preview-overlay evaluation;
- applying accepted edits with `WorkspaceEdit`;
- VS Code diagnostics, progress, cancellation, persistence, and extension
  packaging;
- a restrictive webview content-security policy and message validation.

It depends on `@pieceful/ravel-explorer`, `@pieceful/ravel-host-node`, and the
normal VS Code extension API. The extension host is authoritative for workspace
contents and build capabilities. The webview never receives unrestricted file
access.

The package should be private while the extension is experimental. Publishing
to the VS Code Marketplace and npm package publication are separate decisions.

### Existing-package changes

The first read-only slice can consume the current public `RavelProgram`,
provenance, and trace contracts. Later slices require small additions:

- `core`: public, stable introspection for parsed reference and pipeline steps;
- `markdown`: exact ranges for every definition-pipeline transform, plus
  optional editorial outline metadata;
- `host-node`: evaluate a project from a set of in-memory document overlays;
- `map`: only additive, namespaced navigation metadata unless an actual semantic
  requirement appears.

Explorer-specific rendering structures do not belong in `core`.

## Architecture

```text
normal VS Code text editor                    Ravel Explorer webview
┌──────────────────────────┐                ┌────────────────────────────┐
│ Markdown / Ravel Map     │  reveal/select │ toolbar, search, lenses    │
│                          │◀───────────────▶│ graph canvas               │
│ canonical source buffer  │                │ output/provenance/details  │
└────────────┬─────────────┘                └──────────────┬─────────────┘
             │ VS Code document APIs                       │ typed messages
             └────────────────┬────────────────────────────┘
                              ▼
                 `@pieceful/ravel-vscode`
                 - project and overlay host
                 - WorkspaceEdit and diagnostics
                              │
             load/evaluate   │   Explorer snapshots and diffs
                              ▼
        host-node → adapters → Ravel Map → core → Ravel Program
```

The extension host sends a bounded Explorer projection rather than the complete
program object. The webview requests more context when the user expands a group
or changes focus. This keeps transport and rendering proportional to the
question being asked.

## Explorer data contract

The contract is versioned independently from Ravel Map and provenance maps.
Version 1 should be JSON-serializable and use UTF-16, half-open source ranges,
matching the existing editor and provenance contracts.

```ts
interface ExplorerSnapshot {
  version: 1;
  project: { id: string; label: string };
  revision: string;
  lens: ExplorerLens;
  focus: string[];
  truncated: boolean;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  groups: ExplorerGroup[];
  diagnostics: ExplorerDiagnosticSummary;
}

type ExplorerLens =
  | "overview"
  | "dependencies"
  | "derivation"
  | "provenance"
  | "trace"
  | "changes";

interface ExplorerNode {
  id: string;
  kind:
    | "document"
    | "outline"
    | "chunk"
    | "transform"
    | "compose-step"
    | "emit"
    | "directive"
    | "deliverable"
    | "source-fragment"
    | "generated-fragment"
    | "diagnostic";
  label: string;
  parent?: string;
  source?: SourceLocation;
  language?: string;
  tags?: string[];
  state?: ("generated" | "live" | "succeeded" | "failed" | "changed" | "stale" | "warning" | "error")[];
  counts?: { children?: number; incoming?: number; outgoing?: number };
}

interface ExplorerEdge {
  id: string;
  kind:
    | "contains"
    | "references"
    | "consumes"
    | "transforms"
    | "declares"
    | "composes"
    | "aliases"
    | "imports"
    | "emits"
    | "produces"
    | "corresponds-to";
  source: string;
  target: string;
  authoredAt?: SourceLocation;
  count?: number;
  members?: string[];
}

interface ExplorerGroup {
  id: string;
  kind: "document" | "outline" | "identity" | "language" | "tag" | "deliverable";
  label: string;
  parent?: string;
  nodeIds: string[];
  collapsed: boolean;
}

interface ExplorerDiagnosticSummary {
  errors: number;
  warnings: number;
  information: number;
}
```

`members` is optional and should be omitted for very large aggregates. A host
query can return the members on demand.

Node and edge IDs must be deterministic across unchanged evaluations so the UI
can preserve selection, expansion, and manually adjusted layout. A revision
identifies the exact evaluated source overlay. Every response that depends on
source contents includes that revision.

## Lenses and grouping

One program has several useful structures. They should not be forced into one
generic `parent` relation.

### Overview

Shows documents, configured outputs, and high-level dependency aggregates. It
answers which documents contribute to which deliverables.

### Dependencies

Shows a focused chunk neighborhood:

- direct dependencies and dependents;
- all nodes on a path between two selected nodes;
- deliverable dependency closures;
- ancestor or descendant depth chosen by the user.

### Derivation

Expands an individual chunk or generated range into authored references,
definition transforms, use-site transforms, compose steps, aliases, and emits.
Transform order is visually explicit.

### Provenance

Coordinates generated and source ranges. Exact mappings expose corresponding
offsets. Coarse mappings expose attributed regions and retained origins without
claiming character identity.

### Trace

Shows phase values and transformations for one chunk. Large values are
summarized and loaded on demand.

### Changes

Compares two Explorer revisions. It marks:

- added and removed nodes or edges;
- chunks whose completed values changed;
- changed diagnostics;
- changed provenance precision or origins;
- changed generated ranges and deliverables.

### Grouping lenses

Initial grouping options are document, chunk identity, type/language, tag, and
deliverable closure. Markdown outline grouping is navigational metadata:
headings do not alter Ravel chunk identity or dependency semantics.

The Markdown adapter may add a namespaced value such as:

```json
{
  "metadata": {
    "data": {
      "ravel": {
        "outlinePath": [
          { "text": "Compiler", "level": 2, "source": {} },
          { "text": "Parsing", "level": 3, "source": {} }
        ]
      }
    }
  }
}
```

An Explorer can also derive this metadata transiently from an open Markdown
document. Persist it in a Ravel Map only when an adapter consumer benefits from
the same outline.

## Interaction design

### Webview layout

```text
┌──────────────────────────────────────────────────────────────────┐
│ Search…   Lens: Dependencies   Group: Document   Up 2 / Down 2  │
├───────────────────────────────────────┬──────────────────────────┤
│                                       │ Selection                │
│ Graph canvas                          │ definition and metadata  │
│ - pan and zoom                        │ dependency/derivation    │
│ - compound folding                    │ diagnostics              │
│ - minimap                             ├──────────────────────────┤
│ - keyboard selection                  │ Generated output         │
│                                       │ provenance-highlighted   │
├───────────────────────────────────────┴──────────────────────────┤
│ Changes: source | output | graph | diagnostics    Apply/Discard │
└──────────────────────────────────────────────────────────────────┘
```

The source itself remains in the adjacent normal VS Code editor. The webview
may show a small read-only source excerpt for context, but must not grow a
second general text editor.

### Selection

- Selecting a graph entity reveals its exact source range when one exists.
- Moving the text-editor selection asks the Explorer for intersecting chunks,
  references, transforms, generated ranges, and diagnostics.
- Selecting generated text focuses the best provenance segment and its
  dependency path.
- Hover is preview-only; selection changes focus and is keyboard reachable.
- Multi-selection enables "path between", comparison, and pinning.

Selection synchronization carries an origin token so editor and webview events
do not echo indefinitely.

### Search and focus

Search covers canonical ID, display name, document, language, tag, deliverable,
transform name, and diagnostic code. Results are useful even when their nodes
are not currently rendered. Choosing a result requests a new focused snapshot.

Focus commands:

- Show direct context.
- Show ancestors.
- Show descendants.
- Show impact on deliverables.
- Show all paths between two pinned nodes.
- Explain generated selection.
- Fit selection.
- Return to prior perspective.

### Semantic zoom

- Far: documents, deliverables, counts, and status.
- Medium: chunk names, languages, and aggregated dependencies.
- Near: references, transforms, ports, and concise value summaries.
- Detail panel: exact source and generated ranges, phase values, and provenance.

Zooming may reveal detail already present in the snapshot. It must not silently
change semantic focus or request an unbounded graph.

### Folding

Collapsing a compound group replaces crossing edges with deterministic
aggregated boundary edges. Aggregates display edge kind and count. Expanding a
group restores its members without losing pinned nodes or selection.

### Perspectives

A perspective contains focus nodes, lens, filters, group lens, expanded groups,
pinned nodes, and optional layout adjustments. The VS Code extension initially
stores perspectives in workspace state. A later explicit export format may live
under `.ravel/views/`; no source-controlled format is required for the first
slice.

## Editing and preview

### Source is authoritative

The webview proposes source edits; the host validates them against the current
document version. Accepted edits are applied with VS Code `WorkspaceEdit`, so
normal dirty-state, save, undo, and redo behavior remains intact.

An edit request contains:

```ts
interface ExplorerEditProposal {
  id: string;
  baseRevision: string;
  documents: Array<{
    uri: string;
    version: number;
    edits: Array<{ range: SourceRange; text: string }>;
  }>;
  intent:
    | "edit-source"
    | "change-reference"
    | "change-transform"
    | "reorder-pipeline";
}
```

The host rejects overlapping edits, stale document versions, edits outside the
workspace or declared project, and edits that no longer match the selected
semantic item.

### Preview evaluation

1. The user edits normally in VS Code or changes a structured control.
2. The extension gathers current dirty buffers as an overlay.
3. `host-node` loads configured files from the overlay first and disk second.
4. Adapters and core produce an immutable candidate program.
5. The Explorer compares the candidate revision with the last accepted
   revision.
6. The webview shows graph, output, provenance, and diagnostic changes.

Preview evaluation never writes deliverables or manifests. It uses the same
configured pure transform capabilities as the authoritative build. Unsupported
or effectful capabilities produce a visible "preview unavailable" state rather
than silently using different semantics.

The first implementation may reevaluate the whole project after a short
debounce. Incremental graph updates are an optimization after behavior and
contracts are stable.

### Structured edits

The first structured controls should be narrow and source-shaped:

- change a literal transform argument;
- insert, remove, or reorder a transform in an existing pipeline;
- change an authored reference target;
- switch between `pipe` and `pass` when the adapter exposes the exact token
  range.

Each control displays the source rewrite before previewing it. Freeform graph
rewiring waits until each operation has a specified Markdown/Ravel Map spelling,
formatting behavior, validation rule, and undo story.

### Generated-output editing

- Exact provenance may offer a mapped source edit when one source location is
  unambiguous.
- Reused source with several generated matches requires the user to choose the
  intended source occurrence or edit the canonical source directly.
- Coarse provenance supports navigation and input/transform editing only.
- A selection crossing provenance segments is split or declined; the Explorer
  never guesses a multi-source rewrite.

## Host message protocol

Messages use a discriminated `type`, a protocol `version`, and a unique
`requestId`. Responses include the evaluated `revision`.

Webview-to-host requests:

- `project/open`
- `view/request`
- `entity/select`
- `source/reveal`
- `output/request`
- `edit/preview`
- `edit/apply`
- `edit/discard`
- `perspective/save`
- `perspective/restore`
- `request/cancel`

Host-to-webview events:

- `project/opened`
- `view/result`
- `selection/changed`
- `output/result`
- `edit/preview-result`
- `edit/applied`
- `diagnostics/changed`
- `document/changed`
- `request/progress`
- `request/error`

Unknown message types and incompatible versions are rejected. Errors are
portable data with a user-facing message; unexpected extension failures may
also be written to a Ravel output channel.

## Scale and performance

- Never make a complete-project snapshot the only API.
- Default to at most 500 rendered nodes and report truncation explicitly.
- Search an index of the complete program without rendering all matches.
- Layout in a worker where practical and make layout requests cancellable.
- Cache projections by program revision, lens, focus, depth, grouping, and
  filters.
- Preserve stable positions for unchanged visible nodes when a focused snapshot
  grows.
- Do not rerun global layout for hover or ordinary selection.
- Load full chunk values, trace values, source excerpts, and provenance segment
  lists on demand.
- Offer a table/list representation of the focused graph for accessibility and
  for cases where a diagram is not the clearest view.
- Add synthetic 1k, 10k, and 50k entity fixtures before claiming large-project
  support.

## Security and trust

- The webview uses a nonce-based content-security policy and local bundled
  assets.
- Source labels, Markdown, generated output, and diagnostics are rendered as
  text unless passed through an explicit sanitizer.
- Webview messages are schema-validated by the extension host.
- The webview has no arbitrary filesystem, shell, network, or extension-command
  bridge.
- Preview uses only host-configured Ravel capabilities and never enables a
  transform merely because the UI requested it.
- Applying edits requires a current workspace document version and uses the
  normal VS Code edit API.
- Workspace Trust gates project loading or transforms if those capabilities
  eventually require trust.

## Accessibility

- Every graph command is available through the command palette or toolbar.
- Nodes and edges have keyboard traversal and visible focus.
- A synchronized list/table view exposes the current projection without spatial
  navigation.
- Color is never the only indicator for edge kind, provenance precision,
  diagnostics, or change state.
- Layout and zoom respect reduced-motion settings.
- Source reveal and diagnostic messages use VS Code-native accessible surfaces
  where possible.

## Testing strategy

### Portable Explorer tests

- snapshot and edge IDs are deterministic;
- grouping and aggregation preserve boundary-edge counts;
- focus, path, ancestor, and descendant queries return stable bounded results;
- projection handles cycles and diagnostics without throwing;
- exact and coarse provenance render distinct edit capabilities;
- snapshot diff classifies node, edge, output, provenance, and diagnostic
  changes;
- protocol messages validate and reject incompatible versions.

### VS Code integration tests

- command opens one Explorer panel beside the active Markdown editor;
- graph selection reveals the correct source range;
- editor selection focuses the corresponding graph entity without an event
  loop;
- dirty buffers participate in preview without being saved;
- stale edits are rejected;
- accepted edits use one undoable `WorkspaceEdit`;
- preview never writes build artifacts;
- closing or reloading the webview restores the last perspective;
- untrusted or malformed webview messages cannot access arbitrary files or
  commands.

### Representative fixtures

- greeting: smallest smoke test;
- proof-of-concept project: multiple documents and deliverables;
- FizzBuzz migration: imports, greedy fragments, transforms, composition,
  aliases, exact and coarse provenance;
- benchmark: focused navigation over 50 chunks;
- generated scale fixtures: 1k, 10k, and 50k entities with nested groups and
  crossing edges.

## Decisions

1. Canonical source remains in the ordinary editor.
2. `@pieceful/ravel-explorer` is portable; VS Code integration is a separate
   host package.
3. Cytoscape.js is the initial Explorer renderer and ELK is the initial layout
   engine.
4. React Flow or another direct-manipulation canvas is reconsidered for a later
   Composer, not required by the Explorer.
5. Explorer snapshots are bounded, versioned projections rather than serialized
   internal program objects.
6. Outline containment is navigational metadata, not dependency semantics.
7. Exact/coarse provenance controls editing capabilities.
8. Preview evaluates in-memory overlays and performs no artifact writes.
9. Visual operations are enabled only when they map to an explicit source edit.
10. Folding is computed by the Explorer projection so hidden boundary edges
    retain Ravel kinds, counts, and stable identities.

## Open questions to resolve through prototypes

- Whether relayout after projection-owned folding remains responsive at the
  target visible-node limit.
- Whether ELK layout should run in the webview worker or extension host.
- Whether the initial UI should use a small framework or DOM modules around
  Cytoscape.
- How much parsed pipeline IR must become a stable public core contract.
- Whether definition-pipeline attribute edits can preserve the user's exact
  quoting and spacing or should use a documented formatter.
- Whether dirty buffers in imported files require a project-wide overlay cache
  or can be supplied per preview request.
- Which perspective fields are useful enough to justify a portable exported
  format.
