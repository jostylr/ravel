export type SnapshotId = string;
export type ProjectionId = string;
export type ArtifactId = string;
export type TargetId = string;
export type PieceId = string;
export type OccurrenceId = string;
export type ProjectionStage = "authoring" | "assembled" | "transformed" | "emitted";
export type MappingKind = "exact" | "anchored" | "transformed" | "opaque" | "synthetic";
export type MappingQuality = MappingKind;
export type Affinity = "left" | "right" | "none";
export type PositionEncoding = "utf-8" | "utf-16" | "utf-32";

export interface OffsetRange { start: number; end: number; }
export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface ProjectionCapabilities {
  navigation: boolean;
  diagnostics: boolean;
  completion: boolean;
  writableEdits: boolean;
}
export interface TransformStep {
  kind?: "transform";
  name?: string;
  phase?: number;
  source?: SourceLocation;
}

export interface ProjectionSegment {
  readonly virtual: OffsetRange;
  readonly source?: SourceLocation;
  readonly pieceId?: PieceId;
  readonly occurrenceId?: OccurrenceId;
  readonly expansionPath: readonly PieceId[];
  readonly kind: MappingKind;
  readonly role?: string;
  readonly startAffinity?: "left" | "right";
  readonly endAffinity?: "left" | "right";
  readonly transformChain?: readonly TransformStep[];
}

export interface ExpansionOccurrence {
  readonly id: OccurrenceId;
  readonly pieceId: PieceId;
  readonly projectionId: ProjectionId;
  readonly virtual: OffsetRange;
  readonly invocationSource?: SourceLocation;
  readonly definitionSource?: SourceLocation;
  readonly expansionPath: readonly PieceId[];
  readonly parentOccurrenceId?: OccurrenceId;
  readonly childOccurrenceIds: readonly OccurrenceId[];
  readonly implicit?: boolean;
}

export interface LineIndex {
  readonly text: string;
  readonly textLength: number;
  readonly lineStarts: readonly number[];
}

export interface ProjectionIndexes {
  readonly virtual: readonly number[];
  readonly virtualMaxEnds: readonly number[];
  readonly source: Readonly<Record<string, readonly number[]>>;
  readonly sourceMaxEnds: Readonly<Record<string, readonly number[]>>;
  readonly occurrenceById: Readonly<Record<string, number>>;
  readonly children: Readonly<Record<string, readonly number[]>>;
}

export interface ProjectionDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: SourceLocation;
  related?: SourceLocation[];
}

export interface VirtualDocument {
  readonly id: ProjectionId;
  readonly uri: string;
  readonly snapshotId: SnapshotId;
  readonly sourceVersions: Readonly<Record<string, number>>;
  readonly version: number;
  readonly workspaceId: string;
  readonly artifactId: ArtifactId;
  readonly targetId: TargetId;
  readonly stage: ProjectionStage;
  readonly languageId: string;
  readonly text: string;
  readonly mappings: readonly ProjectionSegment[];
  readonly occurrences: readonly ExpansionOccurrence[];
  readonly lineIndex: LineIndex;
  readonly sourceLineIndexes: Readonly<Record<string, LineIndex>>;
  readonly indexes: ProjectionIndexes;
  readonly contentHash: string;
  readonly inputHash: string;
  readonly artifactSource?: SourceLocation;
  readonly projectionDiagnostics: readonly ProjectionDiagnostic[];
  readonly capabilities: ProjectionCapabilities;
}

export interface ProjectionBuildOptions {
  artifactId?: ArtifactId;
  targetId?: TargetId;
  workspaceId?: string;
  stage?: ProjectionStage;
  languageId?: string;
  projectionId?: ProjectionId;
  uri?: string;
  path?: string;
  snapshotId?: SnapshotId;
  sourceVersions?: Record<string, number>;
  sourceTexts?: Map<string, string> | Record<string, string>;
  version?: number;
  prefix?: string;
  suffix?: string;
  rootPieceId?: PieceId;
  capabilities?: Partial<ProjectionCapabilities>;
  signal?: AbortSignal;
}

export interface ProjectionSelection {
  projectionId?: ProjectionId;
  targetId?: TargetId;
  artifactId?: ArtifactId;
  stage?: ProjectionStage;
  occurrenceId?: OccurrenceId;
  affinity?: Affinity;
  projectionVersion?: number;
}

export interface ProjectionMappingMatch {
  projectionId: ProjectionId;
  uri: string;
  projectionVersion: number;
  snapshotId: SnapshotId;
  virtual: OffsetRange;
  virtualOffset?: number;
  relatedVirtual?: OffsetRange;
  source?: SourceLocation;
  sourceOffset?: number;
  sourceOverlap?: OffsetRange;
  pieceId?: PieceId;
  occurrenceId?: OccurrenceId;
  quality: MappingQuality;
  role: string;
  affinity?: Affinity;
  writable: boolean;
  segmentIndex: number;
}

export type MappingQueryResult =
  | { readonly ok: true; readonly matches: readonly ProjectionMappingMatch[] }
  | { readonly ok: false; readonly reason: string; readonly matches: readonly [] };

export interface GeneratedHighlight {
  range: OffsetRange;
  kind: string;
  categories: readonly string[];
  mappingKind: MappingKind;
  pieceId?: PieceId;
  occurrenceId?: OccurrenceId;
}
export interface ExpansionBreadcrumbItem {
  occurrenceId: OccurrenceId;
  pieceId: PieceId;
  label: string;
  virtual: OffsetRange;
  invocationSource?: SourceLocation;
}
export interface OccurrenceSummary {
  occurrenceId: OccurrenceId;
  pieceId: PieceId;
  targetId: TargetId;
  artifactId: ArtifactId;
  stage: ProjectionStage;
  virtual: OffsetRange;
  pathLabel: string;
}
export interface GeneratedContext {
  readonly ok: true;
  readonly projection: VirtualDocument;
  readonly projectionVersion: number;
  readonly selectedOccurrenceId: OccurrenceId;
  readonly visibleRange: OffsetRange;
  readonly highlights: readonly GeneratedHighlight[];
  readonly breadcrumb: readonly ExpansionBreadcrumbItem[];
  readonly siblings: readonly OccurrenceSummary[];
}
export type GeneratedContextResult = GeneratedContext | { readonly ok: false; readonly reason: string };

export interface ProjectionTextEdit { range: OffsetRange; text: string; }
export interface ProjectionTextChange {
  kind: "none" | "incremental" | "full";
  changes: readonly ProjectionTextEdit[];
}
export interface ProjectionDelta {
  readonly snapshotId: SnapshotId;
  readonly sourceVersions: Readonly<Record<string, number>>;
  readonly opened: readonly VirtualDocument[];
  readonly changed: readonly VirtualDocument[];
  readonly unchanged: readonly VirtualDocument[];
  readonly closed: readonly VirtualDocument[];
  readonly textChanges: Readonly<Record<ProjectionId, ProjectionTextChange>>;
  readonly projectionDiagnostics: readonly ProjectionDiagnostic[];
}
export interface ProjectionSnapshot {
  readonly id?: SnapshotId;
  readonly snapshotId?: SnapshotId;
  readonly version?: number;
  readonly program: Record<string, any>;
  readonly sourceVersions?: Readonly<Record<string, number>>;
  readonly sourceTexts?: Readonly<Record<string, string>>;
  readonly projections?: readonly ProjectionBuildOptions[] | ((snapshot: ProjectionSnapshot) => readonly ProjectionBuildOptions[]);
}

export interface ProjectionServiceOptions {
  workspaceId?: string;
  targetId?: TargetId;
  stage?: ProjectionStage;
  projections?: readonly ProjectionBuildOptions[] | ((snapshot: ProjectionSnapshot) => readonly ProjectionBuildOptions[]);
  yieldEvery?: number;
  maxRetainedSnapshots?: number;
  backgroundDebounceMs?: number;
  scheduler?: () => Promise<void>;
  trace?: (event: Readonly<Record<string, unknown>>) => void;
}

export class ProjectionService {
  constructor(options?: ProjectionServiceOptions);
  update(snapshot: ProjectionSnapshot, signal?: AbortSignal): Promise<ProjectionDelta>;
  scheduleUpdate(snapshot: ProjectionSnapshot, options?: { signal?: AbortSignal; priority?: "background" | "interactive" }): Promise<ProjectionDelta>;
  getProjection(id: ProjectionId): VirtualDocument | undefined;
  getProjectionByUri(uri: string): VirtualDocument | undefined;
  listProjections(): readonly VirtualDocument[];
  listProjectionsForSource(source: SourceLocation): readonly Array<{ projectionId: ProjectionId; uri: string; artifactId: ArtifactId; targetId: TargetId; stage: ProjectionStage; version: number }>;
  listOccurrences(pieceId: PieceId, targetId?: TargetId): readonly ExpansionOccurrence[];
  toVirtual(source: SourceLocation | { uri: string; offset: number }, selection?: ProjectionSelection): readonly ProjectionMappingMatch[];
  toSource(projectionId: ProjectionId, virtual: OffsetRange | number, options?: ProjectionSelection): readonly ProjectionMappingMatch[];
  generatedContext(occurrenceId: OccurrenceId, options?: GeneratedContextOptions): GeneratedContextResult;
  getStats(): Readonly<{ built: number; reused: number; cancelled: number; updates: number; retainedSnapshots: number; currentProjections: number }>;
  dispose(): void;
}

export interface GeneratedContextOptions {
  surroundingLines?: number;
  projectionVersion?: number;
  sourceSelection?: SourceLocation;
}

export function createProjectionId(options?: ProjectionBuildOptions): ProjectionId;
export function createVirtualUri(options?: ProjectionBuildOptions & { path?: string }): string;
export function buildVirtualDocument(program: Record<string, any>, options?: ProjectionBuildOptions): VirtualDocument;
export function projectionInputHash(program: Record<string, any>, options?: ProjectionBuildOptions): string;
export function createLineIndex(text?: string): LineIndex;
export function positionAt(index: LineIndex, offset: number, encoding?: PositionEncoding): { ok: true; position: { line: number; character: number; offset: number } } | { ok: false; reason: string };
export function offsetAt(index: LineIndex, position: { line: number; character: number }, encoding?: PositionEncoding): { ok: true; offset: number } | { ok: false; reason: string };
export function lineRangeAt(index: LineIndex, line: number): { ok: true; range: OffsetRange } | { ok: false; reason: string };
export function lineWindow(index: LineIndex, range: OffsetRange, surroundingLines?: number): { ok: true; range: OffsetRange } | { ok: false; reason: string };
export function buildProjectionIndexes(segments?: readonly ProjectionSegment[], occurrences?: readonly ExpansionOccurrence[]): ProjectionIndexes;
export function coalesceProjectionSegments(segments?: readonly ProjectionSegment[]): readonly ProjectionSegment[];
export function mapVirtualOffset(document: VirtualDocument, offset: number, options?: ProjectionSelection): MappingQueryResult;
export function mapVirtualRange(document: VirtualDocument, range: OffsetRange, options?: ProjectionSelection): MappingQueryResult;
export function mapSourceOffset(document: VirtualDocument, uri: string, offset: number, options?: ProjectionSelection): MappingQueryResult;
export function mapSourceRange(document: VirtualDocument, uri: string, range: OffsetRange, options?: ProjectionSelection): MappingQueryResult;
export function validateProjectionSegments(text: string, segments?: readonly ProjectionSegment[]): readonly Array<{ code: string; message: string }>;
export function sameProjectionMapping(left: ProjectionSegment, right: ProjectionSegment): boolean;
export function generatedContext(document: VirtualDocument, occurrenceId: OccurrenceId, options?: GeneratedContextOptions): GeneratedContextResult;
export function navigateGeneratedSelection(document: VirtualDocument, range: OffsetRange, options?: ProjectionSelection): MappingQueryResult;
export function createProjectionService(options?: ProjectionServiceOptions): ProjectionService;
export function createProjectionTextChange(previousText: string, nextText: string, options?: { minimumReuseRatio?: number }): ProjectionTextChange;

export type TransformSpanMode = "copy" | "mapped" | "inserted" | "removed";
export interface TransformOffsetSpan { input: OffsetRange; output: OffsetRange; mode: TransformSpanMode; }
export interface OffsetMap {
  kind: "offset";
  name: string;
  inputLength: number;
  outputLength: number;
  spans: readonly TransformOffsetSpan[];
}
export interface SourceMapPoint {
  generated: { line: number; column: number };
  source?: string;
  original?: { line: number; column: number };
  name?: string;
}
export interface NormalizedSourceMap {
  kind: "source-map";
  sourceRoot?: string;
  sources: readonly string[];
  sourcesContent: readonly (string | null)[];
  entries: readonly SourceMapPoint[];
}
export type TransformMappingCapability =
  | { kind: "identity" }
  | OffsetMap
  | { kind: "source-map"; entries: readonly SourceMapPoint[] }
  | { kind: "opaque"; anchor?: SourceLocation };
export interface OffsetTransformResult { ok: true; text: string; map: OffsetMap; }

export function identityTransformMap(input: string | number): OffsetMap | { kind: "invalid"; reason: string };
export function createIndentOffsetMap(input: string, count?: number): OffsetTransformResult | { ok: false; reason: string };
export function createDedentOffsetMap(input: string): (OffsetTransformResult & { amount: number }) | { ok: false; reason: string };
export function createEolOffsetMap(input: string, eol?: "\n" | "\r\n"): OffsetTransformResult | { ok: false; reason: string };
export function validateTransformMapping(mapping: TransformMappingCapability): { ok: boolean; reason?: string; index?: number };
export function composeOffsetMaps(...maps: Array<OffsetMap | readonly OffsetMap[]>): { ok: true; map: OffsetMap } | { ok: false; reason: string };
export function mapTransformOffset(mapping: OffsetMap, offset: number, options?: { direction?: "output-to-input" | "input-to-output"; affinity?: Affinity }): { ok: boolean; reason?: string; matches: readonly number[] };
export function opaqueTransformMap(anchor?: SourceLocation): { kind: "opaque"; anchor?: SourceLocation };
export function stageCapabilities(stage: ProjectionStage, overrides?: Partial<ProjectionCapabilities>): ProjectionCapabilities;
export function validateAnalysisTransform(descriptor: { pure?: boolean; effect?: unknown; effects?: readonly unknown[]; authorities?: readonly unknown[]; mapping?: TransformMappingCapability; map?: TransformMappingCapability }): { ok: boolean; reason?: string };
export function normalizeSourceMap(sourceMap: Record<string, any>): { ok: true; map: NormalizedSourceMap } | { ok: false; reason: string };
export function applyTransformMap(document: VirtualDocument, outputText: string, capability: TransformMappingCapability | { map: TransformMappingCapability }, options?: {
  signal?: AbortSignal;
  inputSource?: string;
  transformSource?: SourceLocation;
  transformChain?: readonly TransformStep[];
  name?: string;
  stage?: ProjectionStage;
  languageId?: string;
  projectionId?: ProjectionId;
  uri?: string;
  path?: string;
  version?: number;
  capabilities?: Partial<ProjectionCapabilities>;
}): { ok: true; document: VirtualDocument } | { ok: false; reason: string };

export const MAPPING_KINDS: readonly MappingKind[];
export const PROJECTION_STAGES: readonly ProjectionStage[];
export const POSITION_ENCODINGS: readonly PositionEncoding[];
