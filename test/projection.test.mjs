import assert from "node:assert/strict";
import test from "node:test";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import {
  applyTransformMap,
  buildVirtualDocument,
  coalesceProjectionSegments,
  composeOffsetMaps,
  createDedentOffsetMap,
  createEolOffsetMap,
  createIndentOffsetMap,
  createLineIndex,
  createProjectionService,
  createProjectionTextChange,
  createVirtualUri,
  generatedContext,
  identityTransformMap,
  mapSourceOffset,
  mapSourceRange,
  mapTransformOffset,
  mapVirtualOffset,
  mapVirtualRange,
  normalizeSourceMap,
  offsetAt,
  opaqueTransformMap,
  positionAt,
  stageCapabilities,
  validateAnalysisTransform,
  validateTransformMapping
} from "../packages/projection/src/index.js";

const position = (offset) => ({ line: 0, column: offset, offset });
const source = (offset, length = 1, uri = "guide.md") => ({
  uri,
  range: { start: position(offset), end: position(offset + length) }
});
const identity = (chunk, type = "ts") => ({
  document: "guide", chunk, minor: null, type
});

const repeatedProgram = () => transformGraph(combineMaps([{
  version: 1,
  document: { id: "guide", uri: "guide.md", format: "test" },
  chunks: [
    {
      id: "guide::leaf.ts",
      identity: identity("leaf"),
      body: "const value = 42;",
      source: source(100, 17),
      metadata: { language: "typescript" }
    },
    {
      id: "guide::mid.ts",
      identity: identity("mid"),
      body: "_\"leaf.ts\"\n",
      source: source(200, 11),
      metadata: { language: "typescript" }
    },
    {
      id: "guide::empty.ts",
      identity: identity("empty"),
      body: "",
      source: source(300, 0),
      metadata: { language: "typescript" }
    },
    {
      id: "guide::main.ts",
      identity: identity("main"),
      body: "_\"mid.ts\"_\"empty.ts\"_\"mid.ts\"",
      source: source(400, 34),
      metadata: { language: "typescript" }
    }
  ],
  directives: [{ kind: "out", name: "app.ts", from: "guide::main.ts", source: source(500) }]
}]));

const independentProgram = (left = "one", right = "two") => transformGraph(combineMaps([{
  version: 1,
  document: { id: "guide", uri: "guide.md", format: "test" },
  chunks: [
    { id: "guide::left.ts", identity: identity("left"), body: left, source: source(10, left.length), metadata: { language: "typescript" } },
    { id: "guide::right.ts", identity: identity("right"), body: right, source: source(20, right.length), metadata: { language: "typescript" } }
  ],
  directives: [
    { kind: "out", name: "left.ts", from: "guide::left.ts", source: source(30) },
    { kind: "out", name: "right.ts", from: "guide::right.ts", source: source(31) }
  ]
}]));

test("virtual URIs encode semantic IDs while preserving only path separators", () => {
  assert.equal(
    createVirtualUri({
      workspaceId: "my workspace",
      targetId: "web/client",
      artifactId: "dist/app.ts",
      stage: "assembled",
      path: "dist/app.ts"
    }),
    "pieceful-virtual://my%20workspace/web%2Fclient/dist%2Fapp.ts/assembled/dist/app.ts"
  );
});

test("builds deterministic nested and repeated occurrences from core provenance", () => {
  const program = repeatedProgram();
  assert.deepEqual(program.diagnostics, []);
  const document = buildVirtualDocument(program, {
    artifactId: "app.ts",
    snapshotId: "snapshot-1"
  });
  const rebuilt = buildVirtualDocument(program, {
    artifactId: "app.ts",
    snapshotId: "snapshot-2"
  });

  assert.equal(document.text, "const value = 42;\nconst value = 42;\n");
  assert.equal(document.languageId, "typescript");
  assert.equal(document.contentHash, rebuilt.contentHash);
  assert.deepEqual(document.occurrences.map(({ id }) => id), rebuilt.occurrences.map(({ id }) => id));
  assert.ok(Object.isFrozen(document));
  assert.ok(Object.isFrozen(document.mappings));

  const byPiece = (piece) => document.occurrences.filter((occurrence) => occurrence.pieceId === piece);
  assert.equal(byPiece("guide::main.ts").length, 1);
  assert.equal(byPiece("guide::mid.ts").length, 2);
  assert.equal(byPiece("guide::leaf.ts").length, 2);
  assert.equal(byPiece("guide::empty.ts").length, 1);
  assert.deepEqual(byPiece("guide::empty.ts")[0].virtual, { start: 18, end: 18 });
  assert.deepEqual(byPiece("guide::leaf.ts")[0].expansionPath, [
    "guide::main.ts", "guide::mid.ts", "guide::leaf.ts"
  ]);
});

test("maps exact source positions to every expansion and back occurrence-precisely", () => {
  const document = buildVirtualDocument(repeatedProgram(), { artifactId: "app.ts" });
  const generated = mapSourceOffset(document, "guide.md", 105);
  assert.equal(generated.ok, true);
  assert.deepEqual(generated.matches.map(({ virtualOffset }) => virtualOffset), [5, 23]);
  assert.ok(generated.matches.every((match) => match.quality === "exact" && match.writable));

  for (const match of generated.matches) {
    const roundTrip = mapVirtualOffset(document, match.virtualOffset, {
      occurrenceId: match.occurrenceId
    });
    assert.equal(roundTrip.ok, true);
    assert.deepEqual(roundTrip.matches.map(({ sourceOffset }) => sourceOffset), [105]);
  }

  const sourceRangeMatches = mapSourceRange(document, "guide.md", { start: 106, end: 111 });
  assert.deepEqual(sourceRangeMatches.matches.map(({ virtual }) => virtual), [
    { start: 6, end: 11 },
    { start: 24, end: 29 }
  ]);
  const virtualRange = mapVirtualRange(document, { start: 6, end: 11 });
  assert.equal(virtualRange.matches[0].source.range.start.offset, 106);
  assert.equal(virtualRange.matches[0].source.range.end.offset, 111);

  // Exhaust the interior of every exact segment. This is the occurrence-
  // qualified round-trip property; invocation anchors at a boundary may add
  // navigation candidates but cannot replace the exact candidate.
  for (const segment of document.mappings.filter((entry) =>
    entry.kind === "exact" && entry.virtual.start < entry.virtual.end)) {
    for (let virtualOffset = segment.virtual.start; virtualOffset < segment.virtual.end; virtualOffset += 1) {
      const toSource = mapVirtualOffset(document, virtualOffset, {
        occurrenceId: segment.occurrenceId,
        affinity: "right"
      });
      const exact = toSource.matches.find((match) => match.quality === "exact");
      assert.ok(exact, `missing exact source for virtual offset ${virtualOffset}`);
      const back = mapSourceOffset(document, exact.source.uri, exact.sourceOffset, {
        occurrenceId: segment.occurrenceId,
        affinity: "right"
      });
      assert.ok(back.matches.some((match) => match.virtualOffset === virtualOffset));
    }
  }
});

test("mapping boundaries honor affinity and invalid/stale queries are typed", () => {
  const document = buildVirtualDocument(repeatedProgram(), { artifactId: "app.ts", version: 4 });
  const left = mapVirtualOffset(document, 17, { affinity: "left" });
  const right = mapVirtualOffset(document, 17, { affinity: "right" });
  assert.ok(left.matches.some((match) => match.sourceOffset === 117));
  assert.ok(right.matches.some((match) => match.sourceOffset === 210));
  assert.deepEqual(mapVirtualOffset(document, -1), {
    ok: false,
    reason: "invalid-position",
    matches: []
  });
  assert.equal(mapVirtualOffset(document, 0, { projectionVersion: 3 }).reason, "stale-projection");
  assert.equal(mapVirtualRange(document, { start: 0, end: document.text.length + 1 }).reason, "invalid-range");
  assert.deepEqual(mapSourceOffset(document, "guide.md", -1).matches, []);
  assert.ok(mapVirtualOffset(document, document.text.length, { affinity: "left" }).matches.length > 0);
});

test("synthetic wrappers navigate through the responsible occurrence but are not writable", () => {
  const document = buildVirtualDocument(repeatedProgram(), {
    artifactId: "app.ts",
    prefix: "// generated\n",
    suffix: "// end\n"
  });
  const prefix = mapVirtualOffset(document, 3);
  assert.equal(prefix.matches[0].quality, "synthetic");
  assert.equal(prefix.matches[0].writable, false);
  assert.equal(prefix.matches[0].source.uri, "guide.md");
  assert.equal(document.mappings.find((segment) => segment.role === "prefix").kind, "synthetic");
});

test("generated context supplies highlights, breadcrumbs, siblings, and source navigation", () => {
  const document = buildVirtualDocument(repeatedProgram(), { artifactId: "app.ts" });
  const leaves = document.occurrences.filter((occurrence) => occurrence.pieceId === "guide::leaf.ts");
  const context = generatedContext(document, leaves[0].id, {
    surroundingLines: 1,
    sourceSelection: source(103, 3)
  });
  assert.equal(context.ok, true);
  assert.deepEqual(context.breadcrumb.map(({ pieceId }) => pieceId), [
    "guide::main.ts", "guide::mid.ts", "guide::leaf.ts"
  ]);
  assert.equal(context.siblings.length, 1);
  assert.equal(context.siblings[0].occurrenceId, leaves[1].id);
  assert.ok(context.highlights.some((highlight) => highlight.categories.includes("selected-fragment")));
  assert.equal(generatedContext(document, "missing").reason, "unknown-occurrence");
  assert.equal(generatedContext(document, leaves[0].id, { projectionVersion: 99 }).reason, "stale-projection");
});

test("coalescing requires continuous equivalent mapping behavior", () => {
  const occurrence = "occ";
  const common = {
    pieceId: "guide::piece.ts",
    occurrenceId: occurrence,
    expansionPath: ["guide::piece.ts"],
    kind: "exact",
    role: "content",
    startAffinity: "right",
    endAffinity: "right",
    transformChain: []
  };
  const result = coalesceProjectionSegments([
    { ...common, virtual: { start: 0, end: 2 }, source: source(10, 2) },
    { ...common, virtual: { start: 2, end: 4 }, source: source(12, 2) },
    { ...common, kind: "anchored", virtual: { start: 4, end: 5 }, source: source(14, 2) }
  ]);
  assert.deepEqual(result.map(({ virtual, kind }) => ({ virtual, kind })), [
    { virtual: { start: 0, end: 4 }, kind: "exact" },
    { virtual: { start: 4, end: 5 }, kind: "anchored" }
  ]);
});

test("line indexes convert UTF-8, UTF-16, and UTF-32 with CRLF and non-BMP text", () => {
  const index = createLineIndex("a😀\r\néx");
  assert.deepEqual(positionAt(index, 3, "utf-16").position, { line: 0, character: 3, offset: 3 });
  assert.equal(positionAt(index, 3, "utf-8").position.character, 5);
  assert.equal(positionAt(index, 3, "utf-32").position.character, 2);
  assert.equal(offsetAt(index, { line: 0, character: 5 }, "utf-8").offset, 3);
  assert.equal(offsetAt(index, { line: 0, character: 2 }, "utf-16").reason, "split-character");
  assert.equal(offsetAt(index, { line: 1, character: 3 }, "utf-8").offset, 7);
  assert.equal(positionAt(index, 4, "utf-16").position.character, 3);
});

test("projection service emits opened/changed/unchanged/closed deltas and reuses indexes", async () => {
  const service = createProjectionService({ workspaceId: "tests", maxRetainedSnapshots: 2 });
  const first = await service.update({ id: "s1", program: independentProgram(), sourceVersions: { "guide.md": 1 } });
  assert.equal(first.opened.length, 2);
  assert.equal(first.changed.length, 0);
  const left = first.opened.find((document) => document.artifactId === "left.ts");
  assert.equal(service.getProjection(left.id), left);
  assert.equal(service.getProjectionByUri(left.uri), left);
  assert.equal(service.listProjections().length, 2);

  const second = await service.update({ id: "s2", program: independentProgram(), sourceVersions: { "guide.md": 2 } });
  assert.equal(second.unchanged.length, 2);
  const reusedLeft = service.getProjection(left.id);
  assert.equal(reusedLeft.version, 1);
  assert.equal(reusedLeft.snapshotId, "s2");
  assert.equal(reusedLeft.mappings, left.mappings);
  assert.equal(reusedLeft.lineIndex, left.lineIndex);

  const third = await service.update({ id: "s3", program: independentProgram("one!", "two"), sourceVersions: { "guide.md": 3 } });
  assert.deepEqual(third.changed.map(({ artifactId }) => artifactId), ["left.ts"]);
  assert.deepEqual(third.unchanged.map(({ artifactId }) => artifactId), ["right.ts"]);
  assert.equal(third.changed[0].version, 2);
  assert.equal(third.textChanges[third.changed[0].id].kind, "incremental");
  assert.equal(service.listProjectionsForSource(source(10, 1)).length, 1);
  assert.equal(service.toVirtual({ uri: "guide.md", offset: 11 }).length, 1);
  assert.equal(service.toSource(third.changed[0].id, 1).length, 1);

  const fourth = await service.update({
    id: "s4",
    program: independentProgram("one!", "two"),
    projections: [{ artifactId: "left.ts" }]
  });
  assert.deepEqual(fourth.closed.map(({ artifactId }) => artifactId), ["right.ts"]);
  assert.equal(service.getStats().retainedSnapshots, 2);
  service.dispose();
  assert.equal(service.listProjections().length, 0);
});

test("projection reuse rebuilds when capabilities or virtual identity change", async () => {
  const service = createProjectionService({ workspaceId: "tests" });
  const program = independentProgram();
  const writable = await service.update({
    id: "writable",
    program,
    projections: [{
      artifactId: "left.ts",
      path: "generated/left.ts",
      capabilities: { writableEdits: true }
    }]
  });
  const first = writable.opened[0];
  assert.equal(first.capabilities.writableEdits, true);
  assert.match(first.uri, /generated\/left\.ts$/);

  const readonly = await service.update({
    id: "readonly",
    program,
    projections: [{
      artifactId: "left.ts",
      path: "generated/left.ts",
      capabilities: { writableEdits: false }
    }]
  });
  assert.equal(readonly.changed.length, 1);
  assert.equal(readonly.changed[0].capabilities.writableEdits, false);
  assert.equal(readonly.changed[0].version, 2);

  const relocated = await service.update({
    id: "relocated",
    program,
    projections: [{
      artifactId: "left.ts",
      path: "alternate/left.ts",
      capabilities: { writableEdits: false }
    }]
  });
  assert.equal(relocated.changed.length, 1);
  assert.match(relocated.changed[0].uri, /alternate\/left\.ts$/);
  assert.equal(service.getProjectionByUri(readonly.changed[0].uri), undefined);
});

test("projection updates reject virtual URI aliases without publishing partial state", async () => {
  const service = createProjectionService({ workspaceId: "tests" });
  await service.update({ id: "baseline", program: independentProgram() });
  const baseline = service.listProjections();
  await assert.rejects(service.update({
    id: "collision",
    program: independentProgram("changed-left", "changed-right"),
    projections: [
      { artifactId: "left.ts", uri: "pieceful-virtual://tests/shared.ts" },
      { artifactId: "right.ts", uri: "pieceful-virtual://tests/shared.ts" }
    ]
  }), /multiple projection IDs to the same virtual URI/);

  assert.deepEqual(service.listProjections(), baseline);
  for (const document of baseline) {
    assert.equal(service.getProjection(document.id), document);
    assert.equal(service.getProjectionByUri(document.uri), document);
  }
  assert.equal(
    service.getProjectionByUri("pieceful-virtual://tests/shared.ts"),
    undefined
  );
});

test("projection service rejects pre-cancelled work and interactive scheduling bypasses debounce", async () => {
  const service = createProjectionService({ backgroundDebounceMs: 1_000 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.update({ id: "cancelled", program: independentProgram() }, controller.signal), {
    name: "AbortError"
  });
  const background = service.scheduleUpdate({ id: "background", program: independentProgram() });
  const interactive = service.scheduleUpdate({ id: "interactive", program: independentProgram() }, { priority: "interactive" });
  await assert.rejects(background, { name: "AbortError" });
  assert.equal((await interactive).opened.length, 2);
});

test("a superseding snapshot cancels stale asynchronous projection publication", async () => {
  const resolvers = [];
  const service = createProjectionService({
    yieldEvery: 1,
    scheduler: () => new Promise((resolve) => resolvers.push(resolve))
  });
  const stale = service.update({ id: "stale", program: independentProgram("old", "two") });
  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  const current = service.update({ id: "current", program: independentProgram("new", "two") });
  await Promise.resolve();
  assert.equal(resolvers.length, 2);
  resolvers.shift()();
  await assert.rejects(stale, { name: "AbortError" });
  resolvers.shift()();
  const delta = await current;
  assert.equal(delta.snapshotId, "current");
  assert.equal(service.listProjections().find((entry) => entry.artifactId === "left.ts").text, "new");
  assert.equal(service.getStats().cancelled, 1);
});

test("minimal text changes avoid split surrogate pairs and choose full sync for replacements", () => {
  assert.deepEqual(createProjectionTextChange("abc", "abXc"), {
    kind: "incremental",
    changes: [{ range: { start: 2, end: 2 }, text: "X" }]
  });
  assert.equal(createProjectionTextChange("all old", "brand new").kind, "full");
  const unicode = createProjectionTextChange("a😀b", "a😁b");
  assert.deepEqual(unicode.changes[0].range, { start: 1, end: 3 });
});

test("identity, indentation, dedentation, and EOL maps translate offsets", () => {
  const identityMap = identityTransformMap(4);
  assert.equal(validateTransformMapping(identityMap).ok, true);
  assert.deepEqual(mapTransformOffset(identityMap, 2).matches, [2]);

  const indented = createIndentOffsetMap("a\nb", 2);
  assert.equal(indented.text, "  a\n  b");
  assert.deepEqual(mapTransformOffset(indented.map, 2).matches, [0]);
  assert.deepEqual(mapTransformOffset(indented.map, 0).matches, []);
  assert.deepEqual(mapTransformOffset(indented.map, 0, {
    direction: "input-to-output", affinity: "right"
  }).matches, [2]);

  const dedented = createDedentOffsetMap("  a\n  b");
  assert.equal(dedented.text, "a\nb");
  assert.equal(dedented.amount, 2);
  assert.deepEqual(mapTransformOffset(dedented.map, 0, { direction: "input-to-output" }).matches, []);

  const normalized = createEolOffsetMap("a\r\nb\rc", "\n");
  assert.equal(normalized.text, "a\nb\nc");
  assert.equal(validateTransformMapping(normalized.map).ok, true);
});

test("offset maps compose and retain transformed/synthetic projection provenance", () => {
  const document = buildVirtualDocument(independentProgram("a\r\nb", "two"), {
    artifactId: "left.ts"
  });
  const eol = createEolOffsetMap(document.text, "\n");
  const indent = createIndentOffsetMap(eol.text, 2);
  const composed = composeOffsetMaps(eol.map, indent.map);
  assert.equal(composed.ok, true);
  assert.equal(validateTransformMapping(composed.map).ok, true);
  const applied = applyTransformMap(document, indent.text, composed.map, { name: "format" });
  assert.equal(applied.ok, true);
  assert.equal(applied.document.text, "  a\n  b");
  assert.ok(applied.document.mappings.some((segment) => segment.kind === "synthetic"));
  assert.ok(applied.document.mappings.some((segment) => segment.kind === "transformed"));
  const sourceMatch = mapSourceOffset(applied.document, "guide.md", 10);
  assert.equal(sourceMatch.matches[0].virtualOffset, 2);
});

test("opaque transforms retain a narrow navigation anchor and reject writable edits", () => {
  const document = buildVirtualDocument(independentProgram(), { artifactId: "left.ts" });
  const transformed = applyTransformMap(document, "entirely different", opaqueTransformMap(source(99, 2)), {
    name: "minify"
  });
  assert.equal(transformed.ok, true);
  const result = mapVirtualOffset(transformed.document, 4);
  assert.equal(result.matches[0].quality, "opaque");
  assert.equal(result.matches[0].source.range.start.offset, 99);
  assert.equal(result.matches[0].writable, false);
});

test("core opaque transform origins remain reverse-queryable without becoming writable", () => {
  const program = transformGraph(combineMaps([{
    version: 1,
    document: { id: "guide", uri: "guide.md", format: "test" },
    chunks: [{
      id: "guide::upper.ts",
      identity: identity("upper"),
      body: "value",
      source: source(700, 5),
      definitionPipeline: [{ type: "transform", name: "upper", arguments: [], source: source(800, 5) }],
      metadata: { language: "typescript" }
    }],
    directives: [{ kind: "out", name: "upper.ts", from: "guide::upper.ts", source: source(900) }]
  }]), { transforms: { upper: (value) => value.toUpperCase() } });
  const document = buildVirtualDocument(program, { artifactId: "upper.ts" });
  assert.equal(document.text, "VALUE");
  const authored = mapSourceOffset(document, "guide.md", 702);
  assert.ok(authored.matches.some((match) => match.quality === "opaque"));
  assert.ok(authored.matches.every((match) => !match.writable));
  assert.equal(mapVirtualOffset(document, 2).matches.some((match) =>
    match.source?.range?.start?.offset === 800), true);
});

test("version-3 source maps decode and analysis transforms require purity and no effects", () => {
  const normalized = normalizeSourceMap({
    version: 3,
    sources: ["input.ts"],
    names: [],
    mappings: "AAAA"
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.map.entries[0], {
    generated: { line: 0, column: 0 },
    source: "input.ts",
    original: { line: 0, column: 0 }
  });
  assert.deepEqual(validateAnalysisTransform({
    pure: true,
    mapping: { kind: "identity" }
  }), { ok: true });
  assert.equal(validateAnalysisTransform({ pure: false, mapping: { kind: "identity" } }).reason, "transform-not-declared-pure");
  assert.equal(validateAnalysisTransform({
    pure: true,
    effects: ["filesystem"],
    mapping: { kind: "identity" }
  }).reason, "analysis-transform-requested-effect");
  assert.equal(stageCapabilities("emitted").writableEdits, false);
  assert.throws(() => stageCapabilities("emited"), /Unknown projection stage/);
  assert.deepEqual(applyTransformMap(
    buildVirtualDocument(independentProgram(), { artifactId: "left.ts" }),
    "one",
    { kind: "identity" },
    { stage: "emited" }
  ), { ok: false, reason: "invalid-stage" });
});
