import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transformGraph } from "@pieceful/ravel-core";
import { loadBuildInput } from "@pieceful/ravel-host-node";
import {
  createExplorerEntityDetails,
  createExplorerSnapshot
} from "../packages/explorer/src/index.js";

test("FizzBuzz projects chunks, definition pipes, compose directives, emits, aliases, imports, and outputs", async () => {
  const config = fileURLToPath(
    new URL("../examples/migration/ravel-fizzbuzz.toml", import.meta.url)
  );
  const loaded = await loadBuildInput(config);
  const program = transformGraph(loaded.pretransform);
  const options = {
    focus: "fizzbuzz::program:main.js",
    upstream: Infinity,
    downstream: 1,
    maxNodes: 500
  };
  const first = createExplorerSnapshot({
    program,
    pretransform: loaded.pretransform,
    revision: "fizzbuzz-fixture"
  }, options);
  const second = createExplorerSnapshot({
    program,
    pretransform: loaded.pretransform,
    revision: "fizzbuzz-fixture"
  }, options);

  assert.deepEqual(first, second);
  assert.equal(first.truncated, false);
  assert.deepEqual(first.counts, {
    availableNodes: 27,
    visibleNodes: 27,
    visibleEdges: 42,
    chunks: 7
  });
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(first.nodes.map(({ kind }) => kind))]
        .sort()
        .map((kind) => [kind, first.nodes.filter((node) => node.kind === kind).length])
    ),
    {
      chunk: 7,
      "compose-step": 5,
      deliverable: 2,
      directive: 6,
      document: 2,
      emit: 2,
      transform: 3
    }
  );
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(first.edges.map(({ kind }) => kind))]
        .sort()
        .map((kind) => [kind, first.edges.filter((edge) => edge.kind === kind).length])
    ),
    {
      aliases: 1,
      composes: 5,
      contains: 13,
      declares: 4,
      emits: 4,
      imports: 1,
      produces: 4,
      references: 7,
      transforms: 3
    }
  );
  assert.equal(
    first.nodes.find(({ id }) => id === "chunk:fizzbuzz::program:main.js")?.label,
    "program:main.js"
  );

  const details = createExplorerEntityDetails({
    program,
    pretransform: loaded.pretransform,
    revision: "fizzbuzz-fixture"
  }, "chunk:fizzbuzz::program:main.js");
  assert.equal(details.revision, "fizzbuzz-fixture");
  assert.match(details.authored.text, /_"program:initial-array\.js"/);
  assert.match(details.evaluated.text, /const values = Array\.from/);
  assert.equal(details.authored.truncated, false);

  const transformDetails = createExplorerEntityDetails({
    program,
    pretransform: loaded.pretransform
  }, "transform:fizzbuzz::program:main.js:0:dedent");
  assert.equal(transformDetails.kind, "transform");
  assert.equal(transformDetails.ownerEntityId, "chunk:fizzbuzz::program:main.js");
  assert.match(transformDetails.authored.text, /_"program:helpers\.js"/);
});
