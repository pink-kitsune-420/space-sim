import type { Coast, FlightPlan, ManeuverPlannerOptions, SimulationContext, State, TransferOption, TransferPlanner, TransferProgress, TransferResult, WorldRead } from '@space-sim/game-api';

import { DestinationPicker } from './destinations';

type Card={option:TransferOption;card:HTMLElement;route:HTMLParagraphElement;stops:HTMLParagraphElement;warning:HTMLParagraphElement;text:HTMLParagraphElement;metrics:HTMLOutputElement;button:HTMLButtonElement;autoWarp:HTMLButtonElement};

/** Search results are tied to the source orbit; execution is delegated to the editor. */
export class TransferControls {
 private job?: Generator<TransferProgress,TransferResult>;
 private anchor?: {world:WorldRead;shipId:string;bodyId:string;state:State;context:SimulationContext;coast:Coast};
 private world?:WorldRead;private bodyId='';private shipId='';private disposed=false;private generation=0;
 private readonly destination:DestinationPicker;private readonly low:HTMLInputElement;private readonly high:HTMLInputElement;private readonly circular:HTMLInputElement;
 private readonly horizon?:HTMLInputElement;private readonly highParking?:HTMLInputElement;
 private readonly cancelButton:HTMLButtonElement;private readonly find:HTMLButtonElement;
 private readonly cards:Card[]=[];
 private readonly status:HTMLOutputElement;private readonly choices:HTMLDivElement;
 private readonly pauseHint:HTMLParagraphElement;
 private readonly progress:HTMLDivElement;private readonly bar:HTMLDivElement;private readonly fill:HTMLSpanElement;private readonly progressText:HTMLParagraphElement;
 private shownOptions?:readonly TransferOption[];
 /** Latest unpainted progress. Painting is throttled; samples never decrease and the
  * stage label holds while any interleaved route validation ran within the last second.
  * A provider fraction switches the bar to determinate for the rest of that search. */
 private latest?:TransferProgress;private samples=0;private fraction=-1;private paintedAt=0;private checkedAt=-Infinity;
 private scheduled?:number;
 constructor(private readonly root:HTMLElement,private readonly prefix:string,private readonly service:TransferPlanner,
  private readonly options:ManeuverPlannerOptions,private readonly install:(plan:FlightPlan)=>void,private readonly signal:AbortSignal,
  private readonly automate?:(plan:FlightPlan)=>void){
  root.innerHTML=`<fieldset class="transfer-section"><legend>1 · Destination & orbit</legend>
   <div id="${prefix}-picker" class="transfer-picker"></div>
   <div class="transfer-orbit"><label class="transfer-field">Low altitude (m)<input id="${prefix}-low" type="number" step="any" aria-describedby="${prefix}-orbit-help"></label>
   <label class="transfer-circle"><input id="${prefix}-circular" type="checkbox" checked> Circular</label>
   <label class="transfer-field transfer-high">High altitude (m)<input id="${prefix}-high" type="number" step="any" disabled aria-describedby="${prefix}-orbit-help"></label></div>
   <details class="transfer-help"><summary>About target altitude</summary><p id="${prefix}-orbit-help" class="maneuver-help">Altitudes are metres above the destination’s reference radius. Circular uses the same low and high altitude; turn it off to set both apsides. Search checks terrain clearance and orbit limits.</p></details></fieldset>
   ${service.maxFlightSeconds?`<fieldset class="transfer-section"><legend>2 · Timing${service.parkingOrbits?' & stops':''}</legend><div class="transfer-timing"><label for="${prefix}-years">Mission limit (yr)</label><input id="${prefix}-years" type="number" min="0.000001" max="${service.maxFlightSeconds/(365.25*86400)}" step="any" value="${(service.defaultFlightSeconds??service.maxFlightSeconds)/(365.25*86400)}" aria-describedby="${prefix}-timing-hint ${prefix}-timing-help"></div><p id="${prefix}-timing-hint" class="maneuver-help">Maximum wait + travel, including all stops.</p><details class="transfer-help"><summary>How timing affects search</summary><p id="${prefix}-timing-help" class="maneuver-help">This is a duration limit, not an arrival date. One Julian year is 365.25 days. Search compares direct trips and intermediate parking stops within this limit (up to ${service.maxFlightSeconds/(365.25*86400)} yr). A shorter limit can exclude routes.</p></details>${service.parkingOrbits?`
   <label class="transfer-circle"><input id="${prefix}-high-parking" type="checkbox" checked aria-describedby="${prefix}-parking-help"> High parking stops</label>
   <details class="transfer-help"><summary>About parking stops</summary><p id="${prefix}-parking-help" class="maneuver-help">Staged routes may stop in orbit around a planet on the way. High parking stops orbit just outside (or inside) the neighbouring moon’s orbit, clear of every moon’s SOI. This usually saves Δv and search time. Turn it off to park in a low orbit near each stop instead.</p></details>`:''}</fieldset>`:''}
   <section class="transfer-section" aria-labelledby="${prefix}-review-title"><h3 id="${prefix}-review-title">${service.maxFlightSeconds?'3':'2'} · Search & review</h3>
   <p id="${prefix}-pause-hint" class="maneuver-help">Pause flight to keep departure windows available.</p>
   <div class="maneuver-adjust"><button id="${prefix}-find" type="button">Find transfer windows</button><button id="${prefix}-cancel" type="button" hidden>Cancel search</button></div>
   <div id="${prefix}-progress" class="transfer-progress" hidden><div id="${prefix}-bar" class="transfer-bar" role="progressbar" aria-label="Transfer search progress"><span></span></div><p id="${prefix}-progress-text" class="transfer-progress-text"></p></div>
   <output id="${prefix}-status" class="transfer-status" aria-live="polite">Choose an orbit, then find transfer windows.</output><div id="${prefix}-choices"></div>
   <details class="transfer-help"><summary>Using a transfer plan</summary><p class="maneuver-help">Compare wait, travel time, total Δv and all burns. Use plan creates editable nodes for review; execute them separately. Auto warp adopts the plan and authorizes automatic flight through its burns. Finite-burn checks apply to the current flight conditions; review warnings before departure.</p></details></section>`;
  const get=<T extends HTMLElement>(name:string)=>root.querySelector<T>(`#${prefix}-${name}`)!;
  this.horizon=root.querySelector<HTMLInputElement>(`#${prefix}-years`)??undefined;
  this.highParking=root.querySelector<HTMLInputElement>(`#${prefix}-high-parking`)??undefined;
  this.cancelButton=get('cancel');this.find=get('find');this.low=get('low');this.high=get('high');this.circular=get('circular');this.status=get('status');this.choices=get('choices');
  this.pauseHint=get('pause-hint');this.progress=get('progress');this.bar=get('bar');this.fill=this.bar.querySelector('span')!;this.progressText=get('progress-text');
  this.destination=new DestinationPicker(get('picker'),prefix,service,()=>{this.cancel('Destination changed. Find new options.');this.resetTarget();this.destinationStatus();},signal);
  const on=(target:EventTarget,type:string,callback:()=>void)=>target.addEventListener(type,callback,{signal:this.signal});
  for(const input of [this.low,this.high])on(input,'input',()=>{if(this.circular.checked)this.high.value=this.low.value;this.cancel('Inputs changed. Find new options.');this.destinationStatus();});
  this.high.closest('label')!.hidden=this.circular.checked;
  on(this.circular,'change',()=>{this.high.closest('label')!.hidden=this.circular.checked;this.high.disabled=this.circular.checked;if(this.circular.checked)this.high.value=this.low.value;this.cancel('Inputs changed. Find new options.');this.destinationStatus();});
  if(this.horizon)on(this.horizon,'input',()=>this.cancel('Mission time changed. Find new options.'));
  if(this.highParking)on(this.highParking,'change',()=>this.cancel('Parking stops changed. Find new options.'));
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
  this.cancel();if(!this.destinationStatus())return;this.destination.collapse();const flight=this.options.flight(),ship=flight.ship;if(!ship){this.status.textContent='Choose a flying ship in a bound orbit.';return;}
  const context=flight.world.contextFor(ship),state=structuredClone(ship.state),coast=context.keplerCoast(state,flight.body,flight.world.surface(flight.body.id));
  if(!coast){this.status.textContent='No safe analytic starting coast is available.';return;}
  this.anchor={world:flight.world,shipId:ship.id,bodyId:ship.bodyId,state,context,coast};
  this.job=this.service.search(flight.world,{shipId:ship.id,destinationId:this.destination.value,periapsisAltitude:this.low.valueAsNumber,apoapsisAltitude:this.circular.checked?this.low.valueAsNumber:this.high.valueAsNumber,...(this.horizon?{maxFlightSeconds:this.horizon.valueAsNumber*365.25*86400}:{}),...(this.highParking?{highParking:this.highParking.checked}:{})});
  this.cancelButton.hidden=false;this.status.textContent='Searching bounded transfer options…';
  this.samples=0;this.fraction=-1;this.fill.style.width='';for(const name of ['aria-valuenow','aria-valuemin','aria-valuemax'])this.bar.removeAttribute(name);this.checkedAt=-Infinity;this.latest={tested:0,total:0,accepted:0};this.paintedAt=-Infinity;this.progress.hidden=false;this.paint();this.schedule();
 }
 cancel(message?:string):void {
  this.generation++;this.cancelScheduled();
  try{this.job?.return({options:[],reason:'cancelled'});}finally{this.job=undefined;this.cancelButton.hidden=true;this.progress.hidden=true;this.latest=undefined;this.anchor=undefined;this.shownOptions=undefined;this.choices.replaceChildren();this.cards.length=0;if(message)this.status.textContent=message;}
 }
 update():void {
  if(this.disposed)return;const flight=this.options.flight();
  if(this.pauseHint.hidden!==!!flight.paused)this.pauseHint.hidden=!!flight.paused;
  if(flight.world!==this.world||(flight.ship?.bodyId??'')!==this.bodyId||(flight.ship?.id??'')!==this.shipId){
   const reset=flight.world!==this.world||(flight.ship?.id??'')!==this.shipId;
   this.cancel(this.world?'Flight changed. Find new options.':'Choose an orbit, then find transfer windows.');this.world=flight.world;this.bodyId=flight.ship?.bodyId??'';this.shipId=flight.ship?.id??'';
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
    if(result.done){this.job=undefined;this.cancelScheduled();this.cancelButton.hidden=true;this.progress.hidden=true;this.latest=undefined;this.show(result.value);return;}
    latest=result.value;if(latest.phase==='Checking complete route')this.checkedAt=start;
    if(latest.options&&latest.options!==this.shownOptions){
     this.shownOptions=latest.options;this.sync(latest.options);
     const found=latest.options.length?`${latest.options.length} ${latest.options.length===1?'option':'options'} found · best so far; search continues.`:'Searching bounded transfer options…';
     if(this.status.textContent!==found)this.status.textContent=found;
    }
   }
   if(latest){this.latest=latest;this.paint();}
  }catch(error){this.cancel(error instanceof Error?error.message:'Transfer search failed.');}
 }
 /** At most five text writes per second, and only when the visible line changes. */
 private paint():void {
  const latest=this.latest,now=performance.now();if(!latest||now-this.paintedAt<200&&!(this.fraction<0&&Number.isFinite(latest.fraction)))return;this.paintedAt=now;
  this.samples=Math.max(this.samples,latest.tested);
  if(Number.isFinite(latest.fraction))this.fraction=Math.max(this.fraction,Math.min(1,Math.max(0,latest.fraction!)));
  // Floor and hold below 100 while running: completion replaces the indicator.
  const percent=Math.min(99,Math.floor(this.fraction*100));
  if(this.fraction>=0&&this.bar.getAttribute('aria-valuenow')!==String(percent)){
   if(!this.bar.hasAttribute('aria-valuemax')){this.bar.setAttribute('aria-valuemin','0');this.bar.setAttribute('aria-valuemax','100');}
   this.bar.setAttribute('aria-valuenow',String(percent));this.fill.style.width=`${percent}%`;
  }
  const text=`${now-this.checkedAt<1000?'Checking complete route':'Searching transfer windows'} · ${this.fraction>=0?`${percent}% · `:''}${this.samples.toLocaleString()} samples · ${latest.accepted.toLocaleString()} validated`;
  if(this.progressText.textContent!==text){this.progressText.textContent=text;this.bar.setAttribute('aria-valuetext',text);}
 }
 private show(result:TransferResult):void {
  this.sync(result.options);
  this.status.textContent=result.options.length?`Compare sampled options. ${result.compared?`Validated ${result.compared.direct} direct · ${result.compared.staged} staged. `:''}${result.reason}`:result.reason;
 }
 /** Update cards in place by kind so open details, focus and layout survive new
  * best-so-far results. Cards are added or removed only when the kinds change. */
 private sync(options:readonly TransferOption[]):void {
  for(let i=this.cards.length-1;i>=0;i--)if(!options.some(option=>option.kind===this.cards[i]!.option.kind)){this.cards[i]!.card.remove();this.cards.splice(i,1);}
  const world=this.options.flight().world,name=(id:string)=>world.body(id).name;
  options.forEach((option,index)=>{
   const entry=this.cards.find(card=>card.option.kind===option.kind)??this.card(option);entry.option=option;
   setText(entry.warning,option.route?.finiteValidated?'Complete route · finite burns checked':option.warning.startsWith('Long finite burn')?'Long burn · encounter may differ':'Impulsive estimate · review after departure');
   entry.route.hidden=entry.stops.hidden=!option.route;
   if(option.route){setText(entry.route,option.route.bodyIds.map(name).join(' → '));setText(entry.stops,`${option.plan.nodes.length} burns · ${option.route.stops.length?`Parking stops: ${option.route.stops.map(name).join(', ')}`:'Direct · no intermediate parking'}`);}
   const at=this.choices.children[index];if(at!==entry.card)this.choices.insertBefore(entry.card,at??null);
  });
  this.refreshCards();
 }
 private card(option:TransferOption):Card {
  const document=this.root.ownerDocument,card=document.createElement('article'),text=document.createElement('p'),button=document.createElement('button'),autoWarp=document.createElement('button'),actions=document.createElement('div'),title=document.createElement('strong'),metrics=document.createElement('output'),details=document.createElement('details'),summary=document.createElement('summary'),warning=document.createElement('p'),route=document.createElement('p'),stops=document.createElement('p');
  card.className='transfer-option';text.className='maneuver-help';metrics.className='transfer-metrics';warning.className='transfer-warning';route.className='transfer-route';stops.className='maneuver-help';
  title.textContent=option.kind==='efficient'?'Efficient':'Faster';summary.textContent='Burn estimates & limits';
  actions.className='transfer-actions';actions.append(button,autoWarp);details.append(summary,text);card.append(title,route,stops,metrics,warning,actions,details);
  button.id=`${this.prefix}-use-${option.kind}`;button.type='button';button.textContent='Use plan';button.setAttribute('aria-label',`Use ${option.kind} plan`);
  autoWarp.id=`${this.prefix}-auto-warp-${option.kind}`;autoWarp.type='button';autoWarp.textContent='Auto warp';autoWarp.setAttribute('aria-label',`Auto warp ${option.kind} plan`);autoWarp.title='Use this plan, resume flight and automatically execute all burns with auto-warp between them';autoWarp.hidden=!this.automate;
  const generation=this.generation,entry:Card={option,card,route,stops,warning,text,metrics,button,autoWarp};
  // Read the current option at click time: best-so-far results replace it in place.
  const adopt=(automatic:boolean)=>{
   const {option}=entry;
   if(this.disposed||generation!==this.generation||!this.cards.includes(entry))return;
   if(automatic&&(!this.automate||!this.canAutomate()))return;
   if(!this.valid()){this.cancel('Flight conditions changed. Find new options.');return;}
   if(option.plan.nodes[0]!.time-option.departureBurnSeconds/2<=this.options.flight().world.time+1){this.cancel('The departure preparation window passed. Find new options.');return;}
   this.cancel();this.install(option.plan);
   if(automatic)this.automate!(option.plan);
   else this.options.notify(`${option.plan.nodes.length} editable burn nodes created. Review the complete route; execution needs a separate command.`);
  };
  button.addEventListener('click',()=>adopt(false),{signal:this.signal});autoWarp.addEventListener('click',()=>adopt(true),{signal:this.signal});this.cards.push(entry);
  return entry;
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
   let description=`Departure ${option.departureDeltaV.toFixed(1)} m/s (${option.departureBurnSeconds.toFixed(1)} s at full throttle) · arrival ${option.arrivalDeltaV.toFixed(1)} m/s (${option.arrivalBurnSeconds.toFixed(1)} s at full throttle). At ${(throttle*100).toFixed(0)}% throttle: departure ${duration(option.departureDeltaV)}, arrival ${duration(option.arrivalDeltaV)}. ${option.warning}`;
   if(option.route){description=`At ${(throttle*100).toFixed(0)}% throttle: durations scale with available thrust. Automatic execution uses full throttle.\n`+option.plan.nodes.map(node=>{const burn=option.route?.burns?.find(b=>b.nodeId===node.id);return `${node.label} · ${formatDuration(node.time-now)} from now${burn?` · Δv ${burn.deltaV.toFixed(1)} m/s · ${formatDuration(burn.seconds)} at full throttle`:''}`;}).join('\n')+`\n${option.warning}`;}
   const stats=`Wait ${formatDuration(Math.max(0,wait))} · Travel ${formatDuration(option.travelSeconds)} · Δv ${option.deltaV.toFixed(1)} m/s`;
   setText(metrics,stats);setText(text,description);
  }
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.cancel();}
}

function setText(node:HTMLElement,text:string):void{if(node.textContent!==text)node.textContent=text;}
function formatDuration(seconds:number):string {
 const value=Math.abs(seconds),sign=seconds<0?'−':'';
 if(value>=365.25*86400)return `${sign}${(value/(365.25*86400)).toFixed(2)} yr`;
 if(value>=86400)return `${sign}${(value/86400).toFixed(1)} d`;
 if(value>=3600)return `${sign}${(value/3600).toFixed(1)} h`;
 return `${seconds.toFixed(1)} s`;
}
