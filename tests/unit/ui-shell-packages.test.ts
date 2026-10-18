import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {HUD_LAYOUT,MANUAL_READER,MOD_MENU,WINDOW_SHELL,type ManifestV2} from '../../packages/game-api/src/index';
for(const name of ['ui-shell','hud-layout','manual','mod-menu'])it(`imports ${name} through public requirements and handles dependency removal`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ui-shell-package-'));
 try{
  const graph=new ModuleRegistryV2(),manifests:ManifestV2[]=[];
  for(const folder of ['ui-windows',name]){
   const source=join(directory,folder),output=join(directory,`${folder}.spacemod`);await cp(resolve(`modules/${folder}`),source,{recursive:true});
   await buildPortableModule(join(source,'module.json'),output,{typecheck:false});
   const imported=await inspectRuntimePackage(new Uint8Array(await readFile(output))),registration=imported.register({environment:'browser',allowRuntimeCode:true,approvedDigests:new Set([imported.digest])});
   graph.register(registration.module,registration.assets);manifests.push(registration.module.manifest);
  }
  const profile={format:'space-sim-profile/2' as const,id:'fixture.ui',modules:manifests.map(manifest=>({id:manifest.id,version:manifest.version})),providers:Object.fromEntries(manifests.flatMap(manifest=>manifest.slots.map(slot=>[slot,manifest.id]))),capabilities:{},settings:{}};
  const candidate=graph.prepare(profile,'browser');
  if(name==='ui-shell')expect(typeof candidate.providedService(WINDOW_SHELL).create).toBe('function');
  else if(name==='hud-layout')expect(typeof candidate.providedService(HUD_LAYOUT).visibility).toBe('function');
  else if(name==='manual')expect(typeof candidate.providedService(MANUAL_READER).guides).toBe('function');
  else expect(typeof candidate.providedService(MOD_MENU).profile).toBe('function');
  candidate.dispose();
  const removed={...profile,modules:profile.modules.slice(1),providers:{[manifests[1]!.slots[0]!]:manifests[1]!.id}};
  if(name==='mod-menu'){const independent=graph.prepare(removed,'browser');expect(typeof independent.providedService(MOD_MENU).modules).toBe('function');independent.dispose();}
  else expect(()=>graph.prepare(removed,'browser')).toThrow(name==='manual'?'ui.window-content':'ui.windows');
  const empty=graph.prepare({...profile,modules:[],providers:{}},'browser');expect(empty.lock.order).toEqual([]);empty.dispose();
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);
