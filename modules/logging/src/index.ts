import {MODULE_LOGS,type ModuleInitializationV2,type ModuleLogEntry,type ModuleLogFields,type ModuleLogger,type ModuleLogLevel,type ModuleLogOptions,type ModuleLogService} from '@space-sim/game-api';
const LEVELS:readonly ModuleLogLevel[]=['debug','info','warn','error'];
/** Bounded viewer/host diagnostics. Initialization and writes never inspect a world. */
export function createModuleLogs(options:ModuleLogOptions={}):ModuleLogService {
 const history=options.history??512,minimum=options.minimum??'info',maxPerSecond=options.maxPerSecond??100,messageLength=options.messageLength??2048;
 if(!Number.isInteger(history)||history<1||history>10000||!LEVELS.includes(minimum)||!Number.isInteger(maxPerSecond)||maxPerSecond<1||maxPerSecond>10000||!Number.isInteger(messageLength)||messageLength<64||messageLength>8192)throw new Error('Invalid module logging options');
 const now=options.now??(()=>performance.now()),threshold=LEVELS.indexOf(minimum),ring:(ModuleLogEntry|undefined)[]=new Array(history);
 let disposed=false,cursor=0,count=0,sequence=0;
 const enabled=(level:ModuleLogLevel):boolean=>!disposed&&LEVELS.indexOf(level)>=threshold;
 return Object.freeze<ModuleLogService>({
  logger(source){
   if(disposed)throw new Error('Module logging provider disposed');
   if(typeof source.id!=='string'||!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(source.id)||source.id.length>256||typeof source.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(source.version)||source.version.length>256)throw new Error('Logging requires a module ID and exact version');
   const module=Object.freeze({id:source.id,version:source.version});let closed=false,windowStart=-Infinity,writes=0;
   return Object.freeze<ModuleLogger>({enabled:level=>!closed&&enabled(level),
    write(level,event,message,fields){
     if(closed||!enabled(level))return;
     // Neither a faulty sink, lazy formatter nor host clock may affect the caller.
     try{
      if(typeof event!=='string'||!event.trim()||event.length>96)return;
      const timeMs=now();if(!Number.isFinite(timeMs))return;
      if(timeMs<windowStart||timeMs-windowStart>=1000){windowStart=timeMs;writes=0;}
      if(writes>=maxPerSecond)return;
      const text=typeof message==='function'?message():message;if(typeof text!=='string')return;
      let captured:ModuleLogFields|undefined;
      if(fields!==undefined){
       if(!fields||typeof fields!=='object'||Array.isArray(fields))return;
       const entries=Object.entries(fields);if(entries.length>32)return;
       const copy:Record<string,string|number|boolean|null>=Object.create(null);
       for(const [key,value] of entries){if(!key||key.length>64||!(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value)))return;copy[key]=typeof value==='string'?value.slice(0,1024):value;}
       captured=Object.freeze(copy);
      }
      const entry=Object.freeze<ModuleLogEntry>({sequence:++sequence,timeMs,module,level,event,message:text.slice(0,messageLength),...(captured?{fields:captured}:{})});
      writes++;ring[cursor]=entry;cursor=(cursor+1)%history;count=Math.min(count+1,history);
      try{options.sink?.(entry);}catch{/* Diagnostics cannot fail the operation being observed. */}
     }catch{/* Invalid diagnostic inputs are ignored. */}
    },dispose(){closed=true;}});
  },
  entries(query={}){
   if(disposed)return Object.freeze([]);
   const threshold=LEVELS.indexOf(query.minimum??'debug');
   if(threshold<0||query.after!==undefined&&!Number.isFinite(query.after)||query.limit!==undefined&&(!Number.isInteger(query.limit)||query.limit<0))throw new Error('Invalid log query');
   const result:ModuleLogEntry[]=[];
   for(let i=0;i<count;i++){const entry=ring[(cursor-count+i+history)%history]!;if((!query.moduleId||entry.module.id===query.moduleId)&&LEVELS.indexOf(entry.level)>=threshold&&entry.sequence>(query.after??0))result.push(entry);}
   const limit=Math.min(query.limit??history,history);
   return Object.freeze(limit===0?[]:result.slice(-limit));
  },
  clear(){ring.fill(undefined);cursor=0;count=0;},
  dispose(){if(disposed)return;disposed=true;ring.fill(undefined);count=0;}
 });
}
/**
 * Contributes bounded module-scoped diagnostics.
 * Provides diagnostics.logs@1.0.0 in slot diagnostics.logs.
 * Requires nothing.
 * Settings minimumLevel, historyEntries, maxPerSecond, messageLength and consoleOutput configure severity, retention, rate, message size and console mirroring.
 */
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Module logging',summary:'Bounded module-scoped diagnostics with severity filtering and no simulation state.',asset:'docs/creators/usage.json'});
 const level=LEVELS[context.settings.minimumLevel??1]??'info';
 const sink=context.settings.consoleOutput===1?(entry:ModuleLogEntry)=>console[entry.level](`[${entry.module.id}@${entry.module.version}] ${entry.event}: ${entry.message}`,entry.fields??''):undefined;
 const logs=context.own(createModuleLogs({history:context.settings.historyEntries,minimum:level,maxPerSecond:context.settings.maxPerSecond,messageLength:context.settings.messageLength,sink}));
 context.provide(MODULE_LOGS,logs);
 if(context.module)context.own(logs.logger(context.module)).write('info','logging.ready','Module diagnostics ready');
}
