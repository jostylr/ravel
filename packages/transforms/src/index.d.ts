export interface TransformContext {
  arguments?: unknown[];
  transform?: string;
}
export type RavelTransform = (value: string, context?: TransformContext) => string;

export const markdown: RavelTransform;
export const template: RavelTransform;
export const json: RavelTransform;
export function templateData(args: unknown[]): Record<string, unknown>;
export function escapeHtml(value: string): string;
export const builtinTransforms: Readonly<{ markdown: RavelTransform; template: RavelTransform; json: RavelTransform }>;
