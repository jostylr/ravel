export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; related?: SourceLocation[]; }
export type RavelValue = null | boolean | number | string | RavelValue[] | { [key: string]: RavelValue };
export interface ChunkIdentity { document: string | null; chunk: string | null; minor: string | null; type: string | null; explicitDocument?: boolean; }
export interface RavelMap { version: 1; document: { id: string; uri: string; format: string }; chunks: Array<Record<string, unknown>>; directives?: Array<Record<string, unknown>>; diagnostics?: Diagnostic[]; }
export interface PretransformGraph { version: 1; documents: Array<{ id: string; uri: string; format: string }>; chunks: Array<Record<string, unknown>>; directives: Array<Record<string, unknown>>; diagnostics: Diagnostic[]; }
export interface ProvenanceStep { kind: string; source?: SourceLocation; from?: string; to?: string; name?: string; phase?: number; value?: string; owner?: string; target?: string; }
export interface ProvenanceOrigin { source: SourceLocation | null; chunk: string; kind: string; precision: "exact" | "coarse"; via: ProvenanceStep[]; }
export interface ProvenanceSegment { generated: { start: number; end: number }; source: SourceLocation | null; chunk: string; kind: string; precision: "exact" | "coarse"; via: ProvenanceStep[]; origins?: ProvenanceOrigin[]; }
export interface DeliverableProvenanceMap { version: 1; kind: "ravel-provenance-map"; generated: { uri: string; length: number; offsetEncoding: "utf-16" }; from: string; segments: ProvenanceSegment[]; }
export interface BuildProvenanceMap { version: 1; kind: "ravel-provenance-bundle"; maps: DeliverableProvenanceMap[]; }
export interface ProgramChunk { id: string; identity: ChunkIdentity; value: string; segments: ProvenanceSegment[]; metadata: { language?: string; data?: { ravel?: { run?: boolean; provider?: string; [key: string]: unknown }; [key: string]: unknown }; [key: string]: unknown }; source: SourceLocation; dependencies: string[]; references: Array<{ chunk: string; requested: string; source: SourceLocation }>; provenance: unknown[]; generated?: boolean; }
export interface Deliverable { name: string; from: string; value: string; segments: ProvenanceSegment[]; source: SourceLocation; dependencies: string[]; }
export interface RavelProgram { version: 1; documents: PretransformGraph["documents"]; chunks: Record<string, ProgramChunk>; deliverables: Record<string, Deliverable>; diagnostics: Diagnostic[]; trace: { chunks: Record<string, unknown[]> }; }
export interface TransformCall { type?: "transform"; name: string; arguments?: unknown[]; source?: SourceLocation; }
export interface LiveAnalysis {
  dependencies?: Array<string | { reference: string; source?: SourceLocation }>;
  resources?: Array<string | { name?: string; path?: string; source?: SourceLocation }>;
  modules?: Array<string | { specifier: string; source?: SourceLocation }>;
  diagnostics?: Diagnostic[];
}
export interface LiveExecutionRequest {
  id: string;
  runId: string;
  language: string;
  source: string;
  sourceLocation: SourceLocation;
  inputs: Record<string, RavelValue>;
  resources: Record<string, RavelValue>;
  analysis: LiveAnalysis;
  limits: Record<string, unknown>;
  signal?: AbortSignal;
}
export interface LiveExecutionOutcome {
  ok: boolean;
  hasExport?: boolean;
  value?: RavelValue;
  serialized?: string;
  diagnostics?: Diagnostic[];
  durationMs?: number;
}
export interface ExecutionProvider {
  id: string;
  version?: string;
  languages: string[] | Set<string>;
  analyze?(request: Pick<LiveExecutionRequest, "id" | "language" | "source" | "sourceLocation">): LiveAnalysis;
  execute(request: LiveExecutionRequest): Promise<LiveExecutionOutcome> | LiveExecutionOutcome;
  dispose?(): Promise<void> | void;
}
export interface LiveExecutionPlan {
  version: 1;
  nodes: Record<string, {
    id: string;
    language: string;
    provider: { id: string; version: string };
    source: SourceLocation;
    dependencies: Array<{ reference: string; id: string; source: SourceLocation }>;
    resources: LiveAnalysis["resources"];
    modules: LiveAnalysis["modules"];
    analysis: LiveAnalysis;
  }>;
  diagnostics: Diagnostic[];
  ok: boolean;
}
export interface LiveProgramResult {
  version: 1;
  program: RavelProgram;
  plan: LiveExecutionPlan;
  executions: Record<string, {
    id: string;
    status: "succeeded" | "failed";
    value?: RavelValue;
    serialized?: string;
    provider?: { id: string; version: string };
    durationMs?: number;
  }>;
  diagnostics: Diagnostic[];
  ok: boolean;
}
export function formatChunkId(identity: ChunkIdentity): string;
export function parseChunkId(input: string, options?: { reference?: boolean }): ChunkIdentity | null;
export function parseChunk(body: string, source: SourceLocation): { nodes: unknown[]; diagnostics: Diagnostic[] };
export function combineMaps(maps: RavelMap[]): PretransformGraph;
export function transformGraph(graph: PretransformGraph, options?: {
  transforms?: Record<string, (value: string, ...argumentsValue: unknown[]) => string> | Map<string, Function>;
  deferLiveResults?: boolean;
  liveResults?: LiveProgramResult | LiveProgramResult["executions"] | Map<string, LiveProgramResult["executions"][string]>;
}): RavelProgram;
export function ravelValueIssue(value: unknown, path?: string): string | null;
export function serializeRavelValue(value: unknown): string;
export function cloneRavelValue(value: RavelValue): RavelValue;
export function planLiveExecutions(program: RavelProgram, options?: { providers?: ExecutionProvider[] | Map<string, ExecutionProvider> | Record<string, ExecutionProvider> }): LiveExecutionPlan;
export function executeLiveProgram(program: RavelProgram, options?: {
  providers?: ExecutionProvider[] | Map<string, ExecutionProvider> | Record<string, ExecutionProvider>;
  resources?: Map<string, RavelValue> | Record<string, RavelValue>;
  limits?: Record<string, unknown>;
  runId?: string;
  signal?: AbortSignal;
}): Promise<LiveProgramResult>;
export const provenanceMapVersion: 1;
export function createDeliverableProvenanceMap(deliverable: Deliverable): DeliverableProvenanceMap;
export function createBuildProvenanceMap(program: RavelProgram): BuildProvenanceMap;
export function sourceAtGeneratedOffset(map: DeliverableProvenanceMap, offset: number): (ProvenanceSegment & { sourceOffset?: number }) | null;
export interface GeneratedSourceMatch { generated: { start: number; end: number }; generatedOffset?: number; source?: { start: number; end: number }; precision: "exact" | "coarse"; chunk: string; kind: string; via: ProvenanceStep[]; through?: "transform-origin"; }
export function generatedRangesForSource(map: DeliverableProvenanceMap, uri: string, offset: number): GeneratedSourceMatch[];
export function generatedRangesForSourceRange(map: DeliverableProvenanceMap, uri: string, range: { start: number | SourcePosition; end: number | SourcePosition }): GeneratedSourceMatch[];
export function explainGeneratedOffset(program: RavelProgram, deliverableName: string, offset: number): { deliverable: { name: string; from: string }; generatedOffset: number; segment: ProvenanceSegment & { sourceOffset?: number }; definition: { id: string; identity: ChunkIdentity; metadata: unknown; generated?: boolean } | null; references: ProvenanceStep[]; dependencyPath: string[] } | null;
export const directiveKinds: Set<string>;
export function compose(steps: unknown[], source: SourceLocation): unknown;
export function append(reference: string, source: SourceLocation): unknown;
export function newline(count: number, source: SourceLocation): unknown;
export function pipe(steps: unknown[], source: SourceLocation): unknown;
export function pass(steps: unknown[], source: SourceLocation): unknown;
export function createDirective(name: string, value: unknown, source: SourceLocation): unknown;
export function aliasDirective(name: string, reference: string, source: SourceLocation): unknown;
