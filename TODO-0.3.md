# Ravel 0.3 implementation plan

This file begins with work explicitly deferred from 0.2. Additional 0.3 scope
can be added once the 0.2 release contract is complete.

## Expand historical LitPro compatibility

Ravel 0.2 includes the independent `markdown-litpro` adapter, its three
dialects, and a representative fixture subset. Complete historical-corpus
porting is not a 0.2 release requirement.

- [ ] Inventory the original LitPro documents and fixtures for H1-H4 peers,
      H5/H6 relative paths, repeated headings, minor blocks, pipelines,
      load/save directives, templating, and path resolution.
- [ ] Import each useful historical fixture without rewriting its source and
      label it with `litpro-2017`, `pieceful-2020`, or `litpro-plus`.
- [ ] Record golden normalized chunk graphs, diagnostics, planned effects, and
      generated text for every imported fixture.
- [ ] Run representative historical books and implementation documents through
      the adapter, separating genuine compatibility defects from intentionally
      unsupported ambient authority.
- [ ] Fix fixture-backed adapter gaps while keeping shell, network, dynamic
      evaluation, and filesystem effects inert unless an authorized host
      explicitly performs them.
- [ ] Document irreducible historical ambiguities and provide migration
      guidance where exact replication would be unsafe or nondeterministic.

Exit criteria:

- The selected historical corpus builds reproducibly under declared dialects.
- Every accepted deviation from old LitPro behavior is documented and covered
  by a diagnostic or migration test.
- Broader compatibility does not weaken Ravel’s capability, source-mapping, or
  deterministic-build contracts.

## Portable execution expansion

The 0.2 execution boundary is intentionally small: deterministic sequential
planning, copied JSON values, declared resources, bounded QuickJS execution,
and version-1 provider contracts. Expand it only with explicit contracts and
fixtures.

- [ ] Add persistent cache keys and cache inspection without retaining live
      closures, realms, or mutable provider state.
- [ ] Define scheduler state for cancellation, stale results, retries, trace,
      and bounded parallel execution.
- [ ] Add richer resource snapshots, quotas, hashes, and a read-only virtual
      filesystem for approved transform modules.
- [ ] Add sandboxed transform modules, including virtual includes and native
      tool compatibility where the host explicitly authorizes it.
- [ ] Add large-value fixtures and measured Node/Chromium performance and
      memory budgets before claiming scale guarantees.
- [ ] Improve runtime diagnostics with precise source mapping through provider
      compilation and execution boundaries.

## Explorer and VS Code expansion

The 0.2 Explorer slice remains read-only and bounded. These editing and scale
features require a separate review of source authority, undo semantics, and
host protocol stability.

- [ ] Add structured source-shaped edits, preview/apply round trips, stale
      edit rejection, and one-undo `WorkspaceEdit` behavior.
- [ ] Complete bidirectional editor selection, output/provenance/trace lenses,
      active cancellation, perspectives, and workspace-state restoration.
- [ ] Add 1k/10k/50k fixtures, complete-project indexes, paged projections,
      layout/search budgets, memory profiling, and supported-platform audits.
- [ ] Harden webview message validation, URI normalization, accessibility,
      workspace trust, and source rendering with integration fixtures.

## Native-tool compatibility

- [ ] Add fixtures showing which sources remain consumable by Org Babel,
      classic noweb, MyST, Jupyter, Knitr, Asciidoctor, and Quarto without a
      Ravel extension.
- [ ] Document adapter-specific ownership and execution limitations instead
      of promising transparent native-tool equivalence.
