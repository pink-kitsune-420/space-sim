import type { CodeArtifact } from '../game-runtime/src/artifact';
export function authorContracts(): Promise<typeof import('../game-runtime/src/artifact')>;
export function inspectAuthorSource(source: string, path: string): string[];
export function buildModule(configPath: string, outputPath?: string, options?: { typecheck?: boolean }): Promise<CodeArtifact>;
