import { ALARM_CATALOGUE, ORBITAL_ALARMS, type ModuleInitializationV2, type OrbitalAlarmClock,
 type Disposable, type OrbitalAlarmCatalogue, type OrbitalAlarmStatus, type OrbitalAlarmFactory, type OrbitalAlarmNotice } from '@space-sim/game-api';
interface Entry { deadline:number; time:number; kind:string; label:string; pause:boolean; handled:boolean; generation:number }
interface InspectableClock extends OrbitalAlarmClock { append(session:object, prefix:string, into:OrbitalAlarmStatus[]):void }
const validText=(value:string,max:number)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\p{Cc}\p{Cf}]/u.test(value);
/** Simulation-time event delivery only. Host policy owns warp, pause and presentation. */
function createClock(onDispose:()=>void):InspectableClock {
 const records=new Map<string,Entry>(),ids=new Set<string>(),notices:OrbitalAlarmNotice[]=[];
 let session:object|undefined,last=-Infinity,next=Infinity,generation=0,disposed=false;
 const clear=()=>{records.clear();ids.clear();notices.length=0;session=undefined;last=-Infinity;next=Infinity;generation=0;};
 return Object.freeze<InspectableClock>({
  get secondsUntilNext(){return next;},clear,
  sync(identity,now,events){
   if(disposed)throw Error('Orbital alarm clock disposed');
   if(!identity||typeof identity!=='object'||!Number.isFinite(now)||Math.abs(now)>1e12||events.length>1024)throw Error('Invalid orbital alarm clock input (max 1024 events).');
   ids.clear();
   // Validate atomically before changing delivery state.
   for(const e of events){
    if(!validText(e.id,256)||!validText(e.kind,64)||!validText(e.label,160)||ids.has(e.id)||!Number.isFinite(e.deadline)||!Number.isFinite(e.time)
     ||Math.abs(e.time)>1e12||Math.abs(e.deadline)>1e12||e.deadline>e.time||typeof e.pause!=='boolean'||(e.handled!==undefined&&typeof e.handled!=='boolean'))throw Error('Invalid or duplicate orbital alarm event.');
    ids.add(e.id);
   }
   if(session!==identity||now<last-1e-7)clear();
   session=identity;last=now;next=Infinity;notices.length=0;generation++;
   for(const event of events){
    let record=records.get(event.id);
    if(!record||record.deadline!==event.deadline||record.time!==event.time||record.kind!==event.kind){
     record={deadline:event.deadline,time:event.time,kind:event.kind,label:event.label,pause:event.pause,handled:event.handled===true,generation};records.set(event.id,record);
    }
    record.generation=generation;record.label=event.label;record.pause=event.pause;
    if(event.handled)record.handled=true;
    if(record.handled)continue;
    if(now>=event.deadline){record.handled=true;notices.push({...event,missed:now>event.time});}
    else next=Math.min(next,event.deadline-now);
   }
   for(const [id,record] of records)if(record.generation!==generation)records.delete(id);
   return notices;
  },
  append(identity,prefix,into){
   if(identity!==session||disposed)return;
   for(const [id,e] of records){
    if(into.length>=1024)break;
    into.push({id:`${prefix}/${id}`,kind:e.kind,label:e.label,deadline:e.deadline,time:e.time,pause:e.pause,handled:e.handled,now:last});
   }
  },
  dispose(){if(disposed)return;disposed=true;clear();onDispose();},
 });
}
export function createOrbitalAlarmClock():OrbitalAlarmClock {return createClock(()=>{});}
export function createOrbitalAlarms():OrbitalAlarmFactory & OrbitalAlarmCatalogue & Disposable {
 const clocks=new Map<InspectableClock,string>();let next=1,disposed=false;
 return Object.freeze({
  create(){
   if(disposed)throw Error('Orbital alarm provider disposed');
   if(clocks.size>=64)throw Error('Orbital alarms support at most64 independent clocks.');
   const clock=createClock(()=>clocks.delete(clock));clocks.set(clock,String(next++));return clock;
  },
  read(session:object){const out:OrbitalAlarmStatus[]=[];for(const [clock,id] of clocks)clock.append(session,id,out);return out;},
  dispose(){if(disposed)return;disposed=true;for(const clock of clocks.keys())clock.dispose();clocks.clear();},
 });
}
export default function initialize(context:ModuleInitializationV2):void {
 const alarms=context.own(createOrbitalAlarms());
 context.provide(ORBITAL_ALARMS,alarms);context.provide(ALARM_CATALOGUE,alarms);
 context.contributeGuide({id:'usage',audience:'creators',title:'Simulation-time orbital alarms',summary:'Bounded isolated clocks with no engine or host commands.',asset:'docs/creators/usage.json'});
 context.contributeGuide({id:'burns',audience:'players',title:'Burn reminders',summary:'Manual burn alarms, preparation lead and optional pause.',asset:'docs/players/burns.json'});
}
