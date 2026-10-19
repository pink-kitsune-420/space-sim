import type { ManeuverPlannerOptions, NodeAlarmSettings, OrbitalAlarmClock, OrbitalAlarmEvent, OrbitalAlarmFactory } from '@space-sim/game-api';
export interface AlarmTarget {
 readonly shipId:string; readonly id:string; readonly label:string; readonly time:number; readonly completed?:boolean;
 alarm?:NodeAlarmSettings;
}
export interface AlarmCandidate { readonly node:AlarmTarget; readonly deadline:number }
export const DEFAULT_NODE_ALARM:NodeAlarmSettings=Object.freeze({enabled:true,leadSeconds:10,pause:false});
/** UI/host policy around a reusable command-free clock. No ignition or arming port. */
export class NodeAlarms {
 private readonly clock:OrbitalAlarmClock;
 private readonly events:OrbitalAlarmEvent[]=[];
 private readonly refs=new Map<string,AlarmTarget>();
 private readonly pool=new WeakMap<AlarmTarget,{id:string;kind:string;label:string;name:string;nodeLabel:string;time:number;deadline:number;pause:boolean;handled:boolean}>();
 private readonly enabled:HTMLInputElement;
 private readonly lead:HTMLInputElement;
 private readonly pause:HTMLInputElement;
 private readonly status:HTMLOutputElement;
 private readonly suspended=new WeakSet<AlarmTarget>();
 private selected?:AlarmTarget;
 private disposed=false;
 constructor(root:HTMLElement,factory:OrbitalAlarmFactory,private readonly options:ManeuverPlannerOptions,
  private readonly deadline:(node:AlarmTarget)=>number,private readonly candidates:()=>readonly AlarmCandidate[],
  private readonly warpChanged:()=>void,private readonly stopWarp:()=>void,signal:AbortSignal){
  this.clock=factory.create();
  root.innerHTML='<summary>Burn alarm</summary><label><input type="checkbox" data-alarm="enabled"> Remind me before this burn</label><label>Preparation lead (s)<input type="number" min="0" max="86400" step="any" data-alarm="lead" aria-label="Alarm lead seconds"></label><label data-alarm="pause-label"><input type="checkbox" data-alarm="pause"> Pause at reminder</label><output data-alarm="status"></output><p class="maneuver-help">Notifies before the burn. Manual reminders exit warp; a non-pausing reminder leaves an armed automatic approach in control. Includes half the full-throttle burn and alignment preparation. Later nodes need review after each burn. Reminders never arm or ignite engines.</p>';
  this.enabled=root.querySelector('[data-alarm="enabled"]')!;this.lead=root.querySelector('[data-alarm="lead"]')!;this.pause=root.querySelector('[data-alarm="pause"]')!;this.status=root.querySelector('[data-alarm="status"]')!;
  (root.querySelector('[data-alarm="pause-label"]') as HTMLElement).hidden=!options.setPaused;
  const edit=()=>{
   const node=this.selected,value=this.lead.valueAsNumber;if(!node||node.completed||!Number.isFinite(value)||value<0||value>86400)return;
   node.alarm={...node.alarm,enabled:this.enabled.checked,leadSeconds:value,pause:this.pause.checked};this.touch(node);this.updateUi(node,false);
  };
  for(const input of [this.enabled,this.lead,this.pause])input.addEventListener('change',edit,{signal});
 }
 suspend(node:AlarmTarget):void {this.suspended.add(node);}
 touch(node:AlarmTarget):void {
  this.suspended.delete(node);
  const prefs=node.alarm??DEFAULT_NODE_ALARM;
  node.alarm={...prefs,...(this.deadline(node)>this.options.flight().world.time+.001?{notified:false}:{})};
 }
 updateUi(node:AlarmTarget|undefined,executing:boolean):void {
  this.selected=node;const prefs=node?.alarm??DEFAULT_NODE_ALARM;
  this.enabled.checked=prefs.enabled;this.pause.checked=prefs.pause;
  if(this.lead.ownerDocument.activeElement!==this.lead)this.lead.value=String(prefs.leadSeconds);
  for(const input of [this.enabled,this.lead,this.pause])input.disabled=!node||!!node.completed||executing;
  this.status.textContent=!node?'Choose a node.':this.suspended.has(node)?'Reminder suspended by manual warp. Review or edit to re-enable.':!prefs.enabled?'Alarm off.':prefs.notified?'Reminder delivered.':`Reminder includes ${prefs.leadSeconds.toFixed(1)} s preparation, or longer if alignment needs it.`;
 }
 beforeAdvance(automatic?:AlarmTarget|((node:AlarmTarget)=>boolean)):void {
  if(this.disposed)return;
  const flight=this.options.flight();this.events.length=0;this.refs.clear();
  if(flight.enabled&&flight.canWarp)for(const {node,deadline} of this.candidates()){
   const prefs=node.alarm??DEFAULT_NODE_ALARM;if(!prefs.enabled||this.suspended.has(node)||!Number.isFinite(deadline))continue;
   const name=flight.world.ship(node.shipId)?.name??'Ship';let event=this.pool.get(node);
   if(!event){event={id:JSON.stringify([node.shipId,node.id]),kind:'maneuver',label:`${name} · ${node.label}`.slice(0,160),name,nodeLabel:node.label,time:node.time,deadline,pause:prefs.pause,handled:!!prefs.notified};this.pool.set(node,event);}
   if(event.name!==name||event.nodeLabel!==node.label){event.name=name;event.nodeLabel=node.label;event.label=`${name} · ${node.label}`.slice(0,160);}
   event.time=node.time;event.deadline=deadline;event.pause=prefs.pause;event.handled=!!prefs.notified;this.events.push(event);this.refs.set(event.id,node);
  }
  const notices=this.clock.sync(flight.world,flight.world.time,this.events);
  const isAutomatic=(id:string):boolean=>{const node=this.refs.get(id);return !!node&&(typeof automatic==='function'?automatic(node):node===automatic);};
  if(notices.length){
   let pause=false,missed=false;
   for(const notice of notices){const node=this.refs.get(notice.id);if(node)node.alarm={...(node.alarm??DEFAULT_NODE_ALARM),notified:true};pause ||= notice.pause;missed ||= notice.missed;}
   // An explicitly armed burn owns its approach timing. Its ordinary reminder
   // still notifies, while pause requests and other nodes retain their stop.
   const stop=notices.some(notice=>notice.pause||!isAutomatic(notice.id));
   if(stop)this.stopWarp();
   if(pause)this.options.setPaused?.(true);
   this.options.notify(`${missed?'Missed burn alarm':'Burn alarm'}: ${notices.length===1?notices[0]!.label:`${notices.length} nodes`}. ${pause&&this.options.setPaused?'Paused. ':''}${stop?'Review the burn; engine remains under your control.':'Automatic approach continues.'}`);
   this.options.event?.('maneuver-alarm',{count:notices.length,missed,paused:pause&&!!this.options.setPaused});
   this.updateUi(this.selected,false);
  }else if(!flight.paused&&flight.requestedWarp>1){
   let remaining=this.clock.secondsUntilNext;
   if(automatic){
    remaining=Infinity;
    for(const event of this.events)if(!event.handled&&(!isAutomatic(event.id)||event.pause))remaining=Math.min(remaining,event.deadline-flight.world.time);
   }
   // Same host frame bound as the existing maneuver approach. Never increase warp.
   const factor=remaining<=.25?1:Math.min(flight.requestedWarp,remaining/.2);
   if(factor<flight.requestedWarp){this.options.setWarp(factor);this.warpChanged();}
  }
 }
 dispose():void {if(this.disposed)return;this.disposed=true;this.clock.dispose();this.events.length=0;this.refs.clear();this.selected=undefined;}
}
