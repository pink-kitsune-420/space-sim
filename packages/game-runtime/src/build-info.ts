export interface BuildInfo {
  readonly version: string;
  readonly revision: string;
  readonly development: boolean;
}
declare const __SPACELAB_BUILD_INFO__: BuildInfo;
/** One immutable application identity on browser, offline, server and desktop targets.
 * Unbundled source is a development build. This is separate from module API compatibility. */
export const BUILD_INFO: BuildInfo = Object.freeze(typeof __SPACELAB_BUILD_INFO__ === 'undefined'
  ? { version: 'development', revision: '', development: true } : __SPACELAB_BUILD_INFO__);
export const VERSION = BUILD_INFO.version;
