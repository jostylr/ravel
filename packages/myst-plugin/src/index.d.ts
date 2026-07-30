export interface MystAstNode {
  type: string;
  [key: string]: unknown;
}

export interface PieceDirectiveData {
  arg?: string;
  body?: string;
  options?: Record<string, unknown>;
  node?: MystAstNode;
}

export interface PieceDirective {
  name: "ravel:piece";
  alias: ["piece"];
  doc: string;
  arg: Record<string, unknown>;
  options: Record<string, unknown>;
  body: Record<string, unknown>;
  run(data: PieceDirectiveData, vfile?: { message(...args: unknown[]): unknown }): MystAstNode[];
}

export const pieceDirective: PieceDirective;
export interface RavelDirective {
  name: "ravel";
  doc: string;
  options: Record<string, unknown>;
  body: Record<string, unknown>;
  run(data: PieceDirectiveData): MystAstNode[];
}

export const ravelDirective: RavelDirective;

declare const plugin: {
  name: string;
  author: string;
  license: string;
  directives: Array<PieceDirective | RavelDirective>;
};

export default plugin;
