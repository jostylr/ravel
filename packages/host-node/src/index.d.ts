export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; }
export interface RavelProgram { version?: number; deliverables: Record<string, { name: string; from: string; value: string; segments?: unknown[] }>; }
export interface LiveModuleDeclaration { specifier: string; from: string; source?: SourceLocation; }
export interface LiveConfiguration { modules: LiveModuleDeclaration[]; resources: Record<string, string>; }
export interface BuildInput { pretransform: unknown; outputDirectory?: string; rootDirectory: string; buildOptions?: { clean: boolean; backup: boolean | string }; live?: LiveConfiguration; }
export interface SourceAdapterOptions {
  document?: string;
  mode?: "opt-in" | "primary";
  profile?: "fences" | "modern" | "litpro";
  adapter?: "markdown" | "markdown-litpro" | "myst" | "noweb" | "org";
  dialect?: "litpro-2017" | "pieceful-2020" | "litpro-plus" | "noweb" | "noweb-plus";
  references?: "noweb" | "org-noweb" | "underscore-quote" | "both";
  language?: string;
  nowebPipes?: boolean;
  executionOwner?: "org" | "myst" | "ravel";
  run?: boolean;
  provider?: string;
}
export class RavelInputError extends Error { diagnostics: Diagnostic[]; }
export function loadPretransformGraph(entryPath: string, options?: SourceAdapterOptions): Promise<unknown>;
export function loadTomlBuild(configPath: string): Promise<BuildInput>;
export function loadBuildInput(inputPath: string, options?: SourceAdapterOptions): Promise<BuildInput>;
export function planDeliverables(program: RavelProgram, outputDirectory: string): { version: 1; outputDirectory: string; manifest: string; deliverables: Array<Record<string, unknown>> };
export function planStaleDeliverables(program: RavelProgram, outputDirectory: string, options?: { rootDirectory?: string; staleSince?: string }): Promise<Array<Record<string, unknown>>>;
export function writeDeliverables(program: RavelProgram, outputDirectory: string, options?: { rootDirectory?: string }): Promise<string[]>;
export function createBuildManifest(program: RavelProgram, outputDirectory: string, options?: { stale?: unknown[]; builtAt?: string }): Record<string, unknown>;
export function writeBuildManifest(program: RavelProgram, outputDirectory: string, options?: { rootDirectory?: string; generatedAt?: string }): Promise<Record<string, unknown>>;
export function writeBuildArtifacts(program: RavelProgram, outputDirectory: string, options?: { rootDirectory?: string; stale?: unknown[]; generatedAt?: string }): Promise<Record<string, unknown>>;
export function cleanManagedArtifacts(outputDirectory: string, options?: { rootDirectory?: string; dryRun?: boolean }): Promise<Record<string, unknown>>;
export function refreshStaleArtifacts(outputDirectory: string, options?: { rootDirectory?: string; dryRun?: boolean; generatedAt?: string }): Promise<Record<string, unknown>>;
export function planOutputBackup(outputDirectory: string, options?: { outputRootDirectory?: string; backupRootDirectory?: string; backupPath?: string }): Promise<Record<string, unknown>>;
export function createOutputBackup(outputDirectory: string, options?: { outputRootDirectory?: string; backupRootDirectory?: string; backupPath?: string }): Promise<Record<string, unknown>>;
export function writeGraph(program: unknown, path: string, options?: { rootDirectory?: string }): Promise<void>;
