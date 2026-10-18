import type {ModuleLogger,ModuleLogLevel,ModuleLogService,ModuleReference} from '../../game-api/src/index';
/** Host observation only; never a deterministic module dependency or a reason to fail a candidate. */
export function diagnosticLogger(logs:ModuleLogService|undefined,module:ModuleReference):ModuleLogger|undefined {
 try{return logs?.logger(module);}catch{return undefined;}
}
export function diagnostic(log:ModuleLogger|undefined,level:ModuleLogLevel,event:string,message:string):void {
 try{log?.write(level,event,message);}catch{/* Faulty optional diagnostics cannot alter activation/cleanup. */}
}
