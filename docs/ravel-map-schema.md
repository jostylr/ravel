# Ravel Map schema guide

## Purpose

A Ravel Map is the JSON contract between a format/profile adapter and Ravel core.
It says what chunks a source document contains, where they came from, and which
structural declarations/effects the adapter found. It does not parse the language
inside a chunk body; the chunk parser does that.

    Markdown profile ─┐
    AsciiDoc profile ─┼→ Ravel Map → Ravel core
    Rix block model ──┘

## Canonical shape

    {
      "version": 1,
      "document": {
        "id": "greeting",
        "uri": "file:///project/greeting.md",
        "format": "markdown+ravel-v1"
      },
      "chunks": [
        {
          "id": "main",
          "name": "Main program",
          "body": "console.log(_\"format-greeting\");\n",
          "definitionPipeline": [],
          "metadata": { "language": "javascript", "tags": ["entrypoint"] },
          "source": { "uri": "file:///project/greeting.md", "range": "…" }
        }
      ],
      "directives": []
    }

The canonical interchange form uses objects rather than positional arrays. The
original tuple idea—name, pipeline, body, metadata, position—is the right
information, but object keys make schema evolution and diagnostics safer. A
compact tuple encoding can later be a cache/transport optimization without
becoming the public contract.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| version | yes | Positive integer schema version. |
| document | yes | Source identity and adapter format/profile. |
| chunks | yes | Ordered source chunks; order preserves narrative provenance. |
| directives | no | Adapter-discovered structural/effect declarations. |
| metadata | no | Document-level adapter metadata. |

## Chunk fields

| Field | Required | Meaning |
| --- | --- | --- |
| id | yes | Stable piece ID, unique within the map. |
| name | no | Human-facing display label. |
| body | yes | Raw chunk text for the Ravel chunk parser. |
| definitionPipeline | no | Transform calls declared by the adapter/profile. |
| metadata.language | no | Language/display hint; never executable by itself. |
| metadata.tags | no | Labels for hosts, searches, and profiles. |
| metadata.data | no | JSON data owned by a profile/plugin namespace. |
| source | yes | URI and inclusive/exclusive source range. |
| fragments | no | Fine-grained source ranges if a chunk joins multiple regions. |

Body is intentionally raw. The map can be inspected, saved, diffed, or created
by an editor without implementing composition syntax.

## Chunks emitted from pipes

The map is the input to chunk parsing, not the result of it. A body expression
may use the core `emit` pipe step to declare a derived chunk. The parser records
that declaration, then the graph-expansion phase adds a generated chunk to the
Ravel Program. The generated chunk has the normal chunk fields plus provenance
pointing to the emitting expression.

This is deliberately not an adapter concern and is not written back into the
source map. A Markdown, AsciiDoc, or Rix adapter only needs to preserve the raw
body and its range; it does not need to recognize `emit`.

## Directives

Directives are separate because they often declare a graph edge or effect rather
than contribute text. Examples include derive, rewrite, write, read, fetch, and
execute. A directive records its kind, source range, optional from piece,
optional target, arguments, and metadata.

An adapter may emit a directive core does not recognize; core reports an
actionable diagnostic rather than executing or silently ignoring it.

## Positions and errors

Positions are zero-based line, column, and UTF-16 offset values. Ranges start
inclusively and end exclusively. UTF-16 offsets align with JavaScript,
TypeScript, Monaco, and LSP conventions. The chunk parser later adds ranges for
references and transforms inside body.

## Profiles are adapter policy

The document format identifies the profile that produced the map. For example,
markdown+ravel-v1 may require explicit chunk attributes, while
markdown+litpro-compat-v1 may interpret heading depth and old link conventions.
Both produce this schema. H5/H6-as-child-block is profile policy, not a Ravel
core rule.

## Versioning

Version changes only for incompatible map-shape changes. Optional namespaced
metadata is the preferred extension mechanism. Adapters reject map versions they
cannot understand rather than guessing semantics.

See the machine-readable schema in schemas/ravel-map.schema.json and the
example in examples/greeting.ravel-map.json.
