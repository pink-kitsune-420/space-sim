import {expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
import {transferOptions} from '../../modules/transfer-planner/src/math';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld} from '../../packages/sim-core/src/save';
import type {FlightPlan,TransferRequest,TransferProgress} from '../../packages/game-api/src/index';

const plans=createFlightPlans(),solver=createTransferPlanner(plans),measurements:unknown[]=[];

it('publishes a fully validated moon plan before the remaining search completes and cancels cleanly',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body(ship.bodyId),r=body.radius+102;
 world.teleport(ship.id,body.id,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});
 const before=JSON.stringify(saveWorld(world)),job=solver.search(world,{shipId:ship.id,destinationId:'moon',periapsisAltitude:512,apoapsisAltitude:512});
 try {
  let progress:TransferProgress|undefined;
  for(let count=0;count<100000;count++){
   const step=job.next();expect(step.done).toBe(false);
   if(!step.done&&step.value.options?.length){progress=step.value;break;}
  }
  expect(progress).toBeDefined();expect(progress!.accepted).toBe(1);expect(progress!.tested).toBeLessThan(progress!.total);
  const option=progress!.options![0]!,nodes=evaluate(option.plan,world);
  expect(transferOptions(progress!.options!,option.plan.nodes[0]!.time+1)).toEqual([]);
  expect(nodes.map(n=>n.valid)).toEqual([true,true]);
  const final=world.context.services.orbits.elements(nodes[1]!.after!,world.body('moon').mu);
  expect(final.periapsis).toBeCloseTo(world.body('moon').radius+512,2);
  expect(final.apoapsis).toBeCloseTo(world.body('moon').radius+512,2);
 } finally {job.return({options:[],reason:'cancelled'});}
 expect(JSON.stringify(saveWorld(world))).toBe(before);world.dispose();
},15000);

function evaluate(plan:FlightPlan,world:World){const job=plans.evaluateAsync!(plan,world);for(let i=0;i<100000;i++){const step=job.next();if(step.done)return step.value;}throw Error('Evaluation budget');}
function search(world:World,request:TransferRequest){
 const job=solver.search(world,request);let count=0,last:TransferProgress|undefined,maxNext=0;const start=performance.now();
 for(;;){const at=performance.now(),step=job.next();maxNext=Math.max(maxNext,performance.now()-at);if(step.done){measurements.push({request,result:step.value,yields:count,progress:last,ms:performance.now()-start,maxNext});mkdirSync('private-docs/measurements/flight-planning-0.6.4',{recursive:true});writeFileSync('private-docs/measurements/flight-planning-0.6.4/interbody-search.json',JSON.stringify(measurements,null,2));return step.value;}if(!(step.value.fraction!>=(last?.fraction??0)&&step.value.fraction!<=1))throw Error(`Progress fraction ${step.value.fraction} after ${last?.fraction}`);last=step.value;if(++count>10000000)throw Error('Search budget');}
}

it.each([
 ['planet','moon',1,100,100],['moon','planet',1,300,1000],['planet','magnus',1.15,300,700]
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
 expect(JSON.stringify(saveWorld(world))).toBe(before);world.dispose();
},15000);

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

it('raises a reverse-direction parking orbit toward the Moon without forcing an expensive reversal',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body('planet'),r=1024;
 try {
  world.restoreClock(7100,71);world.teleport(ship.id,body.id,{x:0,y:r},{x:-Math.sqrt(body.mu/r),y:0});
  const result=search(world,{shipId:ship.id,destinationId:'moon',periapsisAltitude:512,apoapsisAltitude:512});
  const efficient=result.options[0]!;expect(efficient,result.reason).toBeDefined();expect(efficient.deltaV).toBeLessThan(100);expect(efficient.departureDeltaV).toBeLessThan(60);expect(efficient.plan.nodes[0]!.prograde).toBeGreaterThan(0);
  const nodes=evaluate(efficient.plan,world),transfer=world.context.services.orbits.elements(nodes[0]!.after!,body.mu);
  expect(nodes.every(node=>node.valid)).toBe(true);expect(transfer.angularMomentum).toBeGreaterThan(0);expect(transfer.apoapsis).toBeGreaterThan(12000);
 }finally{world.dispose();}
},15000);
