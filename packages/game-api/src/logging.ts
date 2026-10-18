import type {Disposable,ModuleReference} from './modules';
import type {ServiceKey} from './modules-v2';

export type ModuleLogLevel='debug'|'info'|'warn'|'error';
/** Diagnostic metadata only; never retain worlds, commands, packets or live objects. */
export type ModuleLogFields=Readonly<Record<string,string|number|boolean|null>>;
export interface ModuleLogEntry {
 readonly sequence:number;
 /** Monotonic diagnostic wall milliseconds, unrelated to simulation time. */
 readonly timeMs:number;
 readonly module:ModuleReference;readonly level:ModuleLogLevel;readonly event:string;readonly message:string;
 readonly fields?:ModuleLogFields;
}
export interface ModuleLogger extends Disposable {
 enabled(level:ModuleLogLevel):boolean;
 /** A lazy message is evaluated only after severity and rate filtering. Invalid entries are dropped.
  * Diagnostic failures must never change gameplay or candidate publication. */
 write(level:ModuleLogLevel,event:string,message:string|(()=>string),fields?:ModuleLogFields):void;
}
export interface ModuleLogQuery {readonly moduleId?:string;readonly minimum?:ModuleLogLevel;readonly after?:number;readonly limit?:number}
export interface ModuleLogService extends Disposable {
 logger(module:ModuleReference):ModuleLogger;
 /** Oldest first; immutable bounded snapshots. No live subscription or frame-loop polling. */
 entries(query?:ModuleLogQuery):readonly ModuleLogEntry[];
 clear():void;
}
export interface ModuleLogOptions {
 readonly history?:number;readonly minimum?:ModuleLogLevel;readonly maxPerSecond?:number;readonly messageLength?:number;
 /** Host-owned diagnostic clock/sink. Both stay outside authoritative behavior. */
 readonly now?:()=>number;readonly sink?:(entry:ModuleLogEntry)=>void;
}
export const MODULE_LOGS:ServiceKey<ModuleLogService>=Object.freeze({slot:'diagnostics.logs',version:'1.0.0'});
