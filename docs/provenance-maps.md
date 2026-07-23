# Generated-output provenance maps

Ravel records how generated text relates to its literate sources. A successful
managed build writes two equivalent views:

- `<deliverable>.ravelmap` is the sidecar for one generated file.
- `.ravelmap` is the build bundle and embeds every sidecar map.

The version-2 output manifest identifies the aggregate map in `provenance` and
the corresponding sidecar in each deliverable entry. These are managed build
artifacts: backups include them, `--clean` removes them, and stale deliverables
retain their sidecars until `ravel refresh` removes both.

## Version 1 shape

A sidecar has this top-level shape:

```json
{
  "version": 1,
  "kind": "ravel-provenance-map",
  "generated": {
    "uri": "dist/program.js",
    "length": 42,
    "offsetEncoding": "utf-16"
  },
  "from": "guide::program.javascript",
  "segments": []
}
```

`generated.start` and `generated.end` in each segment are a half-open range in
UTF-16 code units. This is the indexing used by JavaScript strings and by many
editor protocols. A segment contains:

| Field | Meaning |
| --- | --- |
| `generated` | Half-open range in the generated deliverable. |
| `source` | Original relative URI and source range, or `null` for content with no source. |
| `chunk` | The chunk whose content contributed this range. |
| `kind` | The operation represented by the segment, such as `literal`, `transform`, or `compose-newline`. |
| `precision` | `exact` when character offsets correspond, otherwise `coarse`. |
| `via` | Ordered derivation steps from the contributing chunk toward the deliverable. |

For a nested substitution, `via` retains each authored reference. A leaf
inserted into a middle chunk and then a main chunk therefore records both
reference sites rather than only a flat dependency list.

The aggregate has `kind: "ravel-provenance-bundle"` and a deterministic `maps`
array containing complete sidecar objects. A consumer may use only the nearby
sidecar or load one build-level file without losing information.

## Exact and coarse mappings

Direct literal text and ordinary, non-indented chunk substitutions preserve
exact character correspondence. Greedy Markdown chunks retain separate spans
for their non-contiguous fenced fragments. The forward query can therefore
calculate the precise source offset, and the reverse query can calculate the
precise generated offset.

An arbitrary transform is allowed to reorder, remove, or synthesize text.
Ravel consequently emits a coarse segment for its output and identifies the
transform site instead of inventing a character-exact relationship. Automatic
continuation indentation and synthesized composition newlines currently follow
the same conservative rule. A future transform protocol may let a transform
return its own precise segment map.

This distinction is also the safety boundary for eventual bidirectional
editing: an editor can offer exact navigation or editing for exact segments and
warn or decline when the selected text crosses a coarse segment.

## JavaScript queries

`@pieceful/ravel-core` exports:

```js
import {
  createBuildProvenanceMap,
  createDeliverableProvenanceMap,
  generatedRangesForSource,
  sourceAtGeneratedOffset
} from "@pieceful/ravel-core";
```

`sourceAtGeneratedOffset(map, offset)` returns the containing segment. It also
returns `sourceOffset` when correspondence is exact.

`generatedRangesForSource(map, uri, offset)` returns every corresponding range
in that deliverable. Reused chunks may produce several results. Exact results
include `generatedOffset`; coarse results expose only the containing generated
range.

The constructors are useful for in-memory hosts. The Node host uses the same
functions to serialize sidecars and the aggregate bundle.

## Current boundary

Version 1 establishes useful level-2 provenance and level-3 detail for direct
substitution, with a small exact reverse lookup as the beginning of level 4.
Remaining work includes more precise indentation mapping, provenance supplied
by mapping-aware transforms, CLI position queries, and broader golden coverage.
