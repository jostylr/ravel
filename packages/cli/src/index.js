#!/usr/bin/env node
import { cleanManagedArtifacts, createOutputBackup, loadBuildInput, planDeliverables, planOutputBackup, planStaleDeliverables, refreshStaleArtifacts, writeBuildArtifacts, writeGraph } from "@pieceful/ravel-host-node";
import { transformGraph } from "@pieceful/ravel-core";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXIT_SOURCE = 1;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 3;
const RAVEL_VERSION = "0.1.0";
const valueOptions = new Set(["--config", "--out-dir", "--document", "--mode"]);
const booleanOptions = new Set(["--json", "--dry-run", "--debug", "--chunks", "--trace", "--clean"]);

const usage = () => {
  console.error("Usage: ravel check <map.json|document.md> [--config <run.toml>] [--document <name>] [--mode <opt-in|primary>] [--json]");
  console.error("       ravel                 # builds ./ravel.toml when it exists");
  console.error("       ravel build <map.json|document.md> --out-dir <directory> [--document <name>] [--mode <opt-in|primary>] [--graph <program.json>] [--backup [file.zip]] [--clean] [--dry-run] [--json]");
  console.error("       ravel build --config <run.toml> [--out-dir <directory>] [--graph <program.json>] [--backup [file.zip]] [--clean] [--dry-run] [--json]");
  console.error("       ravel inspect <map.json|document.md> [--config <run.toml>] [--document <name>] [--mode <opt-in|primary>] [--chunks|--graph|--trace] [--json]");
  console.error("       ravel refresh <output-directory> [--dry-run] [--json]");
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
    if (argument === "--backup") {
      if (Object.hasOwn(options, argument)) return { error: "Option may be specified only once: " + argument };
      const following = argumentsValue[index + 1];
      if (following && !following.startsWith("--") && extname(following).toLowerCase() === ".zip") {
        options[argument] = following;
        index += 1;
      } else {
        options[argument] = true;
      }
      continue;
    }
    if (booleanOptions.has(argument) || (argument === "--graph" && command === "inspect")) {
      if (options[argument]) return { error: "Option may be specified only once: " + argument };
      options[argument] = true;
      continue;
    }
    if (!valueOptions.has(argument) && !(argument === "--graph" && command === "build")) {
      return { error: "Unknown option: " + argument };
    }
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

const sortedEntries = (value) => Object.entries(value ?? []).sort(([left], [right]) => left.localeCompare(right));

const inspectProgram = (program, options) => {
  if (options["--chunks"]) {
    return {
      version: program.version,
      view: "chunks",
      chunks: sortedEntries(program.chunks).map(([id, chunk]) => ({
        id,
        name: chunk.name,
        identity: chunk.identity,
        metadata: chunk.metadata,
        generated: chunk.generated,
        dependencies: chunk.dependencies,
        references: chunk.references
      }))
    };
  }
  if (options["--graph"]) {
    return {
      version: program.version,
      view: "graph",
      chunks: sortedEntries(program.chunks).map(([id, chunk]) => ({ id, dependencies: chunk.dependencies })),
      deliverables: Object.values(program.deliverables).sort((left, right) => left.name.localeCompare(right.name)).map((deliverable) => ({
        name: deliverable.name,
        from: deliverable.from,
        dependencies: deliverable.dependencies
      }))
    };
  }
  if (options["--trace"]) {
    return { version: program.version, view: "trace", chunks: Object.fromEntries(sortedEntries(program.trace?.chunks)) };
  }
  return program;
};

const printInspectResult = (result, json) => {
  if (json || !result.view) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.view === "chunks") {
    console.log("Ravel chunks:");
    for (const chunk of result.chunks) {
      const suffix = chunk.generated ? " (generated)" : "";
      console.log("  " + chunk.id + suffix + (chunk.dependencies.length ? " → " + chunk.dependencies.join(", ") : ""));
    }
    return;
  }
  if (result.view === "graph") {
    console.log("Ravel dependency graph (dependent ← dependency):");
    for (const chunk of result.chunks) console.log("  " + chunk.id + " ← " + (chunk.dependencies.length ? chunk.dependencies.join(", ") : "(none)"));
    if (result.deliverables.length) {
      console.log("Deliverables:");
      for (const deliverable of result.deliverables) console.log("  " + deliverable.name + " ← " + deliverable.from);
    }
    return;
  }
  console.log("Ravel evaluation trace:");
  for (const [id, entries] of Object.entries(result.chunks)) {
    console.log("  " + id + ": " + entries.map((entry) => entry.stage).join(" → "));
  }
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
  } else {
    console.log("Ravel wrote " + result.written.length + " deliverable" + (result.written.length === 1 ? "" : "s") + " to " + result.outputDirectory + ".");
    for (const deliverable of result.deliverables) console.log("  " + deliverable.path + " ← " + deliverable.from);
    console.log("Manifest: " + result.manifest);
  }
  if (result.stale?.length) {
    console.log("Stale managed outputs retained:");
    for (const deliverable of result.stale) console.log("  " + deliverable.path + " ← " + (deliverable.from ?? "previous build"));
  }
  if (result.removed?.length) {
    console.log((result.dryRun ? "Managed outputs that would be removed:" : "Managed outputs removed:"));
    for (const deliverable of result.removed) console.log("  " + deliverable.path + " ← " + (deliverable.from ?? "previous build"));
  }
  if (result.backup) {
    const action = result.dryRun ? "Backup plan" : "Backup";
    const count = result.backup.files?.length;
    console.log(action + ": " + result.backup.path + (count === undefined ? "" : " (" + count + " files)"));
  }
};

const printRefreshResult = (result, json) => {
  if (json) {
    console.log(JSON.stringify({ ok: true, command: "refresh", ...result }, null, 2));
    return;
  }
  const action = result.dryRun ? "would remove" : "removed";
  console.log("Ravel refresh " + action + " " + result.removed.length + " stale managed output" + (result.removed.length === 1 ? "" : "s") + ".");
  for (const deliverable of result.removed) console.log("  " + deliverable.path + " ← " + (deliverable.from ?? "previous build"));
};

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
const rawArguments = process.argv.slice(2);
const argumentsValue = rawArguments.length === 0 && existsSync("ravel.toml")
  ? ["build", "--config", "ravel.toml"]
  : rawArguments;
const command = argumentsValue[0];
if (command === "--help" || command === "-h" || argumentsValue.includes("--help")) {
  usage();
  process.exitCode = 0;
} else if (command === "--version" || command === "-v") {
  console.log(RAVEL_VERSION);
  process.exitCode = 0;
} else {
  const parsed = parseArguments(argumentsValue);
  const json = parsed.options?.["--json"] === true;
  const debug = parsed.options?.["--debug"] === true;
  const supported = new Set(["build", "inspect", "check", "refresh"]);
  if (!supported.has(parsed.command) || parsed.error || !parsed.input) {
    if (parsed.error) console.error("ravel usage error: " + parsed.error);
    usage();
    process.exitCode = EXIT_USAGE;
  } else if (parsed.options["--dry-run"] && !new Set(["build", "refresh"]).has(parsed.command)) {
    console.error("ravel usage error: --dry-run is available only with build or refresh.");
    process.exitCode = EXIT_USAGE;
  } else if (parsed.options["--clean"] && parsed.command !== "build") {
    console.error("ravel usage error: --clean is available only with build.");
    process.exitCode = EXIT_USAGE;
  } else if (parsed.options["--backup"] && parsed.command !== "build") {
    console.error("ravel usage error: --backup is available only with build.");
    process.exitCode = EXIT_USAGE;
  } else if (parsed.options["--out-dir"] && parsed.command !== "build") {
    console.error("ravel usage error: --out-dir is available only with build.");
    process.exitCode = EXIT_USAGE;
  } else if ((parsed.options["--chunks"] || parsed.options["--trace"]) && parsed.command !== "inspect") {
    console.error("ravel usage error: --chunks and --trace are available only with inspect.");
    process.exitCode = EXIT_USAGE;
  } else if (parsed.command === "inspect" && ["--chunks", "--graph", "--trace"].filter((option) => parsed.options[option]).length > 1) {
    console.error("ravel usage error: choose only one inspect view.");
    process.exitCode = EXIT_USAGE;
  } else if (parsed.command === "refresh" && ["--config", "--document", "--mode", "--chunks", "--trace"].some((option) => parsed.options[option])) {
    console.error("ravel usage error: refresh accepts only an output directory, --dry-run, and --json.");
    process.exitCode = EXIT_USAGE;
  } else {
    try {
      if (parsed.command === "refresh") {
        printRefreshResult(await refreshStaleArtifacts(parsed.input, {
          rootDirectory: parsed.input,
          dryRun: parsed.options["--dry-run"] === true
        }), json);
        process.exitCode = 0;
      } else {
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
        printInspectResult(inspectProgram(program, parsed.options), json);
      } else {
        const outputDirectory = parsed.options["--out-dir"] ?? loaded.outputDirectory;
        if (!outputDirectory) throw new Error("build requires --out-dir or build.out_dir in the TOML config.");
        const plan = planDeliverables(program, outputDirectory);
        const rootDirectory = parsed.options["--out-dir"] ?? loaded.rootDirectory;
        const configuredClean = loaded.buildOptions?.clean === true;
        const configuredBackup = loaded.buildOptions?.backup ?? false;
        const clean = parsed.options["--clean"] === true || configuredClean;
        const backupSetting = parsed.options["--backup"] ?? configuredBackup;
        const stale = await planStaleDeliverables(program, outputDirectory, { rootDirectory });
        const backupOptions = {
          outputRootDirectory: rootDirectory,
          backupRootDirectory: loaded.rootDirectory,
          ...(typeof backupSetting === "string" ? { backupPath: backupSetting } : {})
        };
        const backup = backupSetting
          ? parsed.options["--dry-run"]
            ? await planOutputBackup(outputDirectory, backupOptions)
            : await createOutputBackup(outputDirectory, backupOptions)
          : null;
        const cleanup = clean
          ? await cleanManagedArtifacts(outputDirectory, { rootDirectory, dryRun: parsed.options["--dry-run"] === true })
          : { removed: [] };
        const retainedStale = clean ? [] : stale;
        if (parsed.options["--dry-run"]) {
          printBuildResult({ ok: true, command: "build", dryRun: true, clean, ...plan, stale: retainedStale, removed: cleanup.removed, ...(backup ? { backup } : {}) }, json);
        } else {
          const artifacts = await writeBuildArtifacts(program, outputDirectory, { rootDirectory, stale: retainedStale });
          if (parsed.options["--graph"]) await writeGraph(program, parsed.options["--graph"], { rootDirectory: loaded.rootDirectory });
          printBuildResult({
            ok: true,
            command: "build",
            outputDirectory: plan.outputDirectory,
            written: artifacts.written,
            manifest: artifacts.manifest.path,
            deliverables: plan.deliverables,
            stale: retainedStale,
            removed: cleanup.removed,
            ...(backup ? { backup } : {}),
            clean,
            chunks: Object.keys(program.chunks).sort()
          }, json);
        }
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
}
