import {expect,it} from 'vitest';
import {createOrbitalAlarmClock} from '../../modules/orbital-alarms/src/index';
import {createFlightPlans} from '../../modules/flight-plans/src/index';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {World} from '../../packages/sim-core/src/world';
import {type OrbitalAlarmEvent,ORBITAL_ALARMS} from '../../packages/game-api/src/index';
const event=(changes:Partial<OrbitalAlarmEvent>={}):OrbitalAlarmEvent=>({id:'burn-1',kind:'maneuver',label:'Departure',deadline:90,time:100,pause:false,...changes});
it('detects high-warp crossings, batches due events, marks missed events and delivers each once',()=>{
 const clock=createOrbitalAlarmClock(),session={};expect(clock.sync(session,0,[event()])).toEqual([]);expect(clock.secondsUntilNext).toBe(90);
 const due=clock.sync(session,95,[event(),event({id:'burn-2',deadline:92})]);expect(due.map(n=>n.missed)).toEqual([false,false]);expect(clock.secondsUntilNext).toBe(Infinity);
 expect(clock.sync(session,101,[event(),event({id:'burn-2',deadline:92})])).toEqual([]);
 expect(clock.sync(session,150,[event(),event({id:'new',deadline:120,time:140,pause:true})])).toMatchObject([{id:'new',missed:true,pause:true}]);
 expect(clock.sync(session,150,[event(),event({id:'new',deadline:120,time:140})])).toEqual([]);clock.dispose();
});
it('reschedules edits, drops deleted events, restores handled saves and clears session/rewind state',()=>{
 const clock=createOrbitalAlarmClock(),session={},edited=event({deadline:110,time:120});clock.sync(session,0,[event()]);
 expect(clock.sync(session,95,[edited])).toEqual([]);expect(clock.secondsUntilNext).toBe(15);
 clock.sync(session,96,[]);expect(clock.secondsUntilNext).toBe(Infinity);expect(clock.sync(session,121,[])).toEqual([]);
 expect(clock.sync(session,121,[{...edited,handled:true}])).toEqual([]);
 expect(clock.sync(session,122,[edited])).toEqual([]);
 expect(clock.sync({},122,[edited])).toMatchObject([{missed:true}]);
 expect(clock.sync(session,90,[event()])).toHaveLength(1);expect(clock.sync(session,50,[event()])).toHaveLength(0);
 expect(clock.secondsUntilNext).toBe(40);expect(clock.sync(session,91,[event()])).toHaveLength(1);
 clock.clear();expect(clock.secondsUntilNext).toBe(Infinity);clock.dispose();expect(()=>clock.sync(session,0,[])).toThrow('disposed');
});
it('rejects malformed or unbounded sets atomically, and bounds a full 1024-event crossing',()=>{
 const clock=createOrbitalAlarmClock(),session={};clock.sync(session,0,[event()]);
 for(const events of [[event(),event()],[event({deadline:101})],[event({time:NaN})],Array.from({length:1025},(_,id)=>event({id:String(id)}))])expect(()=>clock.sync(session,95,events)).toThrow();
 expect(clock.sync(session,95,[event()])).toHaveLength(1);
 const many=Array.from({length:1024},(_,id)=>event({id:String(id),deadline:200,time:210}));expect(clock.sync(session,100,many)).toHaveLength(0);expect(clock.sync(session,205,many)).toHaveLength(1024);expect(clock.sync(session,206,many)).toHaveLength(0);clock.dispose();
});
it('preserves bounded reminder intent and delivery flags in portable plans while old plans omit it',()=>{
 const service=createFlightPlans(),world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),node={id:'departure',label:'Departure',bodyId:ship.bodyId,time:30,prograde:10,radial:0};
 const old=service.capture(world,ship,[node]);expect(old.nodes[0]!.alarm).toBeUndefined();
 const alarm={enabled:true,leadSeconds:15,pause:true,notified:true},plan=service.capture(world,ship,[{...node,alarm}]);
 expect(service.read(JSON.parse(JSON.stringify({format:'space-sim-flight-plans/1',plans:[plan]}))).plans[0]!.nodes[0]!.alarm).toEqual(alarm);
 for(const alarm of [{enabled:true,leadSeconds:-1,pause:false},{enabled:true,leadSeconds:86401,pause:false},{enabled:'yes',leadSeconds:10,pause:false}])expect(()=>service.capture(world,ship,[{...node,alarm:alarm as any}])).toThrow();world.dispose();
});
it('runs a real packaged alarm service in browser/offline/node without plans, UI, motion or execution modules',async()=>{
 const {cp,mkdtemp,readFile,rm}=await import('node:fs/promises'),{join,resolve}=await import('node:path'),{tmpdir}=await import('node:os');
 const {buildPortableModule}=await import('../../packages/module-tools/package.mjs'),{inspectRuntimePackage}=await import('../../packages/game-library/src/runtime-package'),{ModuleRegistryV2}=await import('../../packages/game-runtime/src/modules-v2');
 const dir=await mkdtemp(join(tmpdir(),'orbital-alarm-archive-'));
 try{
  const source=join(dir,'source'),out=join(dir,'alarms.spacemod');await cp(resolve('modules/orbital-alarms'),source,{recursive:true});await buildPortableModule(join(source,'module.json'),out,{typecheck:false});
  const archive=await inspectRuntimePackage(new Uint8Array(await readFile(out)));
  for(const environment of ['browser','offline','node'] as const){
   const registry=new ModuleRegistryV2(),registered=archive.register({environment,allowRuntimeCode:true,approvedDigests:new Set([archive.digest])});registry.register(registered.module,registered.assets);
   const candidate=registry.prepare({format:'space-sim-profile/2',id:'fixture.alarms',modules:[{id:archive.id,version:archive.version}],providers:{'flight.alarms':archive.id},capabilities:{},settings:{}},environment),clock=candidate.providedService(ORBITAL_ALARMS).create();
   expect(clock.sync({},99,[event()])).toHaveLength(1);clock.dispose();candidate.dispose();
  }
 }finally{await rm(dir,{recursive:true,force:true});}
},60000);
