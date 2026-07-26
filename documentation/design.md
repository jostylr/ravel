# Ravel design plan

## Product definition

Ravel makes a program both weaveable and explainable. A source-format adapter
extracts chunks into a Ravel Map. The core parses composition syntax inside
chunks, resolves a deterministic graph, produces diagnostics and provenance, and
plans effects. Hosts decide whether to perform effects and how to render output.

    source text or editor blocks
      → adapter plus profile
      → Ravel Map
  → core syntax, graph expansion, diagnostics
      → Ravel Program
      → CLI, Rix, notebook, or service host

## The key separation

There are two syntaxes, with a stable JSON boundary between them.

1. Format-to-map syntax describes how Markdown, AsciiDoc, or a notebook
   identifies chunks. This is adapter/profile policy. A classic Litpro Markdown
   profile may give H5/H6 headings special meaning; standard Markdown need not.
2. Chunk syntax describes references and use-site transformation pipelines
   inside chunk bodies. This is Ravel core language syntax.

The core never needs to know whether a chunk came from a heading, a fence, an
AsciiDoc listing, or a Rix visual block.

The proposed source-format conventions, including modern and legacy Markdown,
Quarto, AsciiDoc, HTML, Org, noweb, and MyST, are specified in the
[markup adapter design](markup-adapters-design.md).

An `emit` step in chunk syntax is a controlled graph-expansion macro. It creates
an immutable derived chunk definition from the preceding reference/pipeline;
it is expanded before graph resolution and is not an I/O effect. This gives
pipelines the ability to name useful intermediate results without making
format adapters or filesystem hosts responsible for the feature.

## Package boundaries

| Package | Responsibility | Must not depend on |
| --- | --- | --- |
| map | Ravel Map types, schema, and validation | Node, editors, format parsers |
| core | chunk parser, resolver, graph evaluator, diagnostics | Node filesystem, Markdown parser |
| markdown | Markdown profiles and extraction | Node-only host APIs |
| host-node | filesystem, cache, and effect capabilities | Markdown-specific policy |
| cli | command parsing and presentation | direct compiler internals |
| explorer (proposed) | portable focused graph projections, provenance/change UI, and host protocol | Node filesystem, VS Code APIs |
| vscode (proposed) | VS Code webview host, source synchronization, preview overlays, and WorkspaceEdit | compiler internals bypassing public package contracts |

Potential post-0.1 packages include notebook, LSP, trace, and format adapters
such as AsciiDoc. The proposed Explorer and its VS Code integration are specified in
[the Explorer design](explorer-design.md).

## Runtime support

Ravel is compatible with Node without being Node-shaped. The portable package
set—map, core, and eventually browser-safe adapters—targets standard ESM and
Web Platform APIs and must run in modern browsers, Bun, and supported Node.
Node-only capabilities live in host-node; the CLI is consequently Node-only.

| Runtime | Supported packages | Intended role |
| --- | --- | --- |
| Modern browser | map, core, Markdown adapter | web embedding and editor hosts |
| Bun | map, core, Markdown adapter | portable conformance and scripting |
| Node 22+ | all portable packages plus host-node and cli | CLI builds and filesystem effects |

Portable code must not import node-prefixed modules, use process or Buffer,
assume a filesystem, or rely on CommonJS. It may use ESM, URL, TextEncoder,
crypto APIs supported by the target matrix, AbortSignal, and Web Streams where
needed. Any exception requires a host adapter.

## Core invariants

- Maps, syntax trees, and graph snapshots are immutable.
- Every semantic item has a source range; diagnostics include related ranges.
- References and transforms resolve explicitly and deterministically.
- A chunk identity always carries explicit `document`, `chunk`, `minor`, and
  `type` components; its canonical address preserves null components through
  omission syntax such as `doc::`, `doc::.type`, and `doc:::minor.type`.
- Pure computation is cacheable; effects are planned separately and require
  host capabilities.
- AbortSignal is part of long-running operations for editor use.
- The core does not log to the console. Optional trace sinks observe runs.
- The core does not evaluate document JavaScript or shell commands by default.

## Initial vertical slice

1. Build map types, JSON Schema, example map, and validation.
2. Parse literal chunks and underscore-quote references; report unknown
   references and cycles with exact ranges.
3. Create one explicit Markdown profile that produces a Ravel Map without
   performing effects.
4. Add a Node host and CLI to inspect maps, print graph/diagnostics, and plan a
   write artifact. Writing remains opt-in.
5. Add new map/syntax fixtures and selected historical Litpro fixtures.
6. Run portable regression coverage through Node, Bun, and the Chromium browser
   harness before declaring an API portable.

The first proof of concept is now implemented: an `in` directive recursively
loads and joins Ravel Maps, the core parses references and pipelines, `emit`
expands derived chunks, `out` creates a deliverables map, and the Node CLI can
write those deliverables below an explicit output directory. The first Markdown
adapter now extracts explicitly named, source-mapped fenced chunks and TOML can
assemble multiple Markdown documents into one run.

## Ravel modes

| Mode | Purpose |
| --- | --- |
| Build | Deterministically assemble named pieces into artifacts. |
| Inspect | Show pieces, references, graph, provenance, and diagnostics. |
| Trace | Show timing, cache state, transforms, and effect plans. |
| Notebook | Retain cell execution/output state while sharing the graph. |

## Deferred work

Definition-time pipeline staging and host-supplied transforms now have an
initial implementation. Definition-time graph emission, capability-gated
effects, legacy Markdown compatibility, incremental maps and
Rix/LSP integration, parameterized pieces, and typed build profiles all follow
the vertical slice. Each becomes core syntax only after its source ranges,
diagnostics, cache key, and host-security behavior are specified.
