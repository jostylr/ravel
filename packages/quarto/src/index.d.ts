export interface QuartoBridgeOptions {
  uri?: string;
  document?: string;
  headings?: unknown;
  includeIndex?: boolean;
}

export interface QuartoBridgeResult {
  source: string;
  map: Record<string, unknown>;
  program: Record<string, unknown>;
  diagnostics: Array<Record<string, unknown>>;
  sourceMap: Record<string, unknown>;
  cacheKeyMaterial: string;
}

export function decorateQuartoMarkdown(
  text: string,
  map: Record<string, unknown>,
  program: Record<string, unknown>,
  options?: {
    includeIndex?: boolean;
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
