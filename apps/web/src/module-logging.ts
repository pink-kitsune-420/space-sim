import type {Disposable,ModuleLogService} from '../../../packages/game-api/src/index';
import {createModuleLogs} from '../../../modules/logging/src/index';
/** Compatibility host diagnostics until Phase 4 selects presentation services by manifest. */
export const moduleLogs=createModuleLogs();
const active=new Map<symbol,ModuleLogService>();
export function observeModuleLogs(logs:ModuleLogService):Disposable {
 const token=Symbol();active.set(token,logs);return {dispose(){active.delete(token);}};
}
export function moduleLogReport(){
 const modules=[...new Set(active.values())].filter(logs=>logs!==moduleLogs).map(logs=>{
  try{return logs.entries();}catch{return [];}
 });
 return {format:'space-sim-module-logs/1',host:moduleLogs.entries(),modules};
}
