import type {
  ExecutionProvider,
  LiveAnalysis,
  LiveExecutionOutcome,
  LiveExecutionRequest,
  SourceLocation
} from "@pieceful/ravel-core";

export interface JavaScriptLiveProviderOptions {
  id?: string;
  languages?: string[];
  timeoutMs?: number;
  memoryBytes?: number;
  stackBytes?: number;
  outputBytes?: number;
  workerStartupTimeoutMs?: number;
  workerTerminationGraceMs?: number;
  moduleEntries?: number;
  moduleBytes?: number;
  modules?: Map<string, string | { source: string }> |
    Record<string, string | { source: string }>;
  workerFactory?: () => JavaScriptLiveWorker | Promise<JavaScriptLiveWorker>;
}

export interface JavaScriptLiveWorker {
  postMessage(message: unknown): void;
  terminate(): unknown;
  addEventListener?(type: "message" | "error", listener: (event: any) => void): void;
  removeEventListener?(type: "message" | "error", listener: (event: any) => void): void;
  on?(type: "message" | "error", listener: (value: any) => void): void;
  off?(type: "message" | "error", listener: (value: any) => void): void;
  ref?(): void;
  unref?(): void;
}

export interface JavaScriptLiveProvider extends ExecutionProvider {
  id: string;
  version: string;
  languages: string[];
  analyze(request: {
    id?: string;
    language?: string;
    source: string;
    sourceLocation: SourceLocation;
  }): LiveAnalysis;
  execute(request: LiveExecutionRequest): Promise<LiveExecutionOutcome>;
  dispose(): Promise<void>;
}

export function createJavaScriptLiveProvider(options?: JavaScriptLiveProviderOptions): JavaScriptLiveProvider;
export const javascriptLiveProvider: JavaScriptLiveProvider;
