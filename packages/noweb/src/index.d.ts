export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: SourceLocation;
}
export interface NowebRunOptions {
  run?: boolean;
  provider?: string;
}
export interface NowebOptions {
  uri?: string;
  document?: string;
  dialect?: "noweb" | "noweb-plus";
  references?: "noweb" | "underscore-quote" | "both";
  language?: string;
  languages?: Record<string, string>;
  run?: boolean | string[] | Record<string, boolean | NowebRunOptions>;
  provider?: string;
}
export interface NowebAdapterResult {
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
  };
}
export function nowebToMap(text: string, options?: NowebOptions): NowebAdapterResult;
