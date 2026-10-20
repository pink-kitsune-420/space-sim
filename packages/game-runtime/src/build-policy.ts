/** Host-only (`packages/game-runtime`): build-time policy for imported code. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`). */
/** Bundlers replace this literal for distributions that prohibit downloaded code.
 * Unbundled development tools default to the trusted-code workflow. */
declare const __SPACE_SIM_ALLOW_RUNTIME_CODE__: boolean;
/** Whether this build may evaluate imported module code; when `false`, code packages fail with `This build does not allow imported code`. Host-only (`packages/game-runtime`). */
export const ALLOW_RUNTIME_CODE = typeof __SPACE_SIM_ALLOW_RUNTIME_CODE__ === 'undefined' || __SPACE_SIM_ALLOW_RUNTIME_CODE__;
