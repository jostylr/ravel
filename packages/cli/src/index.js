#!/usr/bin/env node
import { loadBuildInput, writeDeliverables, writeGraph } from "../../host-node/src/index.js";
import { transformGraph } from "../../core/src/index.js";

const usage = () => {
  console.error("Usage: ravel build <map.json|document.md> --out-dir <directory> [--document <name>] [--mode <opt-in|primary>] [--graph <program.json>]");
  console.error("       ravel build --config <run.toml> [--out-dir <directory>] [--graph <program.json>]");
  console.error("       ravel inspect <map.json|document.md> [--document <name>] [--mode <opt-in|primary>]");
  console.error("       ravel inspect --config <run.toml>");
};

const argumentsValue = process.argv.slice(2);
const command = argumentsValue[0];
if ((command !== "build" && command !== "inspect") || argumentsValue.length < 2) {
  usage();
  process.exitCode = 1;
} else {
  const option = (name) => {
    const index = argumentsValue.indexOf(name);
    return index === -1 ? undefined : argumentsValue[index + 1];
  };
  const config = option("--config");
  const positional = argumentsValue.slice(1).find((value, index, all) =>
    !value.startsWith("--") && !all[index - 1]?.startsWith("--")
  );
  const input = config ?? positional;
  const outputDirectory = option("--out-dir");
  const graphPath = option("--graph");
  const document = option("--document");
  const mode = option("--mode");

  if (!input || (config && positional) || (command === "build" && !outputDirectory && !config)) {
    usage();
    process.exitCode = 1;
  } else {
    try {
      const loaded = await loadBuildInput(input, { document, mode });
      const program = transformGraph(loaded.pretransform);
      const errors = program.diagnostics.filter((entry) => entry.severity === "error");
      if (errors.length) {
        console.error(JSON.stringify(program.diagnostics, null, 2));
        process.exitCode = 1;
      } else if (command === "inspect") {
        console.log(JSON.stringify(program, null, 2));
      } else {
        const destination = outputDirectory ?? loaded.outputDirectory;
        if (!destination) throw new Error("build requires --out-dir or build.out_dir in the TOML config.");
        const written = await writeDeliverables(program, destination, {
          // An explicit CLI destination establishes a new output root. TOML
          // destinations remain contained by the source/TOML root.
          rootDirectory: outputDirectory ?? loaded.rootDirectory
        });
        if (graphPath) await writeGraph(program, graphPath, { rootDirectory: loaded.rootDirectory });
        console.log(JSON.stringify({ written, chunks: Object.keys(program.chunks).sort() }, null, 2));
      }
    } catch (error) {
      console.error(error.stack ?? String(error));
      process.exitCode = 1;
    }
  }
}
