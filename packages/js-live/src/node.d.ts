import type { Diagnostic, SourceLocation } from "@pieceful/ravel-core";

export interface JavaScriptModuleDeclaration {
  specifier: string;
  from: string;
  source?: SourceLocation;
}

export class JavaScriptModulePreparationError extends Error {
  diagnostics: Diagnostic[];
}

export function prepareJavaScriptModules(
  declarations: JavaScriptModuleDeclaration[],
  options: {
    rootDirectory: string;
    moduleEntries?: number;
    moduleBytes?: number;
  }
): Promise<Record<string, string>>;
