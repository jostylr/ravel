import { readFile } from "node:fs/promises";
import { validateRavelMap } from "@pieceful/ravel-map";

const paths = [
  "../examples/greeting.ravel-map.json",
  "../examples/poc/library.ravel-map.json",
  "../examples/poc/project.ravel-map.json"
];

let failed = false;
for (const path of paths) {
  const uri = new URL(path, import.meta.url).href;
  const map = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  const diagnostics = validateRavelMap(map, { uri });
  for (const diagnostic of diagnostics) {
    failed = true;
    console.error(uri + ": " + diagnostic.message);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Ravel Map examples pass structural validation.");
}
