import type { Coast, FlightPlan, ManeuverPlannerOptions, SimulationContext, State, TransferOption, TransferPlanner, TransferProgress, TransferResult, WorldRead } from '@space-sim/game-api';

import { DestinationPicker } from './destinations';

/** Search results are tied to the source orbit; execution is delegated to the editor. */
export class TransferControls {
 private job?: Generator<TransferProgress,TransferResult>;
 private anchor?: {world:WorldRead;shipId:string;bodyId:string;state:State;context:SimulationContext;coast:Coast};
 private world?:WorldRead;private bodyId='';private shipId='';private disposed=false;private generation=0;
 private readonly destination:DestinationPicker;private readonly low:HTMLInputElement;private readonly high:HTMLInputElement;private readonly circular:HTMLInputElement;
 private readonly horizon?:HTMLInputElement;
 private readonly cancelButton:HTMLButtonElement;private readonly find:HTMLButtonElement;
 private readonly cards:{option:TransferOption;text:HTMLParagraphElement;metrics:HTMLOutputElement;button:HTMLButtonElement;autoWarp:HTMLButtonElement}[]=[];
 private readonly status:HTMLOutputElement;private readonly choices:HTMLDivElement;
 private shownOptions?:readonly TransferOption[];
 private scheduled?:number;
 constructor(private readonly root:HTMLElement,private readonly prefix:string,private readonly service:TransferPlanner,
  private readonly options:ManeuverPlannerOptions,private readonly install:(plan:FlightPlan)=>void,private readonly signal:AbortSignal,
  private readonly automate?:(plan:FlightPlan)=>void){
  root.innerHTML=`<p class="maneuver-help">Plan a complete trip to the orbit you want. Choose a destination and review the route and all burns before adopting. Pause flight to keep departure windows available while searching.</p>
   <div id="${prefix}-picker" class="transfer-picker"></div>
   <label>Target low altitude (m)<input id="${prefix}-low" type="number" step="any"></label>
   <label><input id="${prefix}-circular" type="checkbox" checked> Circular target</label>
   <label>Target high altitude (m)<input id="${prefix}-high" type="number" step="any" disabled></label>
   ${service.maxFlightSeconds?`<label>Maximum mission time (Julian years)<input id="${prefix}-years" type="number" min="0.000001" max="${service.maxFlightSeconds/(365.25*86400)}" step="any" value="${(service.defaultFlightSeconds??service.maxFlightSeconds)/(365.25*86400)}"></label><p class="maneuver-help">Includes waiting and all legs. Search compares direct trips and intermediate parking stops within this limit.</p>`:''}
   <div class="maneuver-adjust"><button id="${prefix}-find" type="button">Find transfer windows</button><button id="${prefix}-cancel" type="button" hidden>Cancel search</button></div>
   <output id="${prefix}-status" aria-live="polite">Choose an orbit and find options.</output><div id="${prefix}-choices"></div>`;
  const get=<T extends HTMLElement>(name:string)=>root.querySelector<T>(`#${prefix}-${name}`)!;
  this.horizon=root.querySelector<HTMLInputElement>(`#${prefix}-years`)??undefined;
  this.cancelButton=get('cancel');this.find=get('find');this.low=get('low');this.high=get('high');this.circular=get('circular');this.status=get('status');this.choices=get('choices');
  this.destination=new DestinationPicker(get('picker'),prefix,service,()=>{this.cancel('Destination changed. Find new options.');this.resetTarget();this.destinationStatus();},signal);
  const on=(target:EventTarget,type:string,callback:()=>void)=>target.addEventListener(type,callback,{signal:this.signal});
  for(const input of [this.low,this.high])on(input,'input',()=>{if(this.circular.checked)this.high.value=this.low.value;this.cancel('Inputs changed. Find new options.');this.destinationStatus();});
  this.high.closest('label')!.hidden=this.circular.checked;
  on(this.circular,'change',()=>{this.high.closest('label')!.hidden=this.circular.checked;this.high.disabled=this.circular.checked;if(this.circular.checked)this.high.value=this.low.value;this.cancel('Inputs changed. Find new options.');this.destinationStatus();});
  if(this.horizon)on(this.horizon,'input',()=>this.cancel('Mission time changed. Find new options.'));
  on(get('find'),'click',()=>this.search());on(get('cancel'),'click',()=>this.cancel('Search cancelled.'));
 }
 private resetTarget():void {
  const world=this.options.flight().world,id=this.destination.value;
  if(!world.hasBody(id)){this.low.value=this.high.value='';return;}
  const body=world.body(id),surface=world.surface(id),top=Math.max(body.radius,surface?.bounds.maxRadius??body.radius,surface?.seaRadiusMetres??body.radius);
  // A low circular orbit with generous clearance above terrain and water, scaled
  // to the destination. Leave room below the exit SOI for unusually tight systems.
  let altitude=Math.ceil(top-body.radius+Math.max(1,body.radius*.25));
  if(body.parentId&&body.soi.exitMetres>top)altitude=Math.min(altitude,top-body.radius+(body.soi.exitMetres-top)/2);
  this.low.value=this.high.value=String(altitude);
 }
 private destinationStatus():boolean {
  this.find.disabled=!this.destination.accepted;
  return this.destination.accepted;
 }
 private valid():boolean {
  const anchor=this.anchor,flight=this.options.flight(),ship=flight.ship;if(!anchor||!ship)return false;
  if(flight.world!==anchor.world||ship.id!==anchor.shipId||ship.bodyId!==anchor.bodyId||ship.state.status!=='flying'||ship.controls.engine||ship.state.time<anchor.state.time||flight.world.contextFor(ship)!==anchor.context)return false;
  const expected=anchor.context.coastAt(anchor.coast,ship.state.time,flight.body,flight.world.surface(flight.body.id),{cache:false});
  return expected.ok&&Math.hypot(expected.state.position.x-ship.state.position.x,expected.state.position.y-ship.state.position.y)<=Math.max(.05,Math.hypot(ship.state.position.x,ship.state.position.y)*1e-8)
   &&Math.hypot(expected.state.velocity.x-ship.state.velocity.x,expected.state.velocity.y-ship.state.velocity.y)<=.05;
 }
 private search():void {
  this.cancel();if(!this.destinationStatus())return;const flight=this.options.flight(),ship=flight.ship;if(!ship){this.status.textContent='Choose a flying ship in a bound orbit.';return;}
  const context=flight.world.contextFor(ship),state=structuredClone(ship.state),coast=context.keplerCoast(state,flight.body,flight.world.surface(flight.body.id));
  if(!coast){this.status.textContent='No safe analytic starting coast is available.';return;}
  this.anchor={world:flight.world,shipId:ship.id,bodyId:ship.bodyId,state,context,coast};
  this.job=this.service.search(flight.world,{shipId:ship.id,destinationId:this.destination.value,periapsisAltitude:this.low.valueAsNumber,apoapsisAltitude:this.circular.checked?this.low.valueAsNumber:this.high.valueAsNumber,...(this.horizon?{maxFlightSeconds:this.horizon.valueAsNumber*365.25*86400}:{})});
  this.cancelButton.hidden=false;this.status.textContent='Searching bounded transfer options…';this.schedule();
 }
 cancel(message?:string):void {
  this.generation++;this.cancelScheduled();
  try{this.job?.return({options:[],reason:'cancelled'});}finally{this.job=undefined;this.cancelButton.hidden=true;this.anchor=undefined;this.shownOptions=undefined;this.choices.replaceChildren();this.cards.length=0;if(message)this.status.textContent=message;}
 }
 update():void {
  if(this.disposed)return;const flight=this.options.flight();
  if(flight.world!==this.world||(flight.ship?.bodyId??'')!==this.bodyId||(flight.ship?.id??'')!==this.shipId){
   const reset=flight.world!==this.world||(flight.ship?.id??'')!==this.shipId;
   this.cancel('Flight changed. Find new options.');this.world=flight.world;this.bodyId=flight.ship?.bodyId??'';this.shipId=flight.ship?.id??'';
   const previous=this.destination.value;
   this.destination.populate(flight.world,this.bodyId,reset);
   if(reset||this.destination.value!==previous)this.resetTarget();
   this.destinationStatus();
  }
  if(!flight.enabled){this.cancel();return;}
  if(this.anchor&&!this.valid()){this.cancel('Flight conditions changed. Find new options.');return;}
  if(this.cards.length) {
   this.refreshCards();
   if(!this.job&&this.cards.every(card=>card.button.disabled)){this.cancel('The departure preparation windows passed. Find new options.');return;}
  }
  this.advance(1);this.schedule();
 }
 private cancelScheduled():void {
  if(this.scheduled!==undefined)this.root.ownerDocument.defaultView?.clearTimeout(this.scheduled);
  this.scheduled=undefined;
 }
 /** Separate bounded tasks use spare time between rendered frames without starving
  * input or rendering. Yield through browser timers after each slice; idle
  * callbacks can defer this work for many frames during continuous flight. */
 private schedule():void {
  const view=this.root.ownerDocument.defaultView,job=this.job;
  if(!job||!view||this.root.ownerDocument.hidden||this.scheduled!==undefined||this.disposed||this.signal.aborted)return;
  this.scheduled=view.setTimeout(()=>{
   this.scheduled=undefined;
   if(this.job!==job||this.disposed||this.signal.aborted||this.root.ownerDocument.hidden)return;
   this.advance(4);this.schedule();
  },0);
 }
 private advance(budget:number):void {
  if(!this.job)return;
  if(!this.options.flight().enabled||!this.valid()){this.cancel('Flight conditions changed. Find new options.');return;}
  const start=performance.now();let latest:TransferProgress|undefined;
  try {
   for(let count=0;count<4096&&performance.now()-start<budget;count++) {
    const result=this.job.next();
    if(result.done){this.job=undefined;this.cancelScheduled();this.cancelButton.hidden=true;this.show(result.value);return;}
    latest=result.value;
    if(latest.options&&latest.options!==this.shownOptions){this.shownOptions=latest.options;this.show({options:latest.options,reason:''});}
   }
   if(latest)this.status.textContent=`Searching · ${latest.phase?`${latest.phase} · `:''}${latest.tested}/${latest.total} samples · ${latest.accepted} validated${this.cards.length?' · Best so far; search continues':''}`;
  }catch(error){this.cancel(error instanceof Error?error.message:'Transfer search failed.');}
 }
 private show(result:TransferResult):void {
  this.choices.replaceChildren();this.cards.length=0;
  this.status.textContent=result.options.length?`Compare sampled options. ${result.compared?`Validated ${result.compared.direct} direct · ${result.compared.staged} staged. `:''}${result.reason}`:result.reason;
  const generation=this.generation;
  for(const option of result.options) {
   const document=this.root.ownerDocument,card=document.createElement('article'),text=document.createElement('p'),button=document.createElement('button'),autoWarp=document.createElement('button'),actions=document.createElement('div'),header=document.createElement('header'),title=document.createElement('strong'),metrics=document.createElement('output'),details=document.createElement('details'),summary=document.createElement('summary'),warning=document.createElement('p');
   card.className='transfer-option';text.className='maneuver-help';metrics.className='transfer-metrics';warning.className='transfer-warning';
   title.textContent=option.kind==='efficient'?'Efficient':'Faster';summary.textContent='Burn estimates & limits';
   warning.textContent=option.route?.finiteValidated?'Complete route · finite burns checked':option.warning.startsWith('Long finite burn')?'Long burn · encounter may differ':'Impulsive estimate · review after departure';
   actions.className='transfer-actions';actions.append(button,autoWarp);header.append(title,actions);card.append(header);
   if(option.route){const route=document.createElement('p'),stops=document.createElement('p');route.className='transfer-route';stops.className='maneuver-help';
    const world=this.options.flight().world,name=(id:string)=>world.body(id).name;
    route.textContent=option.route.bodyIds.map(name).join(' → ');stops.textContent=`${option.plan.nodes.length} burns · ${option.route.stops.length?`Parking stops: ${option.route.stops.map(name).join(', ')}`:'Direct · no intermediate parking'}`;
    card.append(route,stops);
   }
   details.append(summary,text);card.append(metrics,warning,details);
   button.id=`${this.prefix}-use-${option.kind}`;button.type='button';button.textContent='Use plan';button.setAttribute('aria-label',`Use ${option.kind} plan`);
   autoWarp.id=`${this.prefix}-auto-warp-${option.kind}`;autoWarp.type='button';autoWarp.textContent='Auto warp';autoWarp.setAttribute('aria-label',`Auto warp ${option.kind} plan`);autoWarp.title='Use this plan, resume flight and automatically execute all burns with auto-warp between them';autoWarp.hidden=!this.automate;
   const adopt=(automatic:boolean)=>{
    if(this.disposed||generation!==this.generation||!this.cards.some(card=>card.button===button))return;
    if(automatic&&(!this.automate||!this.canAutomate()))return;
    if(!this.valid()){this.cancel('Flight conditions changed. Find new options.');return;}
    if(option.plan.nodes[0]!.time-option.departureBurnSeconds/2<=this.options.flight().world.time+1){this.cancel('The departure preparation window passed. Find new options.');return;}
    this.cancel();this.install(option.plan);
    if(automatic)this.automate!(option.plan);
    else this.options.notify(`${option.plan.nodes.length} editable burn nodes created. Review the complete route; execution needs a separate command.`);
   };
   button.addEventListener('click',()=>adopt(false),{signal:this.signal});autoWarp.addEventListener('click',()=>adopt(true),{signal:this.signal});this.choices.append(card);this.cards.push({option,text,metrics,button,autoWarp});
  }
  this.refreshCards();
 }
 private canAutomate():boolean {
  const flight=this.options.flight();
  return !!this.automate&&flight.enabled&&flight.canWarp&&!flight.inputBlocked&&(!flight.paused||!!this.options.setPaused)
   &&!!flight.ship&&!!this.options.fleet?.owns(flight.ship.id)&&!!this.options.fleet.authorizeWarp;
 }
 private refreshCards():void {
  const now=this.options.flight().world.time;
  for(const {option,text,metrics,button,autoWarp} of this.cards) {
   const wait=option.plan.nodes[0]!.time-now;
   button.disabled=wait-option.departureBurnSeconds/2<=1;
   autoWarp.disabled=button.disabled||!this.canAutomate();
   const flight=this.options.flight(),throttle=flight.ship?.state.throttle??0,acceleration=flight.ship?flight.world.contextFor(flight.ship).vehicle.acceleration:0;
   const duration=(dv:number)=>dv===0?'0.0 s':acceleration*throttle>0?`${(dv/(acceleration*throttle)).toFixed(1)} s`:'no thrust';
   let description=`${option.kind==='efficient'?'Efficient':'Faster'} · wait ${Math.max(0,wait).toFixed(1)} s · travel ${option.travelSeconds.toFixed(1)} s · Δv ${option.deltaV.toFixed(1)} m/s
Departure ${option.departureDeltaV.toFixed(1)} m/s (${option.departureBurnSeconds.toFixed(1)} s at full throttle) · arrival ${option.arrivalDeltaV.toFixed(1)} m/s (${option.arrivalBurnSeconds.toFixed(1)} s at full throttle). At ${(throttle*100).toFixed(0)}% throttle: departure ${duration(option.departureDeltaV)}, arrival ${duration(option.arrivalDeltaV)}. ${option.warning}`;
   if(option.route){description=`At ${(throttle*100).toFixed(0)}% throttle: durations scale with available thrust. Automatic execution uses full throttle.\n`+option.plan.nodes.map(node=>{const burn=option.route?.burns?.find(b=>b.nodeId===node.id);return `${node.label} · ${formatDuration(node.time-now)} from now${burn?` · Δv ${burn.deltaV.toFixed(1)} m/s · ${formatDuration(burn.seconds)} at full throttle`:''}`;}).join('\n')+`\n${option.warning}`;}
   const stats=`Wait ${formatDuration(Math.max(0,wait))} · Travel ${formatDuration(option.travelSeconds)} · Δv ${option.deltaV.toFixed(1)} m/s`;
   if(metrics.textContent!==stats)metrics.textContent=stats;
   if(text.textContent!==description)text.textContent=description;
  }
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.cancel();}
}

function formatDuration(seconds:number):string {
 const value=Math.abs(seconds),sign=seconds<0?'−':'';
 if(value>=365.25*86400)return `${sign}${(value/(365.25*86400)).toFixed(2)} yr`;
 if(value>=86400)return `${sign}${(value/86400).toFixed(1)} d`;
 if(value>=3600)return `${sign}${(value/3600).toFixed(1)} h`;
 return `${seconds.toFixed(1)} s`;
}
