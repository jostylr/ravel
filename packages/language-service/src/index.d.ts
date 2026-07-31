import type {
  LanguageBridge,
  LanguageRequestKind
} from "@pieceful/ravel-language-bridge";
import type { ProjectionService } from "@pieceful/ravel-projection";
export type {
  ClassifiedWorkspaceEdit,
  EditClassification,
  SourceDocumentEdit,
  SourceTextEdit
} from "./edits.js";
export {
  classifyWorkspaceEdit,
  validateSourceEditVersions
} from "./edits.js";
export { createRavelSemanticIndex } from "./ravel-index.js";
export type { RavelSemanticIndex } from "./ravel-index.js";

export interface LanguageRouterResult<T = unknown> {
  status: "ok" | "unmapped" | "target-required" | "exact-mapping-required" |
    "bridge-unavailable" | "capability-unavailable";
  result?: T;
  context?: Record<string, unknown>;
  candidates?: Array<Record<string, unknown>>;
  ambiguityKind?: "occurrence" | "mapping";
  [key: string]: unknown;
}

export interface LanguageRouter {
  update(snapshot: unknown, signal?: AbortSignal): Promise<unknown>;
  request<T = unknown>(
    kind: LanguageRequestKind,
    source: { uri: string; offset?: number; range?: { start: number; end: number } },
    options?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<LanguageRouterResult<T>>;
  listTargets(source: { uri: string; offset?: number }, selection?: Record<string, unknown>): Array<Record<string, unknown>>;
  registerBridge(bridge: LanguageBridge): () => void;
  validateSourceEditVersions: typeof import("./edits.js").validateSourceEditVersions;
  readonly disposed: boolean;
  dispose(): Promise<void>;
}

export function createLanguageRouter(options: {
  projectionService: ProjectionService;
  bridges?: LanguageBridge[];
  trace?: ((event: Record<string, unknown>) => void) | { event(event: Record<string, unknown>): void };
}): LanguageRouter;
