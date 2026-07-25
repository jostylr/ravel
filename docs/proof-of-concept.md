# First graph and chunk-processing proof of concept

This vertical slice implements the first executable Ravel path:

    input Ravel Maps
      → in directives merge a pretransform graph
      → parse chunk references and pipeline steps
      → expand emit steps into derived chunks
      → resolve and evaluate completed chunks
      → out directives produce a deliverables map
      → Node host writes deliverables below an output directory

## Input maps and the pretransform graph

An `in` directive loads another map relative to the current input map. Imported
maps are visited first, so the resulting pretransform graph retains all source
documents, chunks, directives, and source ranges. Canonical chunk IDs include
their document where applicable, so `library::greeting` and
`project::greeting` can coexist; exact duplicate IDs are diagnostics.

    {
      "kind": "in",
      "target": "library.ravel-map.json",
      "source": { "uri": "project.ravel-map.json", "range": "..." }
    }

This is intentionally a graph join rather than textual inclusion. The imported
chunk retains its document identity and source provenance.

## Emitted derived chunks

An expression may name an intermediate result with `emit`:

    _`library::greeting | dedent() | emit('browser', {
      "name": "Browser greeting",
      "language": "javascript",
      "tags": ["generated"]
    })`

Inside `project::greeting`, the parser adds immutable
`project::greeting:browser` to the transformed graph. Its definition references
`library::greeting` through the pipeline before `emit`; it does not
copy a computed string at expansion time. The expression itself continues with
the same incoming value, making emit a pipeline tee.

Each completed chunk records:

- its final `value`;
- direct `dependencies` and source-linked `references`;
- source or emit `provenance`;
- whether it was `generated` by emit;
- metadata such as language and tags.

## Deliverables

An `out` directive turns a completed chunk into a named deliverable:

    {
      "kind": "out",
      "name": "dist/greeting.js",
      "from": "project::main",
      "source": { "uri": "project.ravel-map.json", "range": "..." }
    }

The transformed Ravel Program exposes a `deliverables` object keyed by `name`.
Each value contains the completed content, source chunk ID, dependencies, and
provenance. The core does not write a file; the Node host does so only when the
CLI receives an output directory.

## Run the example

From the repository root:

    node packages/cli/src/index.js build examples/poc/project.ravel-map.json \
      --out-dir .ravel/runs/poc \
      --graph .ravel/runs/poc/program.json

The command loads `library.ravel-map.json`, produces `project::main`,
`library::greeting`, and emitted `project::greeting:browser` chunks, then writes:

    .ravel/runs/poc/dist/greeting.js
    .ravel/runs/poc/generated/greeting.js
    .ravel/runs/poc/program.json

The run directory is ignored by Git. Inspect `program.json` to see the
completed transformed graph and deliverables map.

## Current intentional limits

- only literal chunks, references, and the small built-in transform set exist;
- `emit` metadata must be a static JSON object and emitted IDs are globally unique;
- only `in` and `out` directives have host behavior;
- maps currently load from local files in the Node host;
- Markdown body ranges and generated provenance maps preserve exact UTF-16
  offsets for direct source text and substitutions; transforms that alter text
  are represented as intentionally coarse attribution.
