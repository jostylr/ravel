import assert from "node:assert/strict";
import test from "node:test";
import { combineMaps, transformGraph } from "@pieceful/ravel-core";
import {
  assertExplorerMessage,
  collapseExplorerGroups,
  createExplorerChangeSnapshot,
  createExplorerEntityDetails,
  createExplorerSnapshot,
  dependencyPath,
  diffExplorerSnapshots,
  downstreamChunkIds,
  upstreamChunkIds,
  validateExplorerMessage
} from "../packages/explorer/src/index.js";
import {
  createExplorerElements,
  createExplorerView
} from "../packages/explorer/src/browser.js";

const source = (offset, end = offset + 1) => ({
  uri: "guide.md",
  range: {
    start: { line: 0, column: offset, offset },
    end: { line: 0, column: end, offset: end }
  }
});

const fixture = () => {
  const map = {
    version: 1,
    document: { id: "guide", uri: "guide.md", format: "markdown+ravel-v1" },
    chunks: [
      {
        id: "guide::source.text",
        identity: { document: "guide", chunk: "source", minor: null, type: "text" },
        name: "Source",
        body: " hello ",
        definitionPipeline: [
          { type: "transform", name: "trim", arguments: [], source: source(1, 5) }
        ],
        metadata: { language: "text", tags: ["input"] },
        source: source(0, 7)
      },
      {
        id: "guide::main.text",
        identity: { document: "guide", chunk: "main", minor: null, type: "text" },
        name: "Main",
        body: "_\"source.text\"!",
        metadata: { language: "text", tags: ["entrypoint"] },
        source: source(10, 25)
      },
      {
        id: "guide::live.js",
        identity: { document: "guide", chunk: "live", minor: null, type: "js" },
        name: "Live",
        body: "export default ch(\"source.text\");",
        metadata: { language: "js", tags: [], data: { ravel: { run: true } } },
        source: source(30, 65)
      }
    ],
    directives: [
      {
        kind: "create",
        document: "guide",
        name: "assembled.text",
        compose: [
          { kind: "append", reference: "source.text", source: source(66, 67) },
          {
            kind: "pipe",
            steps: [
              { type: "transform", name: "trim", arguments: [], source: source(67, 68) }
            ],
            source: source(67, 69)
          }
        ],
        source: source(66, 69)
      },
      { kind: "out", name: "dist/main.txt", from: "guide::main.text", source: source(70, 80) }
    ]
  };
  const pretransform = combineMaps([map]);
  const program = transformGraph(pretransform, { deferLiveResults: true });
  const livePlan = {
    version: 1,
    nodes: {
      "guide::live.js": {
        id: "guide::live.js",
        language: "js",
        provider: { id: "test", version: "1" },
        source: source(30, 65),
        dependencies: [
          { reference: "source.text", id: "guide::source.text", source: source(48, 59) }
        ],
        resources: [],
        modules: [],
        analysis: {}
      }
    },
    diagnostics: [],
    ok: true
  };
  return { map, pretransform, program, livePlan };
};

test("creates a deterministic typed snapshot of chunks, transforms, directives, live dependencies, and outputs", () => {
  const context = fixture();
  const first = createExplorerSnapshot(context);
  const second = createExplorerSnapshot(context);

  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.truncated, false);
  assert.deepEqual(
    first.nodes.filter(({ kind }) => kind === "chunk").map(({ id }) => id),
    [
      "chunk:guide::assembled.text",
      "chunk:guide::live.js",
      "chunk:guide::main.text",
      "chunk:guide::source.text"
    ]
  );
  assert.ok(first.nodes.some(({ id, kind }) =>
    id === "transform:guide::source.text:0:trim" && kind === "transform"
  ));
  assert.ok(first.nodes.some(({ kind }) => kind === "directive"));
  assert.ok(first.nodes.some(({ kind }) => kind === "compose-step"));
  assert.ok(first.nodes.some(({ id }) => id === "deliverable:dist/main.txt"));

  const edgeKinds = new Set(first.edges.map(({ kind }) => kind));
  assert.ok(edgeKinds.has("contains"));
  assert.ok(edgeKinds.has("references"));
  assert.ok(edgeKinds.has("consumes"));
  assert.ok(edgeKinds.has("transforms"));
  assert.ok(edgeKinds.has("declares"));
  assert.ok(edgeKinds.has("produces"));

  const sourceNode = first.nodes.find(({ id }) => id === "chunk:guide::source.text");
  const liveNode = first.nodes.find(({ id }) => id === "chunk:guide::live.js");
  assert.equal(sourceNode.counts.transforms, 1);
  assert.ok(liveNode.state.includes("live"));
});

test("focus queries distinguish upstream dependencies from downstream consumers", () => {
  const context = fixture();
  assert.deepEqual(
    upstreamChunkIds(context, "guide::main.text", 1),
    ["guide::main.text", "guide::source.text"]
  );
  assert.deepEqual(
    downstreamChunkIds(context, "guide::source.text", 1),
    ["guide::assembled.text", "guide::live.js", "guide::main.text", "guide::source.text"]
  );
  assert.deepEqual(
    dependencyPath(context, "guide::source.text", "guide::main.text"),
    ["guide::source.text", "guide::main.text"]
  );

  const focused = createExplorerSnapshot(context, {
    focus: "guide::main.text",
    upstream: 1,
    downstream: 0
  });
  assert.deepEqual(
    focused.nodes.filter(({ kind }) => kind === "chunk").map(({ id }) => id),
    ["chunk:guide::main.text", "chunk:guide::source.text"]
  );
  assert.deepEqual(focused.focus, ["chunk:guide::main.text"]);
});

test("bounded snapshots report truncation and never retain dangling edges", () => {
  const snapshot = createExplorerSnapshot(fixture(), {
    focus: "guide::main.text",
    upstream: 1,
    maxNodes: 2
  });
  const ids = new Set(snapshot.nodes.map(({ id }) => id));

  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.nodes.length, 2);
  assert.ok(snapshot.edges.every(({ source: from, target }) => ids.has(from) && ids.has(target)));
});

test("collapsing a document preserves typed aggregate boundary edges", () => {
  const snapshot = createExplorerSnapshot(fixture());
  const collapsed = collapseExplorerGroups(snapshot, "group:document:guide");
  const document = collapsed.nodes.find(({ id }) => id === "document:guide");
  const output = collapsed.nodes.find(({ id }) => id === "deliverable:dist/main.txt");
  const boundary = collapsed.edges.find(({ kind, source: from, target }) =>
    kind === "produces" &&
    from === "document:guide" &&
    target === "deliverable:dist/main.txt"
  );

  assert.ok(document.state.includes("collapsed"));
  assert.ok(document.counts.hiddenChildren > 0);
  assert.ok(output);
  assert.equal(collapsed.nodes.some(({ parent }) => parent === "document:guide"), false);
  assert.equal(boundary.count, 2);
  assert.equal(boundary.members.length, 2);
  assert.equal(collapsed.groups[0].collapsed, true);
});

test("snapshot diffs detect same-length source-result changes through fingerprints", () => {
  const context = fixture();
  const before = createExplorerSnapshot({ ...context, revision: "before" });
  const changedProgram = structuredClone(context.program);
  changedProgram.chunks["guide::main.text"].value = "hello?";
  const after = createExplorerSnapshot({
    ...context,
    program: changedProgram,
    revision: "after"
  });
  const diff = diffExplorerSnapshots(before, after);

  assert.equal(diff.beforeRevision, "before");
  assert.equal(diff.afterRevision, "after");
  assert.deepEqual(diff.nodes.changed, ["chunk:guide::main.text"]);
});

test("change snapshots retain removed entities and annotate graph changes", () => {
  const before = createExplorerSnapshot({ ...fixture(), revision: "before" });
  const after = structuredClone(before);
  after.revision = "after";
  after.nodes = after.nodes
    .filter(({ id }) => id !== "chunk:guide::live.js")
    .map((node) => node.id === "chunk:guide::main.text"
      ? { ...node, fingerprint: "changed-result" }
      : node);
  after.nodes.push({
    id: "chunk:guide::new.text",
    kind: "chunk",
    label: "new.text",
    parent: "document:guide"
  });
  const nodeIds = new Set(after.nodes.map(({ id }) => id));
  after.edges = after.edges.filter(({ source: from, target }) =>
    nodeIds.has(from) && nodeIds.has(target)
  );
  after.counts = {
    ...after.counts,
    availableNodes: after.nodes.length,
    visibleNodes: after.nodes.length,
    visibleEdges: after.edges.length
  };

  const diff = diffExplorerSnapshots(before, after);
  const changes = createExplorerChangeSnapshot(before, after, diff);
  const states = Object.fromEntries(changes.nodes.map(({ id, state }) => [id, state]));

  assert.equal(changes.lens, "changes");
  assert.deepEqual(states["chunk:guide::main.text"], ["changed"]);
  assert.deepEqual(states["chunk:guide::new.text"], ["added"]);
  assert.deepEqual(states["chunk:guide::live.js"], ["live", "removed"]);
  assert.ok(changes.edges.some(({ state }) => state?.includes("removed")));
  assert.deepEqual(changes, createExplorerChangeSnapshot(before, after, diff));
  assert.equal(before.nodes.some(({ state }) => state?.includes("removed")), false);
});

test("entity details return bounded authored and evaluated chunk text on demand", () => {
  const context = fixture();
  const details = createExplorerEntityDetails(context, "chunk:guide::source.text", {
    maxTextLength: 100
  });

  assert.deepEqual(details.authored, {
    text: " hello ",
    length: 7,
    truncated: false
  });
  assert.deepEqual(details.evaluated, {
    text: "hello",
    length: 5,
    truncated: false
  });
  assert.equal(createExplorerEntityDetails(context, "chunk:missing"), null);
});

test("validates the versioned host protocol", () => {
  const message = {
    version: 1,
    type: "view/request",
    requestId: "request-1",
    revision: "revision-1"
  };
  assert.deepEqual(validateExplorerMessage(message), []);
  assert.equal(assertExplorerMessage(message), message);
  assert.deepEqual(validateExplorerMessage({
    version: 2,
    type: "workspace/delete",
    requestId: ""
  }), [
    "Message version must be 1.",
    "Unknown Explorer message type.",
    "Message requestId must be a nonempty string."
  ]);
});

test("browser adapter creates Cytoscape elements and updates a headless view", async () => {
  const context = fixture();
  const first = createExplorerSnapshot(context, {
    focus: "guide::main.text",
    upstream: 1,
    downstream: 0
  });
  const elements = createExplorerElements(first);
  assert.equal(elements.filter(({ group }) => group === "nodes").length, first.nodes.length);
  assert.equal(elements.filter(({ group }) => group === "edges").length, first.edges.length);

  const changedElements = createExplorerElements(createExplorerChangeSnapshot(
    first,
    { ...first, revision: "next", nodes: first.nodes.map((node) =>
      node.id === "chunk:guide::main.text" ? { ...node, label: "Changed" } : node
    ) }
  ));
  assert.match(
    changedElements.find(({ data }) => data.id === "chunk:guide::main.text").classes,
    /state-changed/
  );

  const selected = [];
  const view = createExplorerView(null, first, {
    headless: true,
    layout: false,
    onSelect: (entity) => selected.push(entity.id)
  });
  await view.ready;
  assert.equal(view.cy.nodes().length, first.nodes.length);
  assert.equal(view.select("chunk:guide::main.text").id, "chunk:guide::main.text");

  const second = createExplorerSnapshot(context, {
    focus: "guide::source.text",
    upstream: 0,
    downstream: 1
  });
  await view.update(second, { layout: false });
  assert.equal(view.snapshot, second);
  assert.equal(view.cy.nodes().length, second.nodes.length);
  view.destroy();
});
