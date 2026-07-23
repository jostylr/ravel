export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; }
export interface MarkdownRavelMap { version: 1; document: { id: string; uri: string; format: string }; chunks: Array<Record<string, unknown>>; directives: Array<Record<string, unknown>>; }
export function markdownToMap(text: string, options?: { uri?: string; document?: string; mode?: "opt-in" | "primary" }): { map: MarkdownRavelMap; diagnostics: Diagnostic[] };
