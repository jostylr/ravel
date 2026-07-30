# `@pieceful/ravel-explorer`

Portable graph projections and host-message contracts for Ravel Explorer.

The package turns a completed `RavelProgram` plus optional pretransform and live
execution context into a deterministic, bounded `ExplorerSnapshot`. It does not
read files, execute transforms, write source, or depend on VS Code.

```js
import { createExplorerSnapshot } from "@pieceful/ravel-explorer";

const snapshot = createExplorerSnapshot({
  program,
  pretransform,
  livePlan,
  revision: "editor-buffer-42"
}, {
  focus: ["guide::main"],
  upstream: 3,
  downstream: 1,
  maxNodes: 500
});
```

Dependency and value-flow edges point from producer to consumer. Source
composition uses `references`; live JSON-value dependencies use `consumes`.
This distinction is intentionally preserved.

## Stable identities

Explorer identities are deterministic within snapshot version 1:

- documents: `document:<document-id>`;
- chunks: `chunk:<canonical-chunk-id>`;
- deliverables: `deliverable:<output-name>`;
- definition transforms: `transform:<chunk-id>:<zero-based-phase>:<name>`;
- directives: directive kind, authored source span, and stable directive index;
- compose steps: their directive identity and ordered path inside the compose
  tree;
- ordinary edges: a stable fingerprint of kind, endpoints, authored source
  span, phase, and label;
- collapsed boundary edges: a stable fingerprint of kind and visible
  endpoints.

An explicit host revision identifies the evaluated editor overlay. Without one,
the package derives a deterministic revision from graph, output, provenance,
diagnostic, and live-plan data. Hosts should supply their own revision whenever
they need concurrency control for edit proposals.

The default entry point contains the model and projection foundation. The
`./browser` entry point adapts snapshots to Cytoscape.js and ELK without
changing this contract:

```js
import { createExplorerView } from "@pieceful/ravel-explorer/browser";

const view = createExplorerView(document.querySelector("#graph"), snapshot, {
  onSelect(entity) {
    host.postMessage({ type: "entity/select", entity });
  }
});

await view.ready;
```

Chunk bodies and evaluated values are intentionally not embedded in every
snapshot. Hosts can request bounded details after selection:

```js
import { createExplorerEntityDetails } from "@pieceful/ravel-explorer";

const details = createExplorerEntityDetails(
  { program, pretransform, revision },
  selectedEntityId
);
```

For authored chunks, `details.authored` is the adapter's pre-transform body and
`details.evaluated` is the current completed value. Deliverables expose their
generated value. Selecting a definition transform returns the owning chunk's
before/after text; directive and compose selections return the generated chunk
or output when one exists. Each text field reports its full length and whether
the returned preview was truncated.

Folding remains a projection operation so collapsed boundary edges retain Ravel
edge kinds and counts. The renderer does not depend on the unmaintained
Cytoscape expand/collapse extension.

## FizzBuzz browser harness

From the repository root:

```sh
npm run build:explorer-demo
python3 -m http.server 4173 --directory browser-test
```

Open `http://localhost:4173/explorer.html`. The build derives the snapshot from
the real migration project; the browser never reads the workspace or runs a
transform.
