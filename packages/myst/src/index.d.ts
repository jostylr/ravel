export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: SourceLocation;
}
export interface MystOptions {
  uri?: string;
  document?: string;
  executionOwner?: "myst" | "pieceful";
  run?: boolean | string[];
  provider?: string;
}
export interface MystAdapterResult {
  map: {
    version: 1;
    document: { id: string; uri: string; format: string };
    chunks: Array<Record<string, unknown>>;
    directives: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  };
  diagnostics: Diagnostic[];
  surface: {
    definitions: Array<Record<string, unknown>>;
    references: Array<Record<string, unknown>>;
    directives: Array<Record<string, unknown>>;
    navigation: Array<Record<string, unknown>>;
  };
}
export function mystToMap(text: string, options?: MystOptions): MystAdapterResult;
