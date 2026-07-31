# `@pieceful/ravel-projection`

Browser-safe virtual documents, bidirectional source mappings, expansion
occurrences, generated-code context, incremental deltas, and composable
transform maps for Ravel programs.

The package consumes the public `RavelProgram`/`Deliverable` provenance shape
from `@pieceful/ravel-core`. It has no Node, filesystem, process, editor, or
language-server dependency, so the same projection can run in an editor host
or browser worker.

## Projection service

One service owns the current projection snapshot. Supply every target/artifact
variant in `projections`; IDs and `pieceful-virtual:` URIs remain stable while
their monotonically increasing document versions change.

```js
import { createProjectionService } from "@pieceful/ravel-projection";

const projections = createProjectionService({
  workspaceId: "demo",
  projections: [
    {
      targetId: "web",
      artifactId: "dist/app.ts",
      languageId: "typescript",
      stage: "assembled"
    }
  ]
});

const delta = await projections.update({
  id: "snapshot-1",
  program,
  sourceVersions: { "guide.md": 7 },
  sourceTexts: { "guide.md": guideText }
});

const [virtual] = delta.opened;
const generated = projections.toVirtual({ uri: "guide.md", offset: 120 }, {
  targetId: "web",
  artifactId: "dist/app.ts",
  stage: "assembled",
  projectionVersion: virtual.version
});
const authored = projections.toSource(virtual.id, { start: 12, end: 18 }, {
  projectionVersion: virtual.version
});
```

`update()` returns opened, changed, unchanged, and closed documents plus
minimal-or-full text changes. `scheduleUpdate()` supports interactive and
background work; a superseding update or `AbortSignal` prevents a stale build
from becoming current. Treat returned virtual documents and deltas as
immutable.

Mapping queries return every match because one authored piece can occur in
many artifacts or expansion sites. Narrow them with `targetId`, `artifactId`,
`stage`, and `occurrenceId`; use `affinity` at zero-width boundaries. Invalid
or explicitly stale low-level queries return `{ ok: false, reason, matches: [] }`
rather than throwing. Service convenience methods return an empty match array
for an invalid selection, so callers that need a reason should use the
low-level `mapSource*`/`mapVirtual*` functions.

## Provenance kinds

Each `ProjectionSegment` describes a generated UTF-16 offset range and its
best available authored provenance.

| Kind | Meaning | Reverse-edit status |
| --- | --- | --- |
| `exact` | Generated code is character-for-character authored text. Exact subranges are reversible when source and generated lengths agree. | Eligible for policy-controlled edits. |
| `anchored` | Generated text has a responsible invocation, definition, or transform location, but no character correspondence. | Navigation only. |
| `transformed` | A declared offset or source-map transform preserves a character correspondence for this span. | Mappable, but not automatically editable by the current edit policy. |
| `opaque` | A transform supplied no usable mapping; only a responsible anchor may remain. | Navigation only. |
| `synthetic` | The tool inserted text with no authored destination. | Not editable without a separate host policy, such as an imports destination. |

`writable: true` on a mapping match is necessary, not sufficient, for an
automatic source edit. A host must still enforce the stricter policy in
`@pieceful/ravel-language-service`.

Expansion occurrences form a parent/child tree and preserve invocation and
definition locations. `generatedContext()` returns the occurrence breadcrumb,
sibling expansions, a bounded visible range, and categorized highlights for a
generated-code overlay. It does not infer a unique occurrence when the source
appears more than once.

## Projection stages

Stages are semantic labels, not an implied build pipeline:

- `authoring`: a language-shaped view closest to the authored chunk.
- `assembled`: expanded chunks arranged as an artifact; the normal native
  language-service input.
- `transformed`: output after a declared analysis transform.
- `emitted`: final generated output. Its default capabilities disable
  completion and writable edits while retaining navigation and diagnostics.

The other stages default to navigation, diagnostics, completion, and writable
mapping support. `stageCapabilities()` or build options can reduce these
capabilities. Do not advertise a later stage if the transform needed to create
it executes effects: `validateAnalysisTransform()` accepts only transforms
declared pure, without effects or authorities, and with a valid mapping
capability.

## Transform authors

Transform helpers are exported from `@pieceful/ravel-projection/transforms`.

```js
import {
  applyTransformMap,
  createIndentOffsetMap
} from "@pieceful/ravel-projection/transforms";

const indented = createIndentOffsetMap(assembled.text, 2);
if (!indented.ok) throw new Error(indented.reason);

const transformed = applyTransformMap(
  assembled,
  indented.text,
  indented.map,
  { name: "indent", stage: "transformed" }
);
```

Use the narrowest honest mapping capability:

- `identityTransformMap()` preserves the input mapping kind.
- Offset maps use ordered `copy`, `mapped`, `inserted`, and `removed` spans.
  Indent, dedent, EOL normalization, offset lookup, and composition helpers are
  included. A non-identity copied/mapped span becomes `transformed`; inserted
  output becomes `anchored` when `transformSource` is supplied and `synthetic`
  otherwise; removed input has no output range.
- `normalizeSourceMap()` decodes a version-3 source map. `applyTransformMap()`
  converts matching points into UTF-16 offset spans for one input virtual
  document. Gaps, foreign sources, and source-map regions without usable
  points remain unmapped; this is not a proof that arbitrary source-map edits
  are reversible.
- `opaqueTransformMap()` deliberately degrades the entire output to opaque
  provenance, optionally retaining an anchor. Use it whenever a transform
  cannot supply a truthful map.

`applyTransformMap()` rejects invalid maps and maps whose declared input or
output lengths do not match the supplied texts. Offset-map composition only
works when adjacent map lengths agree. All public offsets are UTF-16 code-unit
offsets; `createLineIndex()`, `positionAt()`, and `offsetAt()` provide explicit
UTF-8, UTF-16, or UTF-32 line/character conversion for protocol boundaries.

MIT © James Taylor
