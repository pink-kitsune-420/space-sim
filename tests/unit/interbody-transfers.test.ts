import {expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import solarSystem from '../../games/space-sim/universes/astronomy/solar-system/universe.json';
import {saveWorld,loadWorld} from '../../packages/sim-core/src/save';
import type {FlightPlan,TransferRequest,TransferProgress,UniverseDefinition} from '../../packages/game-api/src/index';
const plans=createFlightPlans(),solver=createTransferPlanner(plans),measurements:unknown[]=[];
function evaluate(plan:FlightPlan,world:World){const job=plans.evaluateAsync!(plan,world);for(let i=0;i<100000;i++){const step=job.next();if(step.done)return step.value;}throw Error('Evaluation budget');}
function search(world:World,request:TransferRequest){
 const job=solver.search(world,request);let count=0,last:TransferProgress|undefined,maxNext=0;const start=performance.now();
 for(;;){const at=performance.now(),step=job.next();maxNext=Math.max(maxNext,performance.now()-at);if(step.done){measurements.push({request,result:step.value,yields:count,progress:last,ms:performance.now()-start,maxNext});mkdirSync('private-docs/measurements/flight-planning-0.6.4',{recursive:true});writeFileSync('private-docs/measurements/flight-planning-0.6.4/interbody-search.json',JSON.stringify(measurements,null,2));return step.value;}last=step.value;if(++count>10000000)throw Error('Search budget');}
}
it.each([
 ['planet','moon',1,100,100],['planet','moon',-1.1,90,190],['planet','moon',1.15,70,180],['moon','planet',1,300,1000],['planet','velum',1,150,150],['planet','magnus',1.15,300,700],['nix','umbra',1,100,250],
])('validates %s to %s from speed scale %s to target low/high %s/%s',(from,to,speed,low,high)=>{
 const world=new World(DEFAULT_UNIVERSE),seed=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body(from),r=body.radius*1.4;
 world.teleport(seed.id,from,{x:0,y:r},{x:Math.sqrt(body.mu/r)*speed,y:0});const current=world.ship(seed.id)!;
 const before=JSON.stringify(saveWorld(world)),result=search(world,{shipId:current.id,destinationId:to,periapsisAltitude:low,apoapsisAltitude:high});
 expect(result.options.length,result.reason).toBeGreaterThan(0);
 for(const option of result.options){const evaluated=evaluate(option.plan,world);expect(evaluated.map(n=>n.valid)).toEqual([true,true]);
  const final=world.context.services.orbits.elements(evaluated[1]!.after!,world.body(to).mu);
  expect(Math.abs(final.periapsis-world.body(to).radius-low)).toBeLessThan(.01);expect(Math.abs(final.apoapsis!-world.body(to).radius-high)).toBeLessThan(.01);
  expect(option.deltaV).toBeCloseTo(option.departureDeltaV+option.arrivalDeltaV,10);expect(option.warning).toContain('Review actual flight');
 }
 if(result.options.length===2){const [a,b]=result.options;expect(b!.waitSeconds+b!.travelSeconds).toBeLessThan((a!.waitSeconds+a!.travelSeconds)*.98);}
 if(from==='planet'&&to==='moon'&&speed===1){
  const option=result.options[0]!,evaluated=evaluate(option.plan,world),departure=evaluated[0]!.after!,incoming=evaluated[1]!.before!,
   archive={format:'space-sim-flight-plans/1' as const,plans:[option.plan]},saved=saveWorld(world,{flightPlans:archive}),loaded=loadWorld(JSON.parse(JSON.stringify(saved)));
  expect(evaluate(plans.read(saved.flightPlans).plans[0]!,loaded.world)[1]!.after).toEqual(evaluated[1]!.after);loaded.world.dispose();
  const live=new World(DEFAULT_UNIVERSE),craft=live.spawn({ownerId:'pilot',presetId:'planet-orbit'});
  live.restoreClock(Math.round(departure.time/.01),departure.time);live.put({...craft,state:departure});
  for(let i=0;i<100000&&live.time<incoming.time;i++)live.step();
  const actual=live.ship(craft.id)!;expect(actual.bodyId).toBe('moon');
  const reference=live.context.services.orbits.propagate(incoming,live.body('moon').mu,live.time-incoming.time);expect(reference.ok).toBe(true);
  if(reference.ok){expect(Math.hypot(reference.state.position.x-actual.state.position.x,reference.state.position.y-actual.state.position.y)).toBeLessThan(.02);
   expect(Math.hypot(reference.state.velocity.x-actual.state.velocity.x,reference.state.velocity.y-actual.state.velocity.y)).toBeLessThan(.002);}
  live.dispose();
 }
 expect(JSON.stringify(saveWorld(world))).toBe(before);world.dispose();
},120000);

it('rejects invalid targets, unsupported deep relationships, thrust and incompatible hosts without plausible formula-only output',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),request={shipId:ship.id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100};
 function quick(source:World,changed={}){const job=solver.search(source,{...request,...changed});for(let i=0;i<100;i++){const r=job.next();if(r.done)return r.value;}job.return({options:[],reason:'cancelled'});throw Error('Expected immediate rejection');}
 for(const change of [{periapsisAltitude:-1},{apoapsisAltitude:Infinity},{apoapsisAltitude:4000},{destinationId:'nix'},{destinationId:'missing'}])expect(quick(world,change).options).toEqual([]);
 const old=Object.create(world);Object.defineProperty(old,'predictionFeatures',{value:{futureSeeds:true}});expect(quick(old).reason).toContain('exact-end-time');
 world.setControls(ship.id,{engine:true,turn:0,throttle:0});expect(quick(world).reason).toContain('Stop thrust');world.dispose();
});
it('cancels active interbody correction and disposes every owned forecast without writing authority',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),before=JSON.stringify(saveWorld(world));let active=0,closed=0;
 const source=Object.create(world) as World;source.predictShip=function*(...args:Parameters<World['predictShip']>){active++;try{return yield* world.predictShip(...args);}finally{active--;closed++;}};
 const job=solver.search(source,{shipId:ship.id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100});
 for(let i=0;i<1000&&!active;i++)job.next();expect(active).toBe(1);job.return({options:[],reason:'cancelled'});expect(active).toBe(0);expect(closed).toBeGreaterThan(0);
 expect(JSON.stringify(saveWorld(world))).toBe(before);world.dispose();
});
it('never accepts an interbody proposal when the shared predictor reports early contact',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),source=Object.create(world) as World;
 source.predictShip=function*(_id,_coarse,seed){if(seed)yield{time:seed.state.time,position:seed.state.position,velocity:seed.state.velocity,bodyId:seed.bodyId,frameId:seed.bodyId};return 'impact';};
 const result=search(source,{shipId:ship.id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100});
 expect(result.options).toEqual([]);expect(world.ship(ship.id)!.controls.engine).toBe(false);world.dispose();
});

it('supports astronomy-scale Earth-to-Mars plans with selected ephemerides and a noncircular target',()=>{
 const world=new World(solarSystem as UniverseDefinition),ship=world.spawn({ownerId:'pilot',presetId:'earth-orbit'}),
  result=search(world,{shipId:ship.id,destinationId:'mars',periapsisAltitude:100000,apoapsisAltitude:300000});
 expect(result.options.length,result.reason).toBeGreaterThan(0);
 for(const option of result.options){const final=evaluate(option.plan,world)[1]!;expect(final.valid).toBe(true);
  const orbit=world.context.services.orbits.elements(final.after!,world.body('mars').mu);
  expect(Math.abs(orbit.periapsis-world.body('mars').radius-100000)).toBeLessThan(1);
  expect(Math.abs(orbit.apoapsis!-world.body('mars').radius-300000)).toBeLessThan(1);
 }
 world.dispose();
},120000);
