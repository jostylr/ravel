const zeroPosition = () => ({ line: 0, column: 0, offset: 0 });

const fallbackSource = (uri = "<live>") => ({
  uri,
  range: { start: zeroPosition(), end: zeroPosition() }
});

const diagnostic = (code, message, source, related) => ({
  code,
  severity: "error",
  message,
  source: source ?? fallbackSource(),
  ...(related?.length ? { related } : {})
});

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Return the first reason a value cannot cross a Ravel execution boundary.
 * `null` means the value is valid.
 */
export const ravelValueIssue = (value, path = "$", seen = new Set()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : path + " must be a finite number.";
  if (typeof value !== "object") return path + " has unsupported type " + typeof value + ".";
  if (seen.has(value)) return path + " contains a cycle.";
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return path + " must not contain array holes.";
      const issue = ravelValueIssue(value[index], path + "[" + index + "]", seen);
      if (issue) return issue;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      const index = typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key) ? Number(key) : -1;
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
        return path + " has a non-index array property.";
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
        return path + "[" + key + "] must be an enumerable data property.";
      }
    }
    seen.delete(value);
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return path + " must be a plain record.";
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      seen.delete(value);
      return path + " must not contain symbol keys.";
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
      seen.delete(value);
      return path + "." + key + " must be an enumerable data property.";
    }
    const issue = ravelValueIssue(value[key], path + "." + key, seen);
    if (issue) return issue;
  }
  seen.delete(value);
  return null;
};

export const serializeRavelValue = (value) => {
  const issue = ravelValueIssue(value);
  if (issue) throw new TypeError(issue);
  return JSON.stringify(value);
};

export const cloneRavelValue = (value) => JSON.parse(serializeRavelValue(value));

const providerValues = (providers) => {
  if (providers instanceof Map) return [...providers.values()];
  if (Array.isArray(providers)) return providers;
  if (isRecord(providers)) return Object.values(providers);
  return [];
};

const providerLanguages = (provider) =>
  provider?.languages instanceof Set ? [...provider.languages] : provider?.languages ?? [];

const selectProvider = (providers, language, requestedId, source, diagnostics) => {
  const candidates = providers.filter((provider) =>
    (!requestedId || provider?.id === requestedId) &&
    providerLanguages(provider).includes(language)
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    diagnostics.push(diagnostic(
      "RL100",
      requestedId
        ? "Execution provider " + requestedId + " does not support language " + language + "."
        : "No execution provider is registered for language " + language + ".",
      source
    ));
  } else {
    diagnostics.push(diagnostic(
      "RL101",
      "Multiple execution providers are registered for language " + language + ": " +
        candidates.map((provider) => provider.id).join(", ") + ".",
      source
    ));
  }
  return null;
};

const dependencyReference = (entry) => typeof entry === "string" ? entry : entry?.reference;
const dependencySource = (entry, fallback) => typeof entry === "string" ? fallback : entry?.source ?? fallback;

const resolveReference = (reference, owner, chunks) => {
  if (typeof reference !== "string" || !reference) return null;
  if (reference.includes("::")) {
    return Object.hasOwn(chunks, reference) ? { id: reference } : null;
  }
  const document = owner.identity?.document;
  if (document !== null && document !== undefined) {
    const local = document + "::" + reference;
    if (Object.hasOwn(chunks, local)) return { id: local };
    if (!reference.includes(".")) {
      const candidates = Object.entries(chunks)
        .filter(([, chunk]) =>
          chunk.identity?.document === document &&
          chunk.identity?.chunk === reference &&
          chunk.identity?.minor === null
        )
        .map(([id]) => id);
      if (candidates.length === 1) return { id: candidates[0] };
      if (candidates.length > 1) return { ambiguous: candidates };
    }
  }
  return Object.hasOwn(chunks, reference) ? { id: reference } : null;
};

const normalizeAnalysis = (analysis) => ({
  version: 1,
  dependencies: Array.isArray(analysis?.dependencies) ? analysis.dependencies : [],
  resources: Array.isArray(analysis?.resources) ? analysis.resources : [],
  modules: Array.isArray(analysis?.modules) ? analysis.modules : [],
  diagnostics: Array.isArray(analysis?.diagnostics) ? analysis.diagnostics : []
});

/**
 * Analyze executable chunks after ordinary Ravel composition has completed.
 * Providers own their language syntax; core owns provider selection and graph
 * resolution.
 */
export const planLiveExecutions = (program, options = {}) => {
  const diagnostics = [];
  const providers = providerValues(options.providers);
  const chunks = program?.chunks ?? {};
  const nodes = {};

  for (const [id, chunk] of Object.entries(chunks)) {
    const execution = chunk.metadata?.data?.ravel;
    if (execution?.run !== true) continue;
    const language = chunk.metadata?.language;
    if (typeof language !== "string" || !language) {
      diagnostics.push(diagnostic("RL102", "Executable chunk " + id + " has no language.", chunk.source));
      continue;
    }
    const provider = selectProvider(providers, language, execution.provider, chunk.source, diagnostics);
    if (!provider) continue;
    let analysis;
    try {
      analysis = normalizeAnalysis(provider.analyze?.({
        id,
        language,
        source: chunk.value,
        sourceLocation: chunk.source
      }));
    } catch (error) {
      diagnostics.push(diagnostic(
        "RL103",
        "Provider " + provider.id + " could not analyze " + id + ": " + (error?.message ?? String(error)),
        chunk.source
      ));
      continue;
    }
    diagnostics.push(...analysis.diagnostics);
    const dependencies = [];
    for (const entry of analysis.dependencies) {
      const reference = dependencyReference(entry);
      const source = dependencySource(entry, chunk.source);
      const resolved = resolveReference(reference, chunk, chunks);
      if (!resolved) {
        diagnostics.push(diagnostic("RL110", "Unknown live dependency: " + String(reference), source));
      } else if (resolved.ambiguous) {
        diagnostics.push(diagnostic(
          "RL109",
          "Ambiguous live dependency " + String(reference) + ": " + resolved.ambiguous.join(", ") + ".",
          source
        ));
      } else {
        dependencies.push({ reference, id: resolved.id, source });
      }
    }
    nodes[id] = {
      id,
      language,
      provider: { id: provider.id, version: provider.version ?? "unknown" },
      source: chunk.source,
      dependencies,
      resources: analysis.resources,
      modules: analysis.modules,
      analysis
    };
  }

  const visiting = [];
  const visited = new Set();
  const reportedCycles = new Set();
  const visit = (id) => {
    const cycleIndex = visiting.indexOf(id);
    if (cycleIndex !== -1) {
      const cycle = [...visiting.slice(cycleIndex), id];
      const key = cycle.join("\u0000");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        diagnostics.push(diagnostic(
          "RL111",
          "Live dependency cycle: " + cycle.join(" → "),
          nodes[id]?.source,
          cycle.slice(0, -1).map((entry) => nodes[entry]?.source).filter(Boolean)
        ));
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.push(id);
    for (const dependency of nodes[id]?.dependencies ?? []) {
      if (nodes[dependency.id]) visit(dependency.id);
    }
    visiting.pop();
    visited.add(id);
  };
  for (const id of Object.keys(nodes)) visit(id);

  return {
    version: 1,
    nodes,
    diagnostics,
    ok: diagnostics.every((entry) => entry.severity !== "error")
  };
};

const resourceValue = (resources, name) => {
  if (resources instanceof Map) return resources.get(name);
  return resources?.[name];
};

const providerById = (providers, id) => providers.find((provider) => provider?.id === id);

/**
 * Execute a planned live graph. This initial scheduler is deliberately
 * sequential and deterministic; the provider contract is asynchronous so
 * bounded parallel scheduling can be added without changing executors.
 */
export const executeLiveProgram = async (program, options = {}) => {
  const providers = providerValues(options.providers);
  const plan = planLiveExecutions(program, { providers });
  const diagnostics = [...plan.diagnostics];
  const executions = {};
  const active = [];

  const execute = async (id) => {
    if (executions[id]) return executions[id];
    const node = plan.nodes[id];
    if (!node) return null;
    if (active.includes(id)) {
      const failed = { id, status: "failed", value: undefined, serialized: undefined };
      executions[id] = failed;
      return failed;
    }
    active.push(id);
    if (node.analysis.diagnostics.some((entry) => entry.severity === "error")) {
      active.pop();
      const failed = { id, status: "failed", value: undefined, serialized: undefined };
      executions[id] = failed;
      return failed;
    }
    const inputs = {};
    let blocked = false;
    for (const dependency of node.dependencies) {
      const liveDependency = plan.nodes[dependency.id];
      if (liveDependency) {
        const completed = await execute(dependency.id);
        if (completed?.status !== "succeeded") {
          diagnostics.push(diagnostic(
            "RL112",
            "Execution " + id + " is blocked by failed dependency " + dependency.id + ".",
            dependency.source
          ));
          blocked = true;
          continue;
        }
        inputs[dependency.reference] = cloneRavelValue(completed.value);
      } else {
        inputs[dependency.reference] = program.chunks[dependency.id].value;
      }
    }

    const resources = {};
    for (const entry of node.resources) {
      const name = typeof entry === "string" ? entry : entry?.name ?? entry?.path;
      const value = resourceValue(options.resources, name);
      if (value === undefined) {
        diagnostics.push(diagnostic("RL113", "Missing live resource: " + String(name), node.source));
        blocked = true;
      } else {
        resources[name] = cloneRavelValue(value);
      }
    }

    if (blocked) {
      active.pop();
      const failed = { id, status: "failed", value: undefined, serialized: undefined };
      executions[id] = failed;
      return failed;
    }

    const provider = providerById(providers, node.provider.id);
    let outcome;
    try {
      outcome = await provider.execute({
        version: 1,
        id,
        runId: options.runId ?? "live",
        language: node.language,
        source: program.chunks[id].value,
        sourceLocation: node.source,
        inputs,
        resources,
        analysis: node.analysis,
        limits: options.limits ?? {},
        signal: options.signal
      });
    } catch (error) {
      outcome = {
        ok: false,
        diagnostics: [diagnostic(
          "RL120",
          "Provider " + node.provider.id + " failed while executing " + id + ": " +
            (error?.message ?? String(error)),
          node.source
        )]
      };
    }
    const normalizedOutcome = {
      version: outcome?.version ?? 1,
      status: outcome?.status ?? (outcome?.ok && outcome?.hasExport !== false ? "succeeded" : "failed"),
      ...outcome,
      diagnostics: Array.isArray(outcome?.diagnostics) ? outcome.diagnostics : []
    };
    diagnostics.push(...normalizedOutcome.diagnostics);
    active.pop();

    if (normalizedOutcome.status !== "succeeded" || !normalizedOutcome.ok || normalizedOutcome.hasExport === false) {
      const failed = { id, status: "failed", value: undefined, serialized: undefined };
      executions[id] = failed;
      return failed;
    }

    let value;
    try {
      value = typeof normalizedOutcome.serialized === "string"
        ? JSON.parse(normalizedOutcome.serialized)
        : cloneRavelValue(normalizedOutcome.value);
      const serialized = serializeRavelValue(value);
      const succeeded = {
        id,
        status: "succeeded",
        value,
        serialized,
        provider: node.provider,
        durationMs: normalizedOutcome.durationMs
      };
      executions[id] = succeeded;
      return succeeded;
    } catch (error) {
      diagnostics.push(diagnostic(
        "RL121",
        "Execution " + id + " returned an invalid Ravel value: " + (error?.message ?? String(error)),
        node.source
      ));
      const failed = { id, status: "failed", value: undefined, serialized: undefined };
      executions[id] = failed;
      return failed;
    }
  };

  for (const id of Object.keys(plan.nodes)) await execute(id);
  return {
    version: 1,
    program,
    plan,
    executions,
    diagnostics,
    ok: diagnostics.every((entry) => entry.severity !== "error")
  };
};
