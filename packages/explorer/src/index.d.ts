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
export function collapseExplorerGroups(
  snapshot: ExplorerSnapshot,
  groupIds: string | string[]
): ExplorerSnapshot;
export function validateExplorerMessage(message: unknown): string[];
export function assertExplorerMessage<T extends ExplorerMessage>(message: T): T;

export type { Diagnostic, SourceLocation, SourceRange };
