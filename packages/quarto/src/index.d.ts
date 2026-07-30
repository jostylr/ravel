export interface QuartoBridgeOptions {
  uri?: string;
  document?: string;
  headings?: unknown;
  includeIndex?: boolean;
  providerVersions?: Record<string, string>;
  transformVersions?: Record<string, string>;
  dependencies?: Array<Record<string, unknown>>;
}

export interface QuartoDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source?: Record<string, unknown>;
  related?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuartoBridgeResult {
  source: string;
  map: Record<string, unknown>;
  program: Record<string, unknown>;
  diagnostics: QuartoDiagnostic[];
  sourceMap: Record<string, unknown>;
  cacheKeyMaterial: string;
}

export interface QuartoProjectDocument {
  uri: string;
  source: string;
  document?: string;
  headings?: unknown;
}

export interface PreparedQuartoDocument {
  uri: string;
  temporaryUri?: string;
  source: string;
  preparedSource: string;
  map: Record<string, unknown>;
  sourceMap: Record<string, unknown>;
  diagnostics: QuartoDiagnostic[];
}

export interface QuartoProjectOptions {
  includeIndex?: boolean;
  indexScope?: "document" | "project";
  outputExtension?: string;
  transforms?: Record<string, unknown> | Map<string, unknown>;
  providerVersions?: Record<string, string>;
  transformVersions?: Record<string, string>;
  dependencies?: Array<Record<string, unknown>>;
}

export interface QuartoProjectResult {
  documents: PreparedQuartoDocument[];
  graph: Record<string, unknown>;
  program: Record<string, unknown>;
  diagnostics: QuartoDiagnostic[];
  cacheKeyMaterial: string;
  cacheStamp?: string;
}

export function decorateQuartoMarkdown(
  text: string,
  map: Record<string, unknown>,
  program: Record<string, unknown>,
  options?: {
    includeIndex?: boolean;
    indexScope?: "document" | "project";
    graphMap?: Record<string, unknown>;
    linkTarget?: (chunk: Record<string, unknown>) => string | null;
    baseSourceMap?: Record<string, unknown>;
    authoredText?: string;
  }
): {
  source: string;
  sourceMap: Record<string, unknown>;
};

export function weaveQuartoExecutions(
  text: string,
  map: Record<string, unknown>,
  program: Record<string, unknown>
): {
  source: string;
  sourceMap: Record<string, unknown>;
  diagnostics: Array<Record<string, unknown>>;
};

export function prepareQuartoRender(
  text: string,
  options?: QuartoBridgeOptions
): QuartoBridgeResult;

export function prepareQuartoProject(
  documents: QuartoProjectDocument[],
  options?: QuartoProjectOptions
): QuartoProjectResult;

export function stampQuartoProjectCache(
  project: QuartoProjectResult,
  stamp: string
): QuartoProjectResult;

export function remapQuartoDiagnostic(
  diagnostic: Record<string, unknown>,
  project: QuartoProjectResult,
  options?: { lineBase?: number; columnBase?: number }
): QuartoDiagnostic;
