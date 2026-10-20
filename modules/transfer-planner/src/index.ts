import { MAX_FLIGHT_PLAN_SECONDS, FLIGHT_PLANS, TRANSFERS, maneuverDelta,
 type ManeuverBurnFactory, type FlightPlanNode, type FlightPlanService, type ModuleInitializationV2, type State, type TransferOption,
 type TransferPlanner, type TransferResult } from '@space-sim/game-api';

const MAX_SECONDS=365.25*86400;
const FACTORS=[1,1.25,1.6,2,4,8,.9,.75,.5,.25] as const;
import {burnsFit,deltaComponents,radius,tolerance,transferOptions} from './math';
export {deltaComponents} from './math';
import {searchInterbody} from './interbody';
import {searchRoutes} from './routes';
const unsupported=(reason:string):TransferResult=>({options:[],reason});
export function createTransferPlanner(plans:FlightPlanService,burns?:ManeuverBurnFactory):TransferPlanner {
 if(burns){
  const qualified=plans.withBurns?.(burns);
  if(qualified?.simulateBurn&&qualified.refineCapture&&qualified.evaluateAsync)plans=qualified;else burns=undefined;
 }
 return Object.freeze<TransferPlanner>({withBurns:controller=>createTransferPlanner(plans,controller),maxFlightSeconds:burns?MAX_FLIGHT_PLAN_SECONDS:undefined,defaultFlightSeconds:burns?50*365.25*86400:undefined,relationships:Object.freeze(burns?['same-body','child','parent','sibling','other'] as const:['same-body','child','parent','sibling'] as const),*search(world,request){
  const ship=world.ship(request.shipId);
  if(!ship||ship.state.status!=='flying')return unsupported('Choose a flying ship in a bound orbit.');
  if(request.destinationId!==ship.bodyId)return yield* (burns?searchRoutes(plans,world,request,burns):searchInterbody(plans,world,request));
  const maxSeconds=request.maxFlightSeconds??(burns?50*MAX_SECONDS:MAX_SECONDS);
  if(!(Number.isFinite(maxSeconds)&&maxSeconds>30&&maxSeconds<=MAX_FLIGHT_PLAN_SECONDS))return unsupported('Choose a mission duration between 30 seconds and 100 Julian years.');
  if(ship.controls.engine)return unsupported('Stop thrust before searching for a transfer.');
  const context=world.contextFor(ship).cloneForPrediction(),body=world.body(ship.bodyId),surface=world.surface(body.id),orbits=context.services.orbits;
  try {
   if(!context.capabilities.analyticCoast||!context.capabilities.rails||world.requiresWorldPrediction||!world.predictionFeatures?.futureSeeds)
    return unsupported('Transfer search needs compatible analytic motion, SOI horizons and detached future prediction seeds.');
   if(!(context.vehicle.acceleration>0))return unsupported('This vehicle has no engine thrust for a transfer. Coast nodes remain available.');
   const start=structuredClone(ship.state),orbit=orbits.elements(start,body.mu),top=surface?.bounds.maxRadius??body.radius;
   if(orbit.radial||!orbit.period||!orbit.apoapsis||orbit.periapsis<=top+.01)return unsupported('Start in a bound, nonradial orbit that clears the highest terrain.');
   const rp=body.radius+request.periapsisAltitude,ra=body.radius+request.apoapsisAltitude;
   if(!Number.isFinite(rp+ra)||!(rp>top+.01)||ra<rp)return unsupported('Target low/high altitudes must be finite, ordered and clear the highest terrain.');
   if(body.parentId&&ra>=body.soi.exitMetres)return unsupported('The target apoapsis must remain inside this body’s exit SOI.');
   if(Math.abs(orbit.periapsis-rp)<=tolerance(rp)&&Math.abs(orbit.apoapsis-ra)<=tolerance(ra))return unsupported('The current orbit already matches those target altitudes.');
   const coast=context.keplerCoast(start,body,surface);if(!coast)return unsupported('No safe analytic starting coast is available.');
   const prepared=context.coastAt(coast,start.time+30,body,surface,{cache:false});if(!prepared.ok)return unsupported('The preparation window is outside the safe coast.');
   const departures:number[]=[];
   if(orbit.eccentricity<1e-8)departures.push(start.time+30);
   else for(const at of [orbit.periapsis,orbit.apoapsis]) {
    const dt=orbits.timeToRadius(prepared.state,body.mu,at,'outbound',orbit);
    if(dt!==null&&Number.isFinite(dt))departures.push(start.time+30+dt);
   }
   if(!departures.length)return unsupported('No starting apsis could be located in the search window.');
   const targets=rp===ra?[rp]:[rp,ra],total=departures.length*targets.length*FACTORS.length,candidates:Omit<TransferOption,'kind'>[]=[];
   let tested=0,accepted=0,lastReason='No sampled coast satisfied the target and contact checks.';
   for(const departure of departures)for(const target of targets)for(const factor of FACTORS) {
    tested++;yield{tested,total,accepted};
    const at=context.coastAt(coast,departure,body,surface,{cache:false});if(!at.ok)continue;
    const r1=radius(at.state.position),direction=orbit.angularMomentum>0?1:-1;
    const direct=Math.abs(r1-target)<=tolerance(target);
    // At an apsis, a tangential injection picks the opposite apsis of the transfer.
    if(direct&&factor!==1)continue;
    const other=direct?(target===rp?ra:rp):target*factor;
    if(!(other>0)||(!direct&&(r1<target?other<target:other>target)))continue;
    const speed=Math.sqrt(body.mu*(2/r1-2/(r1+other)));
    if(!Number.isFinite(speed))continue;
    const desired={x:-at.state.position.y/r1*direction*speed,y:at.state.position.x/r1*direction*speed};
    const departureComponents=deltaComponents(at.state.position,at.state.velocity,{x:desired.x-at.state.velocity.x,y:desired.y-at.state.velocity.y});if(!departureComponents)continue;
    const transfer:State={...start,...at.state,time:departure,velocity:desired,coast:undefined,revision:start.revision+1};
    let travel:number|null;
    if(direct)travel=Math.abs(rp-ra)<=tolerance(ra)? .01 : Math.PI*Math.sqrt(((rp+ra)/2)**3/body.mu);
    else if(factor===1)travel=Math.PI*Math.sqrt(((r1+target)/2)**3/body.mu);
    else travel=orbits.timeToRadius(transfer,body.mu,target,r1<target?'outbound':'inbound');
    if(!(travel!==null&&travel>0&&Number.isFinite(travel))||departure+travel>start.time+maxSeconds)continue;
    const solved=orbits.propagate(transfer,body.mu,travel);if(!solved.ok)continue;
    const r2=radius(solved.state.position),expected=direct&&Math.abs(rp-ra)>tolerance(ra)?other:target;
    if(Math.abs(r2-expected)>tolerance(expected))continue;
    const arrivalSpeed=Math.sqrt(body.mu*(2/r2-2/(rp+ra)));
    const targetVelocity={x:-solved.state.position.y/r2*direction*arrivalSpeed,y:solved.state.position.x/r2*direction*arrivalSpeed};
    const arrivalComponents=deltaComponents(solved.state.position,solved.state.velocity,{x:targetVelocity.x-solved.state.velocity.x,y:targetVelocity.y-solved.state.velocity.y});if(!arrivalComponents)continue;
    const intents:FlightPlanNode[]=[{id:'departure',label:'Departure',bodyId:body.id,time:departure,...departureComponents},
     {id:'arrival',label:direct?'Arrival · orbit review':'Arrival',bodyId:body.id,time:departure+travel,...arrivalComponents,
       targetOrbit:{periapsisAltitude:request.periapsisAltitude,apoapsisAltitude:request.apoapsisAltitude}}];
    const plan=plans.capture(world,ship,intents),evaluated=plans.evaluate(plan,world);
    if(evaluated.some(node=>!node.valid)){lastReason=evaluated.find(node=>!node.valid)?.reason??lastReason;continue;}
    const arrival=evaluated[1]!.after!,final=orbits.elements(arrival,body.mu);
    if(final.apoapsis===null||Math.abs(final.periapsis-rp)>tolerance(rp)||Math.abs(final.apoapsis-ra)>tolerance(ra))continue;
    // Validate the actual selected world predictor through arrival, preserving terrain
    // and SOI checks. No candidate is accepted from formulas alone.
    if(travel>MAX_SECONDS&&!world.predictionFeatures.endTime)return unsupported('Multi-year orbit changes need exact-end-time prediction support.');
    const forecast=world.predictShip(ship.id,false,{state:evaluated[0]!.after!,bodyId:body.id,...(world.predictionFeatures.endTime?{until:arrival.time}:{})});let reached=false;
    try {
     for(let count=0;count<16384;count++) {
      const step=forecast.next();if(step.done){lastReason=`Prediction ended before arrival (${step.value}).`;break;}
      if(step.value.bodyId&&step.value.bodyId!==body.id){lastReason='This candidate encounters another SOI; interbody solving remains open.';break;}
      if(step.value.time>=arrival.time-1e-7){reached=true;break;}
      yield{tested,total,accepted};
     }
    }finally{forecast.return('open');}
    if(!reached)continue;
    const firstDelta=maneuverDelta(evaluated[0]!.before!,departureComponents.prograde,departureComponents.radial);
    const secondDelta=maneuverDelta(evaluated[1]!.before!,arrivalComponents.prograde,arrivalComponents.radial);
    const departureDeltaV=radius(firstDelta),arrivalDeltaV=radius(secondDelta),departureBurnSeconds=departureDeltaV/context.vehicle.acceleration,arrivalBurnSeconds=arrivalDeltaV/context.vehicle.acceleration;
    if(!burnsFit(travel,firstDelta,secondDelta,context.vehicle.acceleration,context.vehicle.turnRate)){lastReason='No sampled transfer leaves enough time between finite burns to turn and prepare the arrival. Try a stronger engine or a different target.';continue;}
    const scale=Math.min(travel,Math.sqrt(r2*r2*r2/body.mu));
    const warning=Math.max(departureBurnSeconds,arrivalBurnSeconds)>.1*scale
     ?'Long finite burn: the impulsive arrival estimate may differ materially. Review after departure.'
     :'Impulsive estimate. Finite burns change arrival; review the remaining plan after departure.';
    candidates.push({plan,waitSeconds:departure-start.time,travelSeconds:travel,deltaV:departureDeltaV+arrivalDeltaV,departureDeltaV,arrivalDeltaV,departureBurnSeconds,arrivalBurnSeconds,warning});accepted++;
   }
   if(!candidates.length)return unsupported(lastReason);
   const options=transferOptions(candidates,world.time);
   return{options,reason:!options.length?'The validated departure windows passed while searching. Pause flight and search again.':options.length>1?'':'No faster option saves at least 10% of wait plus travel within twice the efficient plan’s delta-v.'};
  }catch(error){return unsupported(error instanceof Error?error.message:'Transfer search failed.');}
  finally{context.dispose();}
 }});
}
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'flight',audience:'players',title:'Transfer window planning',summary:'Compare and review circular or elliptical orbit changes and moon/planet transfers.',asset:'docs/players/flight.json'});
 context.provide(TRANSFERS,createTransferPlanner(context.use(FLIGHT_PLANS)));
 context.contributeGuide({id:'usage',audience:'creators',title:'Bounded orbital transfer search',summary:'Editable bounded same-body and interbody transfers over selected moving-frame prediction contracts.',asset:'docs/creators/usage.json'});
}
