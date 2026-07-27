/** Zero-based UTF-16 source position. */
export interface SourcePosition { line: number; column: number; offset: number; }
/** Inclusive start and exclusive end source range. */
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; related?: SourceLocation[]; }
export type RavelValue = null | boolean | number | string | RavelValue[] | { [key: string]: RavelValue };
export interface ChunkIdentity { document: string | null; chunk: string | null; minor: string | null; type: string | null; }
export interface RavelExecutionMetadata { run: true; provider?: string; }
export interface RavelChunkMetadata {
  language?: string;
  tags?: string[];
  data?: { ravel?: { run?: boolean; provider?: string; [key: string]: unknown }; [key: string]: unknown };
  [key: string]: unknown;
}
export interface RavelChunk { id: string; identity: ChunkIdentity; body: string; source: SourceLocation; name?: string; definitionPipeline?: unknown[]; metadata?: RavelChunkMetadata; fragments?: Array<{ body: string; source: SourceLocation }>; }
export interface RavelDirective { kind: "in" | "out" | "create" | "alias"; source: SourceLocation; name?: string; from?: string; target?: string; document?: string; compose?: unknown[]; reference?: string; metadata?: Record<string, unknown>; }
export interface RavelMap { version: 1; document: { id: string; uri: string; format: string }; chunks: RavelChunk[]; directives?: RavelDirective[]; metadata?: Record<string, unknown>; }
export const RAVEL_MAP_VERSION: 1;
export const RAVEL_MAP_SCHEMA_ID: string;
export const RAVEL_MAP_SCHEMA: Record<string, unknown>;
export function validateRavelMap(map: unknown, options?: { uri?: string }): Diagnostic[];
export class RavelMapValidationError extends Error { diagnostics: Diagnostic[]; }
export function assertRavelMap<T extends RavelMap>(map: T, options?: { uri?: string }): T;
