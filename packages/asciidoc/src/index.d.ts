export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceLocation {
  uri: string;
  range: { start: SourcePosition; end: SourcePosition };
}

export interface AsciiDocAdapterOptions {
  uri?: string;
  document?: string;
  run?: boolean | string[];
  provider?: string;
}

export interface AsciiDocAdapterResult {
  map: Record<string, unknown>;
  diagnostics: Array<{
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
    source: SourceLocation;
  }>;
  surface: {
    definitions: unknown[];
    references: unknown[];
    directives: unknown[];
    navigation: unknown[];
    includes: unknown[];
  };
}

export function asciidocToMap(
  text: string,
  options?: AsciiDocAdapterOptions
): AsciiDocAdapterResult;
