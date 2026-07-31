import type {
  Diagnostic,
  PretransformGraph,
  RavelProgram,
  SourceLocation,
  SourcePosition
} from "@pieceful/ravel-core";

export interface RavelSemanticIndex {
  readonly revision?: string;
  readonly chunks: readonly RavelProgram["chunks"][string][];
  readonly references: readonly Record<string, unknown>[];
  readonly directives: readonly Record<string, unknown>[];
  readonly diagnostics: readonly Diagnostic[];
  readonly symbols: readonly Record<string, unknown>[];
  entityAt(uri: string, position: SourcePosition): Record<string, unknown> | null;
  definitionAt(uri: string, position: SourcePosition): (SourceLocation & Record<string, unknown>) | null;
  referencesFor(id: string, options?: { includeDeclaration?: boolean }): Array<SourceLocation & Record<string, unknown>>;
  hoverAt(uri: string, position: SourcePosition): Record<string, unknown> | null;
  completeReferences(query?: string, options?: { documentId?: string }): Array<Record<string, unknown>>;
  documentSymbols(uri: string): Array<Record<string, unknown>>;
  workspaceSymbols(query?: string): Array<Record<string, unknown>>;
  diagnosticsFor(uri: string): Diagnostic[];
}

export function createRavelSemanticIndex(context: {
  program: RavelProgram;
  pretransform?: PretransformGraph;
  revision?: string;
} | RavelProgram): RavelSemanticIndex;
