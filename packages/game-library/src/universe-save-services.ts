import {CORE_UNIVERSE_FORMAT,type HostServiceAccess,type UniverseSaveFormat} from '../../game-api/src/index';
import {encodeUniverseSave,decodeUniverseSave} from './save-package';
export const universeSaveFormat:UniverseSaveFormat=Object.freeze<UniverseSaveFormat>({
  encode:(save,signal)=>encodeUniverseSave(save,{signal}),decode:(bytes,signal)=>decodeUniverseSave(bytes,{signal}),
});
export const universeSaveFormatService:HostServiceAccess=Object.freeze({key:CORE_UNIVERSE_FORMAT,service:universeSaveFormat,tiers:['platform'] as const,environments:['browser','offline','node'] as const});
