import type {
  Diagnostic,
  LiveExecutionPlan,
  LiveProgramResult,
  PretransformGraph,
  RavelProgram,
  SourceLocation,
  SourceRange
} from "@pieceful/ravel-core";

export const EXPLORER_SNAPSHOT_VERSION: 1;
export const EXPLORER_PROTOCOL_VERSION: 1;
export const explorerLenses: readonly ExplorerLens[];
export const explorerRequestTypes: readonly ExplorerRequestType[];
export const explorerEventTypes: readonly ExplorerEventType[];

export type ExplorerLens =
  | "overview"
  | "dependencies"
  | "derivation"
  | "provenance"
  | "trace"
  | "changes";

export type ExplorerNodeKind =
  | "document"
  | "outline"
  | "chunk"
  | "transform"
  | "compose-step"
  | "emit"
  | "directive"
  | "deliverable"
  | "source-fragment"
  | "generated-fragment"
  | "diagnostic";

export type ExplorerEdgeKind =
  | "contains"
  | "references"
  | "consumes"
  | "transforms"
  | "declares"
  | "composes"
  | "aliases"
  | "imports"
  | "emits"
  | "produces"
  | "corresponds-to";

export interface ExplorerNode {
  id: string;
  kind: ExplorerNodeKind;
  label: string;
  parent?: string;
  source?: SourceLocation | { uri: string };
  language?: string;
  tags?: string[];
  state?: string[];
  counts?: Record<string, number>;
  data?: Record<string, unknown>;
  fingerprint?: string;
}

export interface ExplorerEdge {
  id: string;
  kind: ExplorerEdgeKind;
  source: string;
  target: string;
  authoredAt?: SourceLocation;
  label?: string;
  phase?: number;
  occurrence?: number;
  count?: number;
  members?: string[];
  state?: string[];
}

export interface ExplorerGroup {
  id: string;
  kind: "document" | "outline" | "identity" | "language" | "tag" | "deliverable";
  label: string;
  parent?: string;
  nodeIds: string[];
  collapsed: boolean;
}

export interface ExplorerSnapshot {
  version: 1;
  project: { id: string; label: string };
  revision: string;
  lens: ExplorerLens;
  focus: string[];
  truncated: boolean;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  groups: ExplorerGroup[];
  diagnostics: { errors: number; warnings: number; information: number };
  counts: {
    availableNodes: number;
    visibleNodes: number;
    visibleEdges: number;
    chunks: number;
  };
}

export interface ExplorerContext {
  program: RavelProgram;
  pretransform?: PretransformGraph;
  livePlan?: LiveExecutionPlan;
  liveResult?: LiveProgramResult;
  revision?: string;
  project?: { id: string; label: string };
}

export interface ExplorerSnapshotOptions {
  lens?: ExplorerLens;
  focus?: string | string[];
  upstream?: number;
  downstream?: number;
  maxNodes?: number;
}

export interface ExplorerSnapshotDiff {
  version: 1;
  beforeRevision: string;
  afterRevision: string;
  nodes: { added: string[]; removed: string[]; changed: string[] };
  edges: { added: string[]; removed: string[]; changed: string[] };
  diagnosticsChanged: boolean;
}

export interface ExplorerTextPreview {
  text: string;
  length: number;
  truncated: boolean;
}

export interface ExplorerEntityDetails {
  version: 1;
  entityId: string;
  revision: string;
  kind: "chunk" | "transform" | "directive" | "compose-step" | "deliverable";
  label: string;
  ownerEntityId?: string;
  source?: SourceLocation | { uri: string };
  language?: string;
  authored?: ExplorerTextPreview;
  evaluated?: ExplorerTextPreview;
}

export interface ExplorerOutputSegment {
  index: number;
  generated: { start: number; end: number };
  chunk: string;
  kind: string;
  precision: "exact" | "coarse";
  source?: SourceLocation;
  steps: number;
  origins: number;
}

export interface ExplorerOutputDetails {
  version: 1;
  entityId: string;
  revision: string;
  name: string;
  from: string;
  language?: string;
  value: ExplorerTextPreview;
  segments: ExplorerOutputSegment[];
  availableSegments: number;
  truncatedSegments: boolean;
  explanation: null | {
    generatedOffset: number;
    segment: {
      generated: { start: number; end: number };
      chunk: string;
      kind: string;
      precision: "exact" | "coarse";
      source: SourceLocation | null;
      sourceOffset?: number;
      via: Array<Record<string, unknown>>;
      origins: Array<Record<string, unknown>>;
    };
    definition: null | {
      id: string;
      identity: unknown;
      generated?: boolean;
    };
    references: Array<Record<string, unknown>>;
    dependencyPath: string[];
    truncated: boolean;
  };
}

export interface ExplorerGeneratedMatches {
  version: 1;
  revision: string;
  source: SourceLocation;
  matches: Array<{
    entityId: string;
    name: string;
    from: string;
    generated: { start: number; end: number };
    generatedOffset?: number;
    precision: "exact" | "coarse";
    chunk: string;
    kind: string;
    through?: "transform-origin";
    steps: number;
  }>;
  availableMatches: number;
  truncated: boolean;
}

export type ExplorerRequestType =
  | "project/open"
  | "view/request"
  | "entity/select"
  | "source/reveal"
  | "output/request"
  | "edit/preview"
  | "edit/apply"
  | "edit/discard"
  | "perspective/save"
  | "perspective/restore"
  | "request/cancel";

export type ExplorerEventType =
  | "project/opened"
  | "view/result"
  | "selection/changed"
  | "output/result"
  | "edit/preview-result"
  | "edit/applied"
  | "diagnostics/changed"
  | "document/changed"
  | "request/progress"
  | "request/error";

export interface ExplorerMessage {
  version: 1;
  type: ExplorerRequestType | ExplorerEventType;
  requestId: string;
  revision?: string;
  [key: string]: unknown;
}

export interface ExplorerEditProposal {
  id: string;
  baseRevision: string;
  documents: Array<{
    uri: string;
    version: number;
    edits: Array<{ range: SourceRange; text: string }>;
  }>;
  intent: "edit-source" | "change-reference" | "change-transform" | "reorder-pipeline";
}

export function createExplorerSnapshot(
  programOrContext: RavelProgram | ExplorerContext,
  options?: ExplorerSnapshotOptions
): ExplorerSnapshot;
export function createExplorerEntityDetails(
  programOrContext: RavelProgram | ExplorerContext,
  entityId: string,
  options?: { maxTextLength?: number }
): ExplorerEntityDetails | null;
export function createExplorerOutputDetails(
  programOrContext: RavelProgram | ExplorerContext,
  deliverableId: string,
  options?: {
    generatedOffset?: number;
    maxTextLength?: number;
    maxSegments?: number;
  }
): ExplorerOutputDetails | null;
export function createExplorerGeneratedMatches(
  programOrContext: RavelProgram | ExplorerContext,
  source: SourceLocation,
  options?: { maxMatches?: number }
): ExplorerGeneratedMatches;
export function upstreamChunkIds(
  programOrContext: RavelProgram | ExplorerContext,
  focus: string | string[],
  depth?: number
): string[];
export function downstreamChunkIds(
  programOrContext: RavelProgram | ExplorerContext,
  focus: string | string[],
  depth?: number
): string[];
export function dependencyPath(
  programOrContext: RavelProgram | ExplorerContext,
  producer: string,
  consumer: string
): string[];
export function diffExplorerSnapshots(
  before: ExplorerSnapshot,
  after: ExplorerSnapshot
): ExplorerSnapshotDiff;
export function createExplorerChangeSnapshot(
  before: ExplorerSnapshot,
  after: ExplorerSnapshot,
  diff?: ExplorerSnapshotDiff
): ExplorerSnapshot;
export function collapseExplorerGroups(
  snapshot: ExplorerSnapshot,
  groupIds: string | string[]
): ExplorerSnapshot;
export function validateExplorerMessage(message: unknown): string[];
export function assertExplorerMessage<T extends ExplorerMessage>(message: T): T;

export type { Diagnostic, SourceLocation, SourceRange };
