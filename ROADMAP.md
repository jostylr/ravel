# Ravel roadmap

This is the single current plan for Ravel. It records what is shipped, what
comes next and why, and what is deliberately out of scope. Shipped changes are
in [CHANGELOG.md](CHANGELOG.md); the release procedure is in
[documentation/release-checklist.md](documentation/release-checklist.md).
Older plans are preserved, unedited, in [archive/plans/](archive/plans/README.md)
for design history only — when they disagree with this file, this file wins.

Last reviewed: 2026-10-17 (0.2.1).

## Where Ravel is today

| Area | State | Notes |
| --- | --- | --- |
| Static composition (core, map, CLI, Node host) | **Stable for 0.x use.** Published since 0.1. | Ravel Map v1, TOML config v1, manifest v2, provenance-map v1 are the versioned contracts. |
| Source adapters: Markdown fences, LitPro Markdown, MyST (+ plugin), Org, noweb, AsciiDoc, HTML, Quarto | **Published 0.2.** | All eight produce equivalent outputs for `examples/adapter-conformance`. LitPro compatibility covers a fixture subset, not the full historical corpus. |
| Live execution (`.run`, QuickJS/Wasm in workers) | **Published 0.2, intentionally small.** | Sequential, one JSON `export default`, copied inputs, host-approved ESM only, no caching. |
| Explorer | **Published 0.2, read-only.** | Bounded graph/provenance/trace views; no editing. |
| Virtual documents, language bridge/service, TypeScript adapter | **Published 0.2 as building blocks.** | Consumed by the private VS Code extension; see the status table below. |
| VS Code extension | **Private prototype.** | Not on the Marketplace; no end-to-end Extension Host suite. |

**Real-world use so far.** One external experiment — an A&I website prototype
(`artsideas/website/ravel-site`, not continued) — built a page with Markdown
fences, `.run` blocks, `ch()`, `out()`, manifests and provenance. The safety,
manifest and provenance core worked without problems and builds took ~0.2 s.
It stopped being a fit for three reasons that shape the priorities below:
there is no way to register Markdown/template transforms from the CLI or TOML
(the author hand-wrote a Markdown renderer and `%%MARKER%%` templating inside
live JS, which also collapsed provenance to one coarse segment); there is no
collection input (one source per page, front matter, per-item outputs); and the
LitPro adapter reported zero diagnostics while silently dropping `exec:` and
`define:` commands and output pipelines the old build relied on.

## Next, in priority order

Each item should land with fixtures and documentation. Order reflects what the
one real user hit first; revisit it after the next real project.

1. **Transform registration from TOML and the CLI.** A `[[transforms]]` table
   naming host-side Node modules (the core already accepts
   `transformGraph(map, { transforms })`), plus first-party `markdown` and
   simple template/field-interpolation transforms. This keeps composition in
   the graph, so provenance stays fine-grained instead of collapsing into one
   live block.
2. **Collection inputs.** A deterministic glob input with per-file front matter
   and per-item `out()` planning — the core shape of a static site or a book
   with many chapters.
3. **Honest LitPro migration.** Warn when `exec:`/`define:` commands, output
   pipelines, or apparent references inside code strings are dropped or
   reinterpreted; add `ravel migrate --report` so migration audits do not need
   hand-written scripts. Then port the historical LitPro corpus (inventory,
   import unmodified fixtures labelled by dialect, golden graphs, documented
   deviations).
4. **Static data chunks.** JSON/YAML fences that `ch()` and references can read
   without a `.run` block, and field access such as `_"site-data:name"` in
   static fences.
5. **Persistent live-result caching** with cache keys and inspection, without
   retaining closures, realms or mutable provider state.
6. **Core performance.** 0.2.1 removed the quadratic position scans (a 150 KB
   chunk with 8,000 references now parses in ~17 ms instead of ~3 s). Still
   open: `concatMapped` re-copies accumulated segments inside loops and every
   reference JSON-clones its dependency segments, whose `via` arrays grow with
   nesting depth; `transformGraph` stringifies the whole pretransform graph on
   every call. Add large-input fixtures with loose CI time budgets before
   claiming scale.

## Later — wait for a user who needs it

These are designed (see the archived plans) but expensive, and nobody depends
on them yet.

- **Execution expansion:** bounded parallel scheduling with
  cancellation/stale/retry state and trace; richer resource snapshots, quotas
  and hashes; a read-only virtual filesystem and sandboxed transform modules
  (e.g. Pug resolving includes) inside QuickJS; precise runtime diagnostics
  through provider boundaries.
- **Explorer and VS Code:** structured source-shaped edits with preview/apply
  and one-undo `WorkspaceEdit`; bidirectional selection, lenses and workspace
  restore; 1k/10k/50k-entity fixtures with paged projections and layout budgets;
  webview message validation, accessibility and workspace-trust hardening;
  experimental Composer.
- **Language tooling:** a JSON-RPC/LSP transport, process isolation and crash
  supervision for analyzers, end-to-end Extension Host acceptance, and a second
  language (RiX) to prove the bridge is not TypeScript-specific.
- **Native-tool compatibility:** fixtures showing which sources still work
  unmodified in Org Babel, classic noweb, MyST, Jupyter, Knitr, Asciidoctor and
  Quarto, with adapter ownership limits documented.
- **Site-building conveniences** (only if item 2 lands and is used): watch/serve,
  static asset copying, and link checking as host plugins.

## Known limitations (true as of 0.2.1)

- `ravel inspect` evaluates without running `.run` blocks, so references to a
  live chunk show its source text rather than its result; `build` output can
  differ.
- `create` directive bodies are parsed with underscore-quote references even in
  noweb or Org documents.
- Dynamic-code rejection in `.run` blocks is a best-effort static check. Forms
  such as `(() => {}).constructor("…")` or computed `globalThis[...]` access are
  not caught statically; they still run only inside the isolated QuickJS
  runtime with copied inputs, which is the actual security boundary.
- Symlink checks are performed before writes and deletes, not atomically with
  them; a concurrent local process that swaps a directory for a symlink during
  a build is outside the threat model.
- The Explorer demo bundle is ~4 MB (Cytoscape plus fixture code); check the
  published entry's size before embedding it in a page.

## Out of scope

Unless a future decision changes this file: npm installation or arbitrary
modules requested by a document; network access from live code or transforms;
direct host filesystem access from an executor; native Node addons or
subprocess transforms; cross-run live state or notebook globals; non-JSON live
values; remote execution; character-precise provenance through arbitrary
execution.

## Workstream status detail

**Explorer** (from the archived Explorer plan; checked items / total):
contracts and proof fixture 9/14 · read-only browser Explorer 10/18 · VS Code
read-only integration 16/24 · provenance/output/trace 7/15 · in-memory preview
and change lens 12/17 · structured edits 0/14 · outline, scale and hardening
0/15 · Composer 0/7.

**Virtual documents and language tooling** (from the archived checklist's
evidence table; no milestone gate is closed):

| Milestone | State |
| --- | --- |
| M0 decisions and measurement | Partial: TypeScript bridge ADR, fake bridge, 100k-line performance harness. Missing URI/identity stability and second-language ADRs. |
| M1 projection and mapping | Substantial: immutable virtual documents, segment kinds, occurrences, reverse/line indexes. Fixture corpus narrower than planned; no property tests. |
| M2 incremental projections | Partial: deltas, index reuse, cancellation. Timings informational only. |
| M3 TypeScript bridge | In-process slice works with overlays and configuration confinement; no process isolation. |
| M4 read-only language features | Editor-integrated prototype; no LSP transport or Extension Host suite. |
| M5 generated-code view | Integrated prototype; acceptance and accessibility coverage missing. |
| M6 safe edits | Exact edits only for open, versioned files; no preview transaction for ambiguous edits. |
| M7 multi-target and hardening | Foundations; no soak test, crash supervisor, or threat model. |
| M8 RiX portability proof | Not started. |
