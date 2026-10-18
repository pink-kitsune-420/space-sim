import {afterAll,beforeAll,expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {FLEET_VIEWS,SPIN_VIEWS,type FleetViewInput,type ModuleProfileV2} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {coreRotationService,engineModuleServices} from '../../packages/sim-core/src/module-services';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {createSimulationContext} from '../../packages/sim-core/src/context';
import {BUILTIN_SERVICES} from '../../packages/sim-core/src/services';
type InspectedRuntimePackage=Awaited<ReturnType<typeof inspectRuntimePackage>>;
let directory:string;const archives=new Map<string,InspectedRuntimePackage>();
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'portable-fleet-spin-'));
 for(const name of ['fleet-view','spin-view']){const source=join(directory,name),output=join(directory,`${name}.spacemod`);await cp(resolve('modules',name),source,{recursive:true});await buildPortableModule(join(source,'module.json'),output,{typecheck:false});archives.set(name,await inspectRuntimePackage(new Uint8Array(await readFile(output))));}
});
afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
const profile=(archive:InspectedRuntimePackage):ModuleProfileV2=>({format:'space-sim-profile/2',id:'fixture.readonly-views',modules:[{id:archive.id,version:archive.version}],providers:Object.fromEntries(archive.manifest.slots.map(slot=>[slot,archive.id])),capabilities:{},settings:{}});

it('real fleet archives query selected coast providers with independent per-pilot caches and preserve authority',()=>{
 for(const environment of ['browser','offline','node'] as const){
  const archive=archives.get('fleet-view')!,registration=archive.register({environment,allowRuntimeCode:true,approvedDigests:new Set([archive.digest])}),registry=new ModuleRegistryV2();registry.register(registration.module,registration.assets);const candidate=registry.prepare(profile(archive),environment),factory=candidate.providedService(FLEET_VIEWS),first=factory.create(),second=factory.create();
  let elements=0,propagations=0;
  const selected={...BUILTIN_SERVICES.orbits,elements:(...args:Parameters<typeof BUILTIN_SERVICES.orbits.elements>)=>{elements++;return BUILTIN_SERVICES.orbits.elements(...args);},propagate:(...args:Parameters<typeof BUILTIN_SERVICES.orbits.propagate>)=>{propagations++;return BUILTIN_SERVICES.orbits.propagate(...args);}};
  const world=new World(DEFAULT_UNIVERSE,{createContext:(settings,options)=>createSimulationContext(settings,{...options,services:{orbits:selected}})});
  try{
   const own=world.spawn({ownerId:'primary',presetId:'pad'}),ship=world.spawn({ownerId:'guest',presetId:'planet-orbit',name:'Survey craft'});world.step();expect(world.isAsleep(ship.id)).toBe(true);expect(world.ship(ship.id)!.state.coast?.modelIdentity).toBe(world.context.modelIdentity);
   const before=JSON.stringify({tick:world.tick,time:world.time,ships:world.ships()}),time=world.time+.1,origin=world.system.getBodyPosition(ship.bodyId,time),input:FleetViewInput={world,time,alpha:1,paused:false,skipId:own.id,playerId:'primary',camera:{center:origin,rotation:0,scale:.2},width:800,height:600,previous:()=>undefined,displayOffset:()=>({x:0,y:0}),playerName:id=>id==='guest'?'Guest pilot':undefined};
   const oldElements=elements,oldPropagations=propagations,result=first.build(input);expect(elements).toBeGreaterThan(oldElements);expect(propagations).toBeGreaterThan(oldPropagations);expect(first.stats.solved).toBe(1);
   const coast=world.ship(ship.id)!.state.coast!,expected=world.context.coastAt(coast,time,world.body(ship.bodyId),world.surface(ship.bodyId),{cache:false});if(!expected.ok)throw new Error('Fixture requires valid coast');
   expect(result).toHaveLength(1);expect(result[0]!.position).toEqual({x:origin.x+expected.state.position.x,y:origin.y+expected.state.position.y});expect(result[0]).toMatchObject({foreign:true,label:'SURVEY CRAFT · GUEST PILOT'});
   first.build(input);expect(first.stats.reused).toBe(1);expect(first.stats.solved).toBe(0);
   const guestInput={...input,playerId:'guest'},guest=second.build(guestInput);expect(second.stats.solved).toBe(1);expect(guest[0]).toMatchObject({foreign:false,label:'SURVEY CRAFT'});
   first.build({...input,camera:{...input.camera,center:{x:origin.x+1e9,y:origin.y}}});expect(first.stats.culledByOrbit).toBe(1);second.build(guestInput);expect(second.stats.reused).toBe(1);
   expect(JSON.stringify({tick:world.tick,time:world.time,ships:world.ships()})).toBe(before);candidate.dispose();expect(()=>first.build(input)).toThrow('disposed');expect(()=>factory.create()).toThrow('disposed');
   const absent=registry.prepare({...profile(archive),modules:[],providers:{}},environment);expect(absent.lock.order).toEqual([]);absent.dispose();
  }finally{candidate.dispose();world.dispose();}
 }
});

it('real spin archives require explicit fixed rotation and own independent holds, zero-duration release and disposal',()=>{
 for(const environment of ['browser','offline','node'] as const){
  const archive=archives.get('spin-view')!,registration=archive.register({environment,allowRuntimeCode:true,approvedDigests:new Set([archive.digest])}),missing=new ModuleRegistryV2();missing.register(registration.module,registration.assets);expect(()=>missing.prepare(profile(archive),environment)).toThrow('core.rotation');
  const registry=new ModuleRegistryV2(engineModuleServices());registry.register(registration.module,registration.assets);const candidate=registry.prepare({...profile(archive),settings:{[archive.id]:{releaseSeconds:0}}},environment),factory=candidate.providedService(SPIN_VIEWS),held=factory.create(),free=factory.create(),world=new World(DEFAULT_UNIVERSE);
  try{
   const ship=world.spawn({ownerId:'pilot'}),body=world.body(ship.bodyId),bodies=world.system.getAllBodies(),state=world.ship(ship.id)!.state,before=JSON.stringify(state);
   held.update(bodies,0,1/60,false);held.update(bodies,5000,1/60,false);free.update(bodies,0,1/60,false);expect(held.holding.has(body.id)).toBe(true);expect(free.holding.size).toBe(0);expect(held.angle(body,5000)).not.toBe(free.angle(body,5000));
   const at={...state,time:5000},drawn=held.state(at,body),point=held.point(body,5000,at.position);expect(drawn.position).toEqual(point);
   held.update(bodies,5000+1/60,0,false);expect(held.holding.size).toBe(0);expect(held.angle(body,5000+1/60)).toBe(coreRotationService.spinAngle(body,5000+1/60));expect(Number.isFinite(held.angle(body,5000+1/60))).toBe(true);
   expect(world.tick).toBe(0);expect(JSON.stringify(world.ship(ship.id)!.state)).toBe(before);candidate.dispose();expect(held.holding.size).toBe(0);expect(()=>held.angle(body,0)).toThrow('disposed');expect(()=>factory.create()).toThrow('disposed');
  }finally{candidate.dispose();world.dispose();}
 }
});
