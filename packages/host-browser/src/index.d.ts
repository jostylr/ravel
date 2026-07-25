import type {
  DeliverableProvenanceMap,
  Diagnostic,
  RavelProgram,
  RavelMap
} from "@pieceful/ravel-core";

export interface BrowserDeliverable {
  name: string;
  from: string;
  value: string;
  segments: unknown[];
  dependencies: string[];
  provenance: unknown[];
  source: unknown;
  provenanceMap: DeliverableProvenanceMap;
}

export interface BrowserRenderResult {
  version: 1;
  source: { uri: string; document: string | null };
  map: RavelMap | null;
  program: RavelProgram | null;
  deliverables: BrowserDeliverable[];
  diagnostics: Diagnostic[];
  ok: boolean;
}

export function renderMarkdownDocument(
  source: string,
  options?: {
    uri?: string;
    document?: string;
    mode?: "opt-in" | "primary";
    transforms?: Record<string, (value: string, context: unknown) => string> | Map<string, (value: string, context: unknown) => string>;
  }
): BrowserRenderResult;
