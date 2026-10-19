import {expect,it} from 'vitest';
import {findEncounter,prepareArrival,type EncounterResult,type ArrivalResult} from '../../modules/maneuver-editor/src/encounter';
import {flightSampleInFrame,type FlightPlanNode} from '../../packages/game-api/src/index';
import {ManeuverBurn} from '../../apps/web/src/maneuver-burn';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld} from '../../packages/sim-core/src/save';

function finish(job:Generator<void,EncounterResult>):EncounterResult {
 for(let i=0;i<16386;i++){const step=job.next();if(step.done)return step.value;}
 throw Error('Unbounded encounter search');
}
function flyby(world:World):string {
 const ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),system=world.system,
  m=system.getBodyPosition('moon',0),p=system.getBodyPosition('planet',0),mv=system.getBodyVelocity('moon',0),pv=system.getBodyVelocity('planet',0);
 world.put({...ship,state:{...ship.state,position:{x:m.x-p.x-3000,y:m.y-p.y+600},velocity:{x:mv.x-pv.x+80,y:mv.y-pv.y}}});
 return ship.id;
}
it('finds a real moving-body encounter beyond an outdated arrival time without advancing authority',()=>{
 const world=new World(DEFAULT_UNIVERSE);
 try{
  const id=flyby(world),before=JSON.stringify(saveWorld(world)),result=finish(findEncounter(world,id,'moon',.1));
  expect(result.reason).toBe('');expect(result.entry?.encounter).toEqual({from:'planet',to:'moon'});
  expect(result.entry!.time).toBeGreaterThan(.1);expect(JSON.stringify(saveWorld(world))).toBe(before);
 }finally{world.dispose();}
});
it('reports an absent encounter or surface contact instead of granting a speculative coast or burn',()=>{
 const world=new World(DEFAULT_UNIVERSE);
 try{
  const ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});
  expect(finish(findEncounter(world,ship.id,'moon',1))).toEqual({reason:expect.stringContaining('No Parvus encounter')});
  world.put({...ship,state:{...ship.state,velocity:{x:0,y:0}}});
  expect(finish(findEncounter(world,ship.id,'moon',1))).toEqual({reason:expect.stringContaining('impact')});
 }finally{world.dispose();}
});
it('cancels and closes the owned forecast while detached encounter work is pending',()=>{
 const world=new World(DEFAULT_UNIVERSE),id=flyby(world);let closed=0;
 const source=Object.create(world) as World;
 source.predictShip=function*(...args:Parameters<World['predictShip']>){try{return yield* world.predictShip(...args);}finally{closed++;}};
 try{
  const job=findEncounter(source,id,'moon',1);expect(job.next().done).toBe(false);expect(closed).toBe(0);
  job.return({reason:'cancelled'});expect(closed).toBe(1);
 }finally{world.dispose();}
});
function atEncounter(world:World):string {
 const id=flyby(world),entry=finish(findEncounter(world,id,'moon',.1)).entry!,ship=world.ship(id)!,local=flightSampleInFrame(entry,'moon',world.system),time=Math.round(entry.time*100)/100;
 world.restoreClock(Math.round(time*100),time);
 world.put({...ship,bodyId:'moon',state:{...ship.state,time,position:local.position,velocity:local.velocity,coast:undefined,throttle:0}});
 return id;
}
function arrival(world:World,id:string,node:FlightPlanNode):ArrivalResult {
 const job=prepareArrival(world,id,node,{create:(time,delta,vehicle)=>new ManeuverBurn(time,delta,vehicle)});
 for(let i=0;i<100000;i++){const step=job.next();if(step.done)return step.value;}
 throw Error('Unbounded arrival review');
}
it('retimes and validates a feasible capture at the actual encounter without writing authority',()=>{
 const world=new World(DEFAULT_UNIVERSE);
 try{
  const id=atEncounter(world),before=JSON.stringify(saveWorld(world)),goal={periapsisAltitude:700,apoapsisAltitude:700},result=arrival(world,id,{id:'arrival',label:'Arrival',bodyId:'moon',time:1,prograde:1,radial:0,targetOrbit:goal});
  expect(result.reason).toBe('');expect(result.node?.time).toBeGreaterThan(world.time);expect(result.node?.targetOrbit).toEqual(goal);
  expect(JSON.stringify(saveWorld(world))).toBe(before);
  const node=result.node!,ship=world.ship(id)!,body=world.body('moon'),coast=world.context.keplerCoast(ship.state,body,world.surface(body.id))!,incoming=world.context.coastAt(coast,node.time,body,world.surface(body.id),{cache:false});
  expect(incoming.ok).toBe(true);if(!incoming.ok)throw Error('No incoming coast');
  const v=incoming.state.velocity,p=incoming.state.position,speed=Math.hypot(v.x,v.y),r=Math.hypot(p.x,p.y),delta={x:v.x/speed*node.prograde+p.x/r*node.radial,y:v.y/speed*node.prograde+p.y/r*node.radial},burn=new ManeuverBurn(node.time,delta,world.context.vehicle);
  for(let i=0;i<20000;i++){
   const command=burn.next(world.ship(id)!.state);if(command.throttle!==undefined)world.setThrottle(id,command.throttle);world.setControls(id,command.controls);
   if(burn.phase==='complete')break;world.step();
  }
  expect(burn.phase).toBe('complete');expect(world.ship(id)!.bodyId).toBe('moon');
  const captured=world.context.services.orbits.elements(world.ship(id)!.state,body.mu);
  expect(Math.abs(captured.periapsis-body.radius-700)).toBeLessThan(20);expect(Math.abs(captured.apoapsis!-body.radius-700)).toBeLessThan(20);
 }finally{world.dispose();}
});
it('refuses an unreachable target orbit or missing older arrival goal instead of reusing stale delta-v',()=>{
 const world=new World(DEFAULT_UNIVERSE);
 try{
  const id=atEncounter(world),node={id:'arrival',label:'Arrival',bodyId:'moon',time:1,prograde:1,radial:0};
  expect(arrival(world,id,node).reason).toContain('older node');
  expect(arrival(world,id,{...node,targetOrbit:{periapsisAltitude:1,apoapsisAltitude:1}}).reason).toContain('correction maneuver');
 }finally{world.dispose();}
});
