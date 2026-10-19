import {expect,it} from 'vitest';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld,loadWorld} from '../../packages/sim-core/src/save';
import {flightSampleInFrame,type EvaluatedFlightNode,type FlightPlan,type GhostEnd,type GhostSample} from '../../packages/game-api/src/index';
const service=createFlightPlans();
function trace(job:Generator<GhostSample,GhostEnd>){const samples:GhostSample[]=[];for(let i=0;i<16390;i++){const r=job.next();if(r.done)return{samples,end:r.value};samples.push(r.value);}throw Error('budget');}
function evaluate(plan:FlightPlan,world:World){const job=service.evaluateAsync!(plan,world);for(let i=0;i<100000;i++){const r=job.next();if(r.done)return r.value;}throw Error('budget');}
function flyby(world:World){
 const ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),system=world.system,
  m=system.getBodyPosition('moon',0),p=system.getBodyPosition('planet',0),mv=system.getBodyVelocity('moon',0),pv=system.getBodyVelocity('planet',0);
 world.put({...ship,state:{...ship.state,position:{x:m.x-p.x-3000,y:m.y-p.y+600},velocity:{x:mv.x-pv.x+80,y:mv.y-pv.y}}});return world.ship(ship.id)!;
}
it('reaches exact future times across moving SOIs and agrees with live position and velocity',()=>{
 const world=new World(DEFAULT_UNIVERSE),live=new World(DEFAULT_UNIVERSE),ship=flyby(world);flyby(live);
 const entry=trace(world.predictShip(ship.id)).samples.find(s=>s.encounter)!,until=Math.round((entry.time+1.23)*100)/100;
 const result=trace(world.predictShip(ship.id,false,{state:ship.state,bodyId:ship.bodyId,until})),last=result.samples.at(-1)!;
 expect(result.end).toBe('horizon');expect(last.time).toBe(until);expect(last.bodyId).toBe('moon');
 const local=flightSampleInFrame(last,'moon',world.system);
 while(live.time<until-.005)live.step();const actual=live.ship(ship.id)!;
 expect(actual.bodyId).toBe('moon');expect(Math.hypot(actual.state.position.x-local.position.x,actual.state.position.y-local.position.y)).toBeLessThan(.001);
 expect(Math.hypot(actual.state.velocity.x-local.velocity.x,actual.state.velocity.y-local.velocity.y)).toBeLessThan(1e-5);
 const roundtrip=flightSampleInFrame(local,'planet',world.system);
 expect(Math.hypot(roundtrip.position.x-last.position.x,roundtrip.position.y-last.position.y)).toBeLessThan(1e-6);
 expect(roundtrip.velocity.x).toBeCloseTo(last.velocity.x,10);world.dispose();live.dispose();
});
it('evaluates editable departure/arrival chains in each local body and persists only inert cross-body intent',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=flyby(world),before=JSON.stringify(saveWorld(world));
 const entry=trace(world.predictShip(ship.id)).samples.find(s=>s.encounter)!,time=entry.time+1.234567;
 const plan=service.capture(world,ship,[{id:'out',label:'Departure',bodyId:'planet',time:0,prograde:0,radial:0},{id:'in',label:'Arrival',bodyId:'moon',time,prograde:1,radial:2}]);
 const evaluated=evaluate(plan,world);expect(evaluated.map(r=>r.valid)).toEqual([true,true]);
 const forecast=trace(world.predictShip(ship.id,false,{state:ship.state,bodyId:'planet',until:time})),local=flightSampleInFrame(forecast.samples.at(-1)!,'moon',world.system);
 expect(evaluated[1]!.before!.position).toEqual(local.position);expect(evaluated[1]!.before!.velocity).toEqual(local.velocity);
 const edited=evaluate({...plan,nodes:plan.nodes.map(n=>n.id==='in'?{...n,time:time+.1,radial:3}:n)},world);
 expect(edited[1]!.valid).toBe(true);expect(edited[1]!.after!.velocity).not.toEqual(evaluated[1]!.after!.velocity);
 const preview=trace(service.predict(plan,world));expect(preview.samples.some(s=>s.encounter?.to==='moon')).toBe(true);
 expect(preview.samples.filter(s=>s.frameId).every(s=>s.frameId==='planet')).toBe(true);
 const saved=saveWorld(world,{flightPlans:{format:'space-sim-flight-plans/1',plans:[plan]}}),loaded=loadWorld(JSON.parse(JSON.stringify(saved)));
 const decoded=service.read(saved.flightPlans);expect(evaluate(decoded.plans[0]!,loaded.world).map(n=>n.valid)).toEqual([true,true]);
 expect(loaded.world.ship(ship.id)!.controls.engine).toBe(false);expect(JSON.stringify(saveWorld(world))).toBe(before);
 loaded.world.dispose();world.dispose();
});
it('rejects wrong-body, contact, invalid endpoint limits and missing exact-time support',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=flyby(world),plan=service.capture(world,ship,[{id:'wrong',label:'Wrong',bodyId:'moon',time:.1,prograde:0,radial:0}]);
 expect(evaluate(plan,world)[0]!.reason).toContain('does not reach');
 const old=Object.create(world);Object.defineProperty(old,'predictionFeatures',{value:{futureSeeds:true}});
 expect(evaluate(plan,old)[0]!.reason).toContain('exact-end-time');
 for(const until of [-1,Infinity,4e7])expect(trace(world.predictShip(ship.id,false,{state:ship.state,bodyId:'planet',until})).end).toBe('failed');
 const falling=world.spawn({ownerId:'fall',presetId:'planet-orbit'});world.put({...falling,state:{...falling.state,velocity:{x:0,y:0}}});
 const hit=service.capture(world,world.ship(falling.id)!,[{id:'hit',label:'Too late',bodyId:'planet',time:100,prograde:0,radial:0}]);
 expect(evaluate(hit,world)[0]!.reason).toContain('impact');world.dispose();
});
it('cancels cross-body evaluation and chained preview while a shared forecast is active',()=>{
 for(const kind of ['evaluate','preview']){
  const world=new World(DEFAULT_UNIVERSE),ship=flyby(world);let active=0,closed=0;
  const source=Object.create(world) as World;source.predictShip=function*(...args:Parameters<World['predictShip']>){active++;try{return yield* world.predictShip(...args);}finally{active--;closed++;}};
  const plan=service.capture(world,ship,[{id:'later',label:'Later',bodyId:'moon',time:20,prograde:0,radial:0}]);
  const job=kind==='evaluate'?service.evaluateAsync!(plan,source):service.predict(plan,source);
  expect(job.next().done).toBe(false);expect(active).toBe(1);
  if(kind==='evaluate')(job as Generator<unknown,readonly EvaluatedFlightNode[]>).return([]);else(job as Generator<unknown,GhostEnd>).return('open');
  expect(active).toBe(0);expect(closed).toBe(1);world.dispose();
 }
});
