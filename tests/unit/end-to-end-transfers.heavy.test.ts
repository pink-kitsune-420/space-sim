import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {World} from '../../packages/sim-core/src/world';
import {worldFacade} from '../../packages/sim-core/src/module-services';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createManeuverBurns} from '../../modules/maneuver-burn/src/index';
import {deltaComponents} from '../../modules/transfer-planner/src/math';
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
import {FleetPlansRunner} from '../../modules/maneuver-editor/src/fleet';
import {LocalSession} from '../../modules/session-flight/src/session';
import {flightSessionServices} from '../../packages/net/src/session-services';
import {clampWarpFactor} from '../../packages/sim-core/src/warp';
import type {FlightPlan,FlightPlanNode,ManeuverPlannerOptions,TransferProgress,TransferResult} from '../../packages/game-api/src/index';

const idle={engine:false,turn:0,throttle:0},clock={stepSeconds:.01 as const,idle};
const drain=<T>(job:Generator<unknown,T>):T=>{for(let i=0;i<20000000;i++){const step=job.next();if(step.done)return step.value;}throw Error('Test work limit');};
const drainSearch=(job:Generator<TransferProgress,TransferResult>):TransferResult=>{let fraction=0;for(let i=0;i<20000000;i++){const step=job.next();if(step.done)return step.value;
 if(!(step.value.fraction!>=fraction&&step.value.fraction!<=1))throw Error(`Progress fraction ${step.value.fraction} after ${fraction}`);fraction=step.value.fraction!;}throw Error('Test work limit');};

function executeRoute(plan:FlightPlan,once=false) {
 const world=new World(DEFAULT_UNIVERSE),session=new LocalSession(flightSessionServices(),world,{name:'Pilot'}),id=session.spawn('planet-orbit',true)!,burns=createManeuverBurns(clock),plans=createFlightPlans(burns);
 world.restoreClock(Math.round(plan.epoch.time/.01),plan.epoch.time);session.teleport(id,plan.bodyId,plan.epoch.position,plan.epoch.velocity,plan.epoch.heading);
 let nodes=[...plan.nodes];const notices:string[]=[],visited=new Set<string>();
 const options:ManeuverPlannerOptions={container:null!,flight:()=>({world,ship:world.ship(id),body:world.body(world.ship(id)!.bodyId),enabled:true,canWarp:true,paused:false,inputBlocked:false,warp:session.warp,requestedWarp:session.requestedWarp}),
 setWarp:factor=>session.setWarp(factor),setThrottle:(ship,value)=>session.setThrottle(ship,value),releaseControls:ship=>session.host.setControls(session.playerId,ship,idle),notify:text=>notices.push(text),
 fleet:{owns:ship=>ship===id,setControls:(ship,controls)=>session.host.setControls(session.playerId,ship,controls),requestSlowWarp:()=>{session.setWarp(1);return true;},authorizeWarp:()=>true}};
 const runner=new FleetPlansRunner(options,plans,burns,clock,{nodes:()=>nodes,reviewed:()=>{},completed:(_ship,node)=>{nodes=nodes.map(n=>n.id===node?{...n,completed:true}:n);},retargeted:(_ship,node)=>{nodes=nodes.map(n=>n.id===node.id?node:n);},proposed:(_ship,correction,arrival)=>{nodes=nodes.flatMap(n=>n.id===arrival.id?[correction,arrival]:[n]);}},clampWarpFactor);
 try{
  runner.arm(id,once,true);let completedAtArm=0;
  for(let frame=0;frame<200000&&nodes.some(n=>!n.completed);frame++){
   if(!runner.active){
    const completed=nodes.filter(n=>n.completed).length;
    expect(once&&completed===completedAtArm+1,JSON.stringify(notices)).toBe(true);
    completedAtArm=completed;runner.arm(id,true,true);
   }
   runner.beforeAdvance(idle);runner.advanceReviews();
   session.update(.2,id,idle,undefined,()=>runner.step());visited.add(world.ship(id)!.bodyId);
  }
  expect(nodes.every(n=>n.completed),JSON.stringify({nodes,notices,time:world.time,body:world.ship(id)!.bodyId,status:runner.status(id)})).toBe(true);
  const body=world.body(plan.nodes.at(-1)!.bodyId),ship=world.ship(id)!,orbit=world.contextFor(ship).services.orbits.elements(ship.state,body.mu),goal=plan.nodes.at(-1)!.targetOrbit!;
  expect(ship.bodyId).toBe(body.id);if(body.id==='nix')expect(visited.has('star')).toBe(true);expect(ship.controls.engine).toBe(false);
  expect(Math.abs(orbit.periapsis-body.radius-goal.periapsisAltitude)).toBeLessThan(.1);
  expect(Math.abs(orbit.apoapsis!-body.radius-goal.apoapsisAltitude)).toBeLessThan(.1);
  return {body:body.id,periapsis:orbit.periapsis,apoapsis:orbit.apoapsis,nodes,notices,visited:[...visited],time:world.time};
 }finally{runner.dispose();burns.dispose();session.dispose();}
}

it.each([{altitude:100,epoch:2*365.25*86400},{altitude:100,epoch:99*365.25*86400}])('live execution: refines finite capture at $altitude metres and epoch $epoch',({altitude,epoch})=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'moon-orbit'}),body=world.body('moon'),plans=createFlightPlans(),burns=createManeuverBurns(clock);
 try {
  world.restoreClock(Math.round(epoch/.01),epoch);world.teleport(ship.id,body.id,{x:0,y:body.radius+2000},{x:2,y:-40});
  const actual=world.ship(ship.id)!,context=world.contextFor(actual),r=body.radius+altitude,coast=context.keplerCoast(actual.state,body),dt=context.services.orbits.timeToRadius(actual.state,body.mu,r,'inbound');
  expect(dt).not.toBeNull();const at=context.coastAt(coast!,actual.state.time+dt!,body),p=(at.ok?at.state:(()=>{throw Error("No coast");})()).position,v=at.ok?at.state.velocity:{x:0,y:0},speed=Math.sqrt(body.mu/r),sign=Math.sign(p.x*v.y-p.y*v.x),delta={x:-p.y/r*sign*speed-v.x,y:p.x/r*sign*speed-v.y},parts=deltaComponents(p,v,delta)!;
  const node:FlightPlanNode={id:'arrival',label:'Arrival',bodyId:body.id,time:actual.state.time+dt!,...parts,targetOrbit:{periapsisAltitude:altitude,apoapsisAltitude:altitude}},before=JSON.stringify(actual);
  const result=drain(plans.refineCapture!(world,actual,node,burns));expect(result.after,result.reason).toBeDefined();
  const orbit=context.services.orbits.elements(result.after!,body.mu);expect(Math.abs(orbit.periapsis-r)).toBeLessThan(.01);expect(Math.abs(orbit.apoapsis!-r)).toBeLessThan(.01);expect(JSON.stringify(world.ship(ship.id))).toBe(before);
  executeRoute(plans.capture(world,actual,[{...result.node!,finite:true}]));
 } finally {burns.dispose();world.dispose();}
},240000);

it('live execution: executes complete transfer to nix with full and single-node arming',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),burns=createManeuverBurns(clock),plans=createFlightPlans(burns),solver=createTransferPlanner(plans,burns);
 try{
  const result=drainSearch(solver.search(worldFacade(world).read,{shipId:ship.id,destinationId:'nix',periapsisAltitude:100,apoapsisAltitude:100}));
  expect(result.options.length,result.reason).toBeGreaterThan(0);
  executeRoute(result.options[0]!.plan);
  executeRoute(result.options[0]!.plan,true);
 }finally{burns.dispose();world.dispose();}
},240000);

it.each([['moon','nix'],['nix','moon']])('deep multi-body search: connects %s to %s without altering live flight', (from,to)=>{
 const world=new World(DEFAULT_UNIVERSE),spawn=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body(from),r=body.radius*1.4,burns=createManeuverBurns(clock),plans=createFlightPlans(burns);
 world.teleport(spawn.id,from,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});const ship=world.ship(spawn.id)!,before=JSON.stringify(ship),job=createTransferPlanner(plans,burns).search(world,{shipId:ship.id,destinationId:to,periapsisAltitude:100,apoapsisAltitude:100});
 try{
  const result=drain(job);expect(result.options.length,result.reason).toBeGreaterThan(0);
  for(const option of result.options){expect(option.plan.nodes.at(-1)!.bodyId).toBe(to);expect(option.route?.finiteValidated).toBe(true);expect(option.route?.burns!.reduce((total,b)=>total+b.deltaV,0)).toBeCloseTo(option.deltaV,8);}
  const saved=plans.read({format:'space-sim-flight-plans/1',plans:[result.options[0]!.plan]});expect(saved.plans[0]!.nodes.every(n=>n.finite)).toBe(true);expect(JSON.stringify(world.ship(ship.id))).toBe(before);
 }finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
},240000);

it('live execution: executes the first finite low-parking option to ignis at epoch 0',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body('planet'),r=body.radius+40.2,burns=createManeuverBurns(clock),plans=createFlightPlans(burns);
 world.teleport(ship.id,body.id,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});
 const job=createTransferPlanner(plans,burns).search(world,{shipId:ship.id,destinationId:'ignis',periapsisAltitude:512,apoapsisAltitude:512});
 try{
  let option:import('../../packages/game-api/src/index').TransferOption|undefined;
  for(let work=0;work<20000000;work++){const step=job.next();if(step.value.options?.length){option=step.value.options[0];break;}if(step.done)throw Error(step.value.reason);}
  expect(option).toBeDefined();job.return({options:[],reason:'adopted'});
  const actual=executeRoute(option!.plan);mkdirSync('private-docs/measurements/end-to-end-transfers',{recursive:true});writeFileSync('private-docs/measurements/end-to-end-transfers/ignis-low-parking.json',JSON.stringify({plan:option!.plan,actual},null,2));
 }finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
},240000);
