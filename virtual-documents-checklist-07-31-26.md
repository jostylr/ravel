# Pieceful virtual documents — implementation and checkoff plan

**Status:** Proposed  
**Date:** 2026-07-31  
**Companion specification:** `virtual-documents-design-07-31-26.md`  
**Parent plan:** `plan-07-17-26.md`

## How to use this checklist

This document turns the virtual-document design into independently verifiable
work. Check an item only when its implementation, tests, and required
documentation are all present. Do not check a milestone gate merely because its
happy path works.

Identifiers such as `VD-MAP-04` are stable references for issues, commits,
traces, and test names. Add newly discovered work beneath the relevant section
without renumbering existing items.

For each implementation pull request:

- [ ] Link the checklist IDs it completes.
- [ ] Add or update automated tests before checking an item.
- [ ] State whether public types, mappings, virtual URI behavior, or editor UX
      changed.
- [ ] Record measured latency for changes affecting the interactive path.
- [ ] Confirm analysis did not acquire filesystem, network, process, or execute
      authority unintentionally.
- [ ] Leave boxes unchecked when work is partial and annotate the remaining
      condition immediately below the item.

## Milestone map

| Milestone | Outcome | Depends on | Exit gate |
| --- | --- | --- | --- |
| M0 | Decisions, fixtures, and measurement harness | Pieceful Phase 1 model | G0 |
| M1 | Headless projection and bidirectional mapping | M0 | G1 |
| M2 | Incremental projections and transform maps | M1 | G2 |
| M3 | Native TypeScript/JavaScript bridge | M2 | G3 |
| M4 | LSP read-only language features | M3 | G4 |
| M5 | Generated-code view and occurrence UX | M4 | G5 |
| M6 | Safe completion edits, rename, and imports | M4–M5 | G6 |
| M7 | Multi-target, call hierarchy, and hardening | M6 | G7 |
| M8 | Rix and second-language portability proof | M7 | G8 |

The first shippable vertical slice ends at G6. G7 is the recommended public
preview threshold. G8 validates that the architecture is not accidentally tied
to VS Code or TypeScript.

## 0. Prerequisites and scope

These items may be completed by the broader Pieceful modernization work. They
remain explicit because virtual documents cannot compensate for missing or
unstable source identity.

### Piece Document prerequisites

- [ ] **VD-PRE-01** Define immutable `Position`, `Range`, `Piece`, `Fragment`,
      `PieceDocument`, `Diagnostic`, and graph snapshot types in a browser-safe
      package.
- [ ] **VD-PRE-02** Give every piece declaration, literal fragment,
      substitution, pipeline step, directive, and effect a precise source
      range.
- [ ] **VD-PRE-03** Define stable document and piece identity independent of
      heading text and current line number.
- [ ] **VD-PRE-04** Parse substitutions and transform pipelines into typed AST
      nodes rather than opaque strings.
- [ ] **VD-PRE-05** Resolve piece references into an immutable dependency graph
      with deterministic artifact roots.
- [ ] **VD-PRE-06** Expose invalidated piece and artifact IDs after an
      incremental source change.
- [ ] **VD-PRE-07** Separate pure evaluation from effects so editor projection
      cannot write, fetch, execute, or invoke a shell.
- [ ] **VD-PRE-08** Preserve source line endings and enough source metadata to
      convert offsets and negotiated editor positions correctly.

### Product scope decisions

- [ ] **VD-PRE-09** Confirm TypeScript and JavaScript as the first language
      integration.
- [ ] **VD-PRE-10** Confirm VS Code as the first rich generated-view host while
      keeping headless projection and LSP packages editor-neutral.
- [ ] **VD-PRE-11** Choose one representative TypeScript example with at least
      four pieces, a nested substitution, two source files or artifacts, and a
      real `tsconfig.json`.
- [ ] **VD-PRE-12** Choose one repeated-piece example that expands into two
      semantically different targets.
- [ ] **VD-PRE-13** Decide which portion of legacy v1 syntax, if any, must work
      in the first editor preview.
- [ ] **VD-PRE-14** Confirm that runtime debugger/source-map integration is
      deferred and record the boundary.

## M0. Decisions, fixtures, and measurement harness

### Architecture decision records

- [ ] **VD-ADR-01** Spike TypeScript Language Service API integration with an
      in-memory generated file in a configured project.
- [ ] **VD-ADR-02** Spike `tsserver` protocol integration with an open virtual
      or file-like generated document.
- [ ] **VD-ADR-03** If needed, spike a maintained TypeScript LSP wrapper and
      compare project fidelity, module resolution, diagnostics, cancellation,
      process ownership, and licensing.
- [ ] **VD-ADR-04** Record the selected TypeScript bridge and rejected
      alternatives in an ADR.
- [ ] **VD-ADR-05** Decide the logical virtual URI structure and escaping rules.
- [ ] **VD-ADR-06** Decide how stable `ProjectionId` and `OccurrenceId` values
      are derived without embedding mutable offsets.
- [ ] **VD-ADR-07** Decide the internal position encoding and line-index data
      structure; document conversion at LSP boundaries.
- [ ] **VD-ADR-08** Benchmark candidate interval indexes for virtual-to-source
      and source-to-virtual lookup, then record the choice.
- [ ] **VD-ADR-09** Define active-target configuration and session persistence.
- [ ] **VD-ADR-10** Decide whether the first TypeScript bridge is wholly inside
      the Pieceful LSP process, a managed child process, or editor-mediated.
- [ ] **VD-ADR-11** Define the shadow-workspace fallback root, cleanup policy,
      ignore rules, and watcher exclusions.
- [ ] **VD-ADR-12** Define the transform mapping interface and whether standard
      source maps are stored directly or normalized into Pieceful segments.
- [ ] **VD-ADR-13** Define imports/preamble piece configuration for the first
      language.
- [ ] **VD-ADR-14** Select the second language used at M8 to validate adapter
      portability.

### Conformance fixtures

- [ ] **VD-FIX-01** Add a minimal one-piece, one-artifact fixture.
- [ ] **VD-FIX-02** Add a multi-fragment piece fixture with prose between code
      fences.
- [ ] **VD-FIX-03** Add a nested substitution fixture at least four levels deep.
- [ ] **VD-FIX-04** Add a diamond dependency fixture in which one piece is
      expanded more than once.
- [ ] **VD-FIX-05** Add the same source piece to two artifact targets with
      different type environments.
- [ ] **VD-FIX-06** Add a piece that is not reachable from any artifact.
- [ ] **VD-FIX-07** Add empty pieces, empty fragments, and substitutions at file
      boundaries.
- [ ] **VD-FIX-08** Add LF, CRLF, tabs, non-BMP Unicode, combining characters,
      and a missing final newline.
- [ ] **VD-FIX-09** Add identity, indentation, EOL-normalizing, source-mapped,
      and opaque transform fixtures.
- [ ] **VD-FIX-10** Add synthetic preamble and wrapper text around a mapped
      piece.
- [ ] **VD-FIX-11** Add parse error, unknown reference, cycle, and transform
      failure fixtures with expected partial projections.
- [ ] **VD-FIX-12** Add expected projection text, segment maps, occurrence trees,
      and reverse indexes as reviewable snapshots.

### Test and benchmark harness

- [ ] **VD-HAR-01** Create a headless harness that opens a literate document,
      applies versioned edits, requests projections, and prints normalized
      mappings.
- [ ] **VD-HAR-02** Create a fake deterministic language bridge for routing and
      edit-mapping tests.
- [ ] **VD-HAR-03** Create a TypeScript integration harness that can request
      completion, hover, definition, references, diagnostics, calls, and rename
      without an editor UI.
- [ ] **VD-HAR-04** Add timing instrumentation that separates parsing, graph
      update, projection, Pieceful mapping/routing, and target-language time.
- [ ] **VD-HAR-05** Add a repeatable warm-project benchmark fixture near
      100,000 generated lines.
- [ ] **VD-HAR-06** Add deterministic cancellation and stale-response controls
      to the fake bridge.
- [ ] **VD-HAR-07** Ensure snapshots omit machine-specific absolute paths,
      random IDs, process IDs, and timestamps.
- [ ] **VD-HAR-08** Wire all new packages and fixtures into the clean-checkout
      test command and CI.

### Gate G0 — implementation can begin

- [ ] All Piece Document prerequisites required by the fixtures are complete.
- [ ] The TypeScript bridge ADR is decided from working spikes, not assumption.
- [ ] URI, identity, encoding, mapping-index, and transform-map ADRs are merged.
- [ ] Conformance fixtures have reviewed expected outputs.
- [ ] Headless and performance harnesses run in CI.

## M1. Headless projection and bidirectional mapping

### Package and public types

- [ ] **VD-PRJ-01** Create the browser-safe `projection` package with no Node,
      filesystem, process, editor, or language-server dependency.
- [ ] **VD-PRJ-02** Define `SnapshotId`, `ProjectionId`, `ArtifactId`, `TargetId`,
      `OccurrenceId`, and `ProjectionStage` types.
- [ ] **VD-PRJ-03** Define immutable `VirtualDocument`, `ProjectionSegment`,
      `ExpansionOccurrence`, `ProjectionDelta`, and mapping result types.
- [ ] **VD-PRJ-04** Define mapping quality as exact, anchored, transformed,
      opaque, or synthetic.
- [ ] **VD-PRJ-05** Define half-open `OffsetRange` invariants and zero-width
      anchor rules.
- [ ] **VD-PRJ-06** Make zero, one, and many mapping results explicit in APIs;
      do not return an arbitrary first match.
- [ ] **VD-PRJ-07** Export projection types through intentional package entry
      points and generate API documentation.

### Projection builder

- [ ] **VD-BLD-01** Build an assembled projection from one artifact root with
      deterministic text and ordering.
- [ ] **VD-BLD-02** Record an exact segment for every unchanged literal range.
- [ ] **VD-BLD-03** Record substitution invocation ranges separately from the
      inserted piece body.
- [ ] **VD-BLD-04** Create one occurrence for every expansion, including repeats
      of the same piece.
- [ ] **VD-BLD-05** Build the parent/child occurrence tree and complete expansion
      paths.
- [ ] **VD-BLD-06** Mark separators, wrappers, and other generated scaffolding
      synthetic.
- [ ] **VD-BLD-07** Preserve empty piece occurrences and boundary anchors without
      inventing writable ranges.
- [ ] **VD-BLD-08** Produce a deterministic content hash and monotonically
      versioned stable virtual document identity.
- [ ] **VD-BLD-09** Construct a line index for source and virtual text.
- [ ] **VD-BLD-10** Keep projection diagnostics separate from target-language
      diagnostics while using the shared structured diagnostic model.

### Mapping indexes and operations

- [ ] **VD-MAP-01** Implement virtual offset to all matching projection
      segments.
- [ ] **VD-MAP-02** Implement source URI/offset to all generated occurrences.
- [ ] **VD-MAP-03** Implement exact position translation within a segment.
- [ ] **VD-MAP-04** Implement exact range translation and reject ranges crossing
      incompatible segment boundaries.
- [ ] **VD-MAP-05** Implement anchored fallback with mapping quality and related
      generated range.
- [ ] **VD-MAP-06** Implement generated-to-source navigation for synthetic text
      using the narrowest responsible occurrence or artifact anchor.
- [ ] **VD-MAP-07** Implement source-to-generated lookup qualified by target,
      artifact, stage, and occurrence.
- [ ] **VD-MAP-08** Implement safe adjacent-segment coalescing.
- [ ] **VD-MAP-09** Implement line/column conversion for every supported position
      encoding.
- [ ] **VD-MAP-10** Verify exact round-trip properties with property-based tests.
- [ ] **VD-MAP-11** Verify source-to-virtual mappings intentionally return
      multiple positions for repeated expansion.
- [ ] **VD-MAP-12** Verify mapping APIs never throw on invalid, stale, empty, or
      end-of-document positions; return typed failure results.
- [ ] **VD-MAP-13** Implement and test left/right affinity at literal,
      substitution, separator, fragment, and end-of-document boundaries.

### Generated context model

- [ ] **VD-CTX-01** Implement `generatedContext(occurrenceId)` independent of
      editor UI.
- [ ] **VD-CTX-02** Compute a useful visible range with configurable surrounding
      lines.
- [ ] **VD-CTX-03** Classify highlights for selected fragment, selected piece,
      descendants, surrounding context, transformed text, and synthetic text.
- [ ] **VD-CTX-04** Generate artifact-to-fragment breadcrumbs from the occurrence
      tree.
- [ ] **VD-CTX-05** List sibling occurrences with target, artifact, stage, and
      concise path labels.
- [ ] **VD-CTX-06** Navigate a generated selection to exact source or best
      provenance anchor.

### Gate G1 — deterministic headless projection

- [ ] Every valid conformance fixture produces expected text, mappings, and
      occurrence trees.
- [ ] Exact mapping round-trip properties pass for all tested offsets.
- [ ] Repeated pieces return every occurrence without conflation.
- [ ] Generated context works without Node or editor APIs.
- [ ] No effects execute and no files are written during projection tests.

## M2. Incremental projections and transform maps

### Immutable snapshot updates

- [ ] **VD-INC-01** Accept versioned source changes and create an immutable
      Piece Document/graph snapshot.
- [ ] **VD-INC-02** Preserve stable document, piece, artifact, projection, and
      occurrence identity when semantics are unchanged.
- [ ] **VD-INC-03** Invalidate the changed piece and its transitive dependents.
- [ ] **VD-INC-04** Rebuild only affected artifact projections.
- [ ] **VD-INC-05** Reuse unchanged text slices, line indexes, segment indexes,
      and occurrence subtrees where practical.
- [ ] **VD-INC-06** Produce `ProjectionDelta` with opened, changed, unchanged,
      and closed projections.
- [ ] **VD-INC-07** Produce minimal text changes when cheaper and correct;
      otherwise explicitly send a full replacement.
- [ ] **VD-INC-08** Assign every projection result to its exact source snapshot
      and source document versions.

### Cancellation and scheduling

- [ ] **VD-CAN-01** Accept `AbortSignal` through parse, graph update,
      projection, indexing, and bridge synchronization.
- [ ] **VD-CAN-02** Cancel superseded background projection work.
- [ ] **VD-CAN-03** Allow an explicit interactive request to bypass background
      debounce and request the newest snapshot.
- [ ] **VD-CAN-04** Yield often enough to meet the cancellation responsiveness
      budget on large fixtures.
- [ ] **VD-CAN-05** Retain old snapshots only while outstanding requests need
      them and bound retained memory.
- [ ] **VD-CAN-06** Discard stale asynchronous results without publishing stale
      diagnostics or edits.

### Transform mapping

- [ ] **VD-TRN-01** Define and validate identity transform mappings.
- [ ] **VD-TRN-02** Implement composable offset maps for indentation and
      dedentation.
- [ ] **VD-TRN-03** Implement mapping for LF/CRLF normalization.
- [ ] **VD-TRN-04** Normalize a standard source map into Pieceful transformed
      segments or provide a lossless adapter.
- [ ] **VD-TRN-05** Compose maps across multiple transforms while retaining
      occurrence and expansion paths.
- [ ] **VD-TRN-06** Mark unmapping transforms opaque and retain their narrowest
      provenance anchors.
- [ ] **VD-TRN-07** Start a new projection stage when a transform changes the
      language.
- [ ] **VD-TRN-08** Declare per-stage capabilities: navigation, diagnostics,
      completion, and writable edits.
- [ ] **VD-TRN-09** Reject an analysis transform that requests an effect or
      undeclared authority.

### Performance

- [ ] **VD-PERF-01** Measure full cold projection baseline.
- [ ] **VD-PERF-02** Measure a one-character edit in a leaf piece.
- [ ] **VD-PERF-03** Measure a one-character edit in a highly reused piece.
- [ ] **VD-PERF-04** Measure a large unrelated prose edit.
- [ ] **VD-PERF-05** Measure source-to-virtual and virtual-to-source lookup at
      p50 and p95.
- [ ] **VD-PERF-06** Record allocations and retained memory across 1,000 edits.
- [ ] **VD-PERF-07** Compare results with the initial budgets in the design spec;
      fix regressions or write an evidence-based budget ADR.

### Gate G2 — interactive projection engine

- [ ] Unsaved incremental changes produce correct current projections.
- [ ] Unaffected projections retain identity and avoid rebuilding.
- [ ] Transform mappings compose or degrade explicitly to opaque provenance.
- [ ] Cancellation, stale response, and bounded snapshot tests pass.
- [ ] Pieceful-only interactive budgets pass or revised budgets are documented.

## M3. Native TypeScript/JavaScript bridge

### Generic bridge package

- [ ] **VD-BRG-01** Create `language-bridge` with no editor dependency.
- [ ] **VD-BRG-02** Define open, change, close, request, cancellation, capability,
      and lifecycle interfaces.
- [ ] **VD-BRG-03** Define normalized request/response types or an explicit typed
      passthrough strategy for completion, hover, signature, definitions,
      references, symbols, diagnostics, calls, and rename.
- [ ] **VD-BRG-04** Require adapters to report actual capabilities and supported
      projection stages.
- [ ] **VD-BRG-05** Add the deterministic fake bridge used by unit tests.
- [ ] **VD-BRG-06** Define crash, restart, backoff, and document re-open behavior
      for process-backed adapters.
- [ ] **VD-BRG-07** Ensure bridge errors are structured and never corrupt the
      current source or projection snapshot.

### TypeScript project integration

- [ ] **VD-TS-01** Create `language-typescript` using the mechanism selected by
      `VD-ADR-04`.
- [ ] **VD-TS-02** Open stable virtual documents and send monotonically versioned
      updates.
- [ ] **VD-TS-03** Associate virtual files with the intended `tsconfig.json`.
- [ ] **VD-TS-04** Resolve relative imports as if the logical artifact occupied
      its declared output/project path.
- [ ] **VD-TS-05** Honor `compilerOptions`, path aliases, project references,
      JSX mode, standard libraries, and installed declaration packages used by
      the fixture corpus.
- [ ] **VD-TS-06** Support TypeScript, JavaScript, TSX, and JSX language IDs or
      explicitly scope the preview and diagnose unsupported variants.
- [ ] **VD-TS-07** Keep target project state warm across Pieceful edits.
- [ ] **VD-TS-08** Close projections removed from the current graph.
- [ ] **VD-TS-09** Cancel or ignore superseded language requests.
- [ ] **VD-TS-10** Recover from service failure and reopen current documents
      without user-source loss.

### Native feature verification

- [ ] **VD-TS-11** Member completion uses a type declared in another piece.
- [ ] **VD-TS-12** Signature help works across a nested expansion.
- [ ] **VD-TS-13** Hover reports the configured target's inferred type.
- [ ] **VD-TS-14** Definition and type definition return generated locations.
- [ ] **VD-TS-15** References return all relevant generated locations.
- [ ] **VD-TS-16** Syntactic and semantic diagnostics update after unsaved edits.
- [ ] **VD-TS-17** Document symbols and workspace symbols work in projections.
- [ ] **VD-TS-18** Incoming and outgoing call hierarchy works in projections.
- [ ] **VD-TS-19** Rename returns a complete generated workspace edit.
- [ ] **VD-TS-20** Completion returns additional import edits for the import
      policy fixture.

### Optional shadow workspace fallback

Implement this section only if the selected bridge or real project fixtures
require physical files. If it is not needed, record that finding in the ADR and
mark the section not applicable rather than checked.

- [ ] **VD-SHD-01** Create shadow files only beneath the allowlisted ignored
      directory selected by ADR.
- [ ] **VD-SHD-02** Write a generated/disposable manifest and current projection
      metadata.
- [ ] **VD-SHD-03** Use stable paths and atomic replacement.
- [ ] **VD-SHD-04** Exclude the shadow root from source discovery and Pieceful
      watcher input.
- [ ] **VD-SHD-05** Prevent a write loop between source projection and shadow
      file watchers.
- [ ] **VD-SHD-06** Clean stale shadow files without removing author or declared
      build artifacts.
- [ ] **VD-SHD-07** Verify source control ignore behavior.
- [ ] **VD-SHD-08** Verify failed or denied shadow writes degrade with an
      actionable adapter diagnostic.

### Gate G3 — native service sees an ordinary program

- [ ] The headless TypeScript harness passes completion, hover, signature,
      navigation, diagnostics, symbols, calls, and rename requests.
- [ ] Configured-project imports and module resolution work.
- [ ] Unsaved changes update the same stable virtual document.
- [ ] Process failure/cancellation behavior is deterministic in tests.
- [ ] Pieceful mapping/routing is not yet required for this gate; native
      generated locations are captured as fixtures for M4.

## M4. Pieceful LSP and read-only language features

### Pieceful-native language features

- [ ] **VD-LSP-01** Publish Pieceful parse, reference, cycle, transform, and
      capability diagnostics for literate documents.
- [ ] **VD-LSP-02** Provide Pieceful document symbols for pieces, derived pieces,
      directives, and artifacts.
- [ ] **VD-LSP-03** Go to a piece declaration from a substitution or directive.
- [ ] **VD-LSP-04** Find source-level references to a piece declaration.
- [ ] **VD-LSP-05** Hover a piece reference with identity, language, dependencies,
      dependents, and occurrence summary.
- [ ] **VD-LSP-06** Complete known piece IDs, transforms, and transform arguments
      in Pieceful syntax.
- [ ] **VD-LSP-07** Keep Pieceful-native functionality available when no target
      bridge exists or the workspace is untrusted.

### Target request routing

- [ ] **VD-RTE-01** Capture source and snapshot versions at request start.
- [ ] **VD-RTE-02** Locate the containing LP fragment and source language.
- [ ] **VD-RTE-03** Resolve candidate targets, projections, and occurrences.
- [ ] **VD-RTE-04** Apply the active-target selection policy exactly.
- [ ] **VD-RTE-05** Select a stage that advertises the requested capability.
- [ ] **VD-RTE-06** Require an exact cursor mapping for completion and signature
      help.
- [ ] **VD-RTE-07** Synchronize the selected projection with the bridge before
      issuing the request.
- [ ] **VD-RTE-08** Propagate cancellation and attach projection version to the
      pending request.
- [ ] **VD-RTE-09** Reject results that do not match the captured projection
      version.
- [ ] **VD-RTE-10** Preserve target, artifact, stage, occurrence, and mapping
      quality metadata through result conversion.

### Read-only result mapping

- [ ] **VD-RES-01** Map completion insertion/replacement ranges back to exact
      source ranges without applying them yet.
- [ ] **VD-RES-02** Map hover ranges and add target/expansion context when
      context-dependent.
- [ ] **VD-RES-03** Map signature-help active parameter information at the exact
      source cursor.
- [ ] **VD-RES-04** Map definition and type-definition locations to author
      source, provenance anchors, generated views, or external files according
      to the spec's priority.
- [ ] **VD-RES-05** Group repeated generated references by original source range
      while retaining occurrence counts and target sets.
- [ ] **VD-RES-06** Map generated symbols to their defining pieces without
      removing Pieceful document symbols.
- [ ] **VD-RES-07** Retain distinct results when targets produce different
      semantics.
- [ ] **VD-RES-08** Label Pieceful and target-language results when both apply at
      one source location.

### Diagnostics

- [ ] **VD-DIA-01** Map exact target diagnostics to exact author ranges.
- [ ] **VD-DIA-02** Anchor transformed and opaque diagnostics with mapping
      quality and transform-chain related information.
- [ ] **VD-DIA-03** Anchor synthetic diagnostics to the narrowest responsible
      occurrence, artifact, or configuration source.
- [ ] **VD-DIA-04** Include generated range, expansion breadcrumb, target,
      artifact, stage, and projection version in internal diagnostic data.
- [ ] **VD-DIA-05** Deduplicate identical diagnostics caused by repeated
      expansion and state affected occurrence count.
- [ ] **VD-DIA-06** Keep diagnostics separate when target configuration changes
      their meaning.
- [ ] **VD-DIA-07** Clear diagnostics belonging to closed projections or old
      snapshots.
- [ ] **VD-DIA-08** Navigate from a mapped diagnostic to generated context and
      back to source.

### Gate G4 — useful read-only intelligence in literate source

- [ ] Completion, hover, and signature help work in an unsaved LP fence.
- [ ] Definition crosses a piece boundary and lands in literate source.
- [ ] References are source-level and disclose repeated generated occurrences.
- [ ] Diagnostics are precise or explicitly anchored/opaque/synthetic.
- [ ] Stale language results never appear after a newer source edit.
- [ ] Target failure leaves Pieceful-native features operational.

## M5. Generated-code view and occurrence UX

### Presentation-neutral commands

- [ ] **VD-UI-01** Define commands for peek occurrence, open generated document,
      show all occurrences, show expansion path, select target, next occurrence,
      previous occurrence, and return to source.
- [ ] **VD-UI-02** Return generated context for piece headings, literals,
      substitutions, mapped symbols, and diagnostics.
- [ ] **VD-UI-03** Define stable command arguments based on semantic IDs plus
      snapshot/version checks, not raw offsets alone.
- [ ] **VD-UI-04** Define behavior when an occurrence disappears after an edit.

### VS Code generated documents

- [ ] **VD-VSC-01** Register a read-only generated-document content provider.
- [ ] **VD-VSC-02** Assign the target language ID for native syntax coloring.
- [ ] **VD-VSC-03** Refresh an open generated document when its projection
      version changes.
- [ ] **VD-VSC-04** Display target, artifact, stage, and freshness in the title or
      header.
- [ ] **VD-VSC-05** Highlight the selected literal, selected piece occurrence,
      descendant expansions, surrounding context, transformed text, and
      synthetic text distinctly.
- [ ] **VD-VSC-06** Show the complete expansion breadcrumb.
- [ ] **VD-VSC-07** Implement next/previous navigation across occurrences.
- [ ] **VD-VSC-08** Navigate a generated selection back to exact source or best
      provenance anchor.
- [ ] **VD-VSC-09** Keep a generated view read-only and explain how to reach the
      writable source.
- [ ] **VD-VSC-10** Mark a view stale during recomputation and replace it only
      with a complete current projection.

### Literate-source affordances

- [ ] **VD-VSC-11** Add CodeLens or equivalent occurrence summary above piece
      declarations.
- [ ] **VD-VSC-12** Add commands to the source editor context menu only when a
      generated occurrence exists.
- [ ] **VD-VSC-13** Add a target selector showing the active target and other
      applicable targets.
- [ ] **VD-VSC-14** Persist explicit target selection according to the target ADR
      and invalidate it safely when configuration changes.
- [ ] **VD-VSC-15** From a diagnostic, open generated context centered on the
      exact generated range.
- [ ] **VD-VSC-16** Provide accessible labels, keyboard navigation, and themes
      for all highlight categories.

### UI tests

- [ ] **VD-UIT-01** Test open/peek from each supported source construct.
- [ ] **VD-UIT-02** Test repeated occurrence navigation and breadcrumb updates.
- [ ] **VD-UIT-03** Test generated-to-source navigation for exact, anchored,
      opaque, and synthetic mappings.
- [ ] **VD-UIT-04** Test open-view refresh after unsaved edits.
- [ ] **VD-UIT-05** Test active-target selection and restoration.
- [ ] **VD-UIT-06** Test disappearing artifact, removed piece, bridge failure, and
      projection failure states.
- [ ] **VD-UIT-07** Test that generated documents cannot be saved over source or
      declared artifacts.

### Gate G5 — generated context is understandable

- [ ] A source fragment opens at the correct highlighted generated occurrence.
- [ ] Repeated occurrences can be inspected individually.
- [ ] Breadcrumbs distinguish expansion dependency from language call
      hierarchy.
- [ ] Generated text navigates back to its best source.
- [ ] Open views update safely after edits and never become writable artifacts.
- [ ] Target ambiguity is visible and resolvable from the editor.

## M6. Safe completion edits, imports, and rename

### Workspace edit classifier

- [ ] **VD-EDT-01** Normalize target-language workspace edits without losing
      document version or change annotations.
- [ ] **VD-EDT-02** Classify every edit as exact automatic, preview required,
      specialized Pieceful action, or rejected.
- [ ] **VD-EDT-03** Require one current contiguous writable source mapping for
      automatic edits.
- [ ] **VD-EDT-04** Reject automatic edits crossing fragment, piece, occurrence,
      or incompatible segment boundaries.
- [ ] **VD-EDT-05** Collapse identical generated edits that map to the same
      source range.
- [ ] **VD-EDT-06** Detect conflicting replacements for one source range and
      make the whole atomic operation fail safely.
- [ ] **VD-EDT-07** Reject stale, synthetic, opaque, unauthorized external, and
      unmapped artifact edits with actionable reasons.
- [ ] **VD-EDT-08** Preview multi-file and nontrivial refactorings before apply.
- [ ] **VD-EDT-09** Revalidate all expected versions immediately before applying
      an atomic source workspace edit.
- [ ] **VD-EDT-10** Trace classification and outcome without logging source text
      by default.

### Completion edits

- [ ] **VD-CMP-01** Apply a simple exact completion replacement inside one code
      fence.
- [ ] **VD-CMP-02** Apply exact snippet insertions with cursor/tab-stop behavior
      preserved by the editor adapter.
- [ ] **VD-CMP-03** Separate the primary completion edit from additional edits.
- [ ] **VD-CMP-04** Do not advertise a completion as directly applicable when its
      required additional edits are unsafe.
- [ ] **VD-CMP-05** Keep completion documentation and sort/filter metadata from
      the native language service.

### Import and preamble policy

- [ ] **VD-IMP-01** Implement configured imports/preamble piece lookup per
      artifact and target.
- [ ] **VD-IMP-02** Route an import insertion to an exact mapped imports piece
      when one exists.
- [ ] **VD-IMP-03** Offer destination selection when several valid import pieces
      exist.
- [ ] **VD-IMP-04** Offer to create a language-appropriate imports piece when the
      project policy allows it.
- [ ] **VD-IMP-05** Preview the resulting literate and generated changes before
      creating a piece or changing Pieceful structure.
- [ ] **VD-IMP-06** Reject an import targeting arbitrary synthetic preamble text
      when no policy exists.
- [ ] **VD-IMP-07** Test duplicate import suppression and formatting interaction.

### Rename

- [ ] **VD-REN-01** Request native prepare-rename and map its range to source.
- [ ] **VD-REN-02** Map all native rename edits back to source.
- [ ] **VD-REN-03** Deduplicate edits caused by repeated expansion.
- [ ] **VD-REN-04** Detect one source occurrence receiving conflicting target
      edits.
- [ ] **VD-REN-05** Preview multi-document native symbol rename.
- [ ] **VD-REN-06** Implement piece-ID rename as a separate Pieceful refactoring
      covering declarations, substitutions, directives, and qualified IDs.
- [ ] **VD-REN-07** Do not mix piece-ID and target-language symbol rename merely
      because their visible text matches.
- [ ] **VD-REN-08** Apply rename atomically or not at all.
- [ ] **VD-REN-09** Reparse and reproject after rename, then verify no new
      unresolved references were introduced.

### Gate G6 — first shippable vertical slice

- [ ] Every requirement in section 24 of the design specification is
      demonstrated by an automated test or named manual acceptance scenario.
- [ ] Simple completion edits apply directly to Markdown source.
- [ ] Import edits follow an explicit imports-piece policy.
- [ ] Local symbol rename across pieces is correctly deduplicated.
- [ ] Unsafe generated edits cannot mutate author source or artifacts.
- [ ] Generated occurrence preview accompanies ambiguous or structural edits.
- [ ] No effects execute during completion, rename, preview, or verification.

## M7. Multi-target semantics, hierarchies, and hardening

### Multi-target behavior

- [ ] **VD-TGT-01** Enumerate every target and occurrence applicable at a source
      location.
- [ ] **VD-TGT-02** Apply the active-target priority order from the design spec.
- [ ] **VD-TGT-03** Detect semantically equivalent occurrences using an explicit
      adapter-supported criterion, not text equality alone.
- [ ] **VD-TGT-04** Merge identical results only when their semantic identity and
      source edit are equivalent.
- [ ] **VD-TGT-05** Label conflicting completion, hover, diagnostic, and
      navigation results by target.
- [ ] **VD-TGT-06** Provide a target-selection action instead of silently choosing
      when no default is justified.
- [ ] **VD-TGT-07** Invalidate target selection when its target disappears and
      notify the user without blocking Pieceful-native features.
- [ ] **VD-TGT-08** Test browser/server targets with different global types and
      module resolution.

### References and hierarchy UX

- [ ] **VD-HIE-01** Map incoming call hierarchy to source symbols and call sites.
- [ ] **VD-HIE-02** Map outgoing call hierarchy to source symbols and call sites.
- [ ] **VD-HIE-03** Preserve distinct occurrence metadata behind deduplicated
      source calls.
- [ ] **VD-HIE-04** Display target-dependent call edges separately.
- [ ] **VD-HIE-05** Expose Pieceful expansion edges separately from semantic call
      edges.
- [ ] **VD-HIE-06** Add generated-context navigation from each hierarchy edge.
- [ ] **VD-HIE-07** Implement type hierarchy mapping if supported by the bridge.
- [ ] **VD-HIE-08** Test a call site expanded twice and two distinct source call
      sites that look identical after generation.

### Resilience

- [ ] **VD-ROB-01** Restart a crashed target service with bounded exponential
      backoff.
- [ ] **VD-ROB-02** Reopen only current projections after restart.
- [ ] **VD-ROB-03** Prevent a crash loop from consuming unbounded CPU or flooding
      diagnostics.
- [ ] **VD-ROB-04** Handle malformed and partial source during typing without
      discarding the last independently valid projections unnecessarily.
- [ ] **VD-ROB-09** Label any displayed last-good affected projection stale and
      prohibit it from supplying writable completion or refactoring edits.
- [ ] **VD-ROB-05** Handle deleted, renamed, and moved literate documents and
      artifact roots.
- [ ] **VD-ROB-06** Bound caches for projection text, mappings, recent snapshots,
      and inactive targets.
- [ ] **VD-ROB-07** Soak test rapid edits, target switching, and generated-view
      navigation for at least one hour.
- [ ] **VD-ROB-08** Verify clean shutdown closes processes, virtual documents,
      watchers, and disposable shadow state.

### Security and privacy

- [ ] **VD-SEC-01** Test that read, write, fetch, execute, and custom effects are
      not invoked by any editor analysis path.
- [ ] **VD-SEC-02** Allow only registered pure transforms in projection mode.
- [ ] **VD-SEC-03** Construct a minimal environment for process-backed language
      adapters.
- [ ] **VD-SEC-04** Restrict shadow workspace access to its allowlisted root.
- [ ] **VD-SEC-05** Support an untrusted-workspace mode with process adapters
      disabled.
- [ ] **VD-SEC-06** Ensure traces and ordinary logs omit source text and secrets
      by default.
- [ ] **VD-SEC-07** Threat-model malicious language-service responses, oversized
      edits, path traversal, URI spoofing, symlink escapes, and resource
      exhaustion.
- [ ] **VD-SEC-08** Add regression tests for every accepted security finding.

### Accessibility and documentation

- [ ] **VD-DOC-01** Document active targets, virtual stages, mapping limitations,
      and generated-view commands for users.
- [ ] **VD-DOC-02** Document how language adapter authors declare capabilities,
      project context, and backing modes.
- [ ] **VD-DOC-03** Document how transform authors provide identity, offset,
      source-map, or opaque provenance.
- [ ] **VD-DOC-04** Document why some generated edits need previews or cannot be
      applied.
- [ ] **VD-DOC-05** Document shadow workspace location and safe cleanup when
      applicable.
- [ ] **VD-DOC-06** Verify generated context and target selection are keyboard
      accessible and usable with screen readers.
- [ ] **VD-DOC-07** Add troubleshooting for unavailable bridge, project config,
      ambiguous target, opaque transform, and stale generated view.

### Gate G7 — public preview readiness

- [ ] Multi-target results are correct, labeled, and user-selectable.
- [ ] Call hierarchy and expansion hierarchy remain distinct and navigable.
- [ ] Crash recovery, cache bounds, shutdown, and soak tests pass.
- [ ] Security review has no unresolved high-severity findings.
- [ ] User, adapter-author, transform-author, and troubleshooting docs are
      published.
- [ ] Telemetry/trace data is structured, optional, and content-redacted by
      default.

## M8. Rix integration and second-language portability

### Rix/notebook host

- [ ] **VD-RIX-01** Adapt stable-ID notebook cells to the same Piece Document and
      projection APIs.
- [ ] **VD-RIX-02** Keep cell outputs separate from source pieces and analysis
      projections.
- [ ] **VD-RIX-03** Show generated context and expansion breadcrumbs in a Rix
      pane using the presentation-neutral model.
- [ ] **VD-RIX-04** Route completion and navigation without importing Node-only
      or VS Code packages into browser-safe Rix code.
- [ ] **VD-RIX-05** Display stale execution output separately from stale or
      current analysis projection state.
- [ ] **VD-RIX-06** Cancel projection and language requests when a cell changes
      rapidly or is removed.
- [ ] **VD-RIX-07** Demonstrate the same fixture in Markdown and notebook form
      producing equivalent piece and projection semantics.

### Second language adapter

- [ ] **VD-L2-01** Implement the language selected by `VD-ADR-14` using the
      generic bridge contract.
- [ ] **VD-L2-02** Support its real project/configuration discovery.
- [ ] **VD-L2-03** Support completion, hover, definition, references, and
      diagnostics at minimum.
- [ ] **VD-L2-04** Exercise its required backing mode, including shadow workspace
      if the native service demands files.
- [ ] **VD-L2-05** Demonstrate exact reverse mapping across at least three pieces.
- [ ] **VD-L2-06** Demonstrate an opaque or source-mapped language-specific
      transform.
- [ ] **VD-L2-07** Record any TypeScript assumptions discovered in generic
      packages and remove or explicitly specialize them.

### Gate G8 — architecture validated beyond the first host

- [ ] Rix consumes browser-safe projection APIs and provides generated context.
- [ ] Notebook and Markdown representations share piece/projection semantics.
- [ ] A second native language service works through the bridge contract.
- [ ] Generic packages contain no accidental TypeScript, VS Code, Node, or
      filesystem dependencies.
- [ ] Differences between language adapters are expressed as capabilities and
      configuration, not core conditionals.

## Cross-cutting test matrix

Every supported feature should be exercised against the mapping conditions that
can affect it. Use this table as a coverage check rather than assuming one
end-to-end fixture covers every cell.

| Feature | Exact | Repeated | Transformed | Opaque | Synthetic | Multi-target | Stale/cancelled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Completion | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Hover | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Signature help | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Definition | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| References | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Diagnostics | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Symbols | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Call hierarchy | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Completion edit | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Rename | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Generated view | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Return to source | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

For unsupported combinations, replace `[ ]` with `N/A` only after a test proves
the system returns the specified disabled, anchored, preview, or rejection
behavior.

## Release checklists

### Internal prototype

- [ ] G0 through G3 pass in CI.
- [ ] The headless demonstration uses a real configured TypeScript project.
- [ ] Known mapping and project-context limitations are documented.
- [ ] No editor distribution or compatibility promise is made.

### First editor vertical slice

- [ ] G4 through G6 pass in CI.
- [ ] A fresh user can open the example, type an unsaved member access, receive
      native completion, navigate to another piece, and inspect the generated
      occurrence.
- [ ] Automated acceptance covers safe completion, import action, rename,
      synthetic rejection, and ambiguous targets.
- [ ] Pieceful overhead is measured and reported separately from TypeScript.
- [ ] Crash and stale-response behavior are documented.

### Public preview

- [ ] G7 passes.
- [ ] Upgrade/migration behavior for saved target selections and virtual URI
      changes is defined.
- [ ] Security and privacy review is complete.
- [ ] Extension/process/shadow cleanup has been tested on supported platforms.
- [ ] Troubleshooting and limitation documentation is published.
- [ ] A rollback or feature-disable mechanism exists for target-language bridge
      failures.

### Stable multi-host release

- [ ] G8 passes.
- [ ] Public projection, bridge, and generated-context APIs have compatibility
      policy and versioning.
- [ ] At least two editor/host presentations or one editor plus Rix use the same
      projection API.
- [ ] At least two target language adapters validate bridge portability.
- [ ] Performance budgets and representative benchmark results are published.
- [ ] The source-map/provenance format has a documented schema and conformance
      suite.

## Deferred follow-on work

These items are intentionally outside the first vertical slice and should not
block G6:

- [ ] Compose emitted-stage Pieceful maps with runtime debugger source maps.
- [ ] Map stack traces and breakpoints back through nested piece expansions.
- [ ] Support direct manipulation of generated views through structured
      Pieceful refactorings rather than text edits.
- [ ] Add semantic tokens sourced from target services when the host cannot
      color generated documents natively.
- [ ] Add formatter routing with stable cursor and selection restoration.
- [ ] Add code-action aggregation across several semantically equivalent
      targets.
- [ ] Add remote language services and kernels behind explicit trust and
      capability policies.
- [ ] Define a portable on-disk provenance schema for external compilers and AI
      tools.
- [ ] Add visual dependency/call/expansion graph exploration.
- [ ] Evaluate standard debugging protocol integration after emitted source-map
      composition is proven.

## Completion record template

Use this block when closing a milestone:

```text
Milestone:
Date:
Commit/PR:
Checklist IDs completed:
Test command and result:
Benchmark environment:
Pieceful p50/p95 results:
Target-language p50/p95 results:
Security/effect-boundary verification:
Known limitations:
ADRs added or changed:
Next milestone unblocked:
```
