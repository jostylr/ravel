# Ravel 0.1 implementation plan

## Release definition

Ravel 0.1 is a dependable static literate-programming release. A new user must
be able to install it from a clean checkout, validate a Markdown or Ravel Map
project, build declared artifacts safely, receive useful source-linked errors,
inspect the dependency graph, and trace generated output back to its source.

The existing syntax is sufficient for this milestone. Work should favor
validation, public contracts, diagnostics, provenance, reproducibility, and
release engineering over additional language features.

## Current baseline

The following vertical slice is implemented and should remain passing while the
0.1 work proceeds:

- [x] Markdown fenced-chunk extraction with source ranges, front matter,
      opt-in/primary modes, tags, explicit identities, and greedy fragments.
- [x] Canonical document/chunk/minor/type identities and local, global, and
      cross-document resolution.
- [x] Literal/reference parsing, built-in transforms, definition pipelines,
      delayed substitutions, and generated chunks through `emit`.
- [x] Portable directive IR and Markdown directive parsing for `in`, `out`,
      `create`, `alias`, `compose`, `append`, `newline`, `pipe`, and `pass`.
- [x] Forward-reference settling, deterministic cycle detection, and
      source-linked core diagnostics.
- [x] JSON-map and Markdown imports, multi-file TOML runs, deliverable planning,
      and Node filesystem writes.
- [x] Filesystem-root containment, traversal rejection, and symlink rejection.
- [x] Runnable legacy FizzBuzz migration covering the full static build path.
- [x] Automated Node and Bun test suites, plus browser harnesses that can be
      bundled manually.

## 0.1 scope decisions

These decisions should be recorded before public APIs are frozen:

- [x] Confirm the supported runtime floor. The current proposal is Node 22+,
      current Bun for portable-package conformance, and current evergreen browsers.
      : Yes, node 22, bun, and current browsers
- [x] Decide which packages are public in 0.1. The recommended set is
      `@pieceful/ravel-map`, `@pieceful/ravel-core`, `@pieceful/ravel-markdown`,
      `@pieceful/ravel-host-node`, and the `@pieceful/ravel` CLI, even if they
      ship from one repository and share a version.
      : Fine split; the public names are @pieceful/ravel-..., with the CLI as
      @pieceful/ravel.
- [x] Define compatibility policy: Ravel Map version 1 and the documented
      Markdown fenced profile are the 0.1 contracts; undocumented internal object
      shapes are not.
      : Sounds good
- [x] Decide whether 0.1 is published to a registry or distributed from the
      repository. In either case, installation and package imports must behave like
      a release rather than requiring internal source paths.
      : They will be published on npm. They need to be set up to do so.
- [x] State that plugins, extra adapters, notebooks, editor integration,
      execution, parameters, conditional profiles, and incremental builds are
      post-0.1 work.

Exit criteria:

- The README and package metadata state one consistent product scope and
  runtime matrix.
- A short compatibility policy identifies the stable map, syntax, CLI, and API
  surfaces.

## Phase 1: public packages and executable

Make every advertised package real and consumable before adding new behavior.

- [x] Implement `packages/map/src/index.js` as the public home of Ravel Map
      version constants, validation entry points, and shared diagnostic helpers.
- [x] Add `exports` to every public package and stop relying on imports such as
      `../../core/src/index.js` across package boundaries.
- [x] Add an installed `ravel` executable through a package `bin` entry.
- [x] Add root development scripts that invoke the same public entry points a
      consumer will use.
- [ ] Publish JavaScript API documentation and either generated `.d.ts` files,
      checked JavaScript declarations, or a deliberate TypeScript source/build
      setup. Public map, program, source-range, diagnostic, transform, and host
      types must be representable without reading implementation code.
- [x] Remove `private` only from packages intended for distribution; retain it
      for repository-only packages.
- [ ] Replace placeholder `0.0.0` metadata with the chosen pre-release/version
      policy and add license, repository, engines, files, and keywords metadata.
- [x] Add package smoke tests that pack all public workspaces, install only the
      tarballs into a fresh temporary project, import every public package by
      name, and run `ravel --help`, `ravel --version`, and a minimal build through
      the installed binary (`npm run test:pack`).
- [ ] Verify the packed artifact contents so examples, schemas, entry points,
      declarations, and licenses are present while tests and local run outputs are
      excluded as intended.

Exit criteria:

```sh
npm ci
node -e 'import("@pieceful/ravel-core").then(console.log)'
npx ravel --help
npm test
```

must work from a clean checkout or an installation of the packed artifacts,
without importing a `src/` path.

## Phase 2: authoritative input validation

No malformed or unsupported map should reach graph evaluation as trusted data.

- [x] Implement the initial dependency-free structural Ravel Map validator with
      explicit tests. The current example-only checker is no longer the runtime
      validation boundary; a complete JSON Schema 2020-12 validator remains for
      a later pass.
- [x] Ship the checked-in Ravel Map schema through `@pieceful/ravel-map` as
      `RAVEL_MAP_SCHEMA` and the `@pieceful/ravel-map/schema` JSON entry point;
      the map-contract test checks the published artifact remains identical to
      the repository schema.
- [x] Validate every JSON Ravel Map at the Node host boundary before following
      its directives or combining its chunks.
- [x] Validate adapter-produced Markdown maps in the Node host path so adapter bugs
      fail at the same contract boundary.
- [x] Reject unsupported map versions instead of normalizing them to version 1.
- [x] Validate canonical IDs against their explicit identity components,
      document identity, directives, source ranges, metadata, and unknown fields.
- [x] Convert JSON parse, schema, TOML, configuration, and unsupported-input
      failures into the shared diagnostic model rather than exposing raw exceptions
      to CLI users. The host reports RM201, RC101/RC102, and RH101/RH102 source
      diagnostics; map-shape validation retains its RM200 diagnostics.
- [x] Give configuration diagnostics precise TOML locations where the parser
      makes them available; otherwise report the configuration file and field path.
      `smol-toml` does not expose field ranges, so RC diagnostics point to the
      configuration file and name the invalid field path.
- [x] Expand validation regression coverage beyond version, ID, identity, and
      body cases: malformed source ranges, unsupported/missing directive fields,
      duplicate documents, and unsupported configuration keys now have portable
      map/core/host tests.
- [ ] Keep validation usable in browsers and Bun; Node path and file checks stay
      in `host-node`.

Exit criteria:

- Every JSON or adapter-produced map is validated before graph evaluation.
- Invalid input produces stable diagnostic codes and nonzero CLI status without
  an implementation stack trace.
- The map schema examples and invalid-fixture suite run in Node, Bun, and the
  browser conformance harness where portable.

## Phase 3: release-quality CLI and diagnostics

Turn the current development entry point into a small, predictable interface.

- [x] Add `ravel check <input>` to parse, validate, resolve, and report errors
      without writing deliverables.
- [x] Retain `ravel build` for authorized writes and make its destination and
      planned outputs visible before or during the build summary.
- [x] Refine `ravel inspect` into focused `--chunks`, `--graph`, and `--trace`
      views; keep the complete program dump as the default for machine-oriented
      inspection.
- [x] Add `--dry-run` to show the output/effect plan without writing.
- [x] Add `--json` for stable machine-readable diagnostics and command results.
- [x] Render default diagnostics as
      `path:line:column severity[code]: message`, followed by related source ranges
      and dependency/cycle context where useful.
- [x] Implement conventional `--help` and `--version` success behavior.
- [x] Reject unknown flags, missing flag values, conflicting input forms, and
      extra positional arguments with concise usage diagnostics.
- [x] Define exit codes for success, source/configuration errors, and unexpected
      internal failures.
- [x] Ensure expected user errors never print JavaScript stack traces unless a
      debug flag is explicitly requested.
- [x] Add CLI integration tests covering direct Markdown, direct JSON maps,
      TOML projects, clean checks, failed checks, dry runs, graph output, and writes.

Exit criteria:

- A user can discover, validate, inspect, dry-run, and build a project without
  knowing repository internals.
- Human output is concise and source-oriented; JSON output is stable enough for
  editor, CI, and agent consumers.

## Phase 4: generated-output provenance

Complete Ravel's central promise that an artifact can be explained in terms of
its literate source.

- [ ] Specify a Ravel generated-source-map version 1 format. At minimum it must
      map generated UTF-16 ranges to source URI/ranges and identify the contributing
      chunk, reference, transform/compose step, and derivation chain.
- [ ] Preserve fragment-level provenance while joining greedy chunks.
- [ ] Propagate output spans through literals, substitutions, continuation
      indentation, composition newlines, aliases, definition transforms, use-site
      transforms, `pipe`, `pass`, delayed substitution, and `emit`.
- [ ] Define honest mapping behavior for transforms that cannot provide precise
      character correspondence. Such transforms should retain coarse input/output
      provenance rather than inventing exact mappings.
- [ ] Make deliverable provenance transitive instead of containing only the
      final chunk's origin and a flat dependency list.
- [ ] Add an optional sidecar output for each deliverable or a build-level map
      referenced from the output manifest.
- [ ] Expose provenance queries in the public API: generated position to source,
      source range to generated ranges, definition, references, and dependency
      path.
- [ ] Add golden tests for direct literals, nested references, indentation,
      greedy fragments, aliases, derived chunks, compose operations, and transformed
      content.

Exit criteria:

- Given a generated offset, the API and inspect command can identify the best
  available original source range and the chain that produced it.
- The FizzBuzz deliverable has a checked-in expected provenance map covering
  all meaningful generated regions.

## Phase 5: deterministic and safe artifact lifecycle

Make repeated builds predictable and prevent successful builds from leaving
ambiguous output state.

- [x] Define a stable ordering for documents, chunks, diagnostics, references,
      deliverables, trace entries, and serialized graph keys.
- [x] Store project-relative or root-relative source URIs in persisted build
      artifacts where possible; do not make graphs differ solely because a checkout
      moved to another absolute directory. The Node host redacts absolute URIs
      outside its declared root as `<external>/<basename>`.
- [x] Replace random automatic delay placeholders with deterministic,
      collision-checked tokens derived from stable chunk/expression identity.
- [x] Add machine-readable and human-readable build manifests with Ravel
      version, output paths, source chunks, content hashes, build result, and
      dated stale-output records. Input identities and provenance-map paths
      remain to be added with the provenance work.
- [x] Write files atomically through a temporary sibling followed by rename,
      while retaining the existing containment and symlink protections.
- [x] Detect conflicting deliverables before writing any output.
- [x] Decide and document stale-output behavior: report files from the preceding
      manifest that are absent from the current plan, retain them by default,
      remove all manifest-tracked outputs only with `build --clean`, or remove
      stale entries only with the explicit `refresh` command. Before either a
      normal replacement or `--clean`, `build --backup [file.zip]` can archive
      the complete existing output tree as a no-overwrite ZIP; an omitted name
      is rooted at `backups/` and derived from the prior manifest build time.
- [x] Do not partially commit a build when validation or graph evaluation has
      errors. The CLI evaluates before writing, then atomically commits all
      deliverables and the success manifest with rollback on filesystem failure.
- [x] Add repeatability tests that build the same project in different temporary
      roots and compare normalized program graphs, manifests, diagnostics, and
      deliverable bytes.

Exit criteria:

- Two clean builds of identical inputs produce byte-identical deliverables and
  normalized metadata.
- A failed build neither writes new deliverables nor silently leaves the build
  manifest claiming success.
- Stale output is visible and governed by an explicit policy.

## Phase 6: conformance, CI, and release verification

Make the support matrix a continuously checked property rather than a design
statement.

- [ ] Create shared data-driven conformance fixtures for map validation, syntax,
      graph evaluation, diagnostics, provenance, and deterministic serialization.
- [ ] Run the full portable fixture set under Node and Bun.
- [ ] Automate the existing browser runtime and Markdown-adapter harnesses in a
      real Chromium-class browser.
- [ ] Add at least a periodic Firefox and WebKit-class run, or narrow the 0.1
      browser claim explicitly if those environments are not maintained.
- [x] Add CI jobs for clean `npm ci`, Node tests, Bun tests, schema validation,
      browser-bundle construction, package smoke tests, and packed-artifact
      inspection. Browser conformance execution remains a separate item below.
- [ ] Add regression tests for every new validation and CLI diagnostic.
- [x] Add one second nontrivial static example, distinct from FizzBuzz, that
      exercises multi-file composition and multiple deliverables without relying on
      external transforms. The 50-chunk benchmark also exercises nested imports,
      directives, derived chunks, and a runnable multi-output build.
- [x] Establish a small performance baseline for parsing and building a
      representative project. A strict optimizer or cache is not required for 0.1,
      but obvious accidental quadratic behavior should be caught. Run
      `npm run benchmark:assembly` for repeated load-and-evaluate measurements.
- [ ] Test supported Windows path behavior in CI or explicitly scope 0.1 to the
      operating systems actually verified.

Exit criteria:

- All claimed runtimes and operating systems are represented by automated
  checks.
- A clean checkout and a packed installation pass the same end-to-end examples.
- The release checklist can be run without unrecorded local setup.

## Phase 7: documentation and 0.1 release

- [x] Write a five-minute getting-started guide using the installed `ravel`
      command rather than source paths (`docs/getting-started.md`).
- [ ] Update all reference documents so they distinguish implemented 0.1
      behavior from future design.
- [ ] Document map, syntax, CLI, configuration, diagnostics, provenance-map, and
      manifest versioning.
- [ ] Add a cookbook for single-document builds, multi-document TOML projects,
      reusable libraries, derived chunks, generated variants, and CI checks.
- [ ] Document filesystem trust boundaries, symlink policy, output authorization,
      and why code/shell evaluation is absent from the static core.
- [ ] Write a migration note for the supported FizzBuzz-era concepts and list
      legacy constructs that intentionally have no 0.1 equivalent.
- [ ] Add `CHANGELOG.md`, contribution instructions, a code of conduct if public
      contribution is expected, and a release checklist.
- [ ] Confirm license files and attribution for every published package and
      migrated fixture.
- [ ] Run the complete release suite against the exact packed artifacts.
- [ ] Tag 0.1 only after every preceding phase's exit criteria pass.

## 0.1 release checklist

- [ ] Clean installation succeeds on every supported environment.
- [ ] Public package imports and the installed CLI work without `src/` paths.
- [ ] All map/config inputs are validated before evaluation.
- [ ] `check`, `inspect`, `build`, dry-run, human diagnostics, and JSON output
      have end-to-end tests.
- [ ] Generated artifacts have inspectable transitive provenance/source maps.
- [ ] Builds are deterministic across directories and do not partially write on
      source errors.
- [ ] Output manifests and stale-output policy are documented and tested.
- [ ] Node, Bun, browser, schema, package, and example suites pass in CI.
- [ ] README, reference docs, examples, package metadata, and changelog describe
      the released behavior accurately.
- [ ] The FizzBuzz migration and the second representative example build and run
      from the packed release.

## Explicitly deferred until after 0.1

The following work may be valuable, but it must not delay a dependable static
release:

- plugin discovery, installation, and version negotiation;
- language-specific compilers, formatters, bundlers, linters, and minifiers;
- AsciiDoc and additional text-format adapters;
- legacy heading/link compatibility profiles beyond documented migrations;
- watch mode, persistent caching, and incremental graph updates;
- LSP/editor navigation, refactoring, and generated-output preview;
- Rix and notebook cells, execution state, kernels, and stale-output tracking;
- capability-gated shell, network, fetch, and code execution;
- parameters, templates with bindings, conditionals, and typed build profiles;
- documentation rendering with chunk indexes and cross-reference navigation; and
- distributed or remote build execution.

After 0.1, prioritize these from demonstrated workflows rather than expanding
the core language speculatively.
