import type {
  BridgeCapabilityDefinition,
  BridgeCapabilities,
  BridgeRequestContext,
  LanguageBridge,
  LanguageRequest,
  LanguageRequestKind,
  VirtualDocumentLike
} from "./index.js";

export interface FakeLanguageBridge extends LanguageBridge {
  readonly state: string;
  readonly operations: readonly Record<string, unknown>[];
  readonly documents: Map<string, VirtualDocumentLike>;
  setHandler(kind: LanguageRequestKind, handler: (request: LanguageRequest, context: BridgeRequestContext, signal?: AbortSignal) => unknown): void;
  crash(error?: Error): void;
  restart(): Promise<void>;
  dispose(): Promise<void>;
}
export function createFakeLanguageBridge(options?: {
  languageIds?: readonly string[];
  capabilities?: Partial<Record<LanguageRequestKind, BridgeCapabilityDefinition>>;
  handlers?: Partial<Record<LanguageRequestKind, (request: LanguageRequest, context: BridgeRequestContext, signal?: AbortSignal) => unknown>>;
  defaultResponse?: unknown;
}): FakeLanguageBridge;
