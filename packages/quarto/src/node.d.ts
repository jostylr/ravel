import type {
  QuartoDiagnostic,
  QuartoProjectResult
} from "./index.js";

export interface PrepareQuartoDirectoryOptions {
  temporaryRoot?: string;
  ignoredDirectories?: string[];
  includeIndex?: boolean;
  indexScope?: "document" | "project";
  outputExtension?: string;
  to?: string;
  transforms?: Record<string, unknown> | Map<string, unknown>;
  transformVersions?: Record<string, string>;
  providerVersions?: Record<string, string>;
  quartoVersion?: string;
}

export interface PreparedQuartoDirectory extends QuartoProjectResult {
  projectDirectory: string;
  temporaryDirectory: string;
  files: Array<{ path: string; sha256: string }>;
  projectScripts: Array<{ kind: string; value: unknown }>;
  cacheKey: string;
  cleanup(): Promise<void>;
}

export interface RenderQuartoOptions extends PrepareQuartoDirectoryOptions {
  command?: string;
  commandArguments?: string[];
  input?: string;
  args?: string[];
  environment?: Record<string, string>;
  maxBuffer?: number;
  allowProjectScripts?: boolean;
  previousCacheKey?: string;
}

export interface QuartoRenderResult {
  ok: boolean;
  diagnostics: QuartoDiagnostic[];
  stdout?: string;
  stderr?: string;
  outputDirectory?: string;
  logPath?: string;
  quartoVersion?: string;
  prepared: PreparedQuartoDirectory;
}

export class QuartoHostError extends Error {
  diagnostics: QuartoDiagnostic[];
}

export function prepareQuartoProjectDirectory(
  projectDirectory: string,
  options?: PrepareQuartoDirectoryOptions
): Promise<PreparedQuartoDirectory>;

export function renderPreparedQuartoProject(
  prepared: PreparedQuartoDirectory,
  options?: RenderQuartoOptions
): Promise<QuartoRenderResult>;

export function renderQuartoProject(
  projectDirectory: string,
  options?: RenderQuartoOptions
): Promise<QuartoRenderResult>;
