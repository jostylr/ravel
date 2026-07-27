# Changelog

All notable user-facing changes are recorded here. Ravel follows semantic
versioning for its published packages and versioned public contracts.

## 0.2.0 — in development

### Added

- Added portable `.run` metadata and stable-identity validation to the Markdown
  adapter without executing during parsing.
- Added language-neutral live planning, provider selection, dependency
  resolution, execution, diagnostics, and recursive JSON-value serialization
  to core.
- Added the initial `@pieceful/ravel-js-live` QuickJS/WebAssembly provider with
  one final default export, literal `ch`/`load` analysis, immutable copied
  inputs, and memory, stack, and time limits.

## 0.1.1 — unreleased

### Documentation

- Added package-specific npm READMEs for the CLI, core engine, map contract,
  Markdown adapter, and Node host, each linking to ravel.jostylr.com.
- Added published-package links and one-sentence descriptions near the top of
  the repository README, and replaced its long local documentation list with a
  direct link to the documentation site.
- Updated package homepages to the Ravel documentation site and verify that
  every public package tarball contains its README.

## 0.1.0

### Added

- Static Markdown and Ravel Map composition with a Node CLI.
- Deterministic graph evaluation, diagnostics, declared outputs, manifests,
  managed cleanup, and optional ZIP backups.
- Versioned generated-output provenance: per-deliverable `.ravelmap` sidecars
  and an aggregate `.ravelmap` bundle, with forward and reverse queries.
- Public ESM package exports, handwritten declarations, and packed-installation
  smoke tests for `@pieceful/ravel-*` and `@pieceful/ravel`.
- A private in-memory browser host and CodeMirror playground for rendering a
  single document, inspecting diagnostics, and navigating generated-output
  provenance.
- A Quarto documentation site compiled into `docs/` with GitHub Pages
  publication automation.
- Node, Bun, Chromium, and Windows Node verification workflows.

### Compatibility

- Ravel Map version 1, the documented Markdown fenced profile, TOML config
  version 1, manifest version 2, and provenance-map version 1 are the 0.1
  versioned contracts.
- Plugins, execution, editor integration, additional adapters, watch mode, and
  incremental builds remain outside 0.1.
