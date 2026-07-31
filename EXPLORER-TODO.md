# Ravel Explorer implementation plan

This is the detailed working backlog for Workstream E of the
[Ravel 0.2 implementation plan](TODO-0.2.md) and the design in
[`documentation/explorer-design.md`](documentation/explorer-design.md).
Milestones 0 through 6 are release-binding for 0.2. Milestone 7 is exploratory
work beyond 0.2.

## Outcome

A user can open a Ravel project in VS Code, keep its Markdown source in the
normal editor, explore a bounded source-linked graph beside it, select generated
text to understand its derivation, preview a small source or transform edit, and
apply that edit through normal VS Code undo/redo.

## Existing foundations

- [x] Chunks, references, diagnostics, and deliverables have source ranges.
- [x] Completed chunks expose dependencies and authored references.
- [x] Generated artifacts expose exact/coarse provenance segments.
- [x] Core provides forward, reverse, and dependency-path provenance queries.
- [x] Trace snapshots retain transform phase values.
- [x] Core and the Markdown adapter have a browser-bundle harness.
- [x] The Node host separates evaluation from authorized artifact writes.

## Milestone 0: contracts and proof fixture

Goal: freeze the smallest portable contract before selecting UI details.

- [x] Add `packages/explorer/package.json` for
      `@pieceful/ravel-explorer`, initially private.
- [x] Add `packages/explorer/src/index.js` and `index.d.ts` with no renderer
      dependency in the entry-point smoke test.
- [x] Define version-1 `ExplorerSnapshot`, node, edge, group, lens, source-range,
      query, and diff types.
- [x] Define version-1 host/webview request and event types.
- [ ] Add runtime validation for all messages crossing the webview boundary.
- [x] Define deterministic node and edge ID rules in package documentation.
- [x] Implement a dependency projection from the current public
      `RavelProgram`.
- [x] Implement bounded ancestor, descendant, dependency-closure, and
      path-between queries.
- [ ] Implement document, chunk identity, language/type, tag, and deliverable
      grouping.
- [x] Implement collapsed boundary-edge aggregation by edge kind.
- [x] Mark a projection `truncated` when it reaches the configured visible-node
      limit.
- [ ] Add deterministic JSON golden fixtures for greeting, proof of concept,
      and FizzBuzz.
- [ ] Add unit tests for cycles, missing nodes, duplicate paths, stable ordering,
      aggregation counts, and truncation.
- [ ] Document which desired derivation entities cannot yet be recovered through
      the public core API.

Exit criteria:

- The Explorer package can turn the FizzBuzz `RavelProgram` into a deterministic
  bounded JSON snapshot without importing a browser or VS Code API.
- Focus and path queries are tested independently of rendering.

## Milestone 1: read-only browser Explorer

Goal: validate navigation, folding, and layout against real Ravel graphs.

- [x] Add Cytoscape.js and ELK, retaining folding and boundary-edge aggregation
      in the portable projection rather than an unmaintained renderer extension.
- [x] Build a minimal browser entry point that accepts an `ExplorerSnapshot`.
- [x] Render typed node and edge styles with text labels and non-color
      distinctions.
- [x] Add pan, zoom, fit, and reset-layout controls.
- [ ] Add a minimap for larger visible projections.
- [x] Add document compound nodes and aggregated edges on collapse.
- [ ] Add search over canonical ID, label, document, language/type, tags,
      transform name, deliverable, and diagnostic code.
- [x] Add overview, dependency, and derivation lenses.
- [x] Add all-depth upstream and downstream focus from the current selection.
- [ ] Add ancestor/descendant depth controls, path-between, and impact-on-output.
- [x] Add a selection details panel with source, metadata, and typed
      relationships.
- [ ] Add diagnostic details to selection once diagnostic nodes are projected.
- [ ] Add a synchronized list/table representation of the visible graph.
- [ ] Preserve selection and expanded groups when a focused snapshot grows.
- [ ] Move layout off the main UI path and support cancellation.
- [x] Add a developer harness whose build derives a FizzBuzz snapshot before
      the browser starts, without giving the browser filesystem access.
- [ ] Measure layout, search, expansion, and interaction time for 1k and 10k
      synthetic entities.
- [x] Record the Cytoscape/ELK prototype decisions and revise the visible-node
      default if measurements require it.

Exit criteria:

- A browser harness can navigate the FizzBuzz graph without rendering the
  complete program by default.
- Collapse/expand preserves the meaning and count of crossing edges.
- Every focused graph operation is usable through keyboard-accessible controls.

## Milestone 2: VS Code read-only integration

Goal: link graph navigation with the ordinary Markdown editor.

- [x] Add an initially private `packages/vscode/` extension package.
- [x] Add extension build, project-discovery tests, and an Extension Development
      Host launch configuration.
- [ ] Add extension packaging and VS Code-hosted integration tests.
- [x] Register `Ravel: Open Explorer`.
- [x] Discover a direct source or nearest `ravel.toml` from the active editor.
- [ ] Allow explicit project selection when discovery is ambiguous.
- [x] Open the webview in an editor column beside the active source editor.
- [x] Bundle Explorer assets locally and enforce a nonce-based content-security
      policy.
- [x] Validate every implemented webview request, reject unknown directions and
      versions, and reject stale selection revisions.
- [x] Load and evaluate the selected project through `host-node`.
- [x] Send only bounded Explorer snapshots to the webview.
- [x] Reveal and select exact source ranges from graph selection.
- [x] Request bounded authored and evaluated chunk text only after selection.
- [x] Provide Command-click/F12 definition navigation from exact authored
      references to their defining chunks.
- [x] Observe VS Code selections and focus the narrowest corresponding graph
      entity.
- [x] Add graph/editor origin handling that suppresses the exact programmatic
      source selection.
- [ ] Add VS Code-hosted regression tests for editor/webview selection loops.
- [ ] Publish Ravel diagnostics through a VS Code diagnostic collection.
- [x] Add project-load progress.
- [ ] Add cancellation and a Ravel output channel.
- [ ] Persist the current lens, focus, grouping, filters, expanded groups, and
      pinned nodes in workspace state.
- [ ] Restore the perspective after webview reload.
- [ ] Add VS Code integration tests for commands, selection, reveal, reload,
      malformed messages, and project changes.

Exit criteria:

- Selecting a FizzBuzz graph node reveals the exact Markdown range.
- Moving the cursor into a chunk or reference focuses the corresponding graph
  context.
- The Markdown editor remains the canonical editable surface.

## Milestone 3: provenance, generated output, and trace

Goal: make "where did this generated text come from?" a direct visual workflow.

- [ ] Add a read-only generated-output panel with language-aware plain-text
      rendering.
- [ ] Map a generated selection through `explainGeneratedOffset`.
- [ ] Add provenance highlighting for exact and coarse segments.
- [ ] Show the contributing definition, references, dependency path, transforms,
      compose steps, and retained coarse origins.
- [ ] Add reverse lookup from the active source selection to all generated
      matches.
- [ ] Add deliverable switching and "show impact on outputs".
- [ ] Add a derivation lens with typed reference, transform, compose, alias,
      emit, and produces edges.
- [ ] Add a trace lens for one selected chunk, with phase values loaded on
      demand.
- [ ] Ensure large output and trace values are summarized and paged rather than
      embedded in every snapshot.
- [ ] Add exact/coarse explanations that are understandable without reading the
      raw provenance JSON.
- [ ] Add tests for nested references, greedy fragments, indentation, aliases,
      arbitrary transforms, and reused source ranges.

Core/adapter contract work:

- [ ] Expose stable parsed reference and pipeline-step introspection without
      exposing evaluator internals.
- [ ] Retain precise source ranges for individual Markdown definition-pipeline
      transforms and their arguments.
- [ ] Decide whether compose and directive steps need stable semantic IDs in
      core or can be derived from kind plus source range.

Exit criteria:

- Selecting any meaningful region of the FizzBuzz deliverable reveals the best
  source range and a visible derivation path.
- Coarse transform output is clearly distinguished and never presented as an
  exact character mapping.

## Milestone 4: in-memory source preview and change lens

Goal: show the consequences of normal source edits without writing artifacts.

- [x] Add a Node-host overlay abstraction keyed by normalized source URI and
      document version.
- [x] Make imported project inputs, Ravel Maps, and TOML configuration consult
      overlays before disk.
- [x] Evaluate all dirty project documents as one consistent overlay revision.
- [x] Keep preview evaluation on the non-writing load/transform/projection path.
- [x] Debounce document changes and discard superseded evaluation results.
- [ ] Add active cancellation for an evaluation already in progress.
- [x] Keep the last valid snapshot visible when a candidate has parse or graph
      diagnostics.
- [x] Define and implement deterministic snapshot diffing.
- [x] Compare added/removed/changed nodes and edges, including changed chunk
      and deliverable fingerprints and diagnostic summaries.
- [ ] Compare provenance precision/origins and generated ranges.
- [x] Add a graph Changes lens with selectable added, changed, and removed
      nodes and edges.
- [ ] Add source/output/provenance/diagnostic change filters.
- [ ] Decorate changed source and generated ranges.
- [x] Add saved/candidate text comparisons for changed chunks and deliverables,
      with inline removed/added highlighting.
- [x] Show a visible "preview unavailable" reason when the candidate cannot be
      evaluated or has error diagnostics.
- [ ] Add performance instrumentation for parse, evaluation, projection, diff,
      layout, and transport.
- [x] Test that previewing never creates deliverables, manifests, sidecars,
      backups, or stale-output changes.

Exit criteria:

- Editing a FizzBuzz source chunk in an unsaved VS Code buffer updates the
  affected graph and generated-output diff.
- No preview action writes to the workspace outside VS Code's existing dirty
  document buffer.

## Milestone 5: structured transform and reference edits

Goal: make small graph-adjacent edits while preserving source authority.

- [ ] Define `ExplorerEditProposal` with base revision, document versions,
      source edits, and semantic intent.
- [ ] Validate edit proposals in the extension host.
- [ ] Reject stale, overlapping, out-of-project, or semantically mismatched
      edits.
- [ ] Add a transform inspector with editable literal arguments.
- [ ] Preview insertion, removal, and reordering of transforms in an existing
      pipeline.
- [ ] Add an authored-reference target picker constrained to valid visible or
      searchable chunks.
- [ ] Preview `pipe`/`pass` switching where exact source tokens are available.
- [ ] Show the exact proposed source rewrite alongside structured controls.
- [ ] Apply accepted edits as one VS Code `WorkspaceEdit`.
- [ ] Preserve normal editor formatting where possible; document and test any
      canonical formatting performed by structured edits.
- [ ] Ensure apply participates in VS Code undo/redo as one operation.
- [ ] Keep edits in the normal dirty buffer; do not force save or build.
- [ ] Disable structured editing for coarse or ambiguous source relationships
      with a specific explanation.
- [ ] Add tests for stale edits, undo/redo, transform quoting, reference
      ambiguity, multiple dirty files, and discarded previews.

Exit criteria:

- A user can change a FizzBuzz transform argument from the Explorer, inspect the
  candidate graph and output diff, apply it, and undo it normally in VS Code.
- Every applied visual edit corresponds to a visible source rewrite.

## Milestone 6: outline navigation, scale, and hardening

Goal: make Explorer credible for enormous, meaningfully nested projects.

- [ ] Add transient Markdown outline extraction for navigation.
- [ ] Decide whether to expose outline paths as namespaced adapter metadata.
- [ ] Add outline grouping without altering chunk identity or dependency
      semantics.
- [ ] Add named perspectives and perspective history.
- [ ] Add stable manual layout adjustments within a perspective.
- [ ] Add complete-project search indexes separate from visible graph state.
- [ ] Add paged aggregate-member queries.
- [ ] Add 1k, 10k, and 50k entity fixtures with nested groups and crossing edges.
- [ ] Set and document performance budgets for initial view, focus query,
      search, layout, expansion, and edit preview.
- [ ] Profile memory in the extension host and webview independently.
- [ ] Test cancellation and rapid source edits under load.
- [ ] Add reduced-motion support and audit keyboard and screen-reader behavior.
- [ ] Threat-model webview messages, source/output rendering, workspace trust,
      URI normalization, and transform capability use.
- [ ] Test Windows, macOS, Linux, remote workspaces, and multi-root workspaces.
- [ ] Decide whether exported perspectives need a portable
      `.ravel/views/*.json` format.

Exit criteria:

- A 50k-entity underlying program remains searchable and produces responsive
  bounded focused views without sending or rendering the complete graph.
- Outline folding and semantic graph grouping remain visibly distinct.

## Milestone 7: experimental Composer

Goal: test whether selected explicit Ravel structures benefit from direct visual
authoring.

- [ ] Collect Explorer workflows that repeatedly motivate graph manipulation.
- [ ] Specify canonical source rewrites for each proposed visual gesture.
- [ ] Prototype editing `create(..., compose(...))` sequences and explicit
      pipeline order.
- [ ] Evaluate React Flow or another DOM-rich node editor independently of the
      Explorer renderer.
- [ ] Keep Composer state derived from source and use the same preview/apply
      protocol.
- [ ] Do not add arbitrary dependency wiring unless the language specifies its
      source representation and diagnostics.
- [ ] Decide whether Composer belongs inside `@pieceful/ravel-explorer` or in a
      separate package.

Exit criteria:

- A prototype demonstrates a visual operation that is materially clearer than
  its source-only equivalent and round-trips through canonical source,
  preview, apply, and undo.

## Cross-cutting definition of done

For every milestone:

- [ ] Public or protocol contracts have TypeScript declarations and runtime
      validation where they cross trust boundaries.
- [ ] New behavior has deterministic Node tests and appropriate browser or
      VS Code integration coverage.
- [ ] Source ranges remain zero-based, UTF-16, and half-open.
- [ ] Diagnostics identify source and related ranges.
- [ ] Long-running work accepts cancellation.
- [ ] Portable Explorer code does not import Node or VS Code APIs.
- [ ] Preview paths do not write artifacts.
- [ ] Documentation and representative fixtures are updated.

## Recommended first vertical slice

Implement Milestones 0 through 3 narrowly against the FizzBuzz migration:

1. Generate a bounded dependency snapshot.
2. Render it in Cytoscape with document folding.
3. Host it in a VS Code webview beside the normal Markdown editor.
4. Synchronize graph and source selection.
5. Select a generated range and show its derivation path.

Only after that interaction feels useful should the work proceed to edit
preview and structured source rewrites.
