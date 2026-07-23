export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; related?: SourceLocation[]; }
export interface ChunkIdentity { document: string | null; chunk: string | null; minor: string | null; type: string | null; explicitDocument?: boolean; }
export interface RavelMap { version: 1; document: { id: string; uri: string; format: string }; chunks: Array<Record<string, unknown>>; directives?: Array<Record<string, unknown>>; diagnostics?: Diagnostic[]; }
export interface PretransformGraph { version: 1; documents: Array<{ id: string; uri: string; format: string }>; chunks: Array<Record<string, unknown>>; directives: Array<Record<string, unknown>>; diagnostics: Diagnostic[]; }
export interface ProvenanceStep { kind: string; source?: SourceLocation; from?: string; to?: string; name?: string; phase?: number; value?: string; }
export interface ProvenanceSegment { generated: { start: number; end: number }; source: SourceLocation | null; chunk: string; kind: string; precision: "exact" | "coarse"; via: ProvenanceStep[]; }
export interface DeliverableProvenanceMap { version: 1; kind: "ravel-provenance-map"; generated: { uri: string; length: number; offsetEncoding: "utf-16" }; from: string; segments: ProvenanceSegment[]; }
export interface BuildProvenanceMap { version: 1; kind: "ravel-provenance-bundle"; maps: DeliverableProvenanceMap[]; }
export interface ProgramChunk { id: string; identity: ChunkIdentity; value: string; segments: ProvenanceSegment[]; source: SourceLocation; dependencies: string[]; references: Array<{ chunk: string; requested: string; source: SourceLocation }>; provenance: unknown[]; generated?: boolean; }
export interface Deliverable { name: string; from: string; value: string; segments: ProvenanceSegment[]; source: SourceLocation; dependencies: string[]; }
export interface RavelProgram { version: 1; documents: PretransformGraph["documents"]; chunks: Record<string, ProgramChunk>; deliverables: Record<string, Deliverable>; diagnostics: Diagnostic[]; trace: { chunks: Record<string, unknown[]> }; }
export interface TransformCall { type?: "transform"; name: string; arguments?: unknown[]; source?: SourceLocation; }
export function formatChunkId(identity: ChunkIdentity): string;
export function parseChunkId(input: string, options?: { reference?: boolean }): ChunkIdentity | null;
export function parseChunk(body: string, source: SourceLocation): { nodes: unknown[]; diagnostics: Diagnostic[] };
export function combineMaps(maps: RavelMap[]): PretransformGraph;
export function transformGraph(graph: PretransformGraph, options?: { transforms?: Record<string, (value: string, ...argumentsValue: unknown[]) => string> | Map<string, Function> }): RavelProgram;
export const provenanceMapVersion: 1;
export function createDeliverableProvenanceMap(deliverable: Deliverable): DeliverableProvenanceMap;
export function createBuildProvenanceMap(program: RavelProgram): BuildProvenanceMap;
export function sourceAtGeneratedOffset(map: DeliverableProvenanceMap, offset: number): (ProvenanceSegment & { sourceOffset?: number }) | null;
export function generatedRangesForSource(map: DeliverableProvenanceMap, uri: string, offset: number): Array<{ generated: { start: number; end: number }; generatedOffset?: number; precision: "exact" | "coarse"; chunk: string; kind: string; via: ProvenanceStep[] }>;
export const directiveKinds: Set<string>;
export function compose(steps: unknown[], source: SourceLocation): unknown;
export function append(reference: string, source: SourceLocation): unknown;
export function newline(count: number, source: SourceLocation): unknown;
export function pipe(steps: unknown[], source: SourceLocation): unknown;
export function pass(steps: unknown[], source: SourceLocation): unknown;
export function createDirective(name: string, value: unknown, source: SourceLocation): unknown;
export function aliasDirective(name: string, reference: string, source: SourceLocation): unknown;
