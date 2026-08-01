# Migrating FizzBuzz-era Ravel material

Ravel 0.2 preserves the useful static composition ideas from the predecessor:
named chunks, narrative source order, cross-document references, variants,
pipes, and declared outputs. It adds bounded, explicit live JavaScript
execution, but deliberately does not preserve the predecessor as a runtime or
a compatibility parser.

The runnable reference migration is [the FizzBuzz example](../examples/migration/README.md).
It exercises Markdown extraction, imports, greedy fenced fragments, `create`,
`alias`, `pipe`, `pass`, `emit`, multiple outputs, manifests, and provenance.

## Concept mapping

| Earlier idea | Ravel 0.2 equivalent |
| --- | --- |
| named code piece | a named `.ravel` Markdown fence with an explicit identity |
| cross-document piece | a fully qualified `document::chunk.minor.type` reference |
| variant/minor | the `:minor` part of a chunk address or `emit("minor.type")` |
| language/type | the `.type` part of a chunk address |
| chained transform | a definition pipeline or a reference pipeline such as `|trim()` |
| derived named result | `emit` in `pipe` or `pass` |
| source file to write | `out("path", _"chunk.type")` or a TOML `[[outputs]]` entry |
| project run configuration | `ravel.toml` with `[[files]]` and `[build]` |

## Recommended conversion order

1. Put one document at a time into explicit named Ravel fences.
2. Give every reusable chunk a stable document, chunk, minor, and type address.
3. Replace implicit output conventions with `out` directives or TOML outputs.
4. Replace any dynamic operation with a static composition equivalent where one
   exists, then use `ravel check` before building.
5. Compare generated output and inspect the sidecar `.ravelmap` before retiring
   the old workflow.

## Intentionally absent in 0.2

There is no legacy parser, shell or network directive, mutable global scope,
implicit persistent cache, watch mode, structured editor round-trip editing,
parameter binding, conditional profile, or automatic compatibility treatment of
old headings and links. Those omissions keep the graph deterministic,
auditable, and safe to run in CI. A legacy source that depends on any of them
must be rewritten or kept on its predecessor runtime.

Ravel 0.2 also does not promise character-exact provenance through an arbitrary
transform. Its maps distinguish exact preserved text from coarse transform
attribution; that is a correctness boundary, not missing metadata.
