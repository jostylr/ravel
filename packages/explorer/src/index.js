export const EXPLORER_SNAPSHOT_VERSION = 1;
export const EXPLORER_PROTOCOL_VERSION = 1;

export const explorerLenses = Object.freeze([
  "overview",
  "dependencies",
  "derivation",
  "provenance",
  "trace",
  "changes"
]);

export const explorerRequestTypes = Object.freeze([
  "project/open",
  "view/request",
  "entity/select",
  "source/reveal",
  "output/request",
  "edit/preview",
  "edit/apply",
  "edit/discard",
  "perspective/save",
  "perspective/restore",
  "request/cancel"
]);

export const explorerEventTypes = Object.freeze([
  "project/opened",
  "view/result",
  "selection/changed",
  "output/result",
  "edit/preview-result",
  "edit/applied",
  "diagnostics/changed",
  "document/changed",
  "request/progress",
  "request/error"
]);

const compareText = (left, right) => String(left).localeCompare(String(right));
const sortedEntries = (value) => Object.entries(value ?? {}).sort(([left], [right]) => compareText(left, right));
const uniqueSorted = (values) => [...new Set(values)].sort(compareText);
const finiteDepth = (value, fallback) => {
  if (value === Infinity) return Infinity;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

const stableValue = (value, seen = new Set()) => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((entry) => stableValue(entry, seen))
    : Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, stableValue(value[key], seen)])
    );
  seen.delete(value);
  return result;
};

const stableStringify = (value) => JSON.stringify(stableValue(value));

const fingerprint = (value) => {
  const text = typeof value === "string" ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const sourceOffset = (source) => source?.range?.start?.offset;
const sourceKey = (source) => source?.uri
  ? source.uri + ":" + (sourceOffset(source) ?? "?") + ":" + (source?.range?.end?.offset ?? "?")
  : "generated";

const intersects = (left, right) => Boolean(
  left?.uri &&
  right?.uri &&
  left.uri === right.uri &&
  left.range?.start?.offset < right.range?.end?.offset &&
  right.range?.start?.offset < left.range?.end?.offset
);

const normalizeContext = (value) => value?.program?.chunks
  ? value
  : { program: value };

const rawFocus = (focus) => Array.isArray(focus)
  ? focus
  : focus === undefined || focus === null
    ? []
    : [focus];

const chunkNodeId = (id) => "chunk:" + id;
const documentNodeId = (id) => "document:" + id;
const deliverableNodeId = (name) => "deliverable:" + name;

const chunkLabel = (chunk, fallback) => {
  const identity = chunk?.identity;
  if (!identity?.chunk) return chunk?.name ?? fallback;
  const stem = identity.minor
    ? identity.chunk + ":" + identity.minor
    : identity.chunk;
  return identity.type && !stem.endsWith("." + identity.type)
    ? stem + "." + identity.type
    : stem;
};

const normalizeFocus = (context, focus) => {
  const program = context.program;
  const chunks = new Set(Object.keys(program?.chunks ?? {}));
  const deliverables = program?.deliverables ?? {};
  const result = [];
  for (const requested of rawFocus(focus).map(String)) {
    if (chunks.has(requested)) result.push(requested);
    else if (requested.startsWith("chunk:") && chunks.has(requested.slice(6))) result.push(requested.slice(6));
    else if (requested.startsWith("deliverable:") && deliverables[requested.slice(12)]) {
      result.push(deliverables[requested.slice(12)].from);
    } else if (deliverables[requested]) result.push(deliverables[requested].from);
    else if (requested.startsWith("document:")) {
      const document = requested.slice(9);
      result.push(...[...chunks].filter((id) => program.chunks[id]?.identity?.document === document));
    }
  }
  return uniqueSorted(result);
};

const graphRelations = (context) => {
  const program = context.program;
  const chunkIds = Object.keys(program?.chunks ?? {}).sort(compareText);
  const known = new Set(chunkIds);
  const upstream = new Map(chunkIds.map((id) => [id, new Set()]));
  const downstream = new Map(chunkIds.map((id) => [id, new Set()]));

  for (const id of chunkIds) {
    for (const dependency of program.chunks[id]?.dependencies ?? []) {
      if (known.has(dependency)) upstream.get(id).add(dependency);
    }
  }
  for (const [id, live] of sortedEntries(context.livePlan?.nodes)) {
    if (!known.has(id)) continue;
    for (const dependency of live.dependencies ?? []) {
      if (known.has(dependency.id)) upstream.get(id).add(dependency.id);
    }
  }
  for (const [consumer, dependencies] of upstream) {
    for (const producer of dependencies) downstream.get(producer)?.add(consumer);
  }
  return {
    chunkIds,
    upstream: new Map([...upstream].map(([id, values]) => [id, [...values].sort(compareText)])),
    downstream: new Map([...downstream].map(([id, values]) => [id, [...values].sort(compareText)]))
  };
};

const walk = (adjacency, starts, depth) => {
  const found = new Set(starts);
  let frontier = [...starts].sort(compareText);
  let level = 0;
  while (frontier.length && level < depth) {
    const next = [];
    for (const id of frontier) {
      for (const related of adjacency.get(id) ?? []) {
        if (found.has(related)) continue;
        found.add(related);
        next.push(related);
      }
    }
    frontier = uniqueSorted(next);
    level += 1;
  }
  return [...found].sort(compareText);
};

export const upstreamChunkIds = (programOrContext, focus, depth = 1) => {
  const context = normalizeContext(programOrContext);
  const starts = normalizeFocus(context, focus);
  return walk(graphRelations(context).upstream, starts, finiteDepth(depth, 1));
};

export const downstreamChunkIds = (programOrContext, focus, depth = 1) => {
  const context = normalizeContext(programOrContext);
  const starts = normalizeFocus(context, focus);
  return walk(graphRelations(context).downstream, starts, finiteDepth(depth, 1));
};

export const dependencyPath = (programOrContext, producer, consumer) => {
  const context = normalizeContext(programOrContext);
  const relations = graphRelations(context);
  const from = normalizeFocus(context, producer)[0];
  const to = normalizeFocus(context, consumer)[0];
  if (!from || !to) return [];
  if (from === to) return [from];
  const queue = [[from]];
  const visited = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    for (const next of relations.downstream.get(path.at(-1)) ?? []) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) return candidate;
      visited.add(next);
      queue.push(candidate);
    }
  }
  return [];
};

const focusedChunks = (context, options) => {
  const relations = graphRelations(context);
  const focus = normalizeFocus(context, options.focus);
  if (!focus.length) return { focus, chunks: relations.chunkIds };
  const upstream = walk(relations.upstream, focus, finiteDepth(options.upstream, 1));
  const downstream = walk(relations.downstream, focus, finiteDepth(options.downstream, 1));
  return { focus, chunks: uniqueSorted([...upstream, ...downstream]) };
};

const diagnosticSummary = (diagnostics) => {
  const summary = { errors: 0, warnings: 0, information: 0 };
  for (const diagnostic of diagnostics ?? []) {
    if (diagnostic?.severity === "error") summary.errors += 1;
    else if (diagnostic?.severity === "warning") summary.warnings += 1;
    else summary.information += 1;
  }
  return summary;
};

const documentForSource = (documents, source) => {
  if (!source?.uri) return null;
  return documents.find((document) => document.uri === source.uri) ?? null;
};

const directiveChunkId = (directive) => {
  if (!directive?.document || !directive?.name) return null;
  return directive.document + "::" + directive.name;
};

const resolveDirectiveReference = (program, directive, owner, reference) => {
  if (typeof reference !== "string" || !reference) return null;
  if (program.chunks[reference]) return reference;
  const document = directive.document ?? owner?.id;
  const local = document ? document + "::" + reference : reference;
  if (program.chunks[local]) return local;
  const suffix = "::" + reference;
  const matches = Object.keys(program.chunks).filter((id) => id.endsWith(suffix));
  return matches.length === 1 ? matches[0] : null;
};

const relatedDirective = (directive, selected, selectedDocuments, program) => {
  if (!selected.size) return true;
  if (directive?.from && selected.has(directive.from)) return true;
  const generated = directiveChunkId(directive);
  if (generated && selected.has(generated)) return true;
  const owner = documentForSource(program.documents ?? [], directive?.source);
  return Boolean(owner && selectedDocuments.has(owner.id));
};

const addCandidate = (candidates, node, priority) => {
  const current = candidates.get(node.id);
  if (!current || priority < current.priority) candidates.set(node.id, { node, priority });
};

const addEdge = (edges, edge) => {
  const base = [
    edge.kind,
    edge.source,
    edge.target,
    sourceKey(edge.authoredAt),
    edge.phase ?? "",
    edge.label ?? ""
  ].join("|");
  let id = edge.id ?? "edge:" + fingerprint(base);
  let suffix = 1;
  while (edges.has(id)) {
    id = "edge:" + fingerprint(base + "|" + suffix);
    suffix += 1;
  }
  edges.set(id, { id, ...edge });
};

const nodeDiagnostics = (chunk, diagnostics) => (diagnostics ?? []).filter((diagnostic) =>
  intersects(chunk.source, diagnostic.source)
);

const defaultRevision = (context) => "explorer:" + fingerprint({
  version: context.program?.version,
  documents: context.program?.documents,
  chunks: sortedEntries(context.program?.chunks).map(([id, chunk]) => ({
    id,
    value: chunk.value,
    dependencies: chunk.dependencies,
    references: chunk.references,
    metadata: chunk.metadata,
    segments: chunk.segments
  })),
  deliverables: sortedEntries(context.program?.deliverables).map(([name, output]) => ({
    name,
    from: output.from,
    value: output.value,
    segments: output.segments
  })),
  diagnostics: context.program?.diagnostics,
  livePlan: context.livePlan
});

export const createExplorerSnapshot = (programOrContext, options = {}) => {
  const context = normalizeContext(programOrContext);
  const program = context.program;
  if (!program?.chunks || !program?.deliverables) {
    throw new TypeError("createExplorerSnapshot requires a RavelProgram or { program } context.");
  }

  const lens = explorerLenses.includes(options.lens) ? options.lens : "dependencies";
  const maximum = Math.max(2, Number.isInteger(options.maxNodes) ? options.maxNodes : 500);
  const focused = focusedChunks(context, options);
  const selected = new Set(focused.chunks);
  const focus = new Set(focused.focus);
  const relations = graphRelations(context);
  const candidates = new Map();
  const edges = new Map();
  const documents = [...(program.documents ?? [])].sort((left, right) => compareText(left.id, right.id));
  const selectedDocuments = new Set(
    focused.chunks.map((id) => program.chunks[id]?.identity?.document).filter(Boolean)
  );

  for (const document of documents) {
    if (selectedDocuments.size && !selectedDocuments.has(document.id)) continue;
    addCandidate(candidates, {
      id: documentNodeId(document.id),
      kind: "document",
      label: document.id,
      source: document.uri ? { uri: document.uri } : undefined,
      data: { format: document.format, uri: document.uri },
      fingerprint: fingerprint(document)
    }, 0);
  }

  for (const id of focused.chunks) {
    const chunk = program.chunks[id];
    if (!chunk) continue;
    const diagnostics = nodeDiagnostics(chunk, program.diagnostics);
    const liveNode = context.livePlan?.nodes?.[id];
    const execution = context.liveResult?.executions?.[id];
    const states = [
      chunk.generated ? "generated" : null,
      chunk.metadata?.data?.ravel?.run ? "live" : null,
      execution?.status,
      diagnostics.some((entry) => entry.severity === "error") ? "error" : null,
      diagnostics.some((entry) => entry.severity === "warning") ? "warning" : null
    ].filter(Boolean);
    const parent = chunk.identity?.document ? documentNodeId(chunk.identity.document) : undefined;
    addCandidate(candidates, {
      id: chunkNodeId(id),
      kind: "chunk",
      label: chunkLabel(chunk, id),
      parent,
      source: chunk.source,
      language: chunk.metadata?.language,
      tags: chunk.metadata?.tags ?? [],
      state: uniqueSorted(states),
      counts: {
        incoming: relations.upstream.get(id)?.length ?? 0,
        outgoing: relations.downstream.get(id)?.length ?? 0,
        references: chunk.references?.length ?? 0,
        transforms: context.pretransform?.chunks?.find((entry) => entry.id === id)?.definitionPipeline?.length ?? 0
      },
      data: {
        chunkId: id,
        identity: chunk.identity,
        generated: Boolean(chunk.generated),
        live: Boolean(chunk.metadata?.data?.ravel?.run),
        valueLength: chunk.value?.length ?? 0,
        traceCount: context.program.trace?.chunks?.[id]?.length ?? chunk.trace?.length ?? 0
      },
      fingerprint: fingerprint({
        value: chunk.value,
        dependencies: chunk.dependencies,
        references: chunk.references,
        metadata: chunk.metadata,
        segments: chunk.segments,
        execution
      })
    }, focus.has(id) ? 1 : 2);
    if (parent) {
      addEdge(edges, { kind: "contains", source: parent, target: chunkNodeId(id) });
    }

    const referenced = new Set();
    for (const [index, reference] of (chunk.references ?? []).entries()) {
      if (!selected.has(reference.chunk)) continue;
      referenced.add(reference.chunk);
      addEdge(edges, {
        kind: "references",
        source: chunkNodeId(reference.chunk),
        target: chunkNodeId(id),
        authoredAt: reference.source,
        label: reference.requested,
        occurrence: index
      });
    }
    for (const dependency of chunk.dependencies ?? []) {
      if (!selected.has(dependency) || referenced.has(dependency)) continue;
      addEdge(edges, {
        kind: "references",
        source: chunkNodeId(dependency),
        target: chunkNodeId(id)
      });
    }

    for (const [index, dependency] of (liveNode?.dependencies ?? []).entries()) {
      if (!selected.has(dependency.id)) continue;
      addEdge(edges, {
        kind: "consumes",
        source: chunkNodeId(dependency.id),
        target: chunkNodeId(id),
        authoredAt: dependency.source,
        label: dependency.reference,
        occurrence: index
      });
    }
  }

  const rawChunks = new Map((context.pretransform?.chunks ?? []).map((chunk) => [chunk.id, chunk]));
  for (const id of focused.chunks) {
    const raw = rawChunks.get(id);
    let prior = chunkNodeId(id);
    for (const [phase, step] of (raw?.definitionPipeline ?? []).entries()) {
      const transformId = "transform:" + id + ":" + phase + ":" + step.name;
      addCandidate(candidates, {
        id: transformId,
        kind: "transform",
        label: step.name,
        parent: chunkNodeId(id),
        source: step.source ?? raw.source,
        data: { owner: id, phase: phase + 1, arguments: step.arguments ?? [] },
        fingerprint: fingerprint(step)
      }, 4);
      addEdge(edges, {
        kind: "transforms",
        source: prior,
        target: transformId,
        authoredAt: step.source ?? raw.source,
        phase: phase + 1
      });
      prior = transformId;
    }
  }

  for (const [name, deliverable] of sortedEntries(program.deliverables)) {
    if (!selected.has(deliverable.from)) continue;
    const id = deliverableNodeId(name);
    addCandidate(candidates, {
      id,
      kind: "deliverable",
      label: name,
      source: deliverable.source,
      data: {
        name,
        from: deliverable.from,
        valueLength: deliverable.value?.length ?? 0
      },
      fingerprint: fingerprint({
        value: deliverable.value,
        from: deliverable.from,
        segments: deliverable.segments
      })
    }, 3);
    addEdge(edges, {
      kind: "produces",
      source: chunkNodeId(deliverable.from),
      target: id,
      authoredAt: deliverable.source
    });
  }

  for (const [index, directive] of (context.pretransform?.directives ?? []).entries()) {
    if (!relatedDirective(directive, selected, selectedDocuments, program)) continue;
    const owner = documentForSource(documents, directive.source);
    const id = "directive:" + directive.kind + ":" + sourceKey(directive.source) + ":" + index;
    addCandidate(candidates, {
      id,
      kind: "directive",
      label: directive.kind + (directive.name ? ": " + directive.name : ""),
      parent: owner ? documentNodeId(owner.id) : undefined,
      source: directive.source,
      data: {
        kind: directive.kind,
        name: directive.name,
        from: directive.from,
        target: directive.target,
        document: directive.document
      },
      fingerprint: fingerprint(directive)
    }, 4);
    if (owner) addEdge(edges, { kind: "contains", source: documentNodeId(owner.id), target: id });
    if (directive.kind === "out" && directive.from && program.deliverables?.[directive.name]) {
      addEdge(edges, {
        kind: "declares",
        source: chunkNodeId(directive.from),
        target: id,
        authoredAt: directive.source
      });
      addEdge(edges, {
        kind: "produces",
        source: id,
        target: deliverableNodeId(directive.name),
        authoredAt: directive.source
      });
    }
    const generated = directiveChunkId(directive);
    if ((directive.kind === "create" || directive.kind === "alias") && program.chunks[generated]) {
      addEdge(edges, {
        kind: "declares",
        source: id,
        target: chunkNodeId(generated),
        authoredAt: directive.source
      });
    }
    if (directive.kind === "alias" && directive.reference) {
      const referenced = resolveDirectiveReference(program, directive, owner, directive.reference);
      if (referenced && selected.has(referenced)) {
        addEdge(edges, {
          kind: "aliases",
          source: chunkNodeId(referenced),
          target: id,
          authoredAt: directive.source,
          label: directive.reference
        });
      }
    }
    const addSteps = (steps, parent, prefix, level = 0) => {
      let prior = parent;
      for (const [stepIndex, step] of (steps ?? []).entries()) {
        const stepKind = step.type ?? step.kind ?? "step";
        const stepId = prefix + ":" + stepIndex + ":" + stepKind +
          (step.name ? ":" + step.name : "");
        const kind = stepKind === "transform"
          ? "transform"
          : stepKind === "emit"
            ? "emit"
            : "compose-step";
        const label = stepKind === "append"
          ? "append: " + step.reference
          : stepKind === "newline"
            ? "newline(" + step.count + ")"
            : step.name ?? stepKind;
        addCandidate(candidates, {
          id: stepId,
          kind,
          label,
          parent,
          source: step.source ?? directive.source,
          data: {
            directive: id,
            stepKind,
            arguments: step.arguments ?? [],
            reference: step.reference,
            count: step.count
          },
          fingerprint: fingerprint(step)
        }, 5 + level);
        addEdge(edges, {
          kind: stepKind === "transform"
            ? "transforms"
            : stepKind === "emit"
              ? "emits"
              : "composes",
          source: prior,
          target: stepId,
          authoredAt: step.source ?? directive.source,
          label
        });
        if (stepKind === "append" && step.reference) {
          const referenced = resolveDirectiveReference(program, directive, owner, step.reference);
          if (referenced && selected.has(referenced)) {
            addEdge(edges, {
              kind: "references",
              source: chunkNodeId(referenced),
              target: stepId,
              authoredAt: step.source ?? directive.source,
              label: step.reference
            });
          }
        }
        if (stepKind === "emit") {
          const emitted = focused.chunks.find((chunkId) =>
            (program.chunks[chunkId]?.provenance ?? []).some((entry) =>
              entry?.kind === "emit" && sourceKey(entry.source) === sourceKey(step.source)
            )
          );
          if (emitted) {
            addEdge(edges, {
              kind: "emits",
              source: stepId,
              target: chunkNodeId(emitted),
              authoredAt: step.source
            });
          }
        }
        if (step.steps?.length) addSteps(step.steps, stepId, stepId + ":step", level + 1);
        prior = stepId;
      }
      return prior;
    };
    if (directive.compose?.length) {
      const lastStep = addSteps(directive.compose, id, "compose:" + id);
      if (generated && selected.has(generated) && lastStep !== id) {
        addEdge(edges, {
          kind: "declares",
          source: lastStep,
          target: chunkNodeId(generated),
          authoredAt: directive.source
        });
      }
    }
    if (directive.kind === "in" && owner && directive.target) {
      const imported = documents.find((document) =>
        document.uri === directive.target ||
        document.uri?.endsWith("/" + directive.target)
      );
      if (imported) {
        addCandidate(candidates, {
          id: documentNodeId(imported.id),
          kind: "document",
          label: imported.id,
          source: imported.uri ? { uri: imported.uri } : undefined,
          data: { format: imported.format, uri: imported.uri },
          fingerprint: fingerprint(imported)
        }, 3);
        addEdge(edges, {
          kind: "imports",
          source: documentNodeId(imported.id),
          target: documentNodeId(owner.id),
          authoredAt: directive.source
        });
      }
    }
  }

  const orderedCandidates = [...candidates.values()].sort((left, right) =>
    left.priority - right.priority || compareText(left.node.id, right.node.id)
  );
  const nodes = orderedCandidates.slice(0, maximum).map(({ node }) => node);
  const included = new Set(nodes.map((node) => node.id));
  const visibleEdges = [...edges.values()]
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .sort((left, right) => compareText(left.id, right.id));
  const groups = nodes
    .filter((node) => node.kind === "document")
    .map((document) => ({
      id: "group:" + document.id,
      kind: "document",
      label: document.label,
      nodeIds: nodes.filter((node) => node.parent === document.id).map((node) => node.id).sort(compareText),
      collapsed: false
    }));

  return {
    version: EXPLORER_SNAPSHOT_VERSION,
    project: context.project ?? {
      id: documents[0]?.id ?? "ravel",
      label: documents[0]?.id ?? "Ravel project"
    },
    revision: context.revision ?? defaultRevision(context),
    lens,
    focus: focused.focus.map(chunkNodeId),
    truncated: orderedCandidates.length > nodes.length,
    nodes,
    edges: visibleEdges,
    groups,
    diagnostics: diagnosticSummary(program.diagnostics),
    counts: {
      availableNodes: orderedCandidates.length,
      visibleNodes: nodes.length,
      visibleEdges: visibleEdges.length,
      chunks: focused.chunks.length
    }
  };
};

const changedById = (before, after) => {
  const left = new Map((before ?? []).map((value) => [value.id, value]));
  const right = new Map((after ?? []).map((value) => [value.id, value]));
  const added = [...right.keys()].filter((id) => !left.has(id)).sort(compareText);
  const removed = [...left.keys()].filter((id) => !right.has(id)).sort(compareText);
  const changed = [...right.keys()].filter((id) =>
    left.has(id) && stableStringify(left.get(id)) !== stableStringify(right.get(id))
  ).sort(compareText);
  return { added, removed, changed };
};

export const diffExplorerSnapshots = (before, after) => {
  if (before?.version !== EXPLORER_SNAPSHOT_VERSION || after?.version !== EXPLORER_SNAPSHOT_VERSION) {
    throw new TypeError("diffExplorerSnapshots requires two version-1 Explorer snapshots.");
  }
  return {
    version: 1,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    nodes: changedById(before.nodes, after.nodes),
    edges: changedById(before.edges, after.edges),
    diagnosticsChanged: stableStringify(before.diagnostics) !== stableStringify(after.diagnostics)
  };
};

export const collapseExplorerGroups = (snapshot, groupIds) => {
  if (snapshot?.version !== EXPLORER_SNAPSHOT_VERSION) {
    throw new TypeError("collapseExplorerGroups requires a version-1 Explorer snapshot.");
  }
  const requested = new Set(Array.isArray(groupIds) ? groupIds : [groupIds]);
  const groups = snapshot.groups.map((group) => ({
    ...group,
    collapsed: requested.has(group.id)
  }));
  const parents = new Map(snapshot.nodes.map((node) => [node.id, node.parent]));
  const replacement = new Map();

  const descendantsOf = (container) => {
    const descendants = [];
    for (const node of snapshot.nodes) {
      let parent = parents.get(node.id);
      while (parent) {
        if (parent === container) {
          descendants.push(node.id);
          break;
        }
        parent = parents.get(parent);
      }
    }
    return descendants;
  };

  for (const group of groups.filter(({ collapsed }) => collapsed).sort((left, right) => compareText(left.id, right.id))) {
    const container = group.id.startsWith("group:") ? group.id.slice(6) : null;
    if (!container || !parents.has(container)) continue;
    for (const descendant of descendantsOf(container)) replacement.set(descendant, container);
  }

  if (!replacement.size) return { ...snapshot, groups };

  const nodes = snapshot.nodes
    .filter((node) => !replacement.has(node.id))
    .map((node) => {
      const hiddenChildren = [...replacement.values()].filter((id) => id === node.id).length;
      if (!hiddenChildren) return node;
      return {
        ...node,
        state: uniqueSorted([...(node.state ?? []), "collapsed"]),
        counts: { ...(node.counts ?? {}), hiddenChildren },
        data: { ...(node.data ?? {}), collapsed: true }
      };
    });

  const visibleEdges = new Map();
  for (const edge of snapshot.edges) {
    const source = replacement.get(edge.source) ?? edge.source;
    const target = replacement.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const changed = source !== edge.source || target !== edge.target;
    if (!changed) {
      visibleEdges.set(edge.id, edge);
      continue;
    }
    const key = [edge.kind, source, target].join("|");
    const id = "edge:aggregate:" + fingerprint(key);
    const existing = visibleEdges.get(id);
    const members = [...(existing?.members ?? []), ...(edge.members ?? [edge.id])];
    const label = existing
      ? existing.label === edge.label
        ? existing.label
        : undefined
      : edge.label;
    visibleEdges.set(id, {
      id,
      kind: edge.kind,
      source,
      target,
      ...(label ? { label } : {}),
      count: (existing?.count ?? 0) + (edge.count ?? 1),
      ...(members.length <= 100 ? { members } : {})
    });
  }
  const edges = [...visibleEdges.values()].sort((left, right) => compareText(left.id, right.id));
  return {
    ...snapshot,
    nodes,
    edges,
    groups,
    counts: {
      ...snapshot.counts,
      visibleNodes: nodes.length,
      visibleEdges: edges.length
    }
  };
};

export const validateExplorerMessage = (message) => {
  const issues = [];
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return ["Message must be an object."];
  }
  if (message.version !== EXPLORER_PROTOCOL_VERSION) {
    issues.push("Message version must be " + EXPLORER_PROTOCOL_VERSION + ".");
  }
  if (typeof message.type !== "string" ||
      !explorerRequestTypes.includes(message.type) &&
      !explorerEventTypes.includes(message.type)) {
    issues.push("Unknown Explorer message type.");
  }
  if (typeof message.requestId !== "string" || !message.requestId.trim()) {
    issues.push("Message requestId must be a nonempty string.");
  }
  if (message.revision !== undefined && typeof message.revision !== "string") {
    issues.push("Message revision must be a string when present.");
  }
  return issues;
};

export const assertExplorerMessage = (message) => {
  const issues = validateExplorerMessage(message);
  if (issues.length) {
    const error = new TypeError("Invalid Explorer message: " + issues.join(" "));
    error.issues = issues;
    throw error;
  }
  return message;
};
