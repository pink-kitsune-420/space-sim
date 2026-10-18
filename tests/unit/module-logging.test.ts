import {afterAll,expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MODULE_LOGS,type ManifestV2,type ModuleLogService,type ModuleProfileV2} from '../../packages/game-api/src/index';
import {createModuleLogs} from '../../modules/logging/src/index';
import {ModuleRegistryV2,ModuleRuntimeV2,moduleAssets} from '../../packages/game-runtime/src/modules-v2';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {runtimePackage} from '../../packages/game-library/src/runtime-package';
const folders:string[]=[];
afterAll(async()=>{for(const folder of folders)await rm(folder,{recursive:true,force:true});});
it('retains immutable bounded module entries and filtered snapshots without rounding physical values',()=>{
 let time=1;const logs=createModuleLogs({history:3,minimum:'debug',now:()=>time}),source={id:'test.reader',version:'1.2.3'},logger=logs.logger(source);
 const fields={speed:1.2345678901234567,label:'before'};
 logger.write('info','reader.open','Ready',fields);source.version='9.0.0';fields.label='after';
 const first=logs.entries()[0]!;expect(first).toMatchObject({sequence:1,timeMs:1,module:{id:'test.reader',version:'1.2.3'},fields:{speed:1.2345678901234567,label:'before'}});
 expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.module)).toBe(true);expect(Object.isFrozen(first.fields)).toBe(true);
 for(const level of ['debug','warn','error'] as const){time++;logger.write(level,'reader.state',level);}
 expect(logs.entries().map(entry=>entry.sequence)).toEqual([2,3,4]);expect(logs.entries({moduleId:'other.reader'})).toEqual([]);
 expect(logs.entries({minimum:'warn',after:2,limit:1}).map(entry=>entry.level)).toEqual(['error']);expect(logs.entries({limit:0})).toEqual([]);
 logs.clear();logger.write('info','reader.reset','Reset');expect(logs.entries()[0]!.sequence).toBe(5);expect(first.message).toBe('Ready');
 logger.dispose();logger.write('error','reader.stale','Ignored');expect(logs.entries()).toHaveLength(1);logs.dispose();expect(logger.enabled('error')).toBe(false);expect(logs.entries()).toEqual([]);
});
it('filters before lazy formatting, caps per-scope rates and isolates invalid data, sinks and clocks',()=>{
 let time=0,formatted=0,sinks=0;const logs=createModuleLogs({maxPerSecond:2,messageLength:64,now:()=>time,sink(){sinks++;throw new Error('sink failed');}}),logger=logs.logger({id:'test.reader',version:'1.0.0'});
 logger.write('debug','reader.debug',()=>{formatted++;return 'debug';});expect(formatted).toBe(0);
 logger.write('info','reader.ready','x'.repeat(80),{text:'x'.repeat(1100)});logger.write('warn','reader.warn','Warning');
 logger.write('error','reader.rate',()=>{formatted++;return 'excess';});expect(formatted).toBe(0);expect(sinks).toBe(2);
 expect(logs.entries()[0]!.message).toHaveLength(64);expect(logs.entries()[0]!.fields!.text).toHaveLength(1024);
 time=1000;logger.write('info','reader.invalid','Invalid',{number:NaN});logger.write('info','reader.format',()=>{throw new Error('formatter failed');});
 logger.write('info','reader.ready','Next');expect(logs.entries()).toHaveLength(3);time=NaN;logger.write('error','reader.clock','Invalid clock');expect(logs.entries()).toHaveLength(3);
 logs.dispose();expect(()=>createModuleLogs({history:0})).toThrow('options');
});
const profile=(modules:ManifestV2[],providers:Record<string,string>={}):ModuleProfileV2=>({format:'space-sim-profile/2',id:'test.logs',modules:modules.map(({id,version})=>({id,version})),providers,capabilities:{},settings:{}});
it('uses the real logging archive in browser, offline and Node with declared optional consumers and cleanup',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'module-logs-'));folders.push(folder);await cp('modules/logging',join(folder,'logging'),{recursive:true});
 const built=await buildPortableModule(join(folder,'logging/module.json'),join(folder,'logging.spacemod'),{typecheck:false});
 const provider=JSON.parse(await readFile('modules/logging/module.json','utf8')).manifest as ManifestV2;
 const reader:ManifestV2={...provider,id:'test.reader',name:'Reader',provides:[],slots:[],settings:{},requires:[{name:MODULE_LOGS.slot,version:'^1.0.0',optional:true}]};
 for(const environment of ['browser','offline','node'] as const){
  const registry=new ModuleRegistryV2();registry.register(runtimePackage(built).register({environment,allowRuntimeCode:true,approvedDigests:new Set([built.integrity.digest])}).module,moduleAssets(built.files));
  let closed=0;
  registry.register({manifest:reader,initialize(context){const logs=context.tryUse(MODULE_LOGS);if(logs){const log=context.own(logs.logger(context.module!));log.write('info','reader.ready','Non-flight document reader ready',{documents:1});}context.own({dispose(){closed++;}});}});
  const candidate=registry.prepare(profile([provider,reader],{[MODULE_LOGS.slot]:provider.id}),environment),logs=candidate.providedService(MODULE_LOGS);
  expect(logs.entries({moduleId:reader.id})).toMatchObject([{module:{id:reader.id,version:reader.version},event:'reader.ready',fields:{documents:1}}]);candidate.dispose();expect(closed).toBe(1);expect(logs.entries()).toEqual([]);
  const absent=registry.prepare(profile([reader]),environment);absent.dispose();expect(closed).toBe(2);
  registry.register({manifest:{...reader,id:'test.required',requires:[{name:MODULE_LOGS.slot,version:'^1.0.0'}]},initialize(){throw new Error('must not initialize');}});
  expect(()=>registry.prepare(profile([{...reader,id:'test.required'}]),environment)).toThrow('needs diagnostics.logs');
 }
});
it('observes all module tiers outside deterministic initialization and preserves active candidates on failure',()=>{
 const manifest:ManifestV2={format:'space-sim-module/2',apiVersion:'space-sim-game-api/2',id:'test.authority',name:'Authority',version:'1.0.0',kind:'provider',tier:'authoritative',environments:['node'],dependencies:[],conflicts:[],provides:[],requires:[],slots:[],before:[],after:[],settings:{},license:'MIT'};
 const logs=createModuleLogs({minimum:'debug'}),registry=new ModuleRegistryV2([],logs),plain=new ModuleRegistryV2();let released=0;
 const module={manifest,initialize(){}};registry.register(module);plain.register(module);
 const runtime=new ModuleRuntimeV2(registry,'node'),active=runtime.prepare(profile([manifest]));runtime.activate(active);
 const same=plain.prepare(profile([manifest]),'node');expect(active.lock).toEqual(same.lock);same.dispose();
 const broken={...manifest,id:'test.broken'};registry.register({manifest:broken,initialize(context){context.own({dispose(){released++;}});throw new Error('bad setup');}});
 expect(()=>runtime.prepare(profile([broken]))).toThrow('bad setup');expect(runtime.active).toBe(active);expect(active.available).toBe(true);expect(released).toBe(1);
 expect(logs.entries({moduleId:broken.id}).map(entry=>entry.event)).toEqual(['module.initializing','module.failed','module.disposed']);
 runtime.dispose();expect(logs.entries({moduleId:manifest.id}).map(entry=>entry.event)).toEqual(['module.initializing','module.initialized','module.disposed']);logs.dispose();
 // Even a broken optional diagnostic implementation cannot fail module preparation or cleanup.
 const faulty={logger(){throw new Error('logging unavailable');}} as unknown as ModuleLogService,other=new ModuleRegistryV2([],faulty);other.register(module);expect(()=>other.prepare(profile([manifest]),'node').dispose()).not.toThrow();
});
