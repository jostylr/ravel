import {
  BRIDGE_ERROR_CODES,
  LanguageBridgeError,
  assertLanguageRequest,
  assertVirtualDocument,
  createBridgeCapabilities,
  requireLanguageRequestSupport,
  throwIfAborted
} from "./index.js";

const defaultCapabilities = Object.fromEntries([
  "completion",
  "completionDetails",
  "hover",
  "signatureHelp",
  "definition",
  "typeDefinition",
  "references",
  "documentSymbols",
  "workspaceSymbols",
  "diagnostics",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
  "prepareRename",
  "rename"
].map((kind) => [kind, { stages: ["authoring", "assembled"] }]));

const copyDocument = (document) => Object.freeze({ ...document });

export const createFakeLanguageBridge = (options = {}) => {
  const documents = new Map();
  const operations = [];
  const handlers = new Map(Object.entries(options.handlers ?? {}));
  let state = "ready";
  let failure;

  const ready = () => {
    if (state === "disposed") {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DISPOSED, "The fake language bridge is disposed.");
    }
    if (state === "failed") {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.CRASHED,
        failure?.message ?? "The fake language bridge has failed.",
        { cause: failure, retryable: true }
      );
    }
  };

  const bridge = {
    languageIds: Object.freeze(options.languageIds ?? ["typescript", "javascript"]),
    capabilities: createBridgeCapabilities(options.capabilities ?? defaultCapabilities),
    get state() { return state; },
    get operations() { return Object.freeze(operations.map((entry) => Object.freeze({ ...entry }))); },
    get documents() { return new Map(documents); },

    async open(document, signal) {
      ready();
      throwIfAborted(signal);
      assertVirtualDocument(document);
      const current = documents.get(document.uri);
      if (current && document.version <= current.version) {
        throw new LanguageBridgeError(
          BRIDGE_ERROR_CODES.VERSION_REGRESSION,
          "Document versions must increase monotonically."
        );
      }
      documents.set(document.uri, copyDocument(document));
      operations.push({ kind: "open", uri: document.uri, version: document.version });
    },

    async change(previous, next, changes, signal) {
      ready();
      throwIfAborted(signal);
      assertVirtualDocument(previous);
      assertVirtualDocument(next);
      const current = documents.get(previous.uri);
      if (!current) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DOCUMENT_NOT_OPEN, "The document is not open.");
      }
      if (current.version !== previous.version || next.uri !== previous.uri) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.STALE_DOCUMENT, "The change does not match the open document.");
      }
      if (next.version <= current.version) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.VERSION_REGRESSION, "Document versions must increase monotonically.");
      }
      documents.set(next.uri, copyDocument(next));
      operations.push({ kind: "change", uri: next.uri, version: next.version, changes: [...changes] });
    },

    async close(document) {
      ready();
      assertVirtualDocument(document);
      if (!documents.delete(document.uri)) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DOCUMENT_NOT_OPEN, "The document is not open.");
      }
      operations.push({ kind: "close", uri: document.uri, version: document.version });
    },

    async request(request, context = {}, signal) {
      ready();
      throwIfAborted(signal);
      assertLanguageRequest(request);
      requireLanguageRequestSupport(bridge, request, context);
      const uri = request.documentUri ?? context.document?.uri ?? context.documentUri;
      const document = uri === undefined ? undefined : documents.get(uri);
      if (uri !== undefined && !document) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DOCUMENT_NOT_OPEN, "The request document is not open.");
      }
      if (document && context.version !== undefined && context.version !== document.version) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.STALE_DOCUMENT, "The request targets a stale document version.");
      }
      operations.push({ kind: "request", requestKind: request.kind, uri, version: document?.version });
      const handler = handlers.get(request.kind);
      const result = handler
        ? await handler(request, { ...context, document }, signal)
        : options.defaultResponse ?? null;
      throwIfAborted(signal);
      return result;
    },

    setHandler(kind, handler) {
      handlers.set(kind, handler);
    },

    crash(error = new Error("Deterministic fake bridge failure.")) {
      failure = error;
      state = "failed";
      operations.push({ kind: "crash", message: error.message });
    },

    async restart() {
      if (state === "disposed") ready();
      state = "restarting";
      operations.push({ kind: "restart", documents: documents.size });
      state = "ready";
      failure = undefined;
    },

    async dispose() {
      documents.clear();
      state = "disposed";
      operations.push({ kind: "dispose" });
    }
  };

  return bridge;
};
