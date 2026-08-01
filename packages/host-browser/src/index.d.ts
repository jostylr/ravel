import type {
  Deliverable,
  DeliverableProvenanceMap,
  Diagnostic,
  RavelProgram,
  RavelMap
} from "@pieceful/ravel-core";

export interface BrowserDeliverable extends Deliverable {
  provenanceMap: DeliverableProvenanceMap;
}

export type BrowserTransform = (value: string, context: unknown) => string;

export interface BrowserRenderOptions {
  /** Source URI used in diagnostics and provenance. Defaults to `playground.md`. */
  uri?: string;
  /** Optional stable document identity. */
  document?: string;
  /** Markdown profile. Defaults to the explicit opt-in Ravel profile. */
  mode?: "opt-in" | "primary";
  /**
   * Trusted application-supplied synchronous transforms. Document source cannot
   * register transforms, and this host never provides filesystem or network access.
   */
  transforms?: Record<string, BrowserTransform> | Map<string, BrowserTransform>;
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
  options?: BrowserRenderOptions
): BrowserRenderResult;
