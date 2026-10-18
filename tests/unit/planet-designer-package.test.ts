import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PLANET_DESIGNERS} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {engineModuleServices} from '../../packages/sim-core/src/module-services';
it('real designer archives recover required rotation, allow absent preview providers and permit complete optional removal',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'portable-designer-'));
 try{
  const source=join(directory,'source'),output=join(directory,'designer.spacemod');await cp(resolve('modules/planet-designer'),source,{recursive:true});await buildPortableModule(join(source,'module.json'),output,{typecheck:false});const archive=await inspectRuntimePackage(new Uint8Array(await readFile(output)));
  for(const environment of ['browser','offline'] as const){
   const registration=archive.register({environment,allowRuntimeCode:true,approvedDigests:new Set([archive.digest])}),profile={format:'space-sim-profile/2' as const,id:'fixture.designer',modules:[{id:archive.id,version:archive.version}],providers:{'ui.planet-designer':archive.id},capabilities:{},settings:{}};
   const missing=new ModuleRegistryV2();missing.register(registration.module,registration.assets);expect(()=>missing.prepare(profile,environment)).toThrow('core.rotation');
   const registry=new ModuleRegistryV2(engineModuleServices());registry.register(registration.module,registration.assets);const active=registry.prepare(profile,environment);expect(active.providedService(PLANET_DESIGNERS).create).toBeTypeOf('function');
   expect(()=>registry.prepare({...profile,settings:{[archive.id]:{previewSpinSeconds:0}}},environment)).toThrow();expect(active.available).toBe(true);
   registry.register({manifest:{...registration.module.manifest,id:'fixture.failed-preview',name:'Failed preview',tier:'presentation',provides:[{name:'render.webgl',version:'1.0.0'}],requires:[],slots:['render.webgl'],settings:{}},initialize(){throw new Error('Preview provider failed');}});
   expect(()=>registry.prepare({...profile,modules:[...profile.modules,{id:'fixture.failed-preview',version:archive.version}],providers:{...profile.providers,'render.webgl':'fixture.failed-preview'}},environment)).toThrow('Preview provider failed');expect(active.available).toBe(true);
   const absent=registry.prepare({...profile,modules:[],providers:{}},environment);expect(absent.lock.order).toEqual([]);absent.dispose();active.dispose();
  }
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);
