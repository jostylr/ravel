#!/usr/bin/env node
import { loadBuildInput, writeDeliverables, writeGraph } from "@pieceful/ravel-host-node";
import { transformGraph } from "@pieceful/ravel-core";

const usage = () => {
  console.error("Usage: ravel check <map.json|document.md> [--config <run.toml>] [--document <name>] [--mode <opt-in|primary>] [--json]");
  console.error("       ravel build <map.json|document.md> --out-dir <directory> [--document <name>] [--mode <opt-in|primary>] [--graph <program.json>] [--json]");
  console.error("       ravel build --config <run.toml> [--out-dir <directory>] [--graph <program.json>]");
  console.error("       ravel inspect <map.json|document.md> [--document <name>] [--mode <opt-in|primary>]");
  console.error("       ravel inspect --config <run.toml>");
};

const formatDiagnostic = (entry) => {
  const source = entry.source;
  const start = source?.range?.start;
  const location = source?.uri
    ? source.uri + (start ? ":" + (start.line + 1) + ":" + (start.column + 1) : "")
    : "ravel";
  return location + " " + (entry.severity ?? "error") + "[" + (entry.code ?? "RV900") + "]: " + entry.message;
};

const printDiagnostics = (diagnostics, json) => {
  if (json) {
    console.error(JSON.stringify(diagnostics, null, 2));
  } else {
    for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic));
  }
};

const argumentsValue = process.argv.slice(2);
const command = argumentsValue[0];
if (command === "--help" || command === "-h" || argumentsValue.includes("--help")) {
  usage();
  process.exitCode = 0;
} else if (command === "--version" || command === "-v") {
  console.log("0.0.0");
  process.exitCode = 0;
} else if ((command !== "build" && command !== "inspect" && command !== "check") || argumentsValue.length < 2) {
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
  const json = argumentsValue.includes("--json");

  if (!input || (config && positional) || (command === "build" && !outputDirectory && !config)) {
    usage();
    process.exitCode = 1;
  } else {
    try {
      const loaded = await loadBuildInput(input, { document, mode });
      const program = transformGraph(loaded.pretransform);
      const errors = program.diagnostics.filter((entry) => entry.severity === "error");
      if (errors.length) {
        printDiagnostics(program.diagnostics, json);
        process.exitCode = 1;
      } else if (command === "check") {
        if (json) console.log(JSON.stringify({ ok: true, diagnostics: program.diagnostics }, null, 2));
        else console.log("Ravel check passed.");
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
      if (Array.isArray(error?.diagnostics)) {
        printDiagnostics(error.diagnostics, json);
      } else if (json) {
        console.error(JSON.stringify([{ code: "RV900", severity: "error", message: error?.message ?? String(error) }], null, 2));
      } else {
        console.error("ravel error: " + (error?.message ?? String(error)));
      }
      process.exitCode = 1;
    }
  }
}
