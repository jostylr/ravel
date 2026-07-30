export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; }
export interface LitProHeadingOptions {
  mode?: "legacy" | "flat" | "none";
  major?: number[];
  child?: number;
  grandchild?: number;
  pipelines?: boolean;
}
export interface LitProMarkdownOptions {
  uri?: string;
  document?: string;
  dialect?: "litpro-2017" | "pieceful-2020" | "litpro-plus";
  headings?: "legacy" | "flat" | "none" | LitProHeadingOptions;
}
export interface LitProAdapterResult {
  map: {
    version: 1;
    document: { id: string; uri: string; format: string };
    chunks: Array<Record<string, unknown>>;
    directives: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  };
  diagnostics: Diagnostic[];
  surface: {
    definitions: Array<Record<string, unknown>>;
    references: Array<Record<string, unknown>>;
    directives: Array<Record<string, unknown>>;
  };
}
export function isLitproMarkdown(text: string): boolean;
export function litproMarkdownToMap(text: string, options?: LitProMarkdownOptions): LitProAdapterResult;
