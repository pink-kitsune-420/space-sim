import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MANEUVER_PLANNERS,type ManifestV2} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ShippedModuleCatalogue} from '../../packages/game-library/src/shipped-catalogue';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {engineModuleServices} from '../../packages/sim-core/src/module-services';
it('composes the real editor/display archives through declared services and preserves an active candidate on dependency recovery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'portable-maneuver-editor-'));
 try{
  const archives=[];
  for(const name of ['ui-windows','flight-prediction','maneuver-burn','maneuver-display','maneuver-editor']){
   const source=join(directory,name),output=join(directory,`${name}.spacemod`);await cp(resolve('modules',name),source,{recursive:true});const built=await buildPortableModule(join(source,'module.json'),output,{typecheck:false,shippedBuild:true});archives.push({bytes:new Uint8Array(await readFile(output)),id:built.descriptor.manifest.id,version:built.descriptor.manifest.version,digest:built.integrity.digest});
  }
  const shipped=new ShippedModuleCatalogue(archives.filter(a=>a.id.startsWith('builtin.')).map(({id,version,digest})=>({id,version,digest})));
  for(const environment of ['browser','offline'] as const){
   const registry=new ModuleRegistryV2(engineModuleServices()),manifests:ManifestV2[]=[];
   for(const archive of archives){const checked=await inspectRuntimePackage(archive.bytes,{shipped}),registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])});registry.register(registration.module,registration.assets);manifests.push(registration.module.manifest);}
   const profile=(selected:ManifestV2[])=>({format:'space-sim-profile/2' as const,id:'fixture.maneuver-editor',modules:selected.map(({id,version})=>({id,version})),providers:Object.fromEntries(selected.flatMap(m=>m.slots.map(slot=>[slot,m.id]))),capabilities:{},settings:{}});
   const active=registry.prepare(profile(manifests),environment);expect(active.providedService(MANEUVER_PLANNERS).create).toBeTypeOf('function');expect(active.core.layers.map(layer=>layer.id)).toContain('builtin.maneuver-planner/maneuver');
   for(const [id,service] of [['spacelab.ui-windows','ui.windows'],['spacelab.flight-prediction','view.prediction'],['spacelab.maneuver-burn','flight.maneuver-burn'],['builtin.maneuver-planner','view.maneuver-display']]){
    expect(()=>registry.prepare(profile(manifests.filter(m=>m.id!==id)),environment)).toThrow(service);expect(active.available).toBe(true);
   }
   const withoutEditor=registry.prepare(profile(manifests.filter(m=>m.id!=='spacelab.maneuver-editor')),environment);expect(withoutEditor.core.layers.map(layer=>layer.id)).toContain('builtin.maneuver-planner/maneuver');withoutEditor.dispose();active.dispose();
   const empty=registry.prepare(profile([]),environment);expect(empty.lock.order).toEqual([]);empty.dispose();
  }
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);
