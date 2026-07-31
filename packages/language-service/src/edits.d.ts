export interface OffsetRange { start: number; end: number; }
export interface SourceTextEdit { range: OffsetRange; text: string; }
export interface SourceDocumentEdit {
  uri: string;
  version?: number;
  edits: SourceTextEdit[];
}
export type EditClassification = "automatic" | "preview" | "action" | "rejected";
export interface ClassifiedWorkspaceEdit {
  classification: EditClassification;
  applicable: boolean;
  entries: Array<Record<string, unknown>>;
  sourceEdit: { documents: SourceDocumentEdit[] };
}
export function classifyWorkspaceEdit(workspaceEdit: unknown, options: {
  projectionService: Record<string, unknown>;
  sourceVersions?: Map<string, number> | Record<string, number>;
  isWritableSource?: (uri: string) => boolean;
  importDestination?: unknown;
  limits?: {
    documents?: number;
    edits?: number;
    replacementTextCodeUnits?: number;
  };
}): ClassifiedWorkspaceEdit;
export function validateSourceEditVersions(
  sourceEdit: { documents?: SourceDocumentEdit[] },
  currentVersions: Map<string, number> | Record<string, number>
): { valid: boolean; stale: Array<{ uri: string; expected: number; actual?: number }> };
