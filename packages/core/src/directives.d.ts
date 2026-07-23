import type { SourceLocation } from "./index.js";
export const directiveKinds: Set<string>;
export function compose(steps: unknown[], source: SourceLocation): unknown;
export function append(reference: string, source: SourceLocation): unknown;
export function newline(count: number, source: SourceLocation): unknown;
export function pipe(steps: unknown[], source: SourceLocation): unknown;
export function pass(steps: unknown[], source: SourceLocation): unknown;
export function createDirective(name: string, value: unknown, source: SourceLocation): unknown;
export function aliasDirective(name: string, reference: string, source: SourceLocation): unknown;
