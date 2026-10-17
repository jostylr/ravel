# Changelog

All notable user-facing changes are recorded here. Ravel follows semantic
versioning for its published packages and versioned public contracts.

## 0.2.1 — unreleased

### Fixed

- `--clean` and `refresh` now check every path component for symbolic links
  before deleting, so a symlinked subdirectory of the output directory can no
  longer make Ravel delete files outside it.
- `--clean` (and `build.clean = true`) now writes the new build first and only
  then removes previously managed files it no longer produces. A failed build
  keeps the previous output and manifest. The `removed` list reports only files
  actually removed.
- noweb and Org references must close on one line and may not start or end with
  whitespace, so C++ `std::cout << x` no longer fails with "Unterminated noweb
  chunk reference" and `a << 2; b >> 1` is no longer read as a reference. `@<<`
  writes a literal `<<`.
- Deliverables that collide with `.ravel-manifest.json` or `.manifest.txt`, or
  with each other when compared case-insensitively, are rejected instead of
  being silently overwritten.
- Backups: the first build skips the backup instead of failing; a backup name
  configured in TOML gets the archived build's timestamp so it works on every
  build; derived names add a `-2`, `-3`, … suffix instead of blocking a build.
  Archives now contain only manifest-listed files (as documented) and are
  deflate-compressed.
- A document imported by several `[[files]]` entries is loaded once instead of
  failing with a duplicate document ID.
- Reference source positions now report the correct line and column inside
  multi-line chunks (offsets were already correct).
- A failed artifact write now restores every staged entry and removes its
  temporary files even when one restoration step fails; the original error is
  reported with any rollback problems attached.
- `createDirective` and `aliasDirective` now produce directives that pass Ravel
  Map validation, and the map schema accepts a `create` directive with a
  `body` as core always has.

### Performance

- Parsing large chunks is no longer quadratic: a 150 KB chunk with 8,000
  references parses in about 17 ms instead of about 3 s.

### Security

- Updated `smol-toml` to 1.9.1, fixing a denial-of-service and quadratic parse
  on malformed TOML (affects reading `ravel.toml`).

### Documentation and project

- Added [ROADMAP.md](ROADMAP.md) as the single current plan and moved the
  0.1/0.2/0.3, Explorer, and virtual-document plans to `archive/plans/`.
- Corrected the filesystem-safety guide (there is no `--root` flag; `.run`
  blocks are the one form of document code Ravel executes), described the
  limits of static dynamic-code detection, clarified where `--graph` writes,
  and documented that `inspect` does not run live blocks.
- The CLI test suite now also runs under Bun.

## 0.2.0 — 2026-08-01

### Added

- First public releases of the AsciiDoc, HTML, MyST, MyST plugin, Org, noweb,
  Quarto, and LitPro Markdown adapters, all producing equivalent source-mapped
  Ravel Maps (see `examples/adapter-conformance`).
- First public releases of `@pieceful/ravel-projection`,
  `@pieceful/ravel-language-bridge`, `@pieceful/ravel-language-service`, and
  `@pieceful/ravel-language-typescript`: virtual-document projection and
  language-tooling building blocks used by the private VS Code extension.

- Added portable `.run` metadata and stable-identity validation to the Markdown
  adapter without executing during parsing.
- Added language-neutral live planning, provider selection, dependency
  resolution, execution, diagnostics, and recursive JSON-value serialization
  to core.
- Added the initial `@pieceful/ravel-js-live` QuickJS/WebAssembly provider with
  one final default export, literal `ch`/`load` analysis, immutable copied
  inputs, and memory, stack, and time limits.
- Made `@pieceful/ravel-host-browser` and `@pieceful/ravel-explorer` public
  npm packages, with install-first package guides, versioned browser-safe
  contracts, and packed-installation smoke coverage.
- Moved QuickJS behind persistent, terminable Node and browser workers while
  retaining a fresh QuickJS runtime per execution; cancellation and outer
  deadlines replace failed workers.
- Added a quota-limited immutable virtual-module registry so live blocks can
  statically import host-approved QuickJS-compatible ESM without npm,
  filesystem, URL, or dynamic module resolution.
- Added static live-provider analysis to `ravel check`, so checking a project
  detects malformed or unsafe executable JavaScript without running it.
- Hardened dynamic-code detection against aliases and computed global access,
  and disabled the corresponding QuickJS globals as defense in depth.
- Froze the v0.2 provider analysis/outcome contract at version 1, with stable
  `succeeded` and `failed` execution statuses.

### Deferred to 0.3

- Persistent execution caching, advanced scheduler state/concurrency, richer
  resource snapshots and virtual filesystems, transform modules, and large
  value/performance budgets.
- Structured Explorer edits, full VS Code round-trip editing, 50k-entity
  scale guarantees, and broad native-tool compatibility fixtures.

## 0.1.1 — 2026-07-26

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
