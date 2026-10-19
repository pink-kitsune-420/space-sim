import {flightSampleInFrame,maneuverDelta,deterministicMath as dm,
 type FlightPlanService,type GhostEnd,type GhostSample,type State,type TransferOption,type TransferProgress,type TransferRequest,type TransferResult,type Vec,type WorldRead} from '@space-sim/game-api';
import {lambert,ejection} from './lambert';
import {deltaComponents,radius,tolerance} from './math';
const YEAR=365.25*86400;
const add=(a:Vec,b:Vec):Vec=>({x:a.x+b.x,y:a.y+b.y});
const subtract=(a:Vec,b:Vec):Vec=>({x:a.x-b.x,y:a.y-b.y});
const scale=(v:Vec,f:number):Vec=>({x:v.x*f,y:v.y*f});
interface Probe { sample:GhostSample; safe:boolean; end:GhostEnd }
/** Shared-predictor differential correction. Analytic contact continuations guide
 * proposals only; every accepted path independently passes all contact checks. */
export function* searchInterbody(plans:FlightPlanService,world:WorldRead,request:TransferRequest):Generator<TransferProgress,TransferResult> {
 const none=(reason:string):TransferResult=>({options:[],reason}),ship=world.ship(request.shipId);
 if(!ship||ship.state.status!=='flying')return none('Choose a flying ship in a bound orbit.');
 if(!world.hasBody(request.destinationId))return none('The destination body is unavailable.');
 const origin=world.body(ship.bodyId),destination=world.body(request.destinationId);
 const relationship=destination.parentId===origin.id?'child':origin.parentId===destination.id?'parent':origin.parentId&&origin.parentId===destination.parentId?'sibling':'other';
 if(relationship==='other')return none('Only direct parent/child and sibling bodies sharing a parent are supported. Deeper or unrelated systems need separate legs.');
 const common=relationship==='child'?origin:relationship==='parent'?destination:world.body(origin.parentId!);
 const context=world.contextFor(ship).cloneForPrediction(),orbits=context.services.orbits;
 let tested=0,accepted=0,total=0,lastReason='No sampled transfer converged safely. Try a different parking orbit or target altitude.';
 const progress=():TransferProgress=>({tested,total,accepted});
 try {
  if(ship.controls.engine)return none('Stop thrust before searching for a transfer.');
  if(!context.capabilities.analyticCoast||!context.capabilities.rails||world.requiresWorldPrediction||!world.predictionFeatures?.futureSeeds||!world.predictionFeatures.endTime||!plans.evaluateAsync)
   return none('Interbody planning needs compatible analytic motion, rails and progressive exact-end-time prediction.');
  if(!(context.vehicle.acceleration>0))return none('This vehicle has no engine thrust for a transfer.');
  const start=structuredClone(ship.state),orbit=orbits.elements(start,origin.mu),top=world.surface(origin.id)?.bounds.maxRadius??origin.radius;
  if(orbit.radial||!orbit.period||!orbit.apoapsis||orbit.periapsis<=top+.01)return none('Start in a bound, nonradial orbit that clears the highest terrain.');
  const rp=destination.radius+request.periapsisAltitude,ra=destination.radius+request.apoapsisAltitude,targetTop=world.surface(destination.id)?.bounds.maxRadius??destination.radius;
  if(!Number.isFinite(rp+ra)||rp<=targetTop+.01||ra<rp)return none('Target low/high altitudes must be finite, ordered and clear the highest terrain.');
  if(destination.parentId&&ra>=destination.soi.exitMetres)return none('The target apoapsis must remain inside the destination exit SOI.');
  const coast=context.keplerCoast(start,origin,world.surface(origin.id));if(!coast)return none('No safe analytic starting coast is available.');
  const localDirection=Math.sign(orbit.angularMomentum),commonDirection=destination.ephemeris.kind==='circular-kepler'?destination.ephemeris.direction??-1:localDirection;
  function relative(bodyId:string,time:number,velocity=false):Vec {
   const get=velocity?world.system.getBodyVelocity.bind(world.system):world.system.getBodyPosition.bind(world.system);
   return subtract(get(bodyId,time),get(common.id,time));
  }
  const sourceRadius=origin.id===common.id?(orbit.periapsis+orbit.apoapsis)/2:radius(relative(origin.id,start.time)),
   destinationRadius=destination.id===common.id?(rp+ra)/2:radius(relative(destination.id,start.time)),
   semimajor=(sourceRadius+destinationRadius)/2,baseTravel=Math.PI*Math.sqrt(semimajor*semimajor*semimajor/common.mu),
   omega1=Math.sqrt(common.mu/(sourceRadius*sourceRadius*sourceRadius)),omega2=Math.sqrt(common.mu/(destinationRadius*destinationRadius*destinationRadius)),
   synodic=2*Math.PI/Math.max(1e-12,Math.abs(omega1-omega2)),waitHorizon=Math.min(YEAR-baseTravel*.6,Math.max(2*orbit.period,2*synodic));
  if(!(baseTravel>0&&waitHorizon>=30&&Number.isFinite(baseTravel)))return none('This transfer lies beyond the one-year search limit.');
  const departures:number[]=[];
  for(let i=0;i<40;i++)departures.push(start.time+30+(waitHorizon-30)*i/39);
  const prepared=context.coastAt(coast,start.time+30,origin,world.surface(origin.id),{cache:false});
  if(prepared.ok)for(const apsis of [orbit.periapsis,orbit.apoapsis]){
   const dt=orbits.timeToRadius(prepared.state,origin.mu,apsis,'outbound',orbit);if(dt!==null&&dt>=0)departures.push(start.time+30+dt);
  }
  const factors=[.6,.85,1,1.25];total=departures.length*factors.length;
  const candidates:Omit<TransferOption,'kind'>[]=[];
  const trials:{before:State;endpoint:Vec;velocity:Vec;departure:number;travel:number;arrival:number;score:number}[]=[];
  function* probe(seed:State,until:number):Generator<TransferProgress,Probe|undefined> {
   const job=world.predictShip(ship!.id,false,{state:seed,bodyId:origin.id,until});let last:GhostSample|undefined,end:GhostEnd='open';
   try {
    for(let count=0;count<=16384;count++){
     const step=job.next();if(step.done){end=step.value;break;}last=step.value;if(count%8===0)yield progress();
    }
   }finally{job.return('open');}
   if(!last)return;
   if(end==='horizon'&&Math.abs(last.time-until)<=1e-7)return{sample:flightSampleInFrame({...last,frameId:last.frameId??origin.id,bodyId:last.bodyId??origin.id},common.id,world.system),safe:true,end};
   if(end==='impact'&&until>last.time){
    const id=last.bodyId??origin.id,local=flightSampleInFrame({...last,frameId:last.frameId??origin.id},id,world.system),solved=orbits.propagate(local,world.body(id).mu,until-last.time);
    if(solved.ok)return{sample:flightSampleInFrame({time:until,...solved.state,bodyId:id,frameId:id},common.id,world.system),safe:false,end};
   }
  }
  for(const departure of departures)for(const factor of factors){
   tested++;yield progress();
   const travel=baseTravel*factor,arrival=departure+travel;if(arrival>start.time+YEAR)continue;
   const at=context.coastAt(coast,departure,origin,world.surface(origin.id),{cache:false});if(!at.ok)continue;
   const before:State={...start,...at.state,time:departure,coast:undefined},r1=add(at.state.position,relative(origin.id,departure)),centre=relative(destination.id,arrival);
   let endpoint:Vec,seedVelocity:Vec;
   if(destination.id!==common.id){
    const initial=lambert(r1,centre,travel,common.mu,commonDirection);if(!initial)continue;
    const incoming=subtract(initial.arrival,relative(destination.id,arrival,true)),v=radius(incoming);if(!(v>0))continue;
    endpoint=add(centre,{x:rp*(-incoming.x*.6-incoming.y*.8)/v,y:rp*(-incoming.y*.6+incoming.x*.8)/v});
   }else{
    const angle=dm.atan2(r1.y,r1.x)+commonDirection*(Math.PI-.15);
    endpoint={x:rp*dm.cos(angle),y:rp*dm.sin(angle)};
   }
   const initial=lambert(r1,endpoint,travel,common.mu,commonDirection);if(!initial)continue;
   const relativeVelocity=subtract(initial.departure,relative(origin.id,departure,true));
   if(origin.id===common.id)seedVelocity=relativeVelocity;
   else{const escape=ejection(at.state.position,relativeVelocity,origin.mu,localDirection);if(!escape)continue;seedVelocity=escape;}
   const injection=orbits.elements({position:at.state.position,velocity:seedVelocity},origin.mu);
   if(at.state.position.x*seedVelocity.x+at.state.position.y*seedVelocity.y<0&&injection.periapsis<=top+.01)continue;
   const infinity=radius(subtract(initial.arrival,relative(destination.id,arrival,true))),
    capture=Math.abs(Math.sqrt(infinity*infinity+(destination.id===common.id?0:2*destination.mu/rp))-Math.sqrt(destination.mu*(2/rp-2/(rp+ra))));
   trials.push({before,endpoint,velocity:seedVelocity,departure,travel,arrival,score:radius(subtract(seedVelocity,at.state.velocity))+capture});
  }
  const selected=[...new Set([...trials.slice().sort((a,b)=>a.score-b.score||a.arrival-b.arrival).slice(0,16),...trials.slice().sort((a,b)=>a.arrival-b.arrival||a.score-b.score).slice(0,8)])];
  tested=0;total=selected.length;
  for(const trial of selected){
   tested++;yield progress();
   const {before,endpoint,departure,travel,arrival}=trial,at={state:before};
   let velocity=trial.velocity,best=yield* probe({...before,velocity},arrival);if(!best)continue;
   let error=subtract(best.sample.position,endpoint),norm=radius(error);
   for(let iteration=0;iteration<18&&norm>Math.max(.001,rp*1e-9);iteration++){
    yield progress();
    const h=Math.max(1e-5,radius(velocity)*1e-6,norm/travel*.001),
     x=yield* probe({...before,velocity:{x:velocity.x+h,y:velocity.y}},arrival),
     y=yield* probe({...before,velocity:{x:velocity.x,y:velocity.y+h}},arrival);
    if(!x||!y)break;
    const a=(x.sample.position.x-best.sample.position.x)/h,b=(y.sample.position.x-best.sample.position.x)/h,
     c=(x.sample.position.y-best.sample.position.y)/h,d=(y.sample.position.y-best.sample.position.y)/h,det=a*d-b*c;
    if(!Number.isFinite(det)||Math.abs(det)<1e-12)break;
    let delta={x:(-error.x*d+b*error.y)/det,y:(c*error.x-a*error.y)/det};
    const bound=Math.max(50,radius(velocity)*.5),size=radius(delta);if(size>bound)delta=scale(delta,bound/size);
    let improved=false;
    for(let retry=0;retry<4;retry++){
     const nextVelocity=add(velocity,scale(delta,1/(2**retry))),next=yield* probe({...before,velocity:nextVelocity},arrival);
     if(!next)continue;
     const residual=subtract(next.sample.position,endpoint),size=radius(residual);
     if(size<norm){velocity=nextVelocity;best=next;error=residual;norm=size;improved=true;break;}
    }
    if(!improved)break;
   }
   if(!best.safe||best.sample.bodyId!==destination.id||norm>Math.max(.001,rp*1e-9)){lastReason=`No safe convergence in this bounded search (last forecast: ${best.end}). Try a different orbit or target.`;continue;}
   const local=flightSampleInFrame(best.sample,destination.id,world.system),r=radius(local.position),
    insertionSpeed=Math.sqrt(destination.mu*(2/r-2/(rp+ra))),
    direction=Math.sign(local.position.x*local.velocity.y-local.position.y*local.velocity.x)||localDirection,
    desired={x:-local.position.y/r*direction*insertionSpeed,y:local.position.x/r*direction*insertionSpeed},
    departureComponents=deltaComponents(at.state.position,at.state.velocity,subtract(velocity,at.state.velocity)),
    arrivalComponents=deltaComponents(local.position,local.velocity,subtract(desired,local.velocity));
   if(!departureComponents||!arrivalComponents)continue;
   const plan=plans.capture(world,ship,[{id:'departure',label:`Departure · ${origin.name}`,bodyId:origin.id,time:departure,...departureComponents},
    {id:'arrival',label:`Arrival · ${destination.name}`,bodyId:destination.id,time:arrival,...arrivalComponents}]);
   const evaluation=plans.evaluateAsync!(plan,world);let evaluated:readonly import('@space-sim/game-api').EvaluatedFlightNode[]=[];
   try{for(let count=0;count<65536;count++){const step=evaluation.next();if(step.done){evaluated=step.value;break;}yield progress();}}finally{evaluation.return([]);}
   if(evaluated.length!==2||evaluated.some(n=>!n.valid)){lastReason=evaluated.find(n=>!n.valid)?.reason??'Plan evaluation exceeded its budget.';continue;}
   const after=evaluated[1]!.after!,final=orbits.elements(after,destination.mu);
   if(final.apoapsis===null||!final.period||Math.abs(final.periapsis-rp)>tolerance(rp)||Math.abs(final.apoapsis-ra)>tolerance(ra))continue;
   const stable=world.predictShip(ship.id,false,{state:after,bodyId:destination.id,until:after.time+final.period});let stableEnd:GhostEnd='open',safe=true;
   try{for(let i=0;i<=16384;i++){const step=stable.next();if(step.done){stableEnd=step.value;break;}if(step.value.encounter||step.value.bodyId&&step.value.bodyId!==destination.id){safe=false;break;}yield progress();}}finally{stable.return('open');}
   if(!safe||stableEnd!=='horizon'){lastReason='The target orbit cannot complete a safe revolution inside the destination SOI.';continue;}
   const departureDeltaV=radius(maneuverDelta(evaluated[0]!.before!,departureComponents.prograde,departureComponents.radial)),
    arrivalDeltaV=radius(maneuverDelta(evaluated[1]!.before!,arrivalComponents.prograde,arrivalComponents.radial)),
    departureBurnSeconds=departureDeltaV/context.vehicle.acceleration,arrivalBurnSeconds=arrivalDeltaV/context.vehicle.acceleration,
    dynamical=Math.min(travel,Math.sqrt(rp*rp*rp/destination.mu),Math.sqrt(radius(at.state.position)**3/origin.mu));
   candidates.push({plan,waitSeconds:departure-start.time,travelSeconds:travel,deltaV:departureDeltaV+arrivalDeltaV,departureDeltaV,arrivalDeltaV,departureBurnSeconds,arrivalBurnSeconds,
    warning:`${Math.max(departureBurnSeconds,arrivalBurnSeconds)>.1*dynamical?'Long finite burn: material arrival uncertainty. ':''}Impulsive patched-conic estimate. Review actual flight after departure and SOI changes; execute each burn separately.`});accepted++;
  }
  if(!candidates.length)return none(lastReason);
  candidates.sort((a,b)=>a.deltaV-b.deltaV||a.waitSeconds+a.travelSeconds-b.waitSeconds-b.travelSeconds);
  const efficient=candidates[0]!,faster=candidates.filter(c=>c.waitSeconds+c.travelSeconds<(efficient.waitSeconds+efficient.travelSeconds)*.98).sort((a,b)=>a.waitSeconds+a.travelSeconds-b.waitSeconds-b.travelSeconds||a.deltaV-b.deltaV)[0];
  return{options:[{...efficient,kind:'efficient'},...(faster?[{...faster,kind:'faster' as const}]:[])],reason:faster?'':'No meaningfully faster validated option in this bounded search.'};
 }catch(error){return none(error instanceof Error?error.message:'Interbody search failed.');}
 finally{context.dispose();}
}
