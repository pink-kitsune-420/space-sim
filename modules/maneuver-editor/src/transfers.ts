import type { Coast, FlightPlan, ManeuverPlannerOptions, SimulationContext, State, TransferOption, TransferPlanner, TransferProgress, TransferRelationship, TransferResult, WorldRead } from '@space-sim/game-api';

/** Optional search UI owns no execution. Search results are tied to the source orbit. */
export class TransferControls {
 private job?: Generator<TransferProgress,TransferResult>;
 private anchor?: {world:WorldRead;shipId:string;bodyId:string;state:State;context:SimulationContext;coast:Coast};
 private world?:WorldRead;private bodyId='';private disposed=false;
 private readonly destination:HTMLSelectElement;private readonly low:HTMLInputElement;private readonly high:HTMLInputElement;private readonly circular:HTMLInputElement;
 private readonly relations=new Map<string,TransferRelationship>();
 private readonly find:HTMLButtonElement;private readonly context:HTMLOutputElement;
 private readonly cards:{option:TransferOption;text:HTMLParagraphElement;button:HTMLButtonElement}[]=[];
 private readonly status:HTMLOutputElement;private readonly choices:HTMLDivElement;
 constructor(private readonly root:HTMLElement,private readonly prefix:string,private readonly service:TransferPlanner,
  private readonly options:ManeuverPlannerOptions,private readonly install:(plan:FlightPlan)=>void,private readonly signal:AbortSignal){
  root.innerHTML=`<summary>Transfer window</summary><p class="maneuver-help">Choose a destination by its relation to your current orbit. Transfer types not yet supported by the selected solver are marked.</p>
   <output id="${prefix}-context" class="maneuver-help"></output>
   <label>Destination<select id="${prefix}-destination"></select></label>
   <label>Target low altitude (m)<input id="${prefix}-low" type="number" step="any" value="512"></label>
   <label><input id="${prefix}-circular" type="checkbox" checked> Circular target</label>
   <label>Target high altitude (m)<input id="${prefix}-high" type="number" step="any" value="512" disabled></label>
   <div class="maneuver-adjust"><button id="${prefix}-find" type="button">Find options</button><button id="${prefix}-cancel" type="button">Cancel search</button></div>
   <output id="${prefix}-status" aria-live="polite">Choose an orbit and find options.</output><div id="${prefix}-choices"></div>`;
  const get=<T extends HTMLElement>(name:string)=>root.querySelector<T>(`#${prefix}-${name}`)!;
  this.find=get('find');this.context=get('context');this.destination=get('destination');this.low=get('low');this.high=get('high');this.circular=get('circular');this.status=get('status');this.choices=get('choices');
  const on=(target:EventTarget,type:string,callback:()=>void)=>target.addEventListener(type,callback,{signal:this.signal});
  for(const input of [this.destination,this.low,this.high])on(input,'input',()=>{if(this.circular.checked)this.high.value=this.low.value;this.cancel('Inputs changed. Find new options.');this.destinationStatus();});
  on(this.circular,'change',()=>{this.high.disabled=this.circular.checked;if(this.circular.checked)this.high.value=this.low.value;this.cancel('Inputs changed. Find new options.');this.destinationStatus();});
  on(get('find'),'click',()=>this.search());on(get('cancel'),'click',()=>this.cancel('Search cancelled.'));
 }
 private destinationStatus():boolean {
  const kind=this.relations.get(this.destination.value),unsupported=kind&&this.service.relationships&&!this.service.relationships.includes(kind);
  this.find.disabled=!kind||!!unsupported;
  if(unsupported)this.status.textContent='This destination relationship is not supported by the selected provider. Use direct parent/child or sibling legs.';
  return !!kind&&!unsupported;
 }
 private populateDestinations(world:WorldRead):void {
  const document=this.root.ownerDocument,bodies=world.system.getAllBodies(),current=bodies.find(body=>body.id===this.bodyId);
  this.destination.replaceChildren();this.relations.clear();
  if(!current){this.context.textContent='Choose a ship to see destinations in its orbital neighborhood.';return;}
  const parent=current.parentId?world.body(current.parentId):undefined,groups=new Map<string,{rank:number;node:HTMLOptGroupElement}>();
  this.context.textContent=`Current body: ${current.name}${parent?` · parent: ${parent.name}`:''}`;
  for(const body of bodies){
   const relation:TransferRelationship=body.id===current.id?'same-body':body.parentId===current.id?'child':body.id===current.parentId?'parent':body.parentId&&body.parentId===current.parentId?'sibling':'other';
   this.relations.set(body.id,relation);
   const centre=body.parentId?world.body(body.parentId):undefined;
   let title:string,rank:number,description:string;
   if(relation==='same-body'){title='Current body · orbit raising / lowering';rank=0;description='current orbit';}
   else if(relation==='child'){title=current.surfaceFeatures==='star'?`Planets orbiting ${current.name}`:`Moons of ${current.name}`;rank=1;description=current.surfaceFeatures==='star'?'planet':'moon';}
   else if(relation==='sibling'&&parent?.surfaceFeatures!=='star'){title=`Other moons of ${parent?.name??'the current parent'}`;rank=2;description=`moon of ${parent?.name??'the current parent'}`;}
   else if(relation==='parent'){title='Parent body · leave the current SOI';rank=3;description='parent body';}
   else if(centre?.surfaceFeatures==='star'){title='Interplanetary destinations';rank=4;description=`planet orbiting ${centre.name}`;}
   else if(centre){title=`Moons of ${centre.name} · farther destinations`;rank=5;description=`moon of ${centre.name}`;}
   else{title='Other destinations';rank=6;description=body.surfaceFeatures==='star'?'central star':'body';}
   let group=groups.get(title);if(!group){const node=document.createElement('optgroup');node.label=title;group={rank,node};groups.set(title,group);}
   const option=document.createElement('option');option.value=body.id;
   const unavailable=this.service.relationships&&!this.service.relationships.includes(relation);
   option.textContent=`${body.name} · ${description}${unavailable?' · not available yet':''}`;group.node.append(option);
  }
  this.destination.append(...[...groups.values()].sort((a,b)=>a.rank-b.rank).map(group=>group.node));this.destination.value=current.id;
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
  this.job=this.service.search(flight.world,{shipId:ship.id,destinationId:this.destination.value,periapsisAltitude:this.low.valueAsNumber,apoapsisAltitude:this.circular.checked?this.low.valueAsNumber:this.high.valueAsNumber});
  this.status.textContent='Searching bounded transfer options…';
 }
 cancel(message?:string):void {
  try{this.job?.return({options:[],reason:'cancelled'});}finally{this.job=undefined;this.anchor=undefined;this.choices.replaceChildren();this.cards.length=0;if(message)this.status.textContent=message;}
 }
 update():void {
  if(this.disposed)return;const flight=this.options.flight();
  if(flight.world!==this.world||flight.ship?.bodyId!==this.bodyId){
   this.cancel('Flight changed. Find new options.');this.world=flight.world;this.bodyId=flight.ship?.bodyId??'';
   this.populateDestinations(flight.world);this.destinationStatus();
  }
  if(!flight.enabled){this.cancel();return;}
  if(this.anchor&&!this.valid()){this.cancel('Flight conditions changed. Find new options.');return;}
  if(this.cards.length) {
   this.refreshCards();
   if(this.cards.every(card=>card.button.disabled)){this.cancel('The departure preparation windows passed. Find new options.');return;}
  }
  if(!this.job)return;
  const start=performance.now();let latest:TransferProgress|undefined;
  try {
   for(let count=0;count<128&&performance.now()-start<1;count++) {
    const result=this.job.next();
    if(result.done){this.job=undefined;this.show(result.value);return;}
    latest=result.value;
   }
   if(latest)this.status.textContent=`Searching · ${latest.tested}/${latest.total} samples · ${latest.accepted} validated`;
  }catch(error){this.cancel(error instanceof Error?error.message:'Transfer search failed.');}
 }
 private show(result:TransferResult):void {
  this.status.textContent=result.options.length?`Compare sampled options. ${result.reason}`:result.reason;
  for(const option of result.options) {
   const card=this.root.ownerDocument.createElement('div'),text=this.root.ownerDocument.createElement('p'),button=this.root.ownerDocument.createElement('button');
   text.className='maneuver-help';
   button.id=`${this.prefix}-use-${option.kind}`;button.type='button';button.textContent=`Use ${option.kind} plan`;
   button.addEventListener('click',()=>{
    if(this.disposed)return;
    if(!this.valid()){this.cancel('Flight conditions changed. Find new options.');return;}
    if(option.plan.nodes[0]!.time-option.departureBurnSeconds/2<=this.options.flight().world.time+1){this.cancel('The departure preparation window passed. Find new options.');return;}
    this.install(option.plan);(this.root as HTMLDetailsElement).open=false;this.options.notify('Departure and arrival nodes created. Review the impulsive plan; execute each burn separately or fly manually.');
   },{signal:this.signal});card.append(text,button);this.choices.append(card);this.cards.push({option,text,button});
  }
  this.refreshCards();
 }
 private refreshCards():void {
  const now=this.options.flight().world.time;
  for(const {option,text,button} of this.cards) {
   const wait=option.plan.nodes[0]!.time-now;
   button.disabled=wait-option.departureBurnSeconds/2<=1;
   const flight=this.options.flight(),throttle=flight.ship?.state.throttle??0,acceleration=flight.ship?flight.world.contextFor(flight.ship).vehicle.acceleration:0;
   const duration=(dv:number)=>dv===0?'0.0 s':acceleration*throttle>0?`${(dv/(acceleration*throttle)).toFixed(1)} s`:'no thrust';
   const description=`${option.kind==='efficient'?'Efficient':'Faster'} · wait ${Math.max(0,wait).toFixed(1)} s · travel ${option.travelSeconds.toFixed(1)} s · Δv ${option.deltaV.toFixed(1)} m/s
Departure ${option.departureDeltaV.toFixed(1)} m/s (${option.departureBurnSeconds.toFixed(1)} s at full throttle) · arrival ${option.arrivalDeltaV.toFixed(1)} m/s (${option.arrivalBurnSeconds.toFixed(1)} s at full throttle). At ${(throttle*100).toFixed(0)}% throttle: departure ${duration(option.departureDeltaV)}, arrival ${duration(option.arrivalDeltaV)}. ${option.warning}`;
   if(text.textContent!==description)text.textContent=description;
  }
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.cancel();}
}
