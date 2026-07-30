import type { ExplorerEdge, ExplorerNode, ExplorerSnapshot } from "./index.js";

export interface ExplorerBrowserOptions {
  headless?: boolean;
  layout?: false | Record<string, unknown>;
  style?: unknown[];
  onSelect?: (entity: ExplorerNode | ExplorerEdge, event: unknown) => void;
}

export interface ExplorerView {
  readonly cy: unknown;
  readonly snapshot: ExplorerSnapshot;
  readonly ready: Promise<void>;
  update(snapshot: ExplorerSnapshot, options?: { layout?: false | Record<string, unknown> }): Promise<ExplorerView>;
  fit(padding?: number): void;
  select(id: string): ExplorerNode | ExplorerEdge | null;
  destroy(): void;
}

export const explorerStyles: readonly unknown[];
export const explorerLayoutOptions: Readonly<Record<string, unknown>>;
export function createExplorerElements(snapshot: ExplorerSnapshot): unknown[];
export function createExplorerView(
  container: HTMLElement | null,
  snapshot: ExplorerSnapshot,
  options?: ExplorerBrowserOptions
): ExplorerView;
