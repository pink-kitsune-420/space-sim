import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createSaveFiles,inspectSaveFiles} from '../../packages/game-library/src/save-package';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld,loadWorld} from '../../packages/sim-core/src/save';
import {FLIGHT_PLANS,type FlightPlanNode,type GhostEnd,type GhostSample} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
const nodes:FlightPlanNode[]=[{id:'departure',label:'Departure',bodyId:'planet',time:5,prograde:10,radial:0},{id:'arrival',label:'Arrival',bodyId:'planet',time:20,prograde:2,radial:0}];
it('chains circular and elliptical incoming states through both impulses without writing flight controls or authority',()=>{
 const service=createFlightPlans();
 for(const eccentric of [false,true]) {
  const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});
  if(eccentric)world.put({...ship,state:{...ship.state,velocity:{x:ship.state.velocity.x*1.2,y:0}}});
  const before=JSON.stringify(saveWorld(world)),plan=service.capture(world,world.ship(ship.id)!,nodes),evaluated=service.evaluate(plan,world);
  expect(evaluated.map(n=>n.valid)).toEqual([true,true]);expect(evaluated[1]!.seed).toEqual(evaluated[0]!.after);
  const changed=service.evaluate({...plan,nodes:[{...nodes[0]!,prograde:20},nodes[1]!] },world);
  expect(changed[1]!.before!.position).not.toEqual(evaluated[1]!.before!.position);
  const samples:GhostSample[]=[],job=service.predict(plan,world);let end:GhostEnd|undefined;
  for(let i=0;i<17000;i++){const r=job.next();if(r.done){end=r.value;break;}samples.push(r.value);}
  expect(end).toBe('horizon');expect(samples.filter(s=>Math.abs(s.time-20)<1e-8).length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(saveWorld(world))).toBe(before);world.dispose();
 }
});
it('rejects malformed archives, unsupported future/body conditions, and keeps unknown arming data out of decoded intent',()=>{
 const service=createFlightPlans(),world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),plan=service.capture(world,ship,nodes);
 const read=(value:unknown)=>service.read({format:'space-sim-flight-plans/1',plans:[value]});
 for(const edited of [{...plan,nodes:[nodes[0],nodes[0]]},{...plan,nodes:[{...nodes[0]!,time:Infinity}]},{...plan,nodes:[{...nodes[0]!,time:4e7}]},{...plan,nodes:new Array(17).fill(nodes[0])}])expect(()=>read(edited)).toThrow('Flight plan:');
 const decoded=read({...plan,armed:true,nodes:plan.nodes.map(node=>({...node,engine:true,execute:true}))});
 expect(JSON.stringify(decoded)).not.toMatch(/armed|engine|execute/);
 expect(service.evaluate({...plan,nodes:[{...nodes[0]!,bodyId:'moon'}]},world)[0]!.reason).toContain('Later-body');
 expect(service.evaluate({...plan,fingerprint:'changed'},world)[0]!.valid).toBe(false);
 expect(()=>service.evaluate({...plan,nodes:new Array(17).fill(nodes[0])},world)).toThrow('at most 16');
 const oldHost=Object.create(world);Object.defineProperty(oldHost,'predictionFeatures',{value:undefined});
 expect(service.evaluate(plan,oldHost)[0]!.reason).toContain('future prediction seeds');
 const invalid=service.evaluate({...plan,nodes:[{...nodes[0]!,prograde:-100},nodes[1]!] },world);
 expect(invalid[1]!.valid).toBe(false);world.dispose();
});
it('round-trips bounded inert arrival goals and rejects malformed targets without accepting arming fields',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),service=createFlightPlans(),goal={periapsisAltitude:100,apoapsisAltitude:500},plan=service.capture(world,ship,[{...nodes[0]!,targetOrbit:goal}]);
 try{
  const read=(target:unknown)=>service.read({format:'space-sim-flight-plans/1',plans:[{...plan,nodes:[{...plan.nodes[0],targetOrbit:target,armed:true}]}]});
  expect(read({...goal,engine:true,execute:true}).plans[0]!.nodes[0]!.targetOrbit).toEqual(goal);
  expect(JSON.stringify(read({...goal,engine:true,execute:true}))).not.toMatch(/armed|engine|execute/);
  for(const target of [{periapsisAltitude:-1,apoapsisAltitude:100},{periapsisAltitude:100,apoapsisAltitude:50},{periapsisAltitude:100,apoapsisAltitude:Infinity}])expect(()=>read(target)).toThrow('Flight plan:');
  const saved=saveWorld(world,{flightPlans:{format:'space-sim-flight-plans/1',plans:[plan]}});
  expect(service.read(inspectSaveFiles(createSaveFiles(saved)).flightPlans).plans[0]!.nodes[0]!.targetOrbit).toEqual(goal);
 }finally{world.dispose();}
});

it('stores optional inert intent with existing world formats and accepts older worlds with no planning metadata',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),service=createFlightPlans(),archive={format:'space-sim-flight-plans/1' as const,plans:[service.capture(world,ship,nodes)]};
 const saved=saveWorld(world,{flightPlans:archive});expect(saved.flightPlans).toEqual(archive);expect(saved.flightPlans).not.toBe(archive);
 expect(inspectSaveFiles(createSaveFiles(saved)).flightPlans).toEqual(archive);
 expect(saveWorld(world).flightPlans).toBeUndefined();expect(saveWorld(world,{flightPlans:{...archive,plans:[]}}).flightPlans).toBeUndefined();
 const loaded=loadWorld(JSON.parse(JSON.stringify(saved)));expect(loaded.world.ship(ship.id)!.controls.engine).toBe(false);loaded.world.dispose();
 const old=loadWorld(saveWorld(world));expect(old.world.ship(ship.id)!.state).toEqual(ship.state);old.world.dispose();world.dispose();
});
it('closes the shared predictor when a chained preview is cancelled',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),service=createFlightPlans(),plan=service.capture(world,ship,nodes);let closed=0;
 const source=Object.create(world) as World;source.predictShip=function*(id,coarse,seed){try{return yield* world.predictShip(id,coarse,seed);}finally{closed++;}};
 const job=service.predict(plan,source);expect(job.next().done).toBe(false);job.return('open');expect(closed).toBe(1);world.dispose();
});
it('loads the actual flight-plan archive headlessly in all declared environments with optional UI, camera, sound and prediction absent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'portable-flight-plans-'));
 try {
  const source=join(dir,'source'),output=join(dir,'plans.spacemod');await cp(resolve('modules/flight-plans'),source,{recursive:true});await buildPortableModule(join(source,'module.json'),output,{typecheck:false});
  const checked=await inspectRuntimePackage(new Uint8Array(await readFile(output)));
  for(const environment of ['browser','offline','node'] as const){
   const registry=new ModuleRegistryV2(),registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])});registry.register(registration.module,registration.assets);
   const candidate=registry.prepare({format:'space-sim-profile/2',id:'fixture.plans',modules:[{id:checked.id,version:checked.version}],providers:{'flight.plans':checked.id},capabilities:{},settings:{}},environment);
   const service=candidate.providedService(FLIGHT_PLANS),world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});
   expect(service.evaluate(service.capture(world,ship,nodes),world).every(node=>node.valid)).toBe(true);candidate.dispose();world.dispose();
  }
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
