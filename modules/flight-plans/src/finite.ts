import {deterministicMath as dm,flightSampleInFrame,flightTimeTolerance,maneuverDelta,
 type FlightPlanNode,type FiniteBurnResult,type FiniteCaptureResult,type ManeuverBurnFactory,type Ship,type State,type Vec,type WorldRead} from '@space-sim/game-api';
const length=(v:Vec)=>dm.hypot(v.x,v.y);
const tolerance=(r:number)=>Math.max(.01,r*1e-7);
function components(p:Vec,v:Vec,d:Vec):{prograde:number;radial:number}|undefined {
 const r=length(p),s=length(v),det=(v.x*p.y-v.y*p.x)/(s*r);if(!(r>0&&s>0&&Math.abs(det)>1e-8))return;
 const prograde=(d.x*p.y/r-d.y*p.x/r)/det,radial=(v.x/s*d.y-v.y/s*d.x)/det;
 return Number.isFinite(prograde+radial)&&Math.max(Math.abs(prograde),Math.abs(radial))<=1e6?{prograde,radial}:undefined;
}
/** Detached execution of the selected finite-burn controller on the same 10ms grid.
 * SOI crossings while thrusting are rejected because live execution also stops there. */
export function* simulateBurn(world:WorldRead,ship:Ship,node:FlightPlanNode,burns:ManeuverBurnFactory):Generator<void,FiniteBurnResult> {
 const context=world.contextFor(ship).cloneForPrediction();
 try {
  if(ship.bodyId!==node.bodyId||ship.state.status!=='flying'||ship.controls.engine)return {reason:'A stable coast in the burn body is required.'};
  const body=world.body(node.bodyId),surface=world.surface(body.id),coast=context.keplerCoast(ship.state,body,surface);
  if(!coast||node.time<ship.state.time)return {reason:'No safe starting coast for this burn.'};
  const centre=context.coastAt(coast,node.time,body,surface,{cache:false});if(!centre.ok)return {reason:'The coast cannot reach this burn.'};
  const delta=maneuverDelta({time:node.time,...centre.state},node.prograde,node.radial),dv=length(delta);
  if(dv>=1e-8&&!(context.vehicle.acceleration>0&&context.vehicle.turnRate>0))return {reason:'This vehicle needs thrust and steering to execute the burn.'};
  const angle=dm.atan2(delta.y,delta.x),turn=dv<1e-8?0:Math.abs(dm.normalizeAngle(angle-ship.state.heading))/context.vehicle.turnRate,
   ignition=dv<1e-8?node.time:Math.floor((node.time-dv/context.vehicle.acceleration/2)/.01+1e-8)*.01;
  if(dv>=1e-8&&ignition<ship.state.time+turn+1)return {reason:'There is not enough time to align before the finite burn.'};
  let last:import('@space-sim/game-api').GhostSample|undefined,ready=false;
  const horizon=context.services.rails.horizon(world.system,body,ship.state,coast,ship.state.time,surface?.bounds.maxRadius??body.radius);
  if(horizon>=ignition-ship.state.time){
   const solved=context.coastAt(coast,ignition,body,surface,{cache:false});
   if(solved.ok){last={time:ignition,...solved.state,bodyId:body.id,frameId:body.id};ready=true;}
  }else{
  const forecast=world.predictShip(ship.id,false,{state:ship.state,bodyId:body.id,until:ignition});
  try {for(let i=0;i<16384;i++){
   const step=forecast.next();if(step.done){ready=step.value==='horizon'&&!!last&&Math.abs(last.time-ignition)<=flightTimeTolerance(ignition);break;}
   last=step.value;if(last.bodyId!==body.id)return {reason:'The ship changes SOI before this burn.'};yield;
  }}finally{forecast.return('open');}
  }
  if(!ready||!last)return {reason:'The checked coast cannot safely reach ignition within its work limit.'};
  const local=flightSampleInFrame(last,body.id,world.system);
  let state:State={...ship.state,time:ignition,position:local.position,velocity:local.velocity,coast:undefined,heading:dv<1e-8?ship.state.heading:angle};
  if(dv<1e-8)return {after:{...state,throttle:0},delta,reason:''};
  const burn=burns.create(node.time,delta,context.vehicle);
  try {for(let i=0;i<200000;i++){
   const command=burn.next(state);
   if(command.throttle!==undefined)state={...state,throttle:command.throttle};
   if(burn.phase==='complete')return {after:state,delta,reason:''};
   state=context.advance(state,command.controls,.01,body,surface);
   if(state.status!=='flying'||state.contact||state.water!==undefined||state.waterEntry)return {reason:'The finite burn contacts a surface.'};
   if(world.system.checkSOI(state,body.id,state.time).switched)return {reason:'The finite burn crosses an SOI while thrusting.'};
   yield;
  }}finally{burn.dispose();}
  return {reason:'The finite burn exceeds the bounded validation work limit.'};
 }catch(error){return {reason:error instanceof Error?error.message:'Finite burn validation failed.'};}
 finally{context.dispose();}
}
/** Refine burn vector and centre time against actual finite thrust. Eccentricity
 * vector and signed angular momentum remain well-defined for circular targets. */
export function* refineCapture(world:WorldRead,ship:Ship,node:FlightPlanNode,burns:ManeuverBurnFactory):Generator<void,FiniteCaptureResult> {
 const context=world.contextFor(ship).cloneForPrediction();
 try {
  const goal=node.targetOrbit;if(!goal)return {reason:'The arrival needs a target orbit.'};
  const body=world.body(node.bodyId),rp=body.radius+goal.periapsisAltitude,ra=body.radius+goal.apoapsisAltitude,
   top=world.surface(body.id)?.bounds.maxRadius??body.radius,R=(rp+ra)/2,mu=body.mu,vscale=Math.sqrt(mu/R);
  if(ship.bodyId!==body.id||!(rp>top+.01&&ra>=rp&&(!body.parentId||ra<body.soi.exitMetres)))return {reason:'The target orbit is outside the safe destination region.'};
  const coast=context.keplerCoast(ship.state,body,world.surface(body.id));if(!coast)return {reason:'No safe arrival coast.'};
  const at=context.coastAt(coast,node.time,body,world.surface(body.id),{cache:false});if(!at.ok)return {reason:'The proposed capture cannot be reached.'};
  const first=maneuverDelta({time:node.time,...at.state},node.prograde,node.radial),sign=Math.sign(at.state.position.x*at.state.velocity.y-at.state.position.y*at.state.velocity.x)||1,
   hGoal=sign*Math.sqrt(mu*2*rp*ra/(rp+ra)),e=(ra-rp)/(ra+rp),r=length(at.state.position),ex=e*at.state.position.x/r,ey=e*at.state.position.y/r;
  type Trial={node:FlightPlanNode;after:State;residual:number[];norm:number};
  function* probe(x:readonly number[]):Generator<void,Trial|undefined>{
   const centre=context.coastAt(coast!,x[2]!,body,world.surface(body.id),{cache:false});if(!centre.ok)return;
   const parts=components(centre.state.position,centre.state.velocity,{x:x[0]!,y:x[1]!});if(!parts)return;
   const intent={...node,time:x[2]!,...parts},result=yield* simulateBurn(world,ship,intent,burns),after=result.after;if(!after)return;
   const p=after.position,v=after.velocity,h=p.x*v.y-p.y*v.x,rr=length(p),
    residual=[(v.y*h/mu-p.x/rr-ex)*R,(-v.x*h/mu-p.y/rr-ey)*R,(h-hGoal)/vscale];
   return {node:intent,after,residual,norm:Math.hypot(...residual)};
  }
  let x=[first.x,first.y,node.time],best=yield* probe(x);
  for(let iteration=0;iteration<20&&best&&best.norm>tolerance(R)*.1;iteration++){
   const steps=[Math.max(1e-4,Math.abs(x[0]!)*1e-5),Math.max(1e-4,Math.abs(x[1]!)*1e-5),Math.max(.02,Math.sqrt(R**3/mu)*.001)],columns:number[][]=[];
   for(let j=0;j<3;j++){const perturbed=[...x];perturbed[j]=perturbed[j]!+steps[j]!;const trial=yield* probe(perturbed);if(!trial)break;columns.push(trial.residual.map((v,i)=>(v-best!.residual[i]!)/steps[j]!));}
   if(columns.length!==3)break;
   const a=best.residual.map((v,i)=>[columns[0]![i]!,columns[1]![i]!,columns[2]![i]!,-v]);let valid=true;
   for(let col=0;col<3;col++){
    let pivot=col;for(let row=col+1;row<3;row++)if(Math.abs(a[row]![col]!)>Math.abs(a[pivot]![col]!))pivot=row;
    [a[col],a[pivot]]=[a[pivot]!,a[col]!];const divisor=a[col]![col]!;if(!Number.isFinite(divisor)||Math.abs(divisor)<1e-12){valid=false;break;}
    for(let j=col;j<4;j++)a[col]![j]=a[col]![j]!/divisor;
    for(let row=0;row<3;row++)if(row!==col){const factor=a[row]![col]!;for(let j=col;j<4;j++)a[row]![j]=a[row]![j]!-factor*a[col]![j]!;}
   }
   if(!valid)break;let improved=false;
   for(let retry=0;retry<6;retry++){
    const next=x.map((value,j)=>value+a[j]![3]!/(2**retry)),trial=yield* probe(next);
    if(trial&&trial.norm<best.norm){x=next;best=trial;improved=true;break;}
   }
   if(!improved)break;
  }
  if(!best)return {reason:'No safe finite capture could be simulated.'};
  const orbit=context.services.orbits.elements(best.after,mu);
  if(!orbit.period||orbit.apoapsis===null||Math.abs(orbit.periapsis-rp)>tolerance(rp)||Math.abs(orbit.apoapsis-ra)>tolerance(ra))return {reason:`No finite capture converged to the requested orbit within the work limit.`};
  const forecast=world.predictShip(ship.id,false,{state:best.after,bodyId:body.id,until:best.after.time+orbit.period});let stable=false;
  try{for(let i=0;i<16384;i++){
   const step=forecast.next();if(step.done){stable=step.value==='horizon';break;}
   if(step.value.bodyId!==body.id)return {reason:'The final orbit leaves the destination SOI.'};yield;
  }}finally{forecast.return('open');}
  return stable?{node:best.node,after:best.after,reason:''}:{reason:'A full safe target revolution could not be verified.'};
 }catch(error){return {reason:error instanceof Error?error.message:'Finite capture refinement failed.'};}
 finally{context.dispose();}
}
