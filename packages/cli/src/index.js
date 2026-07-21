#!/usr/bin/env node
import { loadBuildInput, planDeliverables, writeBuildManifest, writeDeliverables, writeGraph } from "@pieceful/ravel-host-node";
import { transformGraph } from "@pieceful/ravel-core";

const EXIT_SOURCE = 1;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 3;
const valueOptions = new Set(["--config", "--out-dir", "--graph", "--document", "--mode"]);
const booleanOptions = new Set(["--json", "--dry-run", "--debug"]);

const usage = () => {
  console.error("Usage: ravel check <map.json|document.md> [--config <run.toml>] [--document <name>] [--mode <opt-in|primary>] [--json]");
  console.error("       ravel build <map.json|document.md> --out-dir <directory> [--document <name>] [--mode <opt-in|primary>] [--graph <program.json>] [--dry-run] [--json]");
  console.error("       ravel build --config <run.toml> [--out-dir <directory>] [--graph <program.json>] [--dry-run] [--json]");
  console.error("       ravel inspect <map.json|document.md> [--config <run.toml>] [--document <name>] [--mode <opt-in|primary>] [--json]");
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
  if (json) console.error(JSON.stringify(diagnostics, null, 2));
  else for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic));
};

const parseArguments = (argumentsValue) => {
  const command = argumentsValue[0];
  const options = {};
  const positional = [];
  for (let index = 1; index < argumentsValue.length; index += 1) {
    const argument = argumentsValue[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (booleanOptions.has(argument)) {
      if (options[argument]) return { error: "Option may be specified only once: " + argument };
      options[argument] = true;
      continue;
    }
    if (!valueOptions.has(argument)) return { error: "Unknown option: " + argument };
    const value = argumentsValue[index + 1];
    if (!value || value.startsWith("--")) return { error: "Option requires a value: " + argument };
    if (Object.hasOwn(options, argument)) return { error: "Option may be specified only once: " + argument };
    options[argument] = value;
    index += 1;
  }
  if (positional.length > 1) return { error: "Expected at most one input path." };
  if (options["--config"] && positional.length) return { error: "Use either an input path or --config, not both." };
  return { command, options, input: options["--config"] ?? positional[0] };
};

const printBuildResult = (result, json) => {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.dryRun) {
    console.log("Ravel build plan for " + result.outputDirectory + ":");
    for (const deliverable of result.deliverables) console.log("  " + deliverable.path + " ← " + deliverable.from);
    console.log("  manifest: " + result.manifest);
    return;
  }
  console.log("Ravel wrote " + result.written.length + " deliverable" + (result.written.length === 1 ? "" : "s") + " to " + result.outputDirectory + ".");
  for (const deliverable of result.deliverables) console.log("  " + deliverable.path + " ← " + deliverable.from);
  console.log("Manifest: " + result.manifest);
};

const argumentsValue = process.argv.slice(2);
const command = argumentsValue[0];
if (command === "--help" || command === "-h" || argumentsValue.includes("--help")) {
  usage();
  process.exitCode = 0;
} else if (command === "--version" || command === "-v") {
  console.log("0.0.0");
  process.exitCode = 0;
} else {
  const parsed = parseArguments(argumentsValue);
  const json = parsed.options?.["--json"] === true;
  const debug = parsed.options?.["--debug"] === true;
  const supported = new Set(["build", "inspect", "check"]);
  if (!supported.has(parsed.command) || parsed.error || !parsed.input) {
    if (parsed.error) console.error("ravel usage error: " + parsed.error);
    usage();
    process.exitCode = EXIT_USAGE;
  } else if (parsed.options["--dry-run"] && parsed.command !== "build") {
    console.error("ravel usage error: --dry-run is available only with build.");
    process.exitCode = EXIT_USAGE;
  } else if ((parsed.options["--out-dir"] || parsed.options["--graph"]) && parsed.command !== "build") {
    console.error("ravel usage error: --out-dir and --graph are available only with build.");
    process.exitCode = EXIT_USAGE;
  } else {
    try {
      const loaded = await loadBuildInput(parsed.input, {
        document: parsed.options["--document"],
        mode: parsed.options["--mode"]
      });
      const program = transformGraph(loaded.pretransform);
      const errors = program.diagnostics.filter((entry) => entry.severity === "error");
      if (errors.length) {
        printDiagnostics(program.diagnostics, json);
        process.exitCode = EXIT_SOURCE;
      } else if (parsed.command === "check") {
        if (json) console.log(JSON.stringify({ ok: true, command: "check", diagnostics: program.diagnostics }, null, 2));
        else console.log("Ravel check passed.");
      } else if (parsed.command === "inspect") {
        console.log(JSON.stringify(program, null, 2));
      } else {
        const outputDirectory = parsed.options["--out-dir"] ?? loaded.outputDirectory;
        if (!outputDirectory) throw new Error("build requires --out-dir or build.out_dir in the TOML config.");
        const plan = planDeliverables(program, outputDirectory);
        if (parsed.options["--dry-run"]) {
          printBuildResult({ ok: true, command: "build", dryRun: true, ...plan }, json);
        } else {
          const written = await writeDeliverables(program, outputDirectory, {
            rootDirectory: parsed.options["--out-dir"] ?? loaded.rootDirectory
          });
          const manifest = await writeBuildManifest(program, outputDirectory, {
            rootDirectory: parsed.options["--out-dir"] ?? loaded.rootDirectory
          });
          if (parsed.options["--graph"]) await writeGraph(program, parsed.options["--graph"], { rootDirectory: loaded.rootDirectory });
          printBuildResult({
            ok: true,
            command: "build",
            outputDirectory: plan.outputDirectory,
            written,
            manifest: manifest.path,
            deliverables: plan.deliverables,
            chunks: Object.keys(program.chunks).sort()
          }, json);
        }
      }
    } catch (error) {
      if (Array.isArray(error?.diagnostics)) {
        printDiagnostics(error.diagnostics, json);
        process.exitCode = EXIT_SOURCE;
      } else if (json) {
        console.error(JSON.stringify([{ code: "RV900", severity: "error", message: error?.message ?? String(error) }], null, 2));
        process.exitCode = EXIT_INTERNAL;
      } else {
        console.error("ravel error: " + (error?.message ?? String(error)));
        if (debug && error?.stack) console.error(error.stack);
        process.exitCode = EXIT_INTERNAL;
      }
    }
  }
}
