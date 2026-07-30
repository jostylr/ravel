import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformGraph } from "@pieceful/ravel-core";
import {
  createExplorerEntityDetails,
  createExplorerSnapshot
} from "@pieceful/ravel-explorer";
import { loadBuildInput } from "@pieceful/ravel-host-node";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const config = resolve(root, "examples/migration/ravel-fizzbuzz.toml");
const destination = resolve(root, "browser-test/generated/explorer-snapshot.json");
const detailsDestination = resolve(root, "browser-test/generated/explorer-details.json");

const loaded = await loadBuildInput(config);
const program = transformGraph(loaded.pretransform);
const context = {
  program,
  pretransform: loaded.pretransform,
  project: {
    id: "fizzbuzz",
    label: "FizzBuzz migration"
  }
};
const snapshot = createExplorerSnapshot(context, {
  maxNodes: 500
});
const details = Object.fromEntries(
  snapshot.nodes
    .map((node) => [node.id, createExplorerEntityDetails(context, node.id)])
    .filter(([, value]) => value)
);

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(snapshot, null, 2) + "\n");
await writeFile(detailsDestination, JSON.stringify(details, null, 2) + "\n");

console.log(
  `Built Explorer fixture: ${snapshot.counts.visibleNodes} nodes, ` +
  `${snapshot.counts.visibleEdges} edges`
);
