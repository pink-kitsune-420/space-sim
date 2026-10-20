// Host-side authoring tooling (Node only). Modules cannot import packages/module-tools;
// they import only `@space-sim/game-api` and their own relative files.
import type { CodeArtifact } from '../game-runtime/src/artifact';
/**
 * Loads the runtime artifact contracts (manifest validation, artifact digests, portable paths)
 * by bundling `packages/game-runtime/src/loader.ts` in memory once per process.
 * The result is cached; no files are written and no module code is evaluated.
 */
export function authorContracts(): Promise<typeof import('../game-runtime/src/artifact')>;
/**
 * Parses one TypeScript or JavaScript source and returns its static import and re-export
 * specifiers in source order, including type-only imports. Source is parsed, never executed.
 * @param source File text.
 * @param path Path used to pick the parser dialect and in error messages.
 * @throws Error on a parse error, a computed specifier, `require`, an import assignment or a
 *   dynamic import ("dynamic imports and require are unsupported; bundle static local inputs").
 */
export function inspectAuthorSource(source: string, path: string): string[];
/**
 * Type-checks and bundles a module folder into one self-contained IIFE script, used by
 * `npm run module:build`. Accepts a legacy source descriptor (`{ manifest, entry, assets?,
 * compatibility, attribution, inputs? }`) or a `spacelab-module-package/1` descriptor.
 * Follows static imports from `entry`; only `@space-sim/game-api` (its public entry point) and
 * relative files inside the folder are allowed. The type check runs `tsc` in a temporary folder
 * that is removed afterwards. Module code is bundled, never executed.
 * @param configPath Descriptor path; its folder is the module root.
 * @param outputPath When set, writes the v1 `space-sim-code-module/1` artifact JSON there
 *   (creating parent folders). Not allowed for `space-sim-module/2` manifests.
 * @param options `typecheck` (default true) runs the strict type check.
 * @returns The validated v1 artifact, or a `space-sim-build/2` body for v2 manifests.
 * @throws Error for an invalid manifest or descriptor field, a missing input, a bare package
 *   import ("Unsupported import …"), a private import outside the folder, a type error
 *   ("Module type check failed: …"), a missing default export, an asset outside the folder, or
 *   "V2 modules must be exported as .spacemod packages" when `outputPath` is set for v2.
 */
export function buildModule(configPath: string, outputPath?: string, options?: { typecheck?: boolean }): Promise<CodeArtifact>;
