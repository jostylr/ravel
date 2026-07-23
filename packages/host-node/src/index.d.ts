export interface SourcePosition { line: number; column: number; offset: number; }
export interface SourceRange { start: SourcePosition; end: SourcePosition; }
export interface SourceLocation { uri: string; range: SourceRange; }
export interface Diagnostic { code: string; severity: "error" | "warning" | "info"; message: string; source: SourceLocation; }
export interface RavelProgram { version?: number; deliverables: Record<string, { name: string; from: string; value: string }>; }
export interface BuildInput { pretransform: unknown; outputDirectory?: string; rootDirectory: string; buildOptions?: { clean: boolean; backup: boolean | string }; }
export class RavelInputError extends Error { diagnostics: Diagnostic[]; }
export function loadPretransformGraph(entryPath: string, options?: { document?: string; mode?: "opt-in" | "primary" }): Promise<unknown>;
export function loadTomlBuild(configPath: string): Promise<BuildInput>;
export function loadBuildInput(inputPath: string, options?: { document?: string; mode?: "opt-in" | "primary" }): Promise<BuildInput>;
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
