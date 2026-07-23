export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; related?: SourceLocation[]; }
export interface ChunkIdentity { document: string | null; chunk: string | null; minor: string | null; type: string | null; explicitDocument?: boolean; }
export interface RavelMap { version: 1; document: { id: string; uri: string; format: string }; chunks: Array<Record<string, unknown>>; directives?: Array<Record<string, unknown>>; diagnostics?: Diagnostic[]; }
export interface PretransformGraph { version: 1; documents: Array<{ id: string; uri: string; format: string }>; chunks: Array<Record<string, unknown>>; directives: Array<Record<string, unknown>>; diagnostics: Diagnostic[]; }
export interface ProgramChunk { id: string; identity: ChunkIdentity; value: string; source: SourceLocation; dependencies: string[]; references: Array<{ chunk: string; requested: string; source: SourceLocation }>; provenance: unknown[]; generated?: boolean; }
export interface Deliverable { name: string; from: string; value: string; source: SourceLocation; dependencies: string[]; }
export interface RavelProgram { version: 1; documents: PretransformGraph["documents"]; chunks: Record<string, ProgramChunk>; deliverables: Record<string, Deliverable>; diagnostics: Diagnostic[]; trace: { chunks: Record<string, unknown[]> }; }
export interface TransformCall { type?: "transform"; name: string; arguments?: unknown[]; source?: SourceLocation; }
export function formatChunkId(identity: ChunkIdentity): string;
export function parseChunkId(input: string, options?: { reference?: boolean }): ChunkIdentity | null;
export function parseChunk(body: string, source: SourceLocation): { nodes: unknown[]; diagnostics: Diagnostic[] };
export function combineMaps(maps: RavelMap[]): PretransformGraph;
export function transformGraph(graph: PretransformGraph, options?: { transforms?: Record<string, (value: string, ...argumentsValue: unknown[]) => string> | Map<string, Function> }): RavelProgram;
export const directiveKinds: Set<string>;
export function compose(steps: unknown[], source: SourceLocation): unknown;
export function append(reference: string, source: SourceLocation): unknown;
export function newline(count: number, source: SourceLocation): unknown;
export function pipe(steps: unknown[], source: SourceLocation): unknown;
export function pass(steps: unknown[], source: SourceLocation): unknown;
export function createDirective(name: string, value: unknown, source: SourceLocation): unknown;
export function aliasDirective(name: string, reference: string, source: SourceLocation): unknown;
