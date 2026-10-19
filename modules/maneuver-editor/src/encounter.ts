import {deterministicMath as dm,flightSampleInFrame,type FlightPlanNode,type GhostSample,type ManeuverBurnFactory,type State,type WorldRead} from '@space-sim/game-api';

export interface EncounterResult { readonly entry?: GhostSample; readonly reason: string }
const YEAR_SECONDS=365.25*86400;
/** Detached encounter search. An outdated burn time is a lookahead hint, never an
 * instruction to thrust, teleport, skip an SOI, or keep warping indefinitely. */
export function* findEncounter(world:WorldRead,shipId:string,bodyId:string,plannedTime:number):Generator<void,EncounterResult> {
 const ship=world.ship(shipId);
 if(!ship||!world.hasBody(bodyId))return {reason:'The ship or destination is unavailable.'};
 if(ship.state.status!=='flying'||ship.controls.engine)return {reason:'A stable unpowered coast is required to follow an encounter.'};
 if(!world.predictionFeatures?.futureSeeds||!world.predictionFeatures.endTime)return {reason:'This host cannot validate a timed encounter.'};
 if(!Number.isFinite(plannedTime))return {reason:'The planned arrival time is invalid.'};
 const remaining=Math.max(0,plannedTime-ship.state.time),until=ship.state.time+Math.min(YEAR_SECONDS,Math.max(3600,remaining*1.25+300));
 const trace=world.predictShip(shipId,false,{state:ship.state,bodyId:ship.bodyId,until});
 try{
  for(let count=0;count<16384;count++){
   const step=trace.next();
   if(step.done)return {reason:step.value==='horizon'||step.value==='closed'
    ?`No ${world.body(bodyId).name} encounter is predicted within the checked coast. Replan the transfer.`
    :`Encounter forecast ended (${step.value}). Review the flight before continuing.`};
   if(step.value.bodyId===bodyId&&step.value.encounter?.to===bodyId)return {entry:step.value,reason:''};
   yield;
  }
  return {reason:'Encounter forecast reached its work limit. Review the flight before continuing.'};
 }finally{trace.return('open');}
}

export interface ArrivalResult {readonly node?:FlightPlanNode;readonly reason:string}
/** Rebuild a single capture at a reachable radius of the original target conic.
 * Formulae only propose; shared coast, finite thrust and a full capture revolution
 * must all validate before this detached job returns executable intent. */
export function* prepareArrival(world:WorldRead,shipId:string,node:FlightPlanNode,burns:ManeuverBurnFactory):Generator<void,ArrivalResult>{
 const ship=world.ship(shipId),goal=node.targetOrbit;
 if(!ship||ship.bodyId!==node.bodyId)return {reason:'Wait for the verified destination encounter before reviewing capture.'};
 if(!goal)return {reason:'Encounter reached. This older node has no target orbit; choose an arrival orbit and replan before burning.'};
 const context=world.contextFor(ship).cloneForPrediction(),body=world.body(ship.bodyId),surface=world.surface(body.id),top=surface?.bounds.maxRadius??body.radius;
 try{
  const rp=body.radius+goal.periapsisAltitude,ra=body.radius+goal.apoapsisAltitude;
  if(!(rp>top+.01&&ra>=rp&&(!body.parentId||ra<body.soi.exitMetres)))return {reason:'The target orbit does not clear the terrain and destination SOI.'};
  const incoming=context.services.orbits.elements(ship.state,body.mu),atRadius=Math.max(rp,incoming.periapsis),slack=Math.max(.001,rp*1e-9);
  if(incoming.radial||atRadius>ra+slack||incoming.apoapsis!==null&&incoming.apoapsis<rp-slack)
   return {reason:'The actual approach cannot reach the chosen orbit with one arrival burn. A correction maneuver is needed.'};
  const radius=Math.min(ra,atRadius),coast=context.keplerCoast(ship.state,body,surface);
  if(!coast)return {reason:'The arrival needs ordinary surface or numerical flight. Review before burning.'};
  const semimajor=(rp+ra)/2,h=Math.sqrt(body.mu*2*rp*ra/(rp+ra)),direction=Math.sign(incoming.angularMomentum)||1;
  let lastReason='There is not enough time to align and execute a safe capture. Replan the arrival.';
  for(const branch of ['inbound','outbound'] as const){
   const dt=context.services.orbits.timeToRadius(ship.state,body.mu,radius,branch,incoming);
   if(dt===null||!Number.isFinite(dt)||dt<0)continue;
   const time=ship.state.time+dt,solved=context.coastAt(coast,time,body,surface,{cache:false});if(!solved.ok)continue;
   const p=solved.state.position,v=solved.state.velocity,r=dm.hypot(p.x,p.y),speed=dm.hypot(v.x,v.y),tangent=direction*h/r,
    radial=Math.sqrt(Math.max(0,body.mu*(2/r-1/semimajor)-tangent*tangent))*(branch==='inbound'?-1:1),
    desired={x:p.x/r*radial-p.y/r*tangent,y:p.y/r*radial+p.x/r*tangent},delta={x:desired.x-v.x,y:desired.y-v.y},magnitude=dm.hypot(delta.x,delta.y),
    angle=Math.abs(dm.normalizeAngle(dm.atan2(delta.y,delta.x)-ship.state.heading)),turn=angle<1e-7?0:context.vehicle.turnRate>0?angle/context.vehicle.turnRate:Infinity,
    half=magnitude/context.vehicle.acceleration/2,det=(v.x*p.y-v.y*p.x)/(speed*r);
   if(!(speed>0&&Math.abs(det)>1e-8&&Number.isFinite(half)&&dt>half+turn+1))continue;
   const prograde=(delta.x*p.y/r-delta.y*p.x/r)/det,radialDelta=(v.x/speed*delta.y-v.y/speed*delta.x)/det;
   if(!Number.isFinite(prograde+radialDelta)||Math.max(Math.abs(prograde),Math.abs(radialDelta))>1e6)continue;
   // Match the live controller's first 10-ms ignition tick, not a fractional
   // numerical step or an impulse at the middle of the finite burn.
   const ignition=Math.ceil((time-half-.005)/.01-1e-8)*.01,forecast=world.predictShip(shipId,false,{state:ship.state,bodyId:body.id,until:ignition});
   let last:GhostSample|undefined,ready=false;
   try{
    for(let i=0;i<16384;i++){
     const step=forecast.next();if(step.done){ready=step.value==='horizon'&&!!last&&Math.abs(last.time-ignition)<1e-7;break;}
     last=step.value;if(last.bodyId!==body.id)break;yield;
    }
   }finally{forecast.return('open');}
   if(!ready||!last){lastReason='The actual coast leaves the destination or contacts its surface before capture.';continue;}
   const local=flightSampleInFrame(last,body.id,world.system);
   let state:State={...ship.state,time:ignition,position:local.position,velocity:local.velocity,coast:undefined,heading:dm.atan2(delta.y,delta.x)};
   const burn=burns.create(time,delta,context.vehicle);let finished=false,safe=true;
   try{
    for(let i=0;i<20000;i++){
     const command=burn.next(state);if(burn.phase==='complete'){finished=true;break;}
     if(command.throttle!==undefined)state={...state,throttle:command.throttle};
     state=context.advance(state,command.controls,.01,body,surface);
     if(state.status!=='flying'||state.contact||state.water!==undefined||state.waterEntry||world.system.checkSOI(state,body.id,state.time).switched){safe=false;break;}yield;
    }
   }finally{burn.dispose();}
   if(!safe||!finished){lastReason='The finite capture cannot finish safely inside the destination. A correction maneuver is needed.';continue;}
   const captured=context.services.orbits.elements(state,body.mu);
   if(captured.period===null||captured.periapsis<=top+.01||captured.apoapsis===null||body.parentId&&captured.apoapsis>=body.soi.exitMetres){lastReason='The finite capture would hit terrain or leave the destination. Replan the arrival.';continue;}
   const revolution=world.predictShip(shipId,false,{state,bodyId:body.id,until:state.time+captured.period});let stable=false;
   try{
    for(let i=0;i<16384;i++){
     const step=revolution.next();if(step.done){stable=step.value==='horizon';break;}
     if(step.value.bodyId!==body.id)break;yield;
    }
   }finally{revolution.return('open');}
   if(!stable){lastReason='The updated capture cannot complete a verified orbit inside the destination.';continue;}
   return {node:{...node,time,prograde,radial:radialDelta,...(node.alarm?{alarm:{...node.alarm,notified:false}}:{})},reason:''};
  }
  return {reason:lastReason};
 }catch(error){return {reason:error instanceof Error?error.message:'Arrival review failed.'};}
 finally{context.dispose();}
}
