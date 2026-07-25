# Changelog

All notable user-facing changes are recorded here. Ravel follows semantic
versioning for its published packages and versioned public contracts.

## 0.1.0 — unreleased

### Added

- Static Markdown and Ravel Map composition with a Node CLI.
- Deterministic graph evaluation, diagnostics, declared outputs, manifests,
  managed cleanup, and optional ZIP backups.
- Versioned generated-output provenance: per-deliverable `.ravelmap` sidecars
  and an aggregate `.ravelmap` bundle, with forward and reverse queries.
- Public ESM package exports, handwritten declarations, and packed-installation
  smoke tests for `@pieceful/ravel-*` and `@pieceful/ravel`.
- An in-memory `@pieceful/ravel-host-browser` package and a CodeMirror
  playground for rendering a single document, inspecting diagnostics, and
  navigating generated-output provenance.
- A Quarto documentation site compiled into `docs/` with GitHub Pages
  publication automation.
- Node, Bun, Chromium, and Windows Node verification workflows.

### Compatibility

- Ravel Map version 1, the documented Markdown fenced profile, TOML config
  version 1, manifest version 2, and provenance-map version 1 are the 0.1
  versioned contracts.
- Plugins, execution, editor integration, additional adapters, watch mode, and
  incremental builds remain outside 0.1.
