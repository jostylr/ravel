export const LANGUAGE_REQUEST_KINDS = Object.freeze([
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
]);

export const PROJECTION_STAGES = Object.freeze([
  "authoring",
  "assembled",
  "transformed",
  "emitted"
]);

export const BRIDGE_LIFECYCLE_STATES = Object.freeze([
  "stopped",
  "starting",
  "ready",
  "failed",
  "restarting",
  "disposed"
]);

export const BRIDGE_ERROR_CODES = Object.freeze({
  ABORTED: "BRIDGE_ABORTED",
  CLOSED: "BRIDGE_CLOSED",
  CRASHED: "BRIDGE_CRASHED",
  DISPOSED: "BRIDGE_DISPOSED",
  DOCUMENT_COLLISION: "BRIDGE_DOCUMENT_COLLISION",
  DOCUMENT_NOT_OPEN: "BRIDGE_DOCUMENT_NOT_OPEN",
  INVALID_DOCUMENT: "BRIDGE_INVALID_DOCUMENT",
  INVALID_REQUEST: "BRIDGE_INVALID_REQUEST",
  NOT_SUPPORTED: "BRIDGE_NOT_SUPPORTED",
  PROJECT_ERROR: "BRIDGE_PROJECT_ERROR",
  STALE_DOCUMENT: "BRIDGE_STALE_DOCUMENT",
  VERSION_REGRESSION: "BRIDGE_VERSION_REGRESSION"
});

const requestKinds = new Set(LANGUAGE_REQUEST_KINDS);
const projectionStages = new Set(PROJECTION_STAGES);
const lifecycleStates = new Set(BRIDGE_LIFECYCLE_STATES);

const nonEmptyString = (value) => typeof value === "string" && value.length > 0;

export class LanguageBridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LanguageBridgeError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.details = options.details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details })
    };
  }
}

export const bridgeError = (error, fallback = {}) => {
  if (error instanceof LanguageBridgeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LanguageBridgeError(
    fallback.code ?? BRIDGE_ERROR_CODES.PROJECT_ERROR,
    fallback.message ?? message,
    {
      cause: error instanceof Error ? error : undefined,
      retryable: fallback.retryable,
      details: fallback.details
    }
  );
};

export const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new LanguageBridgeError(
    BRIDGE_ERROR_CODES.ABORTED,
    reason instanceof Error ? reason.message : "The language request was cancelled.",
    { cause: reason instanceof Error ? reason : undefined, retryable: true }
  );
};

export const assertVirtualDocument = (document) => {
  if (!document || typeof document !== "object") {
    throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.INVALID_DOCUMENT,
      "A virtual document must be an object."
    );
  }
  if (!nonEmptyString(document.uri) || !nonEmptyString(document.languageId) ||
      typeof document.text !== "string" || !Number.isInteger(document.version) ||
      document.version < 0) {
    throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.INVALID_DOCUMENT,
      "A virtual document requires a non-empty uri and languageId, string text, and non-negative integer version.",
      { details: { uri: document.uri, languageId: document.languageId, version: document.version } }
    );
  }
  if (document.stage !== undefined && !projectionStages.has(document.stage)) {
    throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.INVALID_DOCUMENT,
      "Unknown projection stage: " + document.stage + ".",
      { details: { stage: document.stage } }
    );
  }
  return document;
};

export const assertLanguageRequest = (request) => {
  if (!request || typeof request !== "object" || !requestKinds.has(request.kind)) {
    throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.INVALID_REQUEST,
      "A language request requires a supported kind.",
      { details: { kind: request?.kind } }
    );
  }
  return request;
};

const normalizeStages = (stages) => {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new TypeError("A supported bridge capability requires at least one projection stage.");
  }
  const unique = [...new Set(stages)];
  for (const stage of unique) {
    if (!projectionStages.has(stage)) throw new TypeError("Unknown projection stage: " + stage + ".");
  }
  return Object.freeze(unique);
};

export const createBridgeCapabilities = (definitions = {}) => {
  const capabilities = {};
  for (const kind of LANGUAGE_REQUEST_KINDS) {
    const definition = definitions[kind];
    if (definition === undefined || definition === false) {
      capabilities[kind] = Object.freeze({ supported: false, stages: Object.freeze([]) });
      continue;
    }
    const value = definition === true ? { stages: ["assembled"] } : definition;
    capabilities[kind] = Object.freeze({
      supported: true,
      stages: normalizeStages(value.stages),
      triggerCharacters: value.triggerCharacters === undefined
        ? undefined
        : Object.freeze([...new Set(value.triggerCharacters)]),
      resolveProvider: value.resolveProvider === true,
      workspaceProvider: value.workspaceProvider === true
    });
  }
  for (const key of Object.keys(definitions)) {
    if (!requestKinds.has(key)) throw new TypeError("Unknown language request capability: " + key + ".");
  }
  return Object.freeze(capabilities);
};

export const supportsLanguageRequest = (capabilities, kind, stage) => {
  const capability = capabilities?.[kind];
  return capability?.supported === true &&
    (stage === undefined || capability.stages.includes(stage));
};

export const requireLanguageRequestSupport = (bridge, request, context = {}) => {
  assertLanguageRequest(request);
  const stage = context.document?.stage ?? context.stage;
  if (!supportsLanguageRequest(bridge.capabilities, request.kind, stage)) {
    throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.NOT_SUPPORTED,
      "The language bridge does not support " + request.kind +
        (stage === undefined ? "." : " for " + stage + " projections."),
      { details: { kind: request.kind, stage } }
    );
  }
};

export const createRestartPolicy = (options = {}) => {
  const policy = {
    maximumAttempts: options.maximumAttempts ?? 5,
    initialDelayMs: options.initialDelayMs ?? 100,
    maximumDelayMs: options.maximumDelayMs ?? 5_000,
    multiplier: options.multiplier ?? 2
  };
  if (!Number.isInteger(policy.maximumAttempts) || policy.maximumAttempts < 0 ||
      !Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0 ||
      !Number.isFinite(policy.maximumDelayMs) || policy.maximumDelayMs < policy.initialDelayMs ||
      !Number.isFinite(policy.multiplier) || policy.multiplier < 1) {
    throw new TypeError("Invalid language-bridge restart policy.");
  }
  return Object.freeze(policy);
};

export const restartDelay = (policy, attempt) => {
  if (!Number.isInteger(attempt) || attempt < 1) throw new TypeError("Restart attempts start at one.");
  if (attempt > policy.maximumAttempts) return undefined;
  return Math.min(
    policy.maximumDelayMs,
    policy.initialDelayMs * policy.multiplier ** (attempt - 1)
  );
};

export const assertLifecycleState = (state) => {
  if (!lifecycleStates.has(state)) throw new TypeError("Unknown bridge lifecycle state: " + state + ".");
  return state;
};
