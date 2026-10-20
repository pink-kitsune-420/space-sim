/** Host-only (`packages/game-runtime`): optional engine lifecycle diagnostics. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); modules log through `MODULE_LOGS`. */
import type {ModuleLogger,ModuleLogLevel,ModuleLogService,ModuleReference} from '../../game-api/src/index';
/** Host observation only; never a deterministic module dependency or a reason to fail a candidate. */
export function diagnosticLogger(logs:ModuleLogService|undefined,module:ModuleReference):ModuleLogger|undefined {
 try{return logs?.logger(module);}catch{return undefined;}
}
/** Writes one optional diagnostic; a failing logger is ignored. Host-only (`packages/game-runtime`). */
export function diagnostic(log:ModuleLogger|undefined,level:ModuleLogLevel,event:string,message:string):void {
 try{log?.write(level,event,message);}catch{/* Faulty optional diagnostics cannot alter activation/cleanup. */}
}
