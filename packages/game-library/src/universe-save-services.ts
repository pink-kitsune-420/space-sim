/** Host-only registration of the universe save codec (`packages/game-library`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); platform modules request `CORE_UNIVERSE_FORMAT`. */
import {CORE_UNIVERSE_FORMAT,type HostServiceAccess,type UniverseSaveFormat} from '../../game-api/src/index';
import {encodeUniverseSave,decodeUniverseSave} from './save-package';
/** `UniverseSaveFormat` backed by `encodeUniverseSave` and `decodeUniverseSave`, cancellable with an abort signal. Host-only (`packages/game-library`). */
export const universeSaveFormat:UniverseSaveFormat=Object.freeze<UniverseSaveFormat>({
  encode:(save,signal)=>encodeUniverseSave(save,{signal}),decode:(bytes,signal)=>decodeUniverseSave(bytes,{signal}),
});
/** Host service exposing `universeSaveFormat` to platform modules as `CORE_UNIVERSE_FORMAT` (`core.universe-save-format@1.0.0`) in every environment. Host-only (`packages/game-library`). */
export const universeSaveFormatService:HostServiceAccess=Object.freeze({key:CORE_UNIVERSE_FORMAT,service:universeSaveFormat,tiers:['platform'] as const,environments:['browser','offline','node'] as const});
