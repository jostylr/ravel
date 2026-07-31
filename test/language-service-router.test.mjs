import assert from "node:assert/strict";
import test from "node:test";
import { createFakeLanguageBridge } from "../packages/language-bridge/src/testing.js";
import { createLanguageRouter } from "../packages/language-service/src/index.js";

const document = (overrides = {}) => ({
  id: "web:dist/app.ts:assembled:typescript",
  uri: "pieceful-virtual://project/web/dist%2Fapp.ts/assembled/typescript",
  snapshotId: "snapshot-1",
  version: 1,
  artifactId: "dist/app.ts",
  targetId: "web",
  stage: "assembled",
  languageId: "typescript",
  text: "const value = answer;\n",
  ...overrides
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const projectionService = (documents = [document()]) => {
  const projections = new Map(documents.map((entry) => [entry.id, entry]));
  return {
    projections,
    getProjection(id) { return projections.get(id); },
    getProjectionByUri(uri) {
      return [...projections.values()].find((entry) => entry.uri === uri);
    },
    listProjections() { return [...projections.values()]; },
    update() { return { opened: [...projections.values()], changed: [], closed: [] }; },
    toVirtual(source) {
      return [...projections.values()].map((entry) => ({
        projectionId: entry.id,
        virtualOffset: source.offset - 100,
        occurrenceId: entry.targetId + ":main:0",
        targetId: entry.targetId,
        artifactId: entry.artifactId,
        kind: "exact"
      }));
    },
    toSource(id, range) {
      const projection = projections.get(id);
      if (!projection) return [];
      if (range.start >= 20) return [{
        kind: "synthetic",
        projectionId: id,
        occurrenceId: projection.targetId + ":main:0"
      }];
      return [{
        kind: "exact",
        projectionId: id,
        occurrenceId: projection.targetId + ":main:0",
        source: {
          uri: "guide.md",
          range: { start: 100 + range.start, end: 100 + range.end }
        }
      }];
    }
  };
};

test("routes completion through the native bridge and maps its replacement span", async () => {
  const service = projectionService();
  const bridge = createFakeLanguageBridge({
    handlers: {
      completion: () => ({
        items: [{ name: "answer", kind: "const", replacementSpan: { start: 14, end: 20 } }],
        isGlobal: false,
        isMember: false,
        isNewIdentifier: false
      })
    }
  });
  const traces = [];
  const router = createLanguageRouter({
    projectionService: service,
    bridges: [bridge],
    trace: (event) => traces.push(event)
  });
  await router.update({});
  const response = await router.request("completion", {
    uri: "guide.md",
    offset: 114
  }, { targetId: "web" });

  assert.equal(response.status, "ok");
  assert.equal(response.context.projectionVersion, 1);
  assert.deepEqual(response.result.items[0].replacementSpan, { start: 114, end: 120 });
  assert.equal(response.result.items[0].sourceUri, "guide.md");
  assert.deepEqual(bridge.operations.map(({ kind }) => kind), [
    "open",
    "request"
  ]);
  assert.equal(traces.at(-1).requestKind, "completion");
  await router.dispose();
});

test("reverse-maps completion spans through the explicitly selected boundary occurrence", async () => {
  const projection = document({ text: "leftright\n" });
  const service = projectionService([projection]);
  service.toVirtual = () => [
    {
      projectionId: projection.id,
      virtualOffset: 4,
      occurrenceId: "web:left:0",
      targetId: "web",
      artifactId: projection.artifactId,
      kind: "exact",
      affinity: "right"
    },
    {
      projectionId: projection.id,
      virtualOffset: 4,
      occurrenceId: "web:right:0",
      targetId: "web",
      artifactId: projection.artifactId,
      kind: "exact",
      affinity: "right"
    }
  ];
  const reverseSelections = [];
  service.toSource = (_id, range, selection = {}) => {
    reverseSelections.push(selection);
    return [
      {
        kind: "exact",
        occurrenceId: "web:left:0",
        source: { uri: "guide.md", range: { start: 104, end: 104 } }
      },
      {
        kind: "exact",
        occurrenceId: "web:right:0",
        source: { uri: "guide.md", range: { start: 204, end: 204 } }
      }
    ].filter(({ occurrenceId }) => occurrenceId === selection.occurrenceId &&
      range.start === 4 && range.end === 4);
  };
  const bridge = createFakeLanguageBridge({
    handlers: {
      completion: () => ({
        items: [{ name: "right", replacementSpan: { start: 4, end: 4 } }]
      })
    }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const response = await router.request("completion", {
    uri: "guide.md",
    offset: 204
  }, {
    targetId: "web",
    artifactId: projection.artifactId,
    occurrenceId: "web:right:0",
    affinity: "right"
  });

  assert.equal(response.status, "ok");
  assert.deepEqual(response.result.items[0].replacementSpan, { start: 204, end: 204 });
  assert.equal(response.result.items[0].sourceUri, "guide.md");
  assert.equal(response.result.items[0].mappingKind, "exact");
  assert.equal(response.result.items[0].generatedOnly, undefined);
  assert.equal(reverseSelections.at(-1).occurrenceId, "web:right:0");
  assert.equal(reverseSelections.at(-1).affinity, "right");
  await router.dispose();
});

test("rejects an ambiguous primary completion destination within one occurrence", async () => {
  const projection = document();
  const service = projectionService([projection]);
  service.toVirtual = () => [{
    projectionId: projection.id,
    virtualOffset: 14,
    occurrenceId: "web:main:0",
    targetId: "web",
    artifactId: projection.artifactId,
    kind: "exact"
  }];
  service.toSource = (_id, range, selection = {}) => [
    {
      kind: "exact",
      occurrenceId: selection.occurrenceId,
      source: { uri: "first.md", range: { start: 14, end: 20 } }
    },
    {
      kind: "identity",
      occurrenceId: selection.occurrenceId,
      source: { uri: "second.md", range: { start: 30, end: 36 } }
    }
  ];
  const bridge = createFakeLanguageBridge({
    handlers: {
      completion: () => ({
        items: [{ name: "answer", replacementSpan: { start: 14, end: 20 } }]
      })
    }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const response = await router.request("completion", {
    uri: "guide.md",
    offset: 114
  }, { occurrenceId: "web:main:0" });

  assert.equal(response.status, "ok");
  assert.deepEqual(response.result.items[0].replacementSpan, { start: 14, end: 20 });
  assert.equal(response.result.items[0].sourceUri, undefined);
  assert.equal(response.result.items[0].mappingKind, undefined);
  assert.equal(response.result.items[0].generatedOnly, true);
  assert.equal(response.result.items[0].ambiguous, true);
  await router.dispose();
});

test("synchronizes every compatible artifact in the selected target and stage", async () => {
  const selected = document({
    mappings: [{ source: { uri: "secret.md" } }],
    sourceLineIndexes: { "secret.md": { text: "do not disclose" } },
    sourceVersions: { "secret.md": 4 },
    indexes: { source: new Map() }
  });
  const dependency = document({
    id: "web:dist/model.ts:assembled:typescript",
    uri: "pieceful-virtual://project/web/dist%2Fmodel.ts/assembled/typescript",
    artifactId: "dist/model.ts",
    text: "export const answer = 42;\n"
  });
  const otherTarget = document({
    id: "server:dist/model.ts:assembled:typescript",
    uri: "pieceful-virtual://project/server/dist%2Fmodel.ts/assembled/typescript",
    artifactId: "dist/model.ts",
    targetId: "server"
  });
  const otherStage = document({
    id: "web:dist/emitted.js:emitted:javascript",
    uri: "pieceful-virtual://project/web/dist%2Femitted.js/emitted/javascript",
    artifactId: "dist/emitted.js",
    stage: "emitted",
    languageId: "javascript"
  });
  const service = projectionService([selected, dependency, otherTarget, otherStage]);
  service.toVirtual = () => [{
    projectionId: selected.id,
    virtualOffset: 14,
    occurrenceId: "web:main:0",
    targetId: "web",
    artifactId: selected.artifactId,
    kind: "exact"
  }];
  const bridge = createFakeLanguageBridge({
    handlers: { completion: () => ({ items: [] }) }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const response = await router.request("completion", { uri: "guide.md", offset: 114 }, {
    targetId: "web",
    artifactId: selected.artifactId
  });
  assert.equal(response.status, "ok");
  assert.deepEqual(
    bridge.operations.filter(({ kind }) => kind === "open").map(({ uri }) => uri),
    [selected.uri, dependency.uri]
  );
  assert.equal(bridge.documents.has(otherTarget.uri), false);
  assert.equal(bridge.documents.has(otherStage.uri), false);
  const bridged = bridge.documents.get(selected.uri);
  assert.equal(bridged.text, selected.text);
  assert.equal(bridged.mappings, undefined);
  assert.equal(bridged.sourceLineIndexes, undefined);
  assert.equal(bridged.sourceVersions, undefined);
  assert.equal(bridged.indexes, undefined);
  await router.dispose();
});

test("deduplicates concurrent first opens and lets queued requests finish before disposal", async () => {
  const openEntered = deferred();
  const releaseOpen = deferred();
  const bridge = createFakeLanguageBridge({
    handlers: { hover: () => ({ display: "const value: number" }) }
  });
  const originalOpen = bridge.open.bind(bridge);
  let openCalls = 0;
  bridge.open = async (...arguments_) => {
    openCalls += 1;
    openEntered.resolve();
    await releaseOpen.promise;
    return originalOpen(...arguments_);
  };
  const router = createLanguageRouter({
    projectionService: projectionService(),
    bridges: [bridge]
  });

  const first = router.request("hover", { uri: "guide.md", offset: 106 });
  await openEntered.promise;
  const second = router.request("hover", { uri: "guide.md", offset: 106 });
  const disposing = router.dispose();
  await Promise.resolve();

  assert.equal(openCalls, 1);
  assert.equal(bridge.state, "ready");

  releaseOpen.resolve();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  await disposing;

  assert.equal(firstResponse.status, "ok");
  assert.equal(secondResponse.status, "ok");
  assert.equal(openCalls, 1);
  assert.deepEqual(bridge.operations.map(({ kind }) => kind), [
    "open",
    "request",
    "request",
    "dispose"
  ]);
});

test("keeps a native request coherent while an update closes and advances sibling documents", async () => {
  const selected = document();
  const changing = document({
    id: "web:dist/model.ts:assembled:typescript",
    uri: "pieceful-virtual://project/web/dist%2Fmodel.ts/assembled/typescript",
    artifactId: "dist/model.ts",
    text: "export const answer = 41;\n"
  });
  const closing = document({
    id: "web:dist/old.ts:assembled:typescript",
    uri: "pieceful-virtual://project/web/dist%2Fold.ts/assembled/typescript",
    artifactId: "dist/old.ts",
    text: "export const old = true;\n"
  });
  const service = projectionService([selected, changing, closing]);
  service.toVirtual = () => [{
    projectionId: selected.id,
    virtualOffset: 6,
    occurrenceId: "web:main:0",
    targetId: "web",
    artifactId: selected.artifactId,
    kind: "exact"
  }];
  let updateStarted = false;
  const changed = {
    ...changing,
    snapshotId: "snapshot-2",
    version: 2,
    text: "export const answer = 42;\n"
  };
  service.update = async () => {
    updateStarted = true;
    service.projections.set(changed.id, changed);
    service.projections.delete(closing.id);
    return { opened: [], changed: [changed], closed: [closing] };
  };

  const bridge = createFakeLanguageBridge({
    handlers: { hover: () => ({ display: "const value: number" }) }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });
  await router.request("hover", { uri: "guide.md", offset: 106 });

  const requestEntered = deferred();
  const releaseRequest = deferred();
  let holdRequest = true;
  bridge.setHandler("hover", async () => {
    if (holdRequest) {
      holdRequest = false;
      requestEntered.resolve();
      await releaseRequest.promise;
    }
    return { display: "const value: number" };
  });

  const heldRequest = router.request("hover", { uri: "guide.md", offset: 106 });
  await requestEntered.promise;
  const updating = router.update({});
  const nextRequest = router.request("hover", { uri: "guide.md", offset: 106 });
  await Promise.resolve();

  assert.equal(updateStarted, false);
  assert.equal(bridge.documents.get(changing.uri).version, 1);
  assert.equal(bridge.documents.has(closing.uri), true);
  assert.equal(bridge.operations.some(({ kind }) => kind === "close"), false);
  assert.equal(bridge.operations.some(({ kind, version }) =>
    kind === "change" && version === 2
  ), false);

  releaseRequest.resolve();
  const heldResponse = await heldRequest;
  await updating;
  const nextResponse = await nextRequest;

  assert.equal(heldResponse.status, "ok");
  assert.equal(nextResponse.status, "ok");
  assert.equal(bridge.documents.get(changing.uri).version, 2);
  assert.equal(bridge.documents.has(closing.uri), false);
  const operations = bridge.operations;
  const requestIndexes = operations.flatMap(({ kind }, index) =>
    kind === "request" ? [index] : []
  );
  const closeIndex = operations.findIndex(({ kind }) => kind === "close");
  const changeIndex = operations.findIndex(({ kind, version }) =>
    kind === "change" && version === 2
  );
  assert.ok(requestIndexes[1] < closeIndex);
  assert.ok(closeIndex < changeIndex);
  assert.ok(changeIndex < requestIndexes[2]);
  await router.dispose();
});

test("uses stable bridge identity when an earlier registered bridge is removed", async () => {
  const service = projectionService();
  const unrelated = createFakeLanguageBridge({ languageIds: ["javascript"] });
  const bridge = createFakeLanguageBridge({
    languageIds: ["typescript"],
    handlers: { hover: () => ({ display: "const value: number" }) }
  });
  const router = createLanguageRouter({ projectionService: service });
  const removeUnrelated = router.registerBridge(unrelated);
  router.registerBridge(bridge);

  await router.request("hover", { uri: "guide.md", offset: 106 });
  removeUnrelated();
  const changed = document({
    snapshotId: "snapshot-2",
    version: 2,
    text: "const value = 42;\n"
  });
  service.projections.set(changed.id, changed);
  await router.request("hover", { uri: "guide.md", offset: 106 });

  assert.deepEqual(bridge.operations.map(({ kind, version }) => ({ kind, version })), [
    { kind: "open", version: 1 },
    { kind: "request", version: 1 },
    { kind: "change", version: 2 },
    { kind: "request", version: 2 }
  ]);
  await router.dispose();
});

test("rejects an out-of-order projection instead of regressing an open bridge document", async () => {
  const current = document({ snapshotId: "snapshot-2", version: 2 });
  const service = projectionService([current]);
  const bridge = createFakeLanguageBridge({
    handlers: { hover: () => ({ display: "const value: number" }) }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });
  await router.request("hover", { uri: "guide.md", offset: 106 });

  const regressed = document({
    snapshotId: "snapshot-1",
    version: 1,
    text: "const value = stale;\n"
  });
  service.projections.set(regressed.id, regressed);
  await assert.rejects(
    router.request("hover", { uri: "guide.md", offset: 106 }),
    (error) => error.code === "BRIDGE_STALE_DOCUMENT" && /older than open version/.test(error.message)
  );

  assert.equal(bridge.documents.get(current.uri).version, 2);
  assert.deepEqual(bridge.operations.map(({ kind, version }) => ({ kind, version })), [
    { kind: "open", version: 2 },
    { kind: "request", version: 2 }
  ]);
  await router.dispose();
});

test("restart relies on the bridge to reopen current documents without duplicate opens", async () => {
  let attempts = 0;
  const bridge = createFakeLanguageBridge({
    handlers: {
      hover: () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("service failed"), { retryable: true });
        return { display: "const value: number" };
      }
    }
  });
  const router = createLanguageRouter({
    projectionService: projectionService(),
    bridges: [bridge]
  });
  const response = await router.request("hover", { uri: "guide.md", offset: 106 });
  assert.equal(response.status, "ok");
  assert.equal(response.context.retries, 1);
  assert.deepEqual(bridge.operations.map(({ kind }) => kind), [
    "open",
    "request",
    "restart",
    "request"
  ]);
  await router.dispose();
});

test("cancellation never restarts a retryable native bridge", async () => {
  const controller = new AbortController();
  const bridge = createFakeLanguageBridge({
    handlers: {
      hover: () => {
        controller.abort(new DOMException("request cancelled", "AbortError"));
        return null;
      }
    }
  });
  const router = createLanguageRouter({
    projectionService: projectionService(),
    bridges: [bridge]
  });

  await assert.rejects(
    router.request("hover", { uri: "guide.md", offset: 106 }, {}, controller.signal),
    (error) => error.code === "BRIDGE_ABORTED"
  );
  assert.equal(bridge.operations.some(({ kind }) => kind === "restart"), false);
  await router.dispose();
});

test("cancels a queued request promptly without bypassing the active request", async () => {
  const requestEntered = deferred();
  const releaseRequest = deferred();
  const bridge = createFakeLanguageBridge({
    handlers: {
      hover: async () => {
        requestEntered.resolve();
        await releaseRequest.promise;
        return { display: "const value: number" };
      }
    }
  });
  const router = createLanguageRouter({
    projectionService: projectionService(),
    bridges: [bridge]
  });

  const active = router.request("hover", { uri: "guide.md", offset: 106 });
  await requestEntered.promise;
  const controller = new AbortController();
  const queued = router.request(
    "hover",
    { uri: "guide.md", offset: 106 },
    {},
    controller.signal
  );
  controller.abort(new DOMException("queued request cancelled", "AbortError"));

  let timeout;
  try {
    const outcome = await Promise.race([
      queued.then(
        () => ({ status: "resolved" }),
        (error) => ({ status: "rejected", error })
      ),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ status: "timeout" }), 100);
      })
    ]);
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error.code, "BRIDGE_ABORTED");
    assert.equal(bridge.operations.filter(({ kind }) => kind === "request").length, 1);
  } finally {
    clearTimeout(timeout);
    releaseRequest.resolve();
  }

  const activeResponse = await active;
  assert.equal(activeResponse.status, "ok");
  // The canceled queue placeholder settles in order and never invokes the bridge.
  await Promise.resolve();
  assert.equal(bridge.operations.filter(({ kind }) => kind === "request").length, 1);
  await router.dispose();
});

test("requires target selection when one source location has incompatible targets", async () => {
  const service = projectionService([
    document(),
    document({
      id: "server:dist/app.ts:assembled:typescript",
      uri: "pieceful-virtual://project/server/dist%2Fapp.ts/assembled/typescript",
      targetId: "server"
    })
  ]);
  const router = createLanguageRouter({
    projectionService: service,
    bridges: [createFakeLanguageBridge()]
  });
  const ambiguous = await router.request("hover", { uri: "guide.md", offset: 104 });
  assert.equal(ambiguous.status, "target-required");
  assert.deepEqual(ambiguous.candidates.map(({ targetId }) => targetId), ["web", "server"]);

  const selected = await router.request("hover", { uri: "guide.md", offset: 104 }, {
    defaultTargetId: "server"
  });
  assert.equal(selected.status, "ok");
  assert.equal(selected.context.targetId, "server");
  await router.dispose();
});

test("requires artifact selection when one target has multiple generated contexts", async () => {
  const service = projectionService([
    document(),
    document({
      id: "web:dist/worker.ts:assembled:typescript",
      uri: "pieceful-virtual://project/web/dist%2Fworker.ts/assembled/typescript",
      artifactId: "dist/worker.ts"
    })
  ]);
  const router = createLanguageRouter({
    projectionService: service,
    bridges: [createFakeLanguageBridge()]
  });

  const ambiguous = await router.request("hover", { uri: "guide.md", offset: 104 }, {
    targetId: "web"
  });
  assert.equal(ambiguous.status, "target-required");
  assert.deepEqual(
    ambiguous.candidates.map(({ artifactId }) => artifactId),
    ["dist/app.ts", "dist/worker.ts"]
  );

  const selected = await router.request("hover", { uri: "guide.md", offset: 104 }, {
    targetId: "web",
    artifactId: "dist/worker.ts"
  });
  assert.equal(selected.status, "ok");
  assert.equal(selected.context.artifactId, "dist/worker.ts");
  await router.dispose();
});

test("requires occurrence selection when exact contexts remain in one target and artifact", async () => {
  const projection = document();
  const service = projectionService([projection]);
  service.toVirtual = () => [
    {
      projectionId: projection.id,
      virtualOffset: 6,
      occurrenceId: "web:first:0",
      pieceId: "guide::handler.ts",
      targetId: "web",
      artifactId: projection.artifactId,
      kind: "exact"
    },
    {
      projectionId: projection.id,
      virtualOffset: 14,
      occurrenceId: "web:second:0",
      pieceId: "guide::handler.ts",
      targetId: "web",
      artifactId: projection.artifactId,
      kind: "exact"
    }
  ];
  const bridge = createFakeLanguageBridge({
    handlers: { hover: (_request, context) => ({ display: context.occurrenceId }) }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const ambiguous = await router.request("hover", { uri: "guide.md", offset: 106 }, {
    targetId: "web",
    artifactId: projection.artifactId
  });
  assert.equal(ambiguous.status, "target-required");
  assert.equal(ambiguous.ambiguityKind, "occurrence");
  assert.ok(ambiguous.candidates.every(({ pieceId }) =>
    pieceId === "guide::handler.ts"
  ));
  assert.deepEqual(
    ambiguous.candidates.map(({ occurrenceId }) => occurrenceId),
    ["web:first:0", "web:second:0"]
  );
  assert.equal(bridge.operations.length, 0);

  const selected = await router.request("hover", { uri: "guide.md", offset: 106 }, {
    targetId: "web",
    artifactId: projection.artifactId,
    occurrenceId: "web:second:0"
  });
  assert.equal(selected.status, "ok");
  assert.equal(selected.context.occurrenceId, "web:second:0");
  assert.equal(selected.result.display, "web:second:0");
  await router.dispose();
});

test("deduplicates provably equivalent mapping candidates before ambiguity checks", async () => {
  const projection = document();
  const service = projectionService([projection]);
  const match = {
    projectionId: projection.id,
    virtualOffset: 6,
    occurrenceId: "web:main:0",
    targetId: "web",
    artifactId: projection.artifactId,
    kind: "exact"
  };
  service.toVirtual = () => [{ ...match }, { ...match }];
  const bridge = createFakeLanguageBridge({
    handlers: { hover: () => ({ display: "const value: number" }) }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const response = await router.request("hover", { uri: "guide.md", offset: 106 });
  assert.equal(response.status, "ok");
  assert.equal(response.context.occurrenceId, "web:main:0");
  assert.deepEqual(bridge.operations.map(({ kind }) => kind), ["open", "request"]);
  await router.dispose();
});

test("maps definitions, diagnostics, and call hierarchy back to authored locations", async () => {
  const projection = document();
  const service = projectionService([projection]);
  const bridge = createFakeLanguageBridge({
    handlers: {
      definition: () => [{
        uri: projection.uri,
        range: { start: 6, end: 11 },
        name: "value"
      }],
      diagnostics: () => [{
        uri: projection.uri,
        range: { start: 14, end: 20 },
        code: 2304,
        severity: "error",
        message: "Cannot find name 'answer'.",
        related: []
      }],
      incomingCalls: () => [{
        from: {
          uri: projection.uri,
          range: { start: 0, end: 11 },
          selectionRange: { start: 6, end: 11 },
          name: "value",
          kind: "const"
        },
        fromRanges: [{ start: 14, end: 20 }]
      }]
    }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const definition = await router.request("definition", { uri: "guide.md", offset: 114 });
  assert.equal(definition.result[0].uri, "guide.md");
  assert.deepEqual(definition.result[0].range, { start: 106, end: 111 });
  assert.equal(definition.result[0].generated.projectionId, projection.id);

  const diagnostics = await router.request("diagnostics", { uri: "guide.md", offset: 114 });
  assert.equal(diagnostics.result[0].uri, "guide.md");
  assert.deepEqual(diagnostics.result[0].range, { start: 114, end: 120 });

  const incoming = await router.request("incomingCalls", { uri: "guide.md", offset: 114 });
  assert.equal(incoming.result[0].from.uri, "guide.md");
  assert.deepEqual(incoming.result[0].from.selectionRange, { start: 106, end: 111 });
  assert.deepEqual(incoming.result[0].fromRanges, [{ start: 114, end: 120 }]);
  await router.dispose();
});

test("classifies native rename edits before exposing them to an editor host", async () => {
  const projection = document({ sourceVersions: { "guide.md": 12 } });
  const service = projectionService([projection]);
  const bridge = createFakeLanguageBridge({
    handlers: {
      rename: () => ({
        canRename: true,
        changes: [{
          uri: projection.uri,
          textChanges: [
            { range: { start: 6, end: 11 }, text: "result" },
            { range: { start: 6, end: 11 }, text: "result" }
          ]
        }]
      })
    }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });
  const response = await router.request("rename", { uri: "guide.md", offset: 106 }, {
    request: { newName: "result" },
    sourceVersions: new Map([["guide.md", 12]]),
    isWritableSource: (uri) => uri === "guide.md"
  });

  assert.equal(response.result.classifiedEdit.classification, "automatic");
  assert.deepEqual(response.result.classifiedEdit.sourceEdit.documents, [{
    uri: "guide.md",
    version: 12,
    edits: [{ range: { start: 106, end: 111 }, text: "result" }]
  }]);
  await router.dispose();
});

test("refuses exact-cursor features through synthetic mappings and discards stale results", async () => {
  const projection = document();
  const service = projectionService([projection]);
  service.toVirtual = () => [{
    projectionId: projection.id,
    virtualOffset: 20,
    occurrenceId: "web:main:0",
    targetId: "web",
    artifactId: projection.artifactId,
    kind: "synthetic"
  }];
  const bridge = createFakeLanguageBridge({
    handlers: {
      completion: () => ({ items: [] }),
      hover: () => {
        service.projections.set(projection.id, { ...projection, version: 2 });
        return { display: "const value: number" };
      }
    }
  });
  const router = createLanguageRouter({ projectionService: service, bridges: [bridge] });

  const completion = await router.request("completion", { uri: "guide.md", offset: 120 });
  assert.equal(completion.status, "exact-mapping-required");

  await assert.rejects(
    router.request("hover", { uri: "guide.md", offset: 120 }),
    (error) => error.code === "BRIDGE_STALE_DOCUMENT"
  );
  await router.dispose();
});
