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
