import type {Disposable,ModuleReference} from './modules';
import type {ServiceKey} from './modules-v2';

/** Severity, ordered from least to most severe: `debug`, `info`, `warn`, `error`. */
export type ModuleLogLevel='debug'|'info'|'warn'|'error';
/** Diagnostic metadata only; never retain worlds, commands, packets or live objects. */
export type ModuleLogFields=Readonly<Record<string,string|number|boolean|null>>;
/** One immutable log record. Entries are frozen snapshots; later changes to the source never alter them. */
export interface ModuleLogEntry {
 /** Provider-wide, strictly increasing from 1; survives `clear()`. Use it as the `after` cursor of a query. */
 readonly sequence:number;
 /** Monotonic diagnostic wall milliseconds, unrelated to simulation time. */
 readonly timeMs:number;
 /** Exact module ID and version that wrote the entry. */
 readonly module:ModuleReference;
 /** Severity the writer chose. */
 readonly level:ModuleLogLevel;
 /** Short non-empty machine-readable event name, at most 96 characters. */
 readonly event:string;
 /** Human-readable text, truncated to the provider's message-length limit. */
 readonly message:string;
 /** Optional scalar metadata: at most 32 fields, keys up to 64 characters, strings clipped to 1024. */
 readonly fields?:ModuleLogFields;
}
/** A logger scoped to one module identity. The consumer owns it and disposes it when it is removed. */
export interface ModuleLogger extends Disposable {
 /** True when an entry of this severity would currently be considered; false after disposal. Use it to skip expensive preparation. */
 enabled(level:ModuleLogLevel):boolean;
 /** A lazy message is evaluated only after severity and rate filtering. Invalid entries are dropped.
  * Diagnostic failures must never change gameplay or candidate publication. */
 write(level:ModuleLogLevel,event:string,message:string|(()=>string),fields?:ModuleLogFields):void;
}
/** Filter for {@link ModuleLogService.entries}. Every field is optional and they combine with AND. */
export interface ModuleLogQuery {
 /** Only entries written by this module ID. */
 readonly moduleId?:string;
 /** Lowest severity to include. Default `debug`. */
 readonly minimum?:ModuleLogLevel;
 /** Only entries with a `sequence` greater than this. Default 0. */
 readonly after?:number;
 /** Keep at most this many of the newest matches, a non-negative integer. Default and maximum: the retained history size. */
 readonly limit?:number;
}
/** Bounded in-memory diagnostics store. The provider owns the history; consumers own their loggers. */
export interface ModuleLogService extends Disposable {
 /** Creates a logger for an exact module ID and version. Throws for a malformed identity or after the provider is disposed. */
 logger(module:ModuleReference):ModuleLogger;
 /** Oldest first; immutable bounded snapshots. No live subscription or frame-loop polling.
  * Throws for an invalid query; returns an empty list after disposal. */
 entries(query?:ModuleLogQuery):readonly ModuleLogEntry[];
 /** Drops all retained entries. Sequence numbering continues. */
 clear():void;
}
/** Provider limits and host-owned ports. Invalid values make creation throw. */
export interface ModuleLogOptions {
 /** Ring size in entries, integer 1 to 10000. Default 512. Older entries are overwritten. */
 readonly history?:number;
 /** Lowest severity accepted. Default `info`. */
 readonly minimum?:ModuleLogLevel;
 /** Accepted entries per logger per wall-clock second, integer 1 to 10000. Default 100. Excess entries are dropped. */
 readonly maxPerSecond?:number;
 /** Message length in characters, integer 64 to 8192. Default 2048. Longer text is truncated. */
 readonly messageLength?:number;
 /** Host-owned diagnostic clock/sink. Both stay outside authoritative behavior. */
 readonly now?:()=>number;
 /** Called synchronously with every stored entry; exceptions are swallowed. */
 readonly sink?:(entry:ModuleLogEntry)=>void;
}
/** Service key for the module-logging provider (`diagnostics.logs@1.0.0`). */
export const MODULE_LOGS:ServiceKey<ModuleLogService>=Object.freeze({slot:'diagnostics.logs',version:'1.0.0'});
