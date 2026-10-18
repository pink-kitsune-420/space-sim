import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MANEUVER_BURNS} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {engineModuleServices} from '../../packages/sim-core/src/module-services';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld} from '../../packages/sim-core/src/save';

it('imports fixed-tick maneuver intent independently of UI, requires its clock and cancels stale pending burns',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'portable-maneuver-burn-'));
 try{
  const source=join(directory,'burn'),output=join(directory,'burn.spacemod');await cp(resolve('modules/maneuver-burn'),source,{recursive:true});await buildPortableModule(join(source,'module.json'),output,{typecheck:false});const checked=await inspectRuntimePackage(new Uint8Array(await readFile(output)));
  for(const environment of ['browser','offline','node'] as const){
   const registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])}),missing=new ModuleRegistryV2();missing.register(registration.module,registration.assets);
   const profile={format:'space-sim-profile/2' as const,id:'fixture.maneuver-intent',modules:[{id:checked.id,version:checked.version}],providers:{'flight.maneuver-burn':checked.id},capabilities:{},settings:{}};
   expect(()=>missing.prepare(profile,environment)).toThrow('core.clock');
   const registry=new ModuleRegistryV2(engineModuleServices());registry.register(registration.module,registration.assets);const candidate=registry.prepare(profile,environment),factory=candidate.providedService(MANEUVER_BURNS),world=new World(DEFAULT_UNIVERSE);
   try{
    const ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),before=JSON.stringify(saveWorld(world)),state={...ship.state,heading:0,time:.1},burn=factory.create(.1,{x:1,y:0},world.context.vehicle);
    expect(burn.next(state)).toEqual({controls:{turn:0,throttle:0,engine:true},throttle:.8});expect(burn.phase).toBe('burning');
    expect(burn.next({...state,time:.11})).toEqual({controls:{turn:0,throttle:0,engine:false},throttle:0});expect(burn.phase).toBe('complete');expect(burn.remaining).toBe(0);
    const pending=factory.create(.1,{x:1,y:0},world.context.vehicle);pending.next(state);candidate.dispose();expect(()=>pending.next({...state,time:.11})).toThrow('disposed');expect(()=>factory.create(.1,{x:1,y:0},world.context.vehicle)).toThrow('disposed');expect(JSON.stringify(saveWorld(world))).toBe(before);
    // Completed intent remains idle; provider removal cannot replay thrust.
    expect(burn.next({...state,time:.12}).controls.engine).toBe(false);burn.dispose();burn.dispose();
   }finally{candidate.dispose();world.dispose();}
   const optional=registry.prepare({...profile,modules:[],providers:{}},environment);expect(optional.lock.order).toEqual([]);optional.dispose();
  }
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);
