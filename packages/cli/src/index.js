#!/usr/bin/env node
import { loadPretransformGraph, writeDeliverables, writeGraph } from "../../host-node/src/index.js";
import { transformGraph } from "../../core/src/index.js";

const usage = () => {
  console.error("Usage: ravel build <map.json> --out-dir <directory> [--graph <program.json>]");
};

const argumentsValue = process.argv.slice(2);
if (argumentsValue[0] !== "build" || !argumentsValue[1]) {
  usage();
  process.exitCode = 1;
} else {
  const input = argumentsValue[1];
  const option = (name) => {
    const index = argumentsValue.indexOf(name);
    return index === -1 ? undefined : argumentsValue[index + 1];
  };
  const outputDirectory = option("--out-dir");
  const graphPath = option("--graph");

  if (!outputDirectory) {
    usage();
    process.exitCode = 1;
  } else {
    try {
      const pretransform = await loadPretransformGraph(input);
      const program = transformGraph(pretransform);
      const errors = program.diagnostics.filter((entry) => entry.severity === "error");
      if (errors.length) {
        console.error(JSON.stringify(program.diagnostics, null, 2));
        process.exitCode = 1;
      } else {
        const written = await writeDeliverables(program, outputDirectory);
        if (graphPath) await writeGraph(program, graphPath);
        console.log(JSON.stringify({ written, chunks: Object.keys(program.chunks).sort() }, null, 2));
      }
    } catch (error) {
      console.error(error.stack ?? String(error));
      process.exitCode = 1;
    }
  }
}

