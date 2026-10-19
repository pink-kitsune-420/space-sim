import { expect, it, vi } from 'vitest';
import { FleetPlansRunner } from '../../modules/maneuver-editor/src/fleet';
import { createTransferPlanner } from '../../modules/transfer-planner/src/index';
import { createFlightPlans } from '../../modules/flight-plans/src/index';
import { ManeuverBurn } from '../../modules/maneuver-burn/src/index';
import { LocalSession } from '../../modules/session-flight/src/session';
import { flightSessionServices } from '../../packages/net/src/session-services';
import { DEFAULT_UNIVERSE, IDLE, STEP } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import type { FlightPlanNode, ManeuverPlannerOptions } from '../../packages/game-api/src/index';

function fixture() {
 const world=new World(DEFAULT_UNIVERSE),session=new LocalSession(flightSessionServices(),world,{name:'Pilot'});
 const ships=[session.spawn('planet-orbit',false)!,session.spawn('planet-orbit',false)!,session.spawn('planet-orbit',false)!];
 const intents=new Map<string,FlightPlanNode[]>(ships.slice(0,2).map(id=>[id,[{id:'departure',label:'Departure',bodyId:'planet',time:8,prograde:4,radial:0},{id:'arrival',label:'Arrival',bodyId:'planet',time:20,prograde:2,radial:0}]]));
 const completed=vi.fn((id:string,node:string)=>{intents.set(id,intents.get(id)!.map(value=>value.id===node?{...value,completed:true}:value));});
 const notify=vi.fn(),request=vi.fn(()=>{session.setWarp(1);return true;});
 let paused=false;
 const options:ManeuverPlannerOptions={container:null!,flight:()=>({world,ship:world.ship(ships[2]!),body:world.body('planet'),enabled:true,canWarp:true,paused,inputBlocked:false,warp:session.warp,requestedWarp:session.requestedWarp}),
  setWarp:factor=>session.setWarp(factor),setThrottle:(id,value)=>session.setThrottle(id,value),releaseControls:id=>session.host.setControls(session.playerId,id,IDLE),notify,
  fleet:{owns:id=>world.record(id)?.ownerId===session.playerId,setControls:(id,controls)=>session.host.setControls(session.playerId,id,controls),requestSlowWarp:request}};
 const runner=new FleetPlansRunner(options,createFlightPlans(),{create:(time,delta,vehicle)=>new ManeuverBurn(time,delta,vehicle,{stepSeconds:STEP,idle:IDLE})},{stepSeconds:STEP,idle:IDLE},{nodes:id=>intents.get(id)??[],reviewed:vi.fn(),completed});
 const tick=()=>{runner.beforeAdvance(IDLE);session.update(.01,ships[2],IDLE,undefined,()=>runner.step());};
 return {world,session,ships,intents,completed,runner,tick,options,notify,request,pause:()=>{paused=true;}};
}
it('flies two independent unselected ships through both finite burns on the same real clock',()=>{
 const f=fixture();
 try {
  expect(f.runner.active).toBe(false);
  for(const id of f.ships.slice(0,2))f.runner.arm(id!);
  for(let i=0;i<2200;i++)f.tick();
  expect(f.completed).toHaveBeenCalledTimes(4);expect(f.runner.active).toBe(false);
  for(const id of f.ships.slice(0,2)){expect(f.intents.get(id!)!.every(value=>value.completed)).toBe(true);expect(f.world.ship(id!)!.controls.engine).toBe(false);expect(f.world.ship(id!)!.state.throttle).toBe(0);}
  expect(f.world.time).toBeCloseTo(22,6);expect(f.session.requestedWarp).toBe(1);expect(f.request).not.toHaveBeenCalled();
 }finally{f.runner.dispose();f.session.dispose();}
});
it('waits for host permission without ignition or an unauthorized warp write',()=>{
 const f=fixture();let approved=false;
 try {
  f.request.mockImplementation(()=>approved);f.session.setWarp(100);f.runner.arm(f.ships[0]!);
  for(let i=0;i<20;i++)f.runner.beforeAdvance(IDLE);
  expect(f.request).toHaveBeenCalled();expect(f.session.requestedWarp).toBe(100);expect(f.world.tick).toBe(0);expect(f.world.ship(f.ships[0]!)!.controls.engine).toBe(false);expect(f.runner.status(f.ships[0]!)).toContain('host warp approval');
  approved=true;f.session.setWarp(1);
  for(let i=0;i<2200;i++)f.tick();expect(f.completed).toHaveBeenCalledTimes(2);
 }finally{f.runner.dispose();f.session.dispose();}
});
it('refuses foreign ships, cuts interrupted thrust, and never resumes an interrupted plan itself',()=>{
 const f=fixture();
 try {
  const foreign=f.world.spawn({ownerId:'other-pilot',presetId:'planet-orbit'});f.runner.arm(foreign.id);expect(f.runner.has(foreign.id)).toBe(false);
  f.runner.arm(f.ships[0]!);
  for(let i=0;i<1000&&!f.world.ship(f.ships[0]!)!.controls.engine;i++)f.tick();
  expect(f.world.ship(f.ships[0]!)!.controls.engine).toBe(true);f.pause();f.runner.beforeAdvance(IDLE);
  expect(f.runner.has(f.ships[0]!)).toBe(false);expect(f.world.ship(f.ships[0]!)!.controls.engine).toBe(false);expect(f.world.ship(f.ships[0]!)!.state.throttle).toBe(0);
  for(let i=0;i<20;i++)f.runner.beforeAdvance(IDLE);expect(f.runner.active).toBe(false);expect(f.completed).not.toHaveBeenCalled();
 }finally{f.runner.dispose();f.session.dispose();}
});
it('one-shot continuation stops after just the next pending burn',()=>{
 const f=fixture();
 try{f.runner.arm(f.ships[0]!,true);for(let i=0;i<1000;i++)f.tick();expect(f.completed).toHaveBeenCalledTimes(1);expect(f.runner.active).toBe(false);expect(f.intents.get(f.ships[0]!)![1]!.completed).not.toBe(true);}
 finally{f.runner.dispose();f.session.dispose();}
});
it('passes a zero-impulse review checkpoint crossed during a finite departure without trying to ignite it',()=>{
 const f=fixture(),id=f.ships[0]!;
 try {
  f.intents.set(id,[f.intents.get(id)![0]!,{id:'arrival',label:'Arrival · orbit review',bodyId:'planet',time:8.01,prograde:0,radial:0}]);
  f.runner.arm(id);for(let i=0;i<1000;i++)f.tick();
  expect(f.completed).toHaveBeenCalledTimes(2);expect(f.runner.active).toBe(false);expect(f.intents.get(id)!.every(node=>node.completed)).toBe(true);
  expect(f.world.ship(id)!.controls.engine).toBe(false);expect(f.notify.mock.calls.flat().join(' ')).not.toContain('stopped');
 }finally{f.runner.dispose();f.session.dispose();}
});

it('flies a generated moon departure and capture using actual SOI reviews',()=>{
 const f=fixture(),id=f.ships[0]!;
 try {
  const job=createTransferPlanner(createFlightPlans()).search(f.world,{shipId:id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100});
  let adopted=false;
  for(let i=0;i<1000000;i++){
   const step=job.next();
   if(step.done){if(step.value.options.length){f.intents.set(id,[...step.value.options[0]!.plan.nodes]);adopted=true;}break;}
   if(step.value.options?.length){f.intents.set(id,[...step.value.options[0]!.plan.nodes]);adopted=true;break;}
  }
  job.return({options:[],reason:'adopted'});expect(adopted).toBe(true);f.runner.arm(id);
  const until=f.intents.get(id)!.at(-1)!.time+1;
  for(let i=0;i<300000&&f.world.time<until&&f.runner.active;i++)f.tick();
  expect(f.completed.mock.calls,JSON.stringify({nodes:f.intents.get(id),time:f.world.time,body:f.world.ship(id)!.bodyId,notices:f.notify.mock.calls})).toHaveLength(2);
  const ship=f.world.ship(id)!,body=f.world.body('moon'),orbit=f.world.contextFor(ship).services.orbits.elements(ship.state,body.mu);
  expect(ship.bodyId).toBe('moon');expect(ship.controls.engine).toBe(false);expect(orbit.kind).toBe('elliptic');
  // This runner executes the prepared impulse intent; it does not retarget an
  // arrival after finite-burn deviations. Qualify a safe capture, not exact apses.
  expect(orbit.periapsis).toBeGreaterThan(f.world.surface(body.id)?.bounds.maxRadius??body.radius);
  expect(orbit.apoapsis).toBeLessThan(body.soi.exitMetres);
 }finally{f.runner.dispose();f.session.dispose();}
},60000);
it.each([1/60,.2,2])('keeps generated burns on time from a low orbit at 4× with %s-second rendering frames',frameSeconds=>{
 const f=fixture(),id=f.ships[0]!,body=f.world.body('planet'),r=body.radius+58.5;
 try {
  f.session.teleport(id,body.id,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});
  const search=createTransferPlanner(createFlightPlans()).search(f.world,{shipId:id,destinationId:body.id,periapsisAltitude:1536,apoapsisAltitude:1536});
  let adopted=false;
  for(let i=0;i<100000;i++){const step=search.next();if(step.done){if(step.value.options.length){f.intents.set(id,[...step.value.options[0]!.plan.nodes]);adopted=true;}break;}}
  expect(adopted).toBe(true);const times=f.intents.get(id)!.map(node=>node.time),firing:number[][]=[[],[]];
  const send=f.options.fleet!.setControls;
  f.options.fleet!.setControls=(ship,controls)=>{if(ship===id&&controls.engine)firing[Math.min(f.completed.mock.calls.length,1)]!.push(f.world.time);send(ship,controls);};
  f.runner.arm(id);f.session.setWarp(4);let resumedWarp=false;
  for(let i=0;i<30000&&f.runner.active;i++){
   f.runner.beforeAdvance(IDLE);f.session.update(frameSeconds,f.ships[2],IDLE,undefined,()=>f.runner.step());
   // The pilot chooses 4× again after departure; background execution never raises it.
   if(!resumedWarp&&f.completed.mock.calls.length===1&&f.session.requestedWarp===1&&!f.runner.burning){f.session.setWarp(4);resumedWarp=true;}
  }
  expect(f.completed).toHaveBeenCalledTimes(2);
  for(let index=0;index<2;index++)expect(Math.abs((firing[index]![0]!+firing[index]!.at(-1)!+STEP)/2-times[index]!)).toBeLessThanOrEqual(STEP);
  const ship=f.world.ship(id)!,orbit=f.world.contextFor(ship).services.orbits.elements(ship.state,body.mu);
  expect(Math.abs(orbit.periapsis-2048)).toBeLessThan(20);expect(Math.abs(orbit.apoapsis!-2048)).toBeLessThan(20);expect(ship.controls.engine).toBe(false);
 }finally{f.runner.dispose();f.session.dispose();}
});
