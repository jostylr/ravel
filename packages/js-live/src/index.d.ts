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
}

export function createJavaScriptLiveProvider(options?: JavaScriptLiveProviderOptions): JavaScriptLiveProvider;
export const javascriptLiveProvider: JavaScriptLiveProvider;
