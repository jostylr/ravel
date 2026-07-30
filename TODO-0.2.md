# Ravel 0.2 implementation plan

## Release definition

Ravel 0.2 adds portable, capability-limited execution without making JavaScript
or QuickJS part of the core language. A source adapter marks a chunk as
executable, the core builds a language-neutral execution plan, a registered
language provider evaluates it, and the host decides what to do with the
returned value.

Ravel 0.2 also broadens the source-format boundary. It must ship the modern
Markdown, full LitPro Markdown, Quarto, AsciiDoc, HTML, Org, noweb, and MyST
adapters specified in the
[markup adapter design](documentation/markup-adapters-design.md). All adapters
produce equivalent source-mapped Ravel Maps, support definition pipelines
after chunk names, and remain effect-free while parsing.

The first public provider is `@pieceful/ravel-js-live`. It runs ordinary
JavaScript in QuickJS compiled to WebAssembly. The provider accepts immutable
JSON inputs and returns exactly one JSON-compatible default export. It has no
ambient filesystem, network, process, console, or host-write capability.

The 0.2 architecture must also admit later providers such as RiX and other
interpreters or compilers implemented in WebAssembly. Those providers are not
required for 0.2, but a provider conformance fixture must prove that core does
not depend on JavaScript syntax, JavaScript objects, or QuickJS APIs.

Ravel 0.2 also ships the first Ravel Explorer: a portable, bounded graph and
provenance interface embedded in a VS Code webview beside the normal source
editor. It links source, dependencies, transforms, traces, and generated output;
previews source and structured transform edits through in-memory overlays; and
applies accepted changes through normal VS Code undo and redo. The detailed
design and backlog are in the
[Explorer design](documentation/explorer-design.md) and
[Explorer implementation plan](EXPLORER-TODO.md).

## Decisions already made

- [x] Record the following decisions in the public execution design:
  - Executable Markdown fences retain their real language, such as `js` or
    `javascript`, and opt into execution with the `.run` class.
  - `.run` is adapter metadata. Parsing a document never executes the block.
  - JavaScript execution uses standard module syntax and requires exactly one
    top-level `export default` as the final statement.
  - The default export may be any JSON value. Empty strings, empty arrays,
    empty objects, `false`, `0`, and `null` are valid results.
  - A missing export, `undefined`, a function, a symbol, a bigint, a non-finite
    number, a cycle, or another non-JSON value is an execution error.
  - Live code cannot write files, emit display values, log through a host
    console, or commit effects. Ravel directives and hosts consume the returned
    value and decide whether to display, transform, or write it.
  - Incoming values are copied into the execution realm and deeply frozen.
    No live object identity crosses between chunks, runs, or the host.
  - Source composition and value dependencies remain distinct: an
    underscore-quoted reference composes source before execution, while a
    provider-supported value reference such as JavaScript `ch("name")`
    consumes a completed live result.
  - Dynamic dependency and resource names are rejected in 0.2. The graph must
    be known before execution.
- [x] Decide whether `.run` implies `.ravel` for an explicitly named fence.
      The proposed canonical form is:

      ````markdown
      ```js {.run #process-data}
      const parsed = ch("parsed-csv");
      export default parsed.rows;
      ```
      ````

- [x] Decide and document how ordinary processing selects a live result.
      Strings flow as raw text. `jsontext()` serializes a complete JSON value;
      `jsontext("key")` selects one top-level object value. A selected string
      becomes raw text and another selected JSON value becomes compact JSON
      text. More elaborate formatting belongs in the live block. The executor
      never writes either.
- [x] Keep the synchronous 0.1 static-composition API intact. Add an asynchronous
      execution stage rather than making every existing `transformGraph` caller
      asynchronous.

## Package boundaries

| Package | 0.2 responsibility | Must not do |
| --- | --- | --- |
| `@pieceful/ravel-map` | Versioned execution metadata, JSON-value, resource, limit, and result contracts | Import an executor or host |
| `@pieceful/ravel-core` | Language-neutral analysis, execution graph, scheduling, state, caching keys, diagnostics, trace, and directive planning | Parse JavaScript, import QuickJS, or access files |
| `@pieceful/ravel-markdown` | Map `.run`, language, block identity, and execution attributes to Ravel Map metadata with exact ranges | Execute a fence or select a provider |
| Source adapter packages | Map modern/legacy Markdown, AsciiDoc, HTML, Org, noweb, and MyST source into equivalent Ravel Maps and surface/source maps | Resolve the graph, execute code, perform directives, or depend on host authority |
| Quarto integration | Run the Markdown adapter before executable-cell processing and decorate rendered output with chunk captions and graph links | Become a second parser, resolver, or execution engine |
| `@pieceful/ravel-host-node` | Resolve approved resources, persistent caches, CLI policy, and authorized output directives | Expose ambient Node APIs inside an executor |
| `@pieceful/ravel-host-browser` | Supply in-memory resources and browser worker integration | Claim a filesystem or process capability |
| `@pieceful/ravel-js-live` | JavaScript analysis and QuickJS/Wasm execution; portable runtime plus optional Node-specific module preparation | Become a required dependency of core |
| `@pieceful/ravel-explorer` | Portable bounded graph projections, provenance/change lenses, Cytoscape/ELK UI, and versioned host protocol | Access files, import VS Code, execute transforms, or write source |
| `@pieceful/ravel-vscode` | VS Code webview host, project loading, source synchronization, overlay previews, diagnostics, and `WorkspaceEdit` | Make the webview authoritative or expose unrestricted workspace capabilities |

The workspace directory for the first provider should be `packages/js-live/`
with the published name `@pieceful/ravel-js-live`. If Node-only module
preparation is included in this package, expose it through an explicit
`@pieceful/ravel-js-live/node` subpath so the main entry remains browser-safe.

## Workstream A: language-neutral core and host support

### A1. Specify the execution contracts

- [x] Add a `RavelValue` contract covering `null`, booleans, finite numbers,
      strings, arrays, and string-keyed records recursively.
- [ ] Specify an `ExecutionProvider` interface with stable provider ID,
      provider version, accepted language IDs/aliases, analysis, execution,
      cancellation, and supported-feature declarations.
- [ ] Keep language analysis provider-owned. An analysis result reports static
      value dependencies, source dependencies, resource requests, module
      requests, the export contract, diagnostics, and exact source ranges.
- [ ] Define an `ExecutionRequest` containing only composed source, immutable
      inputs, a virtual resource snapshot, limits, source identity, run ID,
      provider configuration, and `AbortSignal`.
- [ ] Define an `ExecutionResult` that distinguishes success from failure and
      carries the exported `RavelValue`, serialized bytes, diagnostics, timing,
      provider/engine versions, and coarse dependency provenance.
- [x] Represent “no export” independently from valid falsy values. Never use
      truthiness to determine whether an execution produced a value.
- [ ] Define stable diagnostic families for provider absence, unsupported
      language, malformed execution metadata, dynamic dependency, missing
      input/resource, cancellation, timeout, memory/stack limit, provider
      failure, missing export, and non-serializable export.
- [x] Add a provider conformance suite using a fake non-JavaScript provider.
      It must pass without importing `@pieceful/ravel-js-live`.

Exit criteria:

- Core can plan and run a small graph through a test provider without knowing
  the provider's source language.
- The public contracts are documented and have checked `.d.ts` declarations.

### A2. Extend maps and Markdown without executing

- [x] Define execution metadata in the Ravel Map contract, preferably as an
      optional, backward-compatible addition to chunk metadata unless a map
      version change is justified.
- [x] Extend the Markdown fence parser to recognize `.run` while preserving the
      first language token for ordinary syntax highlighting.
- [x] Require a stable chunk identity for an executable fence. Report a
      source-linked adapter diagnostic when `.run` appears without one.
- [ ] Preserve the complete fence body and exact ranges for the run marker,
      language, identity, dependency declarations, and resource declarations.
- [x] Confirm that unmarked `js` fences remain ordinary static chunks or
      examples according to the existing Markdown mode; language alone never
      opts into execution.
- [ ] Add Markdown fixtures for `js` and `javascript`, valid and invalid `.run`
      placement, greedy fragments, source composition, and ordinary non-running
      examples.
- [x] Keep `.run` portable across Markdown, future section-profile Markdown,
      editor-produced maps, and other adapters. It must not encode QuickJS in
      adapter output.

Exit criteria:

- Markdown-to-map conversion exposes a complete execution declaration but
  performs no analysis or evaluation.
- Existing 0.1 Markdown fixtures remain byte-for-byte compatible where their
  source does not use `.run`.

### A3. Build the execution graph and scheduler

- [x] Add an explicit post-composition execution-planning phase. Source
      substitutions settle before provider analysis; value dependencies settle
      before provider execution.
- [ ] Detect cycles spanning static source composition and live-value
      dependencies, with the shortest useful source-linked path.
- [ ] Topologically schedule ready executions with bounded concurrency and
      cancellation through `AbortSignal`.
- [ ] Represent run state as `pending`, `running`, `succeeded`, `failed`,
      `cancelled`, or `stale`, without relying on notebook source order.
- [ ] Make automatic/reactive execution a host policy. Core exposes invalidated
      nodes and a deterministic plan; it does not silently rerun effectful host
      directives.
- [x] Copy and deep-freeze every input in the provider realm. Add conformance
      tests proving that a consumer cannot mutate its producer or a sibling
      consumer.
- [x] Preserve a canonical serialized representation of each successful result
      so fan-out stringifies once and parses once per consumer.
- [ ] Attach coarse provenance from a live result to its executable fence,
      source-composed helpers, value dependencies, resources, and provider
      version. Do not invent character-level mappings for arbitrary execution.
- [ ] Add trace events for analysis, waiting, execution, cache hit/miss,
      serialization, cancellation, and failure.

Exit criteria:

- A multi-block fixture executes in dependency order, reports stale downstream
  results after an edit, rejects a mixed cycle, and cancels a long-running fake
  provider cleanly.

### A4. Define resources and a virtual filesystem contract

- [ ] Define a portable immutable resource snapshot: normalized virtual path,
      bytes or text, media type, content hash, and optional deterministic
      metadata.
- [ ] Use canonical POSIX-style virtual paths regardless of host platform.
      Reject absolute paths, traversal, duplicate normalized paths, symlinks,
      devices, and aliases with ambiguous casing policy.
- [ ] Separate read-only project resources from an optional quota-limited
      scratch filesystem. Scratch writes are ephemeral and never write through
      to the host.
- [ ] Specify quotas for entry count, individual file size, total bytes, and
      scratch growth, plus cancellation and deterministic error behavior.
- [ ] Normalize or omit time, permission, owner, inode, and real-path metadata
      so a transform cannot acquire nondeterministic host details.
- [ ] Let a provider analyze static resource requests. For JavaScript,
      `load("cool.csv")` may be convenient syntax, but Ravel resolves the
      literal request before execution and the sandbox sees only the prepared
      snapshot.
- [x] Add host-node resource preparation below an explicit root, reusing the
      existing containment and symlink policy.
- [ ] Add host-browser preparation from caller-supplied in-memory resources.
- [ ] Define how resources participate in cache keys through their content
      hashes rather than host paths or timestamps.

Exit criteria:

- The same resource fixture produces the same execution request and hash on
  Node and in Chromium.
- No executor-facing interface contains a native file descriptor, absolute
  host path, Node `fs` object, or write-through callback.

### A5. Connect results to directives and hosts

- [x] Extend directive planning so a live result can be selected without giving
      the executor an output capability.
- [x] Require the explicit `jsontext()` or `jsontext("key")` boundary for
      non-string live results entering ordinary text pipes or directives.
- [x] Keep build writes in host-node with the existing dry-run, containment,
      atomic commit, manifest, cleanup, and backup behavior.
- [ ] Add inspect/JSON views for execution plans, provider selection, input and
      resource hashes, result summaries, diagnostics, trace, and cache state.
- [x] Decide whether 0.2 exposes a new `ravel run` command or extends
      `inspect`/`build` with an explicit execution flag. No existing command
      should execute `.run` blocks merely because it parsed them.
- [ ] Ensure `check` can analyze and validate executable blocks without running
      them, unless an explicit validation mode requires provider compilation.

Exit criteria:

- A directive writes an exported string or an object key selected through
  `jsontext` via host-node, while the same executor package remains unable to write a
  host file directly.

## Workstream B: `@pieceful/ravel-js-live`

### B1. Establish the QuickJS/Wasm runtime

- [x] Create `packages/js-live/` with package metadata, exports, declarations,
      license, README, packed-installation smoke coverage, and no dependency
      from core back to it.
- [ ] Select and pin an exact QuickJS/Wasm distribution and record its engine,
      wrapper, Wasm variant, and build versions in every run and cache key.
- [x] Reuse the compiled WebAssembly module, but create a fresh execution realm
      for each run by default.
- [x] Run QuickJS inside a dedicated browser worker and a Node worker or
      replaceable process boundary. The host must be able to terminate the
      outer worker if the engine interrupt fails.
- [ ] Configure memory, stack, execution-time, output-size, and pending-job
      limits. Connect core cancellation to both the QuickJS interrupt handler
      and outer worker termination.
- [x] Do not install QuickJS `std`/`os`, a general module loader, timers,
      network APIs, Node globals, `console`, or host object references.
- [x] Marshal inputs and outputs as serialized data rather than exposing live
      QuickJS handles to core or hosts.

Exit criteria:

- The packed provider runs the same minimal JavaScript block in Node and
  Chromium and is absent from the dependency trees of map, core, and Markdown.

### B2. Implement the JavaScript live profile

- [x] Register the language aliases `js` and `javascript`; keep provider
      selection explicit and diagnose ambiguous registrations.
- [x] Parse executable source as an ECMAScript module and reject host imports,
      dynamic imports, top-level side-effect channels, and unsupported syntax
      before execution.
- [x] Require exactly one final top-level `export default`. Accept every valid
      JSON value, including `""`, `[]`, `{}`, `false`, `0`, and `null`.
- [ ] Validate the export deeply before it leaves QuickJS. Reject `undefined`,
      functions, symbols, bigints, non-finite numbers, cycles, accessors,
      and unsupported prototypes instead of silently coercing them. Decide
      whether `Proxy` is disabled in the live profile or handled by a
      time-limited serialization rule.
- [x] Implement static analysis for literal `ch("chunk-reference")` calls and
      reject computed dependency names that cannot be planned. A literal call
      in a conditional branch is still a declared dependency.
- [x] Reserve the injected `ch` and `load` bindings against shadowing or
      reassignment, and reject dynamic code generation in the live profile when
      it could hide dependencies or resource requests from analysis.
- [x] Inject `ch` as a read-only lookup over deep-frozen copies of resolved
      values. It must not expose promises, provider handles, or host objects.
- [x] Implement literal `load("virtual/path")` as a lookup over the prepared
      immutable resource snapshot, not as filesystem access.
- [ ] Preserve source locations through any wrapper or module transformation so
      QuickJS syntax/runtime errors point back to the Markdown fence.
- [ ] Add tests for empty/falsy exports, missing and misplaced exports,
      mutation attempts, serialization failures, dependency cycles, missing
      resources, infinite loops, memory exhaustion, and attempted access to
      `process`, `require`, `fetch`, imports, and host globals.

Exit criteria:

- The documented CSV load, parse, process, and JSON-result example runs through
  QuickJS/Wasm with immutable inputs and no host effect capability.

### B3. Reusable JavaScript helpers and code caching

- [ ] Continue to support underscore-quoted source composition for small helper
      functions. The composed module is analyzed and compiled after all source
      dependencies settle.
- [x] Do not permit functions as live results and do not cache live closures
      across runs.
- [ ] Cache composed source, validation/analysis, and result JSON using the
      core cache-key contract.
- [ ] Reuse the Wasm module and consider an in-memory compiled-module cache only
      after measuring source compilation. Key it by exact engine build, provider
      version, source hash, and execution profile.
- [ ] Never load QuickJS bytecode supplied by a document, dependency, cache from
      another engine version, or other untrusted source. Persistent bytecode
      caching is deferred unless its trust and invalidation model is reviewed.
- [x] Provide trusted virtual modules for reusable libraries only through a
      registry prepared by the host. Arbitrary package or path imports remain
      unavailable.
- [x] Let a Node TOML project map an exact live import specifier to an
      already-installed package export. Bundle it through the Node-only
      `@pieceful/ravel-js-live/node` subpath and pass only immutable ESM source
      to the provider; Ravel never installs the package.
- [ ] Benchmark repeated runs with unchanged code and changing inputs to decide
      whether compiled-code caching produces a material improvement over result
      caching and ordinary recompilation.

Exit criteria:

- Repeated unchanged runs hit the result cache; changed-input runs create fresh
  function objects; no test can observe state from a preceding realm.

### B4. Run approved transform modules in QuickJS

- [ ] Define a transform-module manifest: registered transform name, package
      and exact version, entry/export, input/output kinds, provider, purity,
      deterministic options, required virtual modules, resource needs, limits,
      and content hash.
- [ ] Treat configuration as the authority. A document may request a registered
      transform name but may not install a package, choose an arbitrary module
      path, or expand capabilities.
- [ ] Add a Node-only preparation step that bundles an approved JavaScript
      package and its JavaScript dependencies into a QuickJS-compatible module.
      Reject native addons, unresolved dynamic imports, unsupported Node
      built-ins, worker/process creation, and install-time code.
- [x] Decide whether the bundler belongs in the
      `@pieceful/ravel-js-live/node` subpath or in host-node. Keep its output a
      provider-neutral registered-module artifact where practical.
      Package resolution is host authority, but QuickJS-compatible JavaScript
      preparation belongs to the provider's explicit Node-only subpath.
- [ ] Route external transform execution through the asynchronous provider
      contract while preserving existing synchronous built-in transforms.
- [ ] Require transform modules to return a JSON value or text. They receive no
      direct Ravel graph, host, filesystem, network, output, or cache object.
- [ ] Give every transform invocation a fresh realm by default. If a pooled
      realm is later offered for trusted transforms, make it an explicit host
      policy and exclude it from reproducible mode.
- [ ] Record module bundle hash, package versions, resources, limits, duration,
      and outcome in trace and cache keys.
- [ ] Return coarse transform provenance unless the registered transform
      implements a separately specified source-map result protocol.

Exit criteria:

- A fixture transform packaged like an npm module runs in QuickJS without Node
  authority and returns the same value in repeated clean runs.

### B5. Add Node-style virtual filesystem compatibility

- [ ] Supply Node-style shims only to registered transform modules whose
      manifests request them. Ordinary `.run` JavaScript receives `ch`, `load`,
      and standard language intrinsics, not `fs` or `path`.
- [ ] Implement engine-specific shims over the portable virtual filesystem for
      the smallest useful subset of `node:path`, `node:fs`, and process-like
      path configuration.
- [ ] Start read-only with path normalization, `readFile`/`readFileSync`,
      `exists`/`existsSync`, limited `stat`, directory listing, `cwd`, and
      deterministic error codes. Add scratch writes only for a demonstrated
      transform requirement.
- [ ] Map both `fs` and `node:fs`, and both `path` and `node:path`, during the
      trusted bundling step. Do not emulate unrelated Node globals merely for
      compatibility.
- [ ] Ensure `realpath`, symlinks, permissions, environment variables, home
      directories, temporary host directories, subprocesses, and network
      loading cannot reveal or reach the host.
- [ ] If scratch writes are enabled, constrain them to a separate virtual root,
      enforce quotas, discard them after the invocation, and expose their
      contents only through an explicit returned value.
- [ ] Add a Pug transform fixture for basic rendering.
- [ ] Add a second Pug fixture using `include` or `extends` from the virtual
      filesystem, with all templates supplied as declared Ravel resources.
- [ ] Document unsupported Node-module categories: native addons, shell tools,
      arbitrary dynamic `require`, runtime package discovery, worker threads,
      and modules whose correctness depends on host OS metadata.

Exit criteria:

- Pug renders a template and a virtual include without observing or modifying
  the host filesystem.
- Attempted path traversal, undeclared reads, host writes, network access, and
  subprocess execution fail with stable diagnostics.

## Workstream C: caching, performance, and release integration

### C1. Cache safely

- [ ] Define result cache keys from provider and engine versions, composed
      source, declared inputs, resource and module hashes, limits, transform
      configuration, and relevant Ravel contract versions.
- [ ] Serialize a successful producer once and retain its bytes/hash. Parse one
      immutable copy per consumer rather than stringify/parse twice per edge.
- [ ] Never cache failures as successful results. Decide short-lived diagnostic
      caching separately.
- [ ] Never cache or reuse live function objects, closures, realms, host
      handles, mutable module state, or scratch files.
- [ ] Invalidate downstream results and expose stale state when source, inputs,
      resources, provider version, module bundle, or limits change.
- [ ] Make persistent caches inspectable and safely disposable. Cache absence
      must affect performance only, never correctness.

### C2. Establish performance budgets

- [ ] Add fixtures around approximately 100 KB, 1 MB, and 10 MB JSON values,
      covering a linear chain and one-to-many fan-out.
- [ ] Measure Wasm initialization, realm creation, source analysis, QuickJS
      compilation, function recreation, input parsing/freezing, execution,
      export validation/stringification, worker transfer, and cache lookup
      separately.
- [ ] Benchmark helper-heavy modules to determine whether function/module
      compilation needs a 0.2 cache. Do not optimize live closures.
- [ ] Record peak memory as well as duration; JSON and worker boundaries can
      temporarily hold multiple copies.
- [ ] Set a regression budget only after collecting Node and Chromium
      baselines. Document that very large table workloads may require a future
      immutable binary/Arrow value type rather than JSON.

### C3. Complete product integration

- [x] Add a runnable npm-module CSV example using TOML-declared modules and
      resources, `load`, `ch`, QuickJS/Wasm workers, and the no-write
      `ravel run` command.
- [ ] Add a complete Markdown example with `.run` JavaScript fences, source
      composition, `ch` dependencies, `load` from a declared resource, string
      and structured exports, and directive-controlled output.
- [ ] Add the sandboxed Pug transform example with a virtual include.
- [ ] Add Node and Chromium end-to-end coverage and packed-tarball smoke tests.
      Run Bun conformance for the provider if its selected QuickJS/Wasm package
      supports the same contract reliably; core conformance remains mandatory.
- [ ] Document the threat model and accurately describe the implementation as
      capability-limited and defense-in-depth rather than absolutely safe.
- [ ] Document provider authoring so a future RiX or Wasm-backed language can
      implement analysis, execution, serialization, limits, diagnostics, and
      conformance without depending on JavaScript.
- [ ] Update README, public API, Markdown fences, runtime support, filesystem
      safety, transform guidance, examples, and changelog for 0.2.
- [ ] Add all new public packages and subpath exports to release packing,
      licensing, provenance, and publication checks.

## Workstream D: source-format adapters

The syntax and behavior in this workstream are defined in the
[markup adapter design](documentation/markup-adapters-design.md). The checklist
below makes that design release-binding for 0.2.

### D1. Finalize the shared adapter contract

- [ ] Replace format-specific compiler assumptions with one adapter contract
      that emits a versioned Ravel Map plus definition, fragment, reference,
      directive, and rendered-anchor surfaces.
- [ ] Give every emitted semantic item an exact URI and source range. Where a
      host parser provides only block starts, pair its AST with a lossless
      scanner rather than weakening the Ravel diagnostic contract.
- [ ] Parse definition and use-site pipelines through the shared core syntax
      parser. An adapter identifies the range and spelling; it does not
      implement a private pipe language.
- [ ] Specify that a definition pipeline runs once after all fragments of a
      chunk have been concatenated. Reject conflicting pipelines and pipelines
      attached to later fragments where the format does not define that
      behavior.
- [ ] Preserve per-fragment language metadata and diagnose incompatible
      concatenation consistently across formats.
- [ ] Add adapter capability declarations for headings, named blocks,
      repeated fragments, includes, native cross-references, executable blocks,
      rendered anchors, and exact source-map quality.
- [ ] Ensure parsing only produces maps, diagnostics, and effect plans. No
      adapter may read undeclared files, execute a cell, run a directive, or
      mutate an output document during parsing.
- [x] Build adapter-independent conformance fixtures whose normalized Ravel
      Maps are identical across source formats.

Exit criteria:

- One shared fixture produces the same normalized chunks, references,
  pipelines, directives, diagnostics, and provenance edges through every 0.2
  adapter.
- Core and host packages contain no format-specific parsing branches.

### D2. Complete modern and full-LitPro Markdown

- [x] Extend `@pieceful/ravel-markdown` so heading-owned and named-fence chunks
      coexist. A named fence owns only itself and does not replace the current
      ambient heading; later unnamed fences continue contributing to that
      heading chunk.
- [x] Preserve the language/info string on every unnamed heading-owned fence.
      Infer a chunk language only when its nonempty fragment languages agree.
- [x] Allow a definition pipeline after a heading name or on the first unnamed
      fence. Apply it once after all heading-owned fragments concatenate and
      reject pipelines on later unnamed fragments.
- [x] Support compact CommonMark and attributed Pandoc/Quarto spellings for
      named chunks, append fragments, display names, stable IDs, languages, and
      pipelines.
- [x] Add the independent `markdown-litpro` adapter with H1-H4 peer chunks, H5
      children, H6 grandchildren, slash and colon paths, relative references,
      repeated definitions, minor blocks, link directives, delayed
      substitutions, legacy comments, and fence/indented-code concatenation.
- [x] Implement the `litpro-2017`, `pieceful-2020`, and `litpro-plus`
      dialects, plus `legacy`, `flat`, and `none` heading-level modes.
- [x] Keep unsafe legacy directives as planned effects. Exact structural
      compatibility must not imply ambient shell, network, eval, or filesystem
      authority.

Importing and validating the broader historical LitPro corpus is deferred to
the [0.3 plan](TODO-0.3.md). Ravel 0.2 retains its checked-in representative
compatibility fixtures without making complete corpus replication a release
requirement.

Exit criteria:

- A modern fixture can place a named fence between two unnamed fences and
  retain both unnamed fragments under the heading chunk.
- The checked-in 0.2 LitPro compatibility subset produces the expected chunk
  structure and generated text under its declared dialect.

### D3. Implement the Quarto integration

- [x] Accept `.qmd` through the selected Markdown adapter rather than defining
      a Quarto-specific Ravel Map dialect.
- [x] Use native `lst-*` labels and `lst-cap` captions for the no-extension
      baseline so named chunks are visible and cross-referenceable.
- [x] Add pure single-document pre-execution preparation that weaves Quarto-
      owned cells before Jupyter or Knitr sees them and never overwrites
      authored source.
- [x] Add the project host that materializes a complete temporary `.qmd` tree
      and invokes Quarto against that tree.
- [x] Compose authored, woven-code, and graph-decoration source mappings and
      include authored/prepared content, adapter format, and bridge version in
      cache-key material.
- [x] Add transform/provider versions and project-level dependency inputs to
      Quarto freeze/cache keys.
- [x] Add pure render preparation that retains native chunk captions and
      generates `uses`, `used by`, definition links, and a chunk/dependency
      index from the resolved graph.
- [x] Keep a Lua filter optional: native listings and generated Markdown cover
      current HTML/PDF placement, so add a placement-only filter later only for
      a demonstrated output-format need.
- [x] Prevent Quarto execution and Ravel execution from both claiming the same
      cell. Filters and executed output may not declare new chunks after graph
      validation.
- [x] Add HTML and PDF render assertions plus a structured executable-cell
      failure mapped through temporary woven source to its authored definition.
- [ ] Add a real Jupyter or Knitr failure fixture when either runtime is
      available in the CI matrix; the host-level mapping contract is covered
      without requiring those runtimes locally.

Exit criteria:

- Static and executable Quarto examples show visible chunk names and working
  graph navigation, and executable code is woven before the native engine runs.

### D4. Implement AsciiDoc and HTML

- [x] Implement AsciiDoc section-owned and attributed-block forms using native
      section IDs, block titles, source languages, roles, custom attributes,
      cross-references, and `ravel` directive macros.
- [x] Support compact section-name pipelines and `lp-pipe` block attributes.
- [ ] Enable Asciidoctor source mapping and pair its block AST with lossless
      rescanning for metadata, block ends, literal bodies, inline references,
      pipelines, and included-file URIs.
- [x] Implement HTML section and figure forms using semantic elements,
      `data-ravel-*` metadata, visible headings/captions, `pre > code` fragments,
      native anchors, and explicit directive links.
- [x] Parse HTML without scripting, ignore runtime DOM mutation, and preserve
      source-to-value mappings while decoding character entities in code.
- [x] Add include/entity/Unicode/nesting fixtures and prove that neither
      adapter parses rendered HTML as a substitute for source structure.

Exit criteria:

- Equivalent AsciiDoc and HTML fixtures produce the shared conformance Ravel
  Map with exact source-linked diagnostics and no renderer execution.

### D5. Implement Org, noweb, and MyST

- [x] Implement Org `#+NAME`, `:noweb-ref` aggregation, `#+LP_NAME`,
      `#+LP_PIPE`, source languages, exact block bodies, and both Org-noweb and
      underscore-quote reference policies.
- [x] Preserve Babel header arguments, results, sessions, cache, execution, and
      tangling requests as metadata/effect plans. Require an explicit owner so
      Babel and Ravel cannot both execute or tangle the same block.
- [x] Support `<<name | pipeline>>` only under the configured extended Org
      reference policy and emit a portability diagnostic because unmodified
      Babel treats the pipe as part of the block ID.
- [x] Implement a small lossless noweb scanner for documentation chunks,
      `<<name>>=` definitions, repeated definitions, `<<name>>` references,
      `@` terminators, exact offsets, and configured/inferred languages.
- [x] Implement strict `noweb` and extended `noweb-plus` dialects. In
      `noweb-plus`, split definition and reference names at the first unescaped
      pipe; also support the classic-compatible Ravel pipeline pragma.
- [x] Implement canonical MyST `{ravel:piece}` with a `{piece}` alias,
      name-and-pipeline argument, language, caption, label, code body,
      cross-reference, and notebook-cell mapping.
- [x] Map MyST `{ravel}` bodies through the same graph-directive grammar as
      Markdown `ravel` fences.
- [x] Ship the separate `@pieceful/ravel-myst-plugin` renderer with visible
      captions and pipelines, native labels and cross references, optional
      MyST-owned code cells, and static rendering for Ravel-owned cells.
- [ ] Add native-tool compatibility fixtures showing which sources remain
      consumable by Org Babel, classic noweb, and a MyST renderer without a
      Ravel extension.

Exit criteria:

- Org and noweb repeated fragments, references, and pipelines normalize to the
  same Ravel Map as the Markdown fixture.
- MyST renders a visible, cross-referenceable chunk while emitting that same
  map.

## Workstream E: Explorer and VS Code integration

The complete task breakdown is maintained in the
[Explorer implementation plan](EXPLORER-TODO.md). Milestones 0 through 6 of
that plan are release-binding for 0.2. The experimental Composer milestone is
deferred beyond 0.2.

### E1. Establish the portable Explorer contract and browser UI

- [x] Add `@pieceful/ravel-explorer` as a portable ESM workspace package.
- [x] Define versioned snapshot, query, diff, edit, and
      host-message contracts.
- [ ] Project the public `RavelProgram` into deterministic, bounded document,
      chunk, transform, deliverable, provenance, trace, diagnostic, and change
      views.
- [ ] Implement focused ancestor, descendant, dependency-closure, path-between,
      search, grouping, folding, and aggregated boundary-edge queries.
- [ ] Render focused snapshots with Cytoscape.js and ELK, including compound
      groups, semantic zoom, minimap, keyboard controls, and a synchronized
      list/table view.
- [ ] Keep complete-project indexing separate from the visible graph and report
      truncation explicitly.
- [ ] Add deterministic fixtures and browser tests for greeting, proof of
      concept, FizzBuzz, and generated scale graphs.

Exit criteria:

- FizzBuzz produces a deterministic bounded Explorer snapshot and can be
  navigated in the browser harness without rendering the entire program.
- Folding preserves crossing-edge kinds and counts, and focused navigation is
  keyboard accessible.

### E2. Embed Explorer beside the normal VS Code editor

- [x] Add the initially private `@pieceful/ravel-vscode` extension package and
      register `Ravel: Open Explorer`.
- [ ] Discover direct inputs and nearest `ravel.toml` projects from the active
      editor, with explicit selection still required when discovery is
      ambiguous.
- [x] Open a content-security-policy-restricted webview beside the ordinary
      Markdown or Ravel Map editor.
- [x] Load authoritative project state through `host-node`, validate the
      implemented request payloads and revisions, and send only bounded
      Explorer projections.
- [ ] Synchronize graph selection with exact source reveal and editor selection
      without feedback loops.
- [ ] Publish diagnostics through VS Code and support progress, cancellation,
      output logging, and workspace-state perspective restoration.
- [ ] Add integration tests for project discovery, source reveal, selection,
      reload, cancellation, malformed messages, and changing documents.

Exit criteria:

- Selecting a graph entity reveals its exact source in the normal editor, and
  selecting source focuses the corresponding graph context.
- The webview has no unrestricted filesystem, command, shell, network, or
  transform capability.

### E3. Connect provenance, generated output, and trace

- [ ] Add read-only generated-output, derivation, provenance, and trace lenses.
- [ ] Map generated selections through `explainGeneratedOffset` and map source
      selections back to every generated occurrence.
- [ ] Expose stable parsed reference, pipeline, compose, alias, and emit
      introspection needed by the derivation view.
- [ ] Retain exact source ranges for individual definition-pipeline transforms
      and arguments across all 0.2 source adapters.
- [ ] Distinguish exact and coarse provenance visually and in available editing
      actions.
- [ ] Page or summarize large output, trace, and provenance data instead of
      embedding it in every snapshot.

Exit criteria:

- Selecting any meaningful FizzBuzz output region reveals the best source
  range, dependency path, and derivation chain.
- Coarse execution or transform provenance is never presented as exact
  character correspondence.

### E4. Preview and apply source-shaped edits

- [ ] Add a Node-host overlay abstraction so dirty project documents are
      evaluated before disk contents without writing artifacts.
- [ ] Debounce and cancel superseded previews while keeping the last valid
      snapshot visible when a candidate has diagnostics.
- [ ] Diff candidate and accepted revisions across nodes, edges, chunk values,
      outputs, provenance, traces, and diagnostics.
- [ ] Add source, graph, output, provenance, and diagnostic change views.
- [ ] Define and validate edit proposals with base revisions and document
      versions.
- [ ] Preview transform-argument changes, transform insertion/removal/reordering,
      authored reference changes, and exact `pipe`/`pass` changes.
- [ ] Show the proposed source rewrite and apply accepted changes as one
      undoable VS Code `WorkspaceEdit`.
- [ ] Reject stale, overlapping, out-of-project, coarse, or ambiguous edit
      proposals with a specific explanation.
- [ ] Prove that preview creates no deliverables, manifests, provenance
      sidecars, backups, or stale-output mutations.

Exit criteria:

- An unsaved FizzBuzz source edit updates the focused graph and output diff.
- A structured transform edit can be previewed, applied to canonical source,
  and undone normally in VS Code.

### E5. Add outline navigation and large-project hardening

- [ ] Add Markdown outline grouping as navigational metadata without changing
      chunk identity or dependency semantics.
- [ ] Add named perspectives, complete-project search indexes, paged aggregate
      queries, and stable layout adjustments.
- [ ] Add 1k, 10k, and 50k entity fixtures and set performance budgets for
      initial view, search, focus, layout, expansion, and preview.
- [ ] Profile host and webview memory independently and test cancellation under
      rapid edits.
- [ ] Complete keyboard, screen-reader, reduced-motion, workspace-trust,
      message-protocol, URI-normalization, and source-rendering audits.
- [ ] Test supported desktop platforms, remote workspaces, and multi-root
      workspaces.

Exit criteria:

- A 50k-entity underlying program remains searchable and produces responsive,
  bounded focused views without transporting or rendering the complete graph.
- Outline folding remains visibly and semantically distinct from the dependency
  graph.

## 0.2 release checklist

- [ ] The 0.1 static composition and build suites remain passing. `check` and
      `inspect` do not execute `.run`; `run` and `build` do so explicitly as
      part of their documented contracts.
- [ ] Modern Markdown, full LitPro Markdown, Quarto, AsciiDoc, HTML, Org,
      noweb, and MyST adapters pass the shared source-map and normalized-map
      conformance suite.
- [ ] Definition pipelines after chunk names behave identically across all 0.2
      adapters and run once after fragment concatenation.
- [x] The checked-in historical LitPro fixture subset passes under its
      declared dialect, including H1-H4 peers, H5/H6 paths, repeated headings,
      minor blocks, and legacy directives.
- [ ] Core plans and schedules execution through a language-neutral provider
      contract proven by a non-JavaScript conformance provider.
- [ ] Markdown recognizes `js`/`javascript` fences with `.run` without changing
      their highlighting language.
- [x] `@pieceful/ravel-js-live` runs QuickJS in WebAssembly behind a terminable
      worker boundary in Node and Chromium.
- [ ] JavaScript blocks require one final `export default` and correctly retain
      empty and falsy JSON values.
- [ ] Inputs and resources are copied, immutable, content-hashed, and unable to
      expose host paths or objects.
- [ ] No live block or transform can directly write host files; directives and
      hosts remain the only output authority.
- [ ] Time, memory, stack, output, resource, and scratch quotas have regression
      coverage.
- [ ] Result caching is deterministic and no live function, closure, or realm
      state survives a run.
- [ ] An approved npm-style transform module runs in QuickJS, and Pug resolves
      an include from the virtual filesystem without host filesystem access.
- [ ] Cancellation, stale state, diagnostics, trace, and cache inspection work
      through public APIs.
- [ ] `@pieceful/ravel-explorer` renders deterministic bounded graph,
      provenance, trace, and change views without Node or VS Code dependencies.
- [ ] `@pieceful/ravel-vscode` links Explorer selection bidirectionally with the
      normal source editor and restores workspace perspectives.
- [ ] Generated-output selections reveal their source and derivation while
      exact and coarse provenance remain visibly distinct.
- [ ] Dirty-buffer and structured transform edits preview without artifact
      writes, apply through one `WorkspaceEdit`, and participate in undo/redo.
- [ ] Focused Explorer views remain responsive against the 50k-entity scale
      fixture without transporting or rendering the complete graph.
- [ ] Documentation explains current guarantees, limitations, provider
      authoring, and the path to a future RiX provider.
- [ ] Clean installation, Node tests, browser tests, schema checks, and packed
      installation tests pass for the exact release artifacts.

## Explicitly deferred beyond 0.2

- A public RiX provider or additional production language providers.
- Arbitrary npm installation or execution requested by a document.
- Native Node addons and subprocess-backed transforms.
- General Node compatibility inside QuickJS.
- Network access from live code or transform modules.
- Direct host filesystem access from an executor.
- Persistent user-supplied QuickJS bytecode caches.
- Cross-run live closures, stateful notebook globals, or shared mutable realms.
- Character-precise provenance through arbitrary execution.
- Streaming, Arrow, shared-memory, or other non-JSON live values.
- Distributed or remote execution.
- Direct-manipulation Composer mode and arbitrary visual graph rewiring.
