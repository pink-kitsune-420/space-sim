import {expect,it} from 'vitest';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {createTransferPlanner} from '../../modules/transfer-planner/src/index';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import solarSystem from '../../games/space-sim/universes/astronomy/solar-system/universe.json';
import {saveWorld,loadWorld} from '../../packages/sim-core/src/save';
import type {FlightPlan,TransferRequest,UniverseDefinition} from '../../packages/game-api/src/index';

const plans=createFlightPlans(),solver=createTransferPlanner(plans);

function evaluate(plan:FlightPlan,world:World){const job=plans.evaluateAsync!(plan,world);for(let i=0;i<100000;i++){const step=job.next();if(step.done)return step.value;}throw Error('Evaluation budget');}
function search(world:World,request:TransferRequest){
 const job=solver.search(world,request);let count=0;
 for(;;){const step=job.next();if(step.done)return step.value;if(++count>10000000)throw Error('Search budget');}
}

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

it('steps 100k live physics frames to verify flight arrival integration matches orbit propagation',()=>{
 const world=new World(DEFAULT_UNIVERSE),seed=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),body=world.body('planet'),r=body.radius*1.4;
 world.teleport(seed.id,'planet',{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});const current=world.ship(seed.id)!;
 const result=search(world,{shipId:current.id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100});
 expect(result.options.length,result.reason).toBeGreaterThan(0);
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
 live.dispose();world.dispose();
},120000);
