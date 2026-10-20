import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {World} from '../../packages/sim-core/src/world';
import {worldFacade} from '../../packages/sim-core/src/module-services';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createManeuverBurns} from '../../modules/maneuver-burn/src/index';
import {deltaComponents} from '../../modules/transfer-planner/src/math';
import type {FlightPlan,FlightPlanNode,ManeuverPlannerOptions,TransferProgress,TransferResult} from '../../packages/game-api/src/index';
const idle={engine:false,turn:0,throttle:0},clock={stepSeconds:.01 as const,idle};
const drain=<T>(job:Generator<unknown,T>):T=>{for(let i=0;i<20000000;i++){const step=job.next();if(step.done)return step.value;}throw Error('Test work limit');};
/** Route progress stays inside [0, 1] and never moves backwards across interleaved legs. */
const drainSearch=(job:Generator<TransferProgress,TransferResult>):TransferResult=>{let fraction=0;for(let i=0;i<20000000;i++){const step=job.next();if(step.done)return step.value;
 if(!(step.value.fraction!>=fraction&&step.value.fraction!<=1))throw Error(`Progress fraction ${step.value.fraction} after ${fraction}`);fraction=step.value.fraction!;}throw Error('Test work limit');};
it.each([{altitude:100,epoch:0},{altitude:512,epoch:0},{altitude:100,epoch:2*365.25*86400},{altitude:100,epoch:99*365.25*86400}])('refines finite capture at $altitude metres and epoch $epoch without changing flight',({altitude,epoch})=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'moon-orbit'}),body=world.body('moon'),plans=createFlightPlans(),burns=createManeuverBurns(clock);
 try {
  world.restoreClock(Math.round(epoch/.01),epoch);world.teleport(ship.id,body.id,{x:0,y:body.radius+2000},{x:2,y:-40});
  const actual=world.ship(ship.id)!,context=world.contextFor(actual),r=body.radius+altitude,coast=context.keplerCoast(actual.state,body),dt=context.services.orbits.timeToRadius(actual.state,body.mu,r,'inbound');
  expect(dt).not.toBeNull();const at=context.coastAt(coast!,actual.state.time+dt!,body),p=(at.ok?at.state:(()=>{throw Error("No coast");})()).position,v=at.ok?at.state.velocity:{x:0,y:0},speed=Math.sqrt(body.mu/r),sign=Math.sign(p.x*v.y-p.y*v.x),delta={x:-p.y/r*sign*speed-v.x,y:p.x/r*sign*speed-v.y},parts=deltaComponents(p,v,delta)!;
  const node:FlightPlanNode={id:'arrival',label:'Arrival',bodyId:body.id,time:actual.state.time+dt!,...parts,targetOrbit:{periapsisAltitude:altitude,apoapsisAltitude:altitude}},before=JSON.stringify(actual);
  const result=drain(plans.refineCapture!(world,actual,node,burns));expect(result.after,result.reason).toBeDefined();
  const orbit=context.services.orbits.elements(result.after!,body.mu);expect(Math.abs(orbit.periapsis-r)).toBeLessThan(.01);expect(Math.abs(orbit.apoapsis!-r)).toBeLessThan(.01);expect(JSON.stringify(world.ship(ship.id))).toBe(before);
  if(epoch)executeRoute(plans.capture(world,actual,[{...result.node!,finite:true}]));
 } finally {burns.dispose();world.dispose();}
});
it('round-trips a multi-year plan and reaches its explicit forecast horizon',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),plans=createFlightPlans(),year=365.25*86400;
 try {
  const body=world.body('star'),r=1e9;world.teleport(ship.id,body.id,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});const actual=world.ship(ship.id)!;
  const plan=plans.capture(world,actual,[{id:'later',label:'Later',bodyId:actual.bodyId,time:year*2,prograde:0,radial:0}]);expect(plan.nodes[0]!.time).toBe(year*2);
  // The plan's analytic same-body evaluator can skip whole safe parking revolutions.
  expect(plans.evaluate(plan,world)[0]!.valid).toBe(true);expect(plans.read({format:'space-sim-flight-plans/1',plans:[plan]}).plans[0]).toEqual(plan);
  const forecast=world.predictShip(ship.id,false,{state:actual.state,bodyId:body.id,until:year*2});let last=0,end='';
  for(let i=0;i<16384;i++){const step=forecast.next();if(step.done){end=step.value;break;}last=step.value.time;}forecast.return('open');expect(end).toBe('horizon');expect(last).toBe(year*2);
 }finally{world.dispose();}
});
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
it.each(['moon','nix'])('finds a finite validated complete transfer to %s',destinationId=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),burns=createManeuverBurns(clock),plans=createFlightPlans(burns),solver=createTransferPlanner(plans,burns),before=JSON.stringify(ship);
 try{
  const result=drainSearch(solver.search(worldFacade(world).read,{shipId:ship.id,destinationId,periapsisAltitude:100,apoapsisAltitude:100}));
  expect(result.options.length,result.reason).toBeGreaterThan(0);
  for(const option of result.options){
   expect(option.route?.finiteValidated).toBe(true);
   const evaluation=drain(plans.evaluateAsync!(option.plan,world));expect(evaluation.every(n=>n.valid),evaluation.map(n=>n.reason).join('; ')).toBe(true);
   const final=world.context.services.orbits.elements(evaluation.at(-1)!.after!,world.body(destinationId).mu);
   expect(Math.abs(final.periapsis-world.body(destinationId).radius-100)).toBeLessThan(.01);
   expect(Math.abs(final.apoapsis!-world.body(destinationId).radius-100)).toBeLessThan(.01);
  }
  expect(JSON.stringify(world.ship(ship.id))).toBe(before);
  if(destinationId==='nix'){executeRoute(result.options[0]!.plan);executeRoute(result.options[0]!.plan,true);}
 }finally{burns.dispose();world.dispose();}
},240000);

import {FleetPlansRunner} from '../../modules/maneuver-editor/src/fleet';
import {LocalSession} from '../../modules/session-flight/src/session';
import {flightSessionServices} from '../../packages/net/src/session-services';
import {clampWarpFactor} from '../../packages/sim-core/src/warp';
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

import {stopAltitudes} from '../../modules/transfer-planner/src/routes';
it('parks intermediate stops high beside the route moon and clear of every moon SOI',()=>{
 const world=new World(DEFAULT_UNIVERSE);
 try{
  // Just outside Parvus at Primus and Nix at Magnus, rather than deep in either well.
  const primus=stopAltitudes(world,['moon','planet','nix'],1,0);expect(primus).toHaveLength(1);expect(primus[0]).toBeCloseTo(15360*1.5-512,6);
  // Players may turn high parking off and keep the original low parking orbits.
  const low=stopAltitudes(world,['moon','planet','nix'],1,0,false);expect(low).toHaveLength(2);expect(Math.max(...low)).toBeLessThan(512);
  expect(stopAltitudes(world,['moon','planet','magnus','nix'],2,0)[0]).toBeCloseTo(12288*1.5-2048,6);
  const magnus=world.body('magnus'),r=stopAltitudes(world,['planet','magnus','nix'],1,0)[0]!+magnus.radius;
  for(const moon of world.system.getAllBodies().filter(b=>b.parentId==='magnus'))
   expect(Math.abs(r-Math.hypot(world.system.getBodyPosition(moon.id,0).x-world.system.getBodyPosition('magnus',0).x,world.system.getBodyPosition(moon.id,0).y-world.system.getBodyPosition('magnus',0).y))).toBeGreaterThan(moon.soi.exitMetres*1.5);
 }finally{world.dispose();}
 const nested=(radius:number,exit:number)=>{
  const universe=structuredClone(DEFAULT_UNIVERSE),system=universe.systems[0]!;
  const body={id:'nested',name:'Nested',parentId:'moon',radius:32,mu:4096,soi:{radius:exit,entryMetres:exit*.95,exitMetres:exit},ephemeris:{kind:'circular-kepler' as const,radius,phaseRadiansAtEpoch:1,direction:-1 as const}};
  const world=new World({...universe,systems:[{...system,bodies:[...system.bodies,body]},...universe.systems.slice(1)]});
  try{return stopAltitudes(world,['planet','moon','nested'],1,0);}finally{world.dispose();}
 };
 // Outside would leave Parvus's exit SOI, so park inside; with no clear high orbit, keep low parking.
 expect(nested(2000,200)[0]).toBeCloseTo(1200-128,6);
 const fallback=nested(2000,900);expect(fallback).toHaveLength(2);expect(Math.max(...fallback)).toBeLessThan(1200-128);
});

it.each([['moon','planet'],['nix','umbra'],['moon','nix'],['nix','moon'],['planet','velum']])('connects %s to %s without altering live flight', (from,to)=>{
 const world=new World(DEFAULT_UNIVERSE),spawn=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body(from),r=body.radius*1.4,burns=createManeuverBurns(clock),plans=createFlightPlans(burns);
 world.teleport(spawn.id,from,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});const ship=world.ship(spawn.id)!,before=JSON.stringify(ship),job=createTransferPlanner(plans,burns).search(world,{shipId:ship.id,destinationId:to,periapsisAltitude:100,apoapsisAltitude:100});
 try{
  const result=drain(job);expect(result.options.length,result.reason).toBeGreaterThan(0);
  for(const option of result.options){expect(option.plan.nodes.at(-1)!.bodyId).toBe(to);expect(option.route?.finiteValidated).toBe(true);expect(option.route?.burns!.reduce((total,b)=>total+b.deltaV,0)).toBeCloseTo(option.deltaV,8);}
  const saved=plans.read({format:'space-sim-flight-plans/1',plans:[result.options[0]!.plan]});expect(saved.plans[0]!.nodes.every(n=>n.finite)).toBe(true);expect(JSON.stringify(world.ship(ship.id))).toBe(before);
 }finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
},240000);
it('reaches a custom moon below another moon without assuming a fixed hierarchy depth',()=>{
 const universe=structuredClone(DEFAULT_UNIVERSE),system=universe.systems[0]!;
 const body={id:'nested',name:'Nested',parentId:'moon',radius:32,mu:4096,soi:{radius:200,entryMetres:190,exitMetres:200},ephemeris:{kind:'circular-kepler' as const,radius:1500,phaseRadiansAtEpoch:1,direction:-1 as const}};
 const world=new World({...universe,systems:[{...system,bodies:[...system.bodies,body]},...universe.systems.slice(1)]}),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),burns=createManeuverBurns(clock),plans=createFlightPlans(burns),job=createTransferPlanner(plans,burns).search(world,{shipId:ship.id,destinationId:'nested',periapsisAltitude:40,apoapsisAltitude:40});
 try{const result=drain(job);expect(result.options.length,result.reason).toBeGreaterThan(0);expect(result.options[0]!.plan.nodes.at(-1)!.bodyId).toBe('nested');}
 finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
},240000);

it('cancels an end-to-end search and releases its forecast without changing authority',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),burns=createManeuverBurns(clock),plans=createFlightPlans(burns),before=JSON.stringify(ship);let active=0;
 const source=Object.create(world) as World;source.predictShip=function*(...args:Parameters<World['predictShip']>){active++;try{return yield* world.predictShip(...args);}finally{active--;}};
 const job=createTransferPlanner(plans,burns).search(source,{shipId:ship.id,destinationId:'nix',periapsisAltitude:100,apoapsisAltitude:100});
 try{for(let i=0;i<10000&&!active;i++)job.next();expect(active).toBe(1);job.return({options:[],reason:'cancelled'});expect(active).toBe(0);expect(JSON.stringify(world.ship(ship.id))).toBe(before);}
 finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
});

it.each([{destination:'moon',altitude:100,epoch:71},{destination:'ignis',altitude:512,epoch:0}])('executes the first finite low-parking option to $destination at epoch $epoch',({destination,altitude,epoch})=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body('planet'),r=body.radius+40.2,burns=createManeuverBurns(clock),plans=createFlightPlans(burns);
 world.restoreClock(Math.round(epoch/.01),epoch);world.teleport(ship.id,body.id,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});
 const job=createTransferPlanner(plans,burns).search(world,{shipId:ship.id,destinationId:destination,periapsisAltitude:altitude,apoapsisAltitude:altitude});
 try{
  let option:import('../../packages/game-api/src/index').TransferOption|undefined;
  for(let work=0;work<20000000;work++){const step=job.next();if(step.value.options?.length){option=step.value.options[0];break;}if(step.done)throw Error(step.value.reason);}
  expect(option).toBeDefined();job.return({options:[],reason:'adopted'});
  const actual=executeRoute(option!.plan);mkdirSync('private-docs/measurements/end-to-end-transfers',{recursive:true});writeFileSync(`private-docs/measurements/end-to-end-transfers/${destination}-low-parking.json`,JSON.stringify({plan:option!.plan,actual},null,2));
 }finally{job.return({options:[],reason:'cancelled'});burns.dispose();world.dispose();}
},240000);
