import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIDGE_ERROR_CODES,
  LanguageBridgeError,
  createBridgeCapabilities,
  createRestartPolicy,
  restartDelay,
  supportsLanguageRequest
} from "../packages/language-bridge/src/index.js";
import { createFakeLanguageBridge } from "../packages/language-bridge/src/testing.js";

const document = (version, text = "const value = 1;") => ({
  id: "projection:test",
  uri: "pieceful-virtual://workspace/target/artifact/assembled/main.ts",
  version,
  stage: "assembled",
  languageId: "typescript",
  text
});

test("bridge capabilities report request and stage support explicitly", () => {
  const capabilities = createBridgeCapabilities({
    completion: { stages: ["authoring", "assembled"], triggerCharacters: ["."] },
    hover: false,
    diagnostics: { stages: ["assembled"] }
  });

  assert.equal(supportsLanguageRequest(capabilities, "completion", "authoring"), true);
  assert.equal(supportsLanguageRequest(capabilities, "completion", "emitted"), false);
  assert.equal(supportsLanguageRequest(capabilities, "hover", "assembled"), false);
  assert.deepEqual(capabilities.completion.triggerCharacters, ["."]);
  assert.throws(() => { capabilities.completion.stages.push("emitted"); }, TypeError);
});

test("restart policy uses deterministic capped exponential backoff", () => {
  const policy = createRestartPolicy({
    maximumAttempts: 4,
    initialDelayMs: 25,
    maximumDelayMs: 80,
    multiplier: 2
  });
  assert.deepEqual([1, 2, 3, 4, 5].map((attempt) => restartDelay(policy, attempt)), [25, 50, 80, 80, undefined]);
  const error = new LanguageBridgeError(BRIDGE_ERROR_CODES.CRASHED, "service exited", {
    retryable: true,
    details: { attempt: 2 }
  });
  assert.deepEqual(error.toJSON(), {
    name: "LanguageBridgeError",
    code: BRIDGE_ERROR_CODES.CRASHED,
    message: "service exited",
    retryable: true,
    details: { attempt: 2 }
  });
});

test("fake bridge enforces versions, cancellation, failures, restart, and reopen state", async () => {
  const bridge = createFakeLanguageBridge({
    handlers: {
      hover: (_request, context) => ({ version: context.document.version })
    }
  });
  const first = document(1);
  await bridge.open(first);

  await assert.rejects(
    bridge.change(first, document(1, "const value = 2;"), [], undefined),
    (error) => error instanceof LanguageBridgeError && error.code === BRIDGE_ERROR_CODES.VERSION_REGRESSION
  );

  const second = document(2, "const value = 2;");
  await bridge.change(first, second, [{ range: { start: 14, end: 15 }, text: "2" }]);
  assert.deepEqual(
    await bridge.request({ kind: "hover", documentUri: second.uri, position: 6 }, { version: 2, stage: "assembled" }),
    { version: 2 }
  );
  await assert.rejects(
    bridge.request({ kind: "hover", documentUri: second.uri, position: 6 }, { version: 1, stage: "assembled" }),
    (error) => error.code === BRIDGE_ERROR_CODES.STALE_DOCUMENT
  );

  const controller = new AbortController();
  controller.abort(new Error("superseded"));
  await assert.rejects(
    bridge.request({ kind: "hover", documentUri: second.uri, position: 6 }, { version: 2, stage: "assembled" }, controller.signal),
    (error) => error.code === BRIDGE_ERROR_CODES.ABORTED && error.retryable
  );

  bridge.crash(new Error("test crash"));
  await assert.rejects(
    bridge.request({ kind: "hover", documentUri: second.uri, position: 6 }, { version: 2 }),
    (error) => error.code === BRIDGE_ERROR_CODES.CRASHED
  );
  await bridge.restart();
  assert.equal(bridge.documents.get(second.uri).text, second.text);
  assert.deepEqual(await bridge.request(
    { kind: "hover", documentUri: second.uri, position: 6 },
    { version: 2, stage: "assembled" }
  ), { version: 2 });

  await bridge.close(second);
  await bridge.dispose();
  assert.equal(bridge.state, "disposed");
  assert.equal(bridge.documents.size, 0);
});

test("fake bridge rejects requests outside an adapter's declared stages", async () => {
  const bridge = createFakeLanguageBridge({
    capabilities: { hover: { stages: ["assembled"] } }
  });
  const source = { ...document(1), stage: "authoring" };
  await bridge.open(source);
  await assert.rejects(
    bridge.request({ kind: "hover", documentUri: source.uri, position: 0 }, { document: source }),
    (error) => error.code === BRIDGE_ERROR_CODES.NOT_SUPPORTED
  );
});
