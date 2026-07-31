export type ProjectionStage = "authoring" | "assembled" | "transformed" | "emitted";
export type LanguageRequestKind =
  | "completion" | "completionDetails" | "hover" | "signatureHelp"
  | "definition" | "typeDefinition" | "references"
  | "documentSymbols" | "workspaceSymbols" | "diagnostics"
  | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls"
  | "prepareRename" | "rename";

export interface OffsetRange { start: number; end: number; }
export interface TextChange { range: OffsetRange; text: string; }
export interface VirtualDocumentLike {
  id?: string;
  uri: string;
  snapshotId?: string;
  version: number;
  artifactId?: string;
  targetId?: string;
  stage?: ProjectionStage;
  languageId: string;
  text: string;
  fileName?: string;
  path?: string;
  tsconfigPath?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BridgeCapability {
  readonly supported: boolean;
  readonly stages: readonly ProjectionStage[];
  readonly triggerCharacters?: readonly string[];
  readonly resolveProvider?: boolean;
  readonly workspaceProvider?: boolean;
}
export type BridgeCapabilities = Readonly<Record<LanguageRequestKind, BridgeCapability>>;
export type BridgeCapabilityDefinition = boolean | {
  stages: readonly ProjectionStage[];
  triggerCharacters?: readonly string[];
  resolveProvider?: boolean;
  workspaceProvider?: boolean;
};

export interface LanguageRequestBase {
  kind: LanguageRequestKind;
  documentUri?: string;
}
export interface PositionLanguageRequest extends LanguageRequestBase {
  position?: number;
}
export interface CompletionRequest extends PositionLanguageRequest {
  kind: "completion";
  options?: Record<string, unknown>;
  formatOptions?: Record<string, unknown>;
}
export interface CompletionDetailsRequest extends PositionLanguageRequest {
  kind: "completionDetails";
  name: string;
  source?: string;
  data?: unknown;
  preferences?: Record<string, unknown>;
  formatOptions?: Record<string, unknown>;
}
export interface HoverRequest extends PositionLanguageRequest { kind: "hover"; }
export interface SignatureHelpRequest extends PositionLanguageRequest {
  kind: "signatureHelp";
  options?: Record<string, unknown>;
}
export interface DefinitionRequest extends PositionLanguageRequest { kind: "definition"; }
export interface TypeDefinitionRequest extends PositionLanguageRequest { kind: "typeDefinition"; }
export interface ReferencesRequest extends PositionLanguageRequest { kind: "references"; }
export interface DocumentSymbolsRequest extends LanguageRequestBase { kind: "documentSymbols"; }
export interface WorkspaceSymbolsRequest extends LanguageRequestBase {
  kind: "workspaceSymbols";
  query?: string;
  maximumResultCount?: number;
  excludeFileName?: string;
  excludeDtsFiles?: boolean;
}
export interface DiagnosticsRequest extends LanguageRequestBase {
  kind: "diagnostics";
  categories?: readonly ("configuration" | "compilerOptions" | "syntactic" | "semantic" | "suggestion")[];
}
export interface PrepareCallHierarchyRequest extends PositionLanguageRequest { kind: "prepareCallHierarchy"; }
export interface IncomingCallsRequest extends PositionLanguageRequest { kind: "incomingCalls"; }
export interface OutgoingCallsRequest extends PositionLanguageRequest { kind: "outgoingCalls"; }
export interface PrepareRenameRequest extends PositionLanguageRequest {
  kind: "prepareRename";
  allowRenameOfImportPath?: boolean;
}
export interface RenameRequest extends PositionLanguageRequest {
  kind: "rename";
  newName: string;
  allowRenameOfImportPath?: boolean;
  findInStrings?: boolean;
  findInComments?: boolean;
  providePrefixAndSuffixTextForRename?: boolean;
}
export type LanguageRequest =
  | CompletionRequest | CompletionDetailsRequest | HoverRequest
  | SignatureHelpRequest | DefinitionRequest | TypeDefinitionRequest
  | ReferencesRequest | DocumentSymbolsRequest | WorkspaceSymbolsRequest
  | DiagnosticsRequest | PrepareCallHierarchyRequest | IncomingCallsRequest
  | OutgoingCallsRequest | PrepareRenameRequest | RenameRequest;

export interface GeneratedLocation {
  uri: string;
  range: OffsetRange;
  contextRange?: OffsetRange;
  name?: string;
  kind?: string;
  containerName?: string;
  isWriteAccess?: boolean;
  isDefinition?: boolean;
}
export interface GeneratedTextEdit { range: OffsetRange; text: string; }
export interface GeneratedFileChanges {
  uri: string;
  version?: number;
  textChanges: GeneratedTextEdit[];
  isNewFile?: boolean;
}
export interface CompletionItem {
  name: string;
  kind: string;
  kindModifiers?: string;
  sortText: string;
  insertText?: string;
  filterText?: string;
  replacementSpan?: OffsetRange;
  source?: string;
  hasAction?: boolean;
  isRecommended?: boolean;
  isSnippet?: boolean;
  commitCharacters?: string[];
  data?: unknown;
}
export interface CompletionResponse {
  items: CompletionItem[];
  isGlobal: boolean;
  isMember: boolean;
  isNewIdentifier: boolean;
  optionalReplacementSpan?: OffsetRange;
  defaultCommitCharacters?: string[];
}
export interface CompletionDetailsResponse {
  name: string;
  kind: string;
  kindModifiers?: string;
  display: string;
  documentation: string;
  tags: Array<{ name: string; text: string }>;
  source?: string;
  codeActions: Array<{
    description: string;
    commands?: unknown[];
    changes: GeneratedFileChanges[];
  }>;
}
export interface HoverResponse {
  range?: OffsetRange;
  kind?: string;
  kindModifiers?: string;
  display: string;
  documentation: string;
  tags: Array<{ name: string; text: string }>;
}
export interface SignatureHelpResponse {
  applicableSpan?: OffsetRange;
  selectedItemIndex: number;
  argumentIndex: number;
  argumentCount: number;
  items: Array<{
    isVariadic?: boolean;
    prefix: string;
    separator: string;
    suffix: string;
    documentation: string;
    tags: Array<{ name: string; text: string }>;
    parameters: Array<{
      name: string;
      display: string;
      documentation: string;
      tags: Array<{ name: string; text: string }>;
      isOptional: boolean;
    }>;
  }>;
}
export interface GeneratedSymbol {
  name: string;
  kind: string;
  kindModifiers?: string;
  uri: string;
  range: OffsetRange;
  selectionRange?: OffsetRange;
  containerName?: string;
}
export interface GeneratedDiagnostic {
  uri: string;
  range: OffsetRange;
  code: string | number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source: string;
  related: Array<{ uri?: string; range?: OffsetRange; message: string }>;
}
export interface GeneratedCallItem {
  name: string;
  kind: string;
  uri: string;
  range: OffsetRange;
  selectionRange: OffsetRange;
  containerName?: string;
  kindModifiers?: string;
}
export interface IncomingCall {
  from: GeneratedCallItem;
  fromRanges: OffsetRange[];
}
export interface OutgoingCall {
  to: GeneratedCallItem;
  fromRanges: OffsetRange[];
}
export interface PrepareRenameResponse {
  canRename: boolean;
  range?: OffsetRange;
  placeholder?: string;
  reason?: string;
  fullDisplayName?: string;
  kind?: string;
  kindModifiers?: string;
}
export interface RenameResponse {
  canRename: boolean;
  reason?: string;
  changes: GeneratedFileChanges[];
}
export type LanguageResponse<T extends LanguageRequest> =
  T extends CompletionRequest ? CompletionResponse :
  T extends CompletionDetailsRequest ? CompletionDetailsResponse | undefined :
  T extends HoverRequest ? HoverResponse | undefined :
  T extends SignatureHelpRequest ? SignatureHelpResponse | undefined :
  T extends DefinitionRequest | TypeDefinitionRequest | ReferencesRequest ? GeneratedLocation[] :
  T extends DocumentSymbolsRequest | WorkspaceSymbolsRequest ? GeneratedSymbol[] :
  T extends DiagnosticsRequest ? GeneratedDiagnostic[] :
  T extends PrepareCallHierarchyRequest ? GeneratedCallItem[] :
  T extends IncomingCallsRequest ? IncomingCall[] :
  T extends OutgoingCallsRequest ? OutgoingCall[] :
  T extends PrepareRenameRequest ? PrepareRenameResponse :
  T extends RenameRequest ? RenameResponse : unknown;

export interface ExtensibleLanguageRequest extends LanguageRequestBase {
  range?: OffsetRange;
  [key: string]: unknown;
}
export interface BridgeRequestContext {
  document?: VirtualDocumentLike;
  documentUri?: string;
  version?: number;
  stage?: ProjectionStage;
  [key: string]: unknown;
}

export interface LanguageBridge {
  readonly languageIds: readonly string[];
  readonly capabilities: BridgeCapabilities;
  readonly state?: string;
  open(document: VirtualDocumentLike, signal?: AbortSignal): Promise<void>;
  change(previous: VirtualDocumentLike, next: VirtualDocumentLike, changes: readonly TextChange[], signal?: AbortSignal): Promise<void>;
  close(document: VirtualDocumentLike): Promise<void>;
  request<T extends LanguageRequest>(request: T, context?: BridgeRequestContext, signal?: AbortSignal): Promise<LanguageResponse<T>>;
  restart?(): Promise<void>;
  dispose?(): Promise<void>;
}

export type BridgeLifecycleState = "stopped" | "starting" | "ready" | "failed" | "restarting" | "disposed";
export interface BridgeLifecycleEvent {
  previous: BridgeLifecycleState;
  current: BridgeLifecycleState;
  attempt: number;
  error?: LanguageBridgeError;
}
export interface ProcessBackedLanguageBridge extends LanguageBridge {
  readonly state: BridgeLifecycleState;
  readonly restartPolicy: RestartPolicy;
  start(): Promise<void>;
  restart(): Promise<void>;
  onDidChangeState(listener: (event: BridgeLifecycleEvent) => void): { dispose(): void };
}

export interface RestartPolicy {
  maximumAttempts: number;
  initialDelayMs: number;
  maximumDelayMs: number;
  multiplier: number;
}

export const LANGUAGE_REQUEST_KINDS: readonly LanguageRequestKind[];
export const PROJECTION_STAGES: readonly ProjectionStage[];
export const BRIDGE_LIFECYCLE_STATES: readonly string[];
export const BRIDGE_ERROR_CODES: Readonly<Record<string, string>>;
export class LanguageBridgeError extends Error {
  code: string;
  retryable: boolean;
  details?: unknown;
  constructor(code: string, message: string, options?: { cause?: Error; retryable?: boolean; details?: unknown });
  toJSON(): { name: string; code: string; message: string; retryable: boolean; details?: unknown };
}
export function bridgeError(error: unknown, fallback?: { code?: string; message?: string; retryable?: boolean; details?: unknown }): LanguageBridgeError;
export function throwIfAborted(signal?: AbortSignal): void;
export function assertVirtualDocument<T extends VirtualDocumentLike>(document: T): T;
export function assertLanguageRequest<T extends LanguageRequest>(request: T): T;
export function createBridgeCapabilities(definitions?: Partial<Record<LanguageRequestKind, BridgeCapabilityDefinition>>): BridgeCapabilities;
export function supportsLanguageRequest(capabilities: BridgeCapabilities, kind: LanguageRequestKind, stage?: ProjectionStage): boolean;
export function requireLanguageRequestSupport(bridge: Pick<LanguageBridge, "capabilities">, request: LanguageRequest, context?: BridgeRequestContext): void;
export function createRestartPolicy(options?: Partial<RestartPolicy>): Readonly<RestartPolicy>;
export function restartDelay(policy: RestartPolicy, attempt: number): number | undefined;
export function assertLifecycleState(state: string): string;
