import {MAX_FLIGHT_PLAN_SECONDS,flightTimeTolerance,type EvaluatedFlightNode,type FlightPlanNode,type FlightPlanService,type ManeuverBurnFactory,type Ship,type TransferOption,type TransferProgress,type TransferRequest,type TransferResult,type WorldRead} from '@space-sim/game-api';
import {REFINE_START,finiteArrivals,searchInterbody} from './interbody';
import {radius,tolerance,transferOptions} from './math';
const YEAR=365.25*86400,CHECK_UNITS=.25;
/** A read-only future seed over the selected provider. Every prediction starts from
 * explicit inert state; no authority is stepped, teleported or replaced. */
function futureWorld(world:WorldRead,ship:Ship):WorldRead {
 const future=Object.create(world) as WorldRead;
 // Shadow the frozen read facade rather than proxying its nonconfigurable methods.
 // Bind methods to their owner so custom providers can retain private fields.
 Object.defineProperties(future,{
  time:{value:ship.state.time},ship:{value:(id:string)=>id===ship.id?ship:world.ship(id)},
  contextFor:{value:world.contextFor.bind(world)},body:{value:world.body.bind(world)},surface:{value:world.surface.bind(world)},
  hasBody:{value:world.hasBody.bind(world)},predictShip:{value:world.predictShip.bind(world)},
 });
 return future;
}
function routePaths(world:WorldRead,from:string,to:string):readonly string[][] {
 const chain=(id:string)=>{const ids:string[]=[];for(let body=world.body(id);;){ids.push(body.id);if(!body.parentId)break;body=world.body(body.parentId);}return ids;};
 const a=chain(from),b=chain(to),common=a.find(id=>b.includes(id));if(!common)return [];
 const up=a.slice(1,a.indexOf(common)),down=b.slice(1,b.indexOf(common)).reverse();
 // Direct, destination staging, source staging, and both. Hierarchies of arbitrary
 // depth remain intact, with at most seven legs under the portable 16-node bound.
 const paths=[[from,...up,...down,to],[from,...down,to],[from,...up,to],[from,to]];
 return paths.filter((path,i)=>path.length<=8&&paths.findIndex(p=>p.join('\0')===path.join('\0'))===i);
}
/** Intermediate parking altitudes. A stop beside a moon on the route parks just
 * outside (else inside) that moon's orbit, clear of every moon's SOI: a low stop
 * deep in the parent's well pays for both a capture and an escape. Low parking
 * remains the fallback when no high orbit fits, and the choice when high is false. */
export function stopAltitudes(world:WorldRead,path:readonly string[],stage:number,time:number,high=true):number[] {
 const body=world.body(path[stage]!),top=world.surface(body.id)?.bounds.maxRadius??body.radius,
  low=[Math.max(body.radius*.4,top-body.radius+body.radius*.25),Math.max(body.radius*.9,top-body.radius+body.radius*.5)];
 const child=[path[stage-1],path[stage+1]].find(id=>id!==undefined&&world.body(id).parentId===body.id);
 if(!high||!child||!body.parentId)return low;
 const centre=world.system.getBodyPosition(body.id,time),distance=(id:string)=>{const p=world.system.getBodyPosition(id,time);return radius({x:p.x-centre.x,y:p.y-centre.y});};
 const moons=world.system.getAllBodies().filter(moon=>moon.parentId===body.id).map(moon=>({orbit:distance(moon.id),soi:moon.soi.exitMetres})),orbit=distance(child);
 for(const r of [orbit*1.5,orbit*.6])
  if(r>top+body.radius*.25&&r<=body.soi.exitMetres*.8&&moons.every(moon=>Math.abs(r-moon.orbit)>=moon.soi*1.5))return [r-body.radius];
 return low;
}
interface Partial {ship:Ship;nodes:readonly FlightPlanNode[];bodies:readonly string[];deltaV:number;first?:TransferOption;last?:TransferOption}
/** Whole-trip bounded beam search. Efficient and fastest partial routes survive each
 * stage; final options compare complete mission cost, never independently cheap legs. */
export function* searchRoutes(plans:FlightPlanService,world:WorldRead,request:TransferRequest,burns:ManeuverBurnFactory):Generator<TransferProgress,TransferResult> {
 const actual=world.ship(request.shipId),limit=request.maxFlightSeconds??50*YEAR;
 if(!actual)return {options:[],reason:'Choose a flying ship.'};
 const source=actual;
 if(!world.hasBody(request.destinationId))return {options:[],reason:'The destination body is unavailable.'};
 if(!(Number.isFinite(limit)&&limit>30&&limit<=MAX_FLIGHT_PLAN_SECONDS))return {options:[],reason:'Choose a mission duration between 30 seconds and 100 Julian years.'};
 const paths=routePaths(world,source.bodyId,request.destinationId),candidates:Omit<TransferOption,'kind'>[]=[];
 const legCache=new Map<string,TransferResult>(),pendingLegs=new Set<string>();
 let published:readonly TransferOption[]|undefined;
 let directCount=0,stagedCount=0;
 let tested=0,accepted=0,reason='No complete direct or staged route passed the finite-burn and encounter checks. Try a different parking orbit, target or mission duration.';
 // Progress counts one unit per leg stage and CHECK_UNITS for whole-route validation
 // (about a quarter of a leg's time when measured). Units completed on every path are
 // divided by their sum; a stage is split evenly between its beam legs.
 const share=new Float64Array(paths.length),units=paths.reduce((sum,path)=>sum+path.length-1+CHECK_UNITS,0),
  fraction=()=>{let sum=0;for(const value of share)sum+=value;return sum/units;};
 function* searchPath(path:readonly string[],index:number):Generator<TransferProgress,void>{
  const size=path.length-1+CHECK_UNITS,advance=(done:number)=>{share[index]=Math.max(share[index]!,Math.min(size,done));};
  let beam:Partial[]=[{ship:source,nodes:[],bodies:[source.bodyId],deltaV:0}];
  const kind=path.length>2?`Via ${path.slice(1,-1).map(id=>world.body(id).name).join(', ')}`:'Direct';
  for(let stage=1;stage<path.length&&beam.length;stage++){
   const destinationId=path[stage]!,body=world.body(destinationId),final=stage===path.length-1,
    altitudes=final?[request.periapsisAltitude]:stopAltitudes(world,path,stage,source.state.time,request.highParking!==false);
   const next:Partial[]=[],legs=beam.length*altitudes.length;let started=0;
   for(const partial of beam)for(const low of altitudes){
    const slot=started++;advance(stage-1+slot/legs);
    const remaining=source.state.time+limit-partial.ship.state.time;if(remaining<=30)continue;
    const key=JSON.stringify([partial.ship.bodyId,partial.ship.vehicleId,partial.ship.state,destinationId,low,final?request.apoapsisAltitude:low,remaining]);
    while(pendingLegs.has(key))yield{phase:`${kind} · ${world.body(partial.ship.bodyId).name} → ${body.name}`,tested,total:tested,accepted,fraction:fraction(),options:published};
    const cached=legCache.get(key);if(!cached)pendingLegs.add(key);
    const forecastWorld=futureWorld(world,partial.ship),job=searchInterbody(plans,forecastWorld,{...request,destinationId,periapsisAltitude:low,apoapsisAltitude:final?request.apoapsisAltitude:low,maxFlightSeconds:remaining},burns);
    let result:TransferResult=cached??{options:[],reason:'This leg reached its bounded search work limit.'},firstAccepted=-1;
    try{for(let work=0;!cached&&work<8000000;work++){
     const step=job.next();if(step.done){result=step.value;break;}
     if(step.value.options?.length){result={options:step.value.options,reason:''};if(firstAccepted<0)firstAccepted=step.value.tested;}
     // Preserve two cost/time variants when available. After a success, sample
     // two more windows rather than exhaust every leg before showing a full route.
     if(firstAccepted>=0&&(step.value.accepted>=2||step.value.tested>firstAccepted+2))break;
     // Refinement stops two windows after its first success, usually by the eighth of ~24.
     // Project that end so early completion does not leap from a stalled bar.
     const coarse=step.value.fraction??0,end=Math.min(step.value.total,firstAccepted>=0?firstAccepted+3:Math.max(8,step.value.tested+3));
     advance(stage-1+(slot+(coarse<REFINE_START?coarse:REFINE_START+(1-REFINE_START)*Math.min(1,(step.value.tested-1)/end)))/legs);
     yield{phase:`${kind} · ${world.body(partial.ship.bodyId).name} → ${body.name}`,tested:tested+step.value.tested,total:tested+step.value.total,accepted,fraction:fraction(),options:published};
    }}finally{pendingLegs.delete(key);job.return({options:[],reason:'cancelled'});}
    if(!cached)legCache.set(key,result);
    tested++;if(!result.options.length)reason=result.reason;
    for(const option of result.options){
     const after=finiteArrivals.get(option.plan);if(!after||after.time>source.state.time+limit)continue;
     next.push({ship:{...partial.ship,bodyId:destinationId,state:after},nodes:[...partial.nodes,...option.plan.nodes.map((node,index)=>({...node,id:stage===1&&index===0?'departure':final&&index===1?'arrival':`leg-${stage}-${index}`,label:`${index?'Capture':'Departure'} · ${world.body(node.bodyId).name}`.slice(0,80)}))],
      bodies:[...partial.bodies,destinationId],deltaV:partial.deltaV+option.deltaV,first:partial.first??option,last:option});
    }
   }
   // Keep different complete prefixes for fuel and elapsed time. Stable ties retain
   // hierarchy/parking-radius sample order. This is bounded sampling, not a global optimum.
   const cheapest=next.slice().sort((a,b)=>a.deltaV-b.deltaV||a.ship.state.time-b.ship.state.time).slice(0,2),fastest=next.slice().sort((a,b)=>a.ship.state.time-b.ship.state.time||a.deltaV-b.deltaV).slice(0,2);
   beam=[...new Set([...cheapest,...fastest])];
   // Delta-v and elapsed time only grow along a route. A prefix beyond twice the
   // displayed efficient delta-v and 90% of its time can be neither option.
   const best=published?.[0];
   if(best&&!final)beam=beam.filter(route=>!(route.deltaV>best.deltaV*2&&route.ship.state.time-source.state.time>(best.waitSeconds+best.travelSeconds)*.9));
  }
  for(const [checked,route] of beam.entries()){
   advance(path.length-1+CHECK_UNITS*checked/beam.length);
   if(route.ship.bodyId!==request.destinationId||!route.first||!route.last)continue;
   const plan=plans.capture(world,source,route.nodes),evaluation=plans.evaluateAsync?.(plan,world);if(!evaluation)continue;
   let evaluated:readonly EvaluatedFlightNode[]=[];
   try{for(let i=0;i<2000000;i++){
    const step=evaluation.next();if(step.done){evaluated=step.value;break;}yield{phase:'Checking complete route',tested,total:tested,accepted,fraction:fraction()};
   }}finally{evaluation.return([]);}
   if(evaluated.length!==route.nodes.length||evaluated.some(node=>!node.valid)){
    reason=evaluated.find(node=>!node.valid)?.reason??'Complete route validation reached its work limit.';continue;
   }
   // Recheck goals on the joined finite chain, not only on individually qualified
   // legs. Small differences at one stop must not become an unchecked later leg.
   let valid=true;
   for(const node of evaluated){
    const goal=node.intent.targetOrbit;if(!goal)continue;
    const after=node.after!,body=world.body(node.intent.bodyId),orbit=world.contextFor(source).services.orbits.elements(after,body.mu),rp=body.radius+goal.periapsisAltitude,ra=body.radius+goal.apoapsisAltitude;
    if(!orbit.period||orbit.apoapsis===null||Math.abs(orbit.periapsis-rp)>tolerance(rp)||Math.abs(orbit.apoapsis-ra)>tolerance(ra)){
     valid=false;reason=`The joined route does not preserve the requested orbit at ${body.name}.`;break;
    }
    const until=after.time+orbit.period,trace=world.predictShip(source.id,false,{state:after,bodyId:body.id,until});let stable=false,lastTime=after.time;
    try{for(let i=0;i<16384;i++){
     const step=trace.next();if(step.done){stable=step.value==='horizon'&&Math.abs(lastTime-until)<=flightTimeTolerance(until);break;}
     lastTime=step.value.time;if(step.value.bodyId!==body.id)break;yield{phase:'Checking complete route',tested,total:tested,accepted,fraction:fraction()};
    }}finally{trace.return('open');}
    if(!stable){valid=false;reason=`The joined route cannot verify a safe parking revolution at ${body.name}.`;break;}
   }
   if(!valid)continue;
   const acceleration=world.contextFor(source).vehicle.acceleration,burnEstimates=evaluated.map(node=>{const dv=Math.hypot(node.delta!.x,node.delta!.y);return {nodeId:node.intent.id,deltaV:dv,seconds:dv/acceleration};}),firstBurn=burnEstimates[0]!,lastBurn=burnEstimates.at(-1)!;
   candidates.push({plan,waitSeconds:route.first.waitSeconds,travelSeconds:evaluated.at(-1)!.after!.time-route.nodes[0]!.time,deltaV:burnEstimates.reduce((sum,burn)=>sum+burn.deltaV,0),
    departureDeltaV:firstBurn.deltaV,arrivalDeltaV:lastBurn.deltaV,departureBurnSeconds:firstBurn.seconds,arrivalBurnSeconds:lastBurn.seconds,
    route:{bodyIds:route.bodies,stops:route.bodies.slice(1,-1),maxFlightSeconds:limit,finiteValidated:true,burns:burnEstimates},
    warning:'Complete route checked with finite burns, actual SOI transitions and a safe revolution at every parking orbit. Bounded sampled comparison; actual encounters and remaining burns are reviewed during execution.'});accepted++;
   if(route.bodies.length>2)stagedCount++;else directCount++;
   published=transferOptions(candidates,world.time);yield{tested,total:tested,accepted,fraction:fraction(),options:published};
  }
  share[index]=size;
 }
 // Advance every route: a hard direct approach must not block a useful staged
 // plan, or vice versa. The usually cheaper direct trip receives most work until
 // it validates. Identical pending legs share their completed cache.
 const jobs=paths.map((path,index)=>({direct:path.length===2,job:searchPath(path,index)}));
 try{while(jobs.length)for(let i=0;i<jobs.length;i++){
  const {direct,job}=jobs[i]!;
  for(let turn=direct&&!directCount?Math.max(1,2*(jobs.length-1)):1;turn>0;turn--){
   const step=job.next();if(step.done){jobs.splice(i--,1);break;}yield step.value;
  }
 }}finally{for(const {job} of jobs)job.return();}
 const options=transferOptions(candidates,world.time);return {options,compared:{direct:directCount,staged:stagedCount},reason:options.length?(options.length===1?'No sampled faster route saves 10% of total time within twice the efficient route’s Δv.':''):(candidates.length?'Validated departure preparation windows passed. Pause flight and search again.':reason)};
}
