import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformGraph } from "@pieceful/ravel-core";
import { createExplorerSnapshot } from "@pieceful/ravel-explorer";
import { loadBuildInput } from "@pieceful/ravel-host-node";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const config = resolve(root, "examples/migration/ravel-fizzbuzz.toml");
const destination = resolve(root, "browser-test/generated/explorer-snapshot.json");

const loaded = await loadBuildInput(config);
const program = transformGraph(loaded.pretransform);
const snapshot = createExplorerSnapshot({
  program,
  pretransform: loaded.pretransform,
  project: {
    id: "fizzbuzz",
    label: "FizzBuzz migration"
  }
}, {
  maxNodes: 500
});

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(snapshot, null, 2) + "\n");

console.log(
  `Built Explorer fixture: ${snapshot.counts.visibleNodes} nodes, ` +
  `${snapshot.counts.visibleEdges} edges`
);
