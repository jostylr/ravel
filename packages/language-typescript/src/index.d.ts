import type {
  BridgeCapabilities,
  BridgeRequestContext,
  LanguageBridge,
  LanguageRequest,
  LanguageResponse,
  TextChange,
  VirtualDocumentLike
} from "@pieceful/ravel-language-bridge";

export interface TypeScriptBridgeOptions {
  /** An already loaded `typescript` compiler API. */
  typescript?: unknown;
  /** Alternate module specifier used by the async factory. */
  typescriptModule?: string;
  loadTypeScript?: (specifier: string) => unknown | Promise<unknown>;
  /** Base directory used for virtual artifact paths. */
  currentDirectory?: string;
  /**
   * Allowlisted root for explicit and discovered tsconfig files. Defaults to
   * currentDirectory; relative values are resolved from currentDirectory.
   * Config paths outside its canonical filesystem location are ignored.
   */
  configSearchRoot?: string;
  tsconfigPath?: string;
  compilerOptions?: Record<string, unknown>;
  fileNameForDocument?: (document: VirtualDocumentLike) => string | undefined;
  configFileForDocument?: (document: VirtualDocumentLike, fileName: string) => string | undefined;
  completionOptions?: Record<string, unknown>;
  userPreferences?: Record<string, unknown>;
  formatOptions?: Record<string, unknown>;
}

export interface GeneratedRange { start: number; end: number; }
export interface GeneratedLocation {
  uri: string;
  range: GeneratedRange;
  contextRange?: GeneratedRange;
  name?: string;
  kind?: string;
  containerName?: string;
  isWriteAccess?: boolean;
  isDefinition?: boolean;
}
export interface GeneratedTextChange { range: GeneratedRange; text: string; }
export interface GeneratedFileChanges {
  uri: string;
  version?: number;
  textChanges: GeneratedTextChange[];
  isNewFile?: boolean;
}
export interface TypeScriptDiagnostic {
  uri: string;
  range: GeneratedRange;
  code: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source: "typescript";
  related: Array<{ uri?: string; range?: GeneratedRange; message: string }>;
}
export interface TypeScriptCallItem {
  name: string;
  kind: string;
  uri: string;
  range: GeneratedRange;
  selectionRange: GeneratedRange;
  containerName?: string;
  kindModifiers?: string;
}

export class TypeScriptLanguageBridge implements LanguageBridge {
  readonly languageIds: readonly ["typescript", "typescriptreact", "javascript", "javascriptreact"];
  readonly capabilities: BridgeCapabilities;
  readonly state: string;
  constructor(typescript: unknown, options?: TypeScriptBridgeOptions);
  open(document: VirtualDocumentLike, signal?: AbortSignal): Promise<void>;
  change(previous: VirtualDocumentLike, next: VirtualDocumentLike, changes?: readonly TextChange[], signal?: AbortSignal): Promise<void>;
  close(document: VirtualDocumentLike): Promise<void>;
  request<T extends LanguageRequest>(request: T, context?: BridgeRequestContext, signal?: AbortSignal): Promise<LanguageResponse<T>>;
  restart(): Promise<void>;
  dispose(): Promise<void>;
}

export function createTypeScriptLanguageBridge(options?: TypeScriptBridgeOptions): Promise<TypeScriptLanguageBridge>;
export function createTypeScriptLanguageBridgeWithApi(typescript: unknown, options?: TypeScriptBridgeOptions): TypeScriptLanguageBridge;
