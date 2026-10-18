/** Bundlers replace this literal for distributions that prohibit downloaded code.
 * Unbundled development tools default to the trusted-code workflow. */
declare const __SPACE_SIM_ALLOW_RUNTIME_CODE__: boolean;
export const ALLOW_RUNTIME_CODE = typeof __SPACE_SIM_ALLOW_RUNTIME_CODE__ === 'undefined' || __SPACE_SIM_ALLOW_RUNTIME_CODE__;
