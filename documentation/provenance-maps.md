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
| `origins` | Original input spans retained by a coarse transform, when applicable. |

For a nested substitution, `via` retains each authored reference. A leaf
inserted into a middle chunk and then a main chunk therefore records both
reference sites rather than only a flat dependency list.

The aggregate has `kind: "ravel-provenance-bundle"` and a deterministic `maps`
array containing complete sidecar objects. A consumer may use only the nearby
sidecar or load one build-level file without losing information.

## Exact and coarse mappings

Direct literal text and ordinary chunk substitutions preserve exact character
correspondence. Continuation indentation and the built-in `indent` transform
retain exact spans for original characters and mark only inserted padding
coarse. `trim`, `dedent`, and `concat` preserve exact spans for surviving
characters. Greedy Markdown chunks retain separate spans for their
non-contiguous fenced fragments.

An arbitrary transform is allowed to reorder, remove, or synthesize text.
Ravel consequently emits a coarse segment for its output, identifies the
transform site, and retains its contributing `origins` instead of inventing a
character-exact relationship. Synthesized composition newlines are likewise
coarse. A future custom-transform protocol may let external transforms return
their own precise segment maps.

This distinction is also the safety boundary for eventual bidirectional
editing: an editor can offer exact navigation or editing for exact segments and
warn or decline when the selected text crosses a coarse segment.

## JavaScript queries

`@pieceful/ravel-core` exports:

```js
import {
  createBuildProvenanceMap,
  createDeliverableProvenanceMap,
  explainGeneratedOffset,
  generatedRangesForSource,
  generatedRangesForSourceRange,
  sourceAtGeneratedOffset
} from "@pieceful/ravel-core";
```

`sourceAtGeneratedOffset(map, offset)` returns the containing segment. It also
returns `sourceOffset` when correspondence is exact.

`generatedRangesForSource(map, uri, offset)` returns every corresponding range
in that deliverable. Reused chunks may produce several results. Exact results
include `generatedOffset`; coarse results expose only the containing generated
range. `generatedRangesForSourceRange` performs the same lookup for a half-open
source range and clips exact generated ranges to the overlap.

`explainGeneratedOffset(program, deliverable, offset)` adds the contributing
definition, authored reference steps, and dependency path to a forward lookup.
Reverse queries also search retained transform origins, returning an honest
coarse result when character correspondence was destroyed.

The constructors are useful for in-memory hosts. The Node host uses the same
functions to serialize sidecars and the aggregate bundle.

## CLI queries

Inspect a generated position directly from the source project:

```sh
ravel inspect ravel.toml \
  --provenance dist/program.js \
  --generated-offset 218
```

Run the reverse lookup with the URI and UTF-16 offset reported in a map:

```sh
ravel inspect ravel.toml \
  --provenance dist/program.js \
  --source-uri guide.md \
  --source-offset 84
```

Add `--json` for the complete segment, definition, references, dependency path,
or reverse matches.

## Current boundary

Version 1 now supplies level-2 coverage across every evaluator path, level-3
source detail through ordinary composition and mapping-aware built-ins, and
exact forward/reverse navigation for unchanged characters. This is the useful
navigation subset of level 4. Editing generated content back into source and a
precise-map return protocol for external transforms remain post-0.1 work.
