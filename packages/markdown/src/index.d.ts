export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; }
export interface MarkdownRavelMap { version: 1; document: { id: string; uri: string; format: string }; chunks: Array<Record<string, unknown>>; directives: Array<Record<string, unknown>>; }
export interface ModernHeadingOptions { enabled?: boolean; levels?: number[]; }
export interface MarkdownOptions {
  uri?: string;
  document?: string;
  mode?: "opt-in" | "primary";
  profile?: "fences" | "modern";
  headings?: boolean | "none" | ModernHeadingOptions;
}
export function modernMarkdownToMap(text: string, options?: MarkdownOptions): { map: MarkdownRavelMap; diagnostics: Diagnostic[] };
export function markdownToMap(text: string, options?: MarkdownOptions): { map: MarkdownRavelMap; diagnostics: Diagnostic[] };
