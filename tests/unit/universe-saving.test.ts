import {WorldStore} from '../../apps/server/src/store';
import {afterEach,expect,it,vi} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {TRAINER_VEHICLE_ID,UNIVERSE_SAVES,SERVER_UNIVERSE_STORAGE,CORE_UNIVERSE_DISK,type WorldSave,type UniverseDisk,type ManifestV2} from '../../packages/game-api/src/index';
import {createUniverseSaves} from '../../modules/universe-saves/src/index';
import {createServerUniverseStorage} from '../../modules/universe-server-storage/src/index';
import {universeSaveFormat,universeSaveFormatService} from '../../packages/game-library/src/universe-save-services';
import {engineModuleServices} from '../../packages/sim-core/src/module-services';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld,loadWorld} from '../../packages/sim-core/src/save';
import {universeDisk} from '../../apps/server/src/universe-disk';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
const clean:(()=>unknown)[]=[];
afterEach(async()=>{for(const dispose of clean.splice(0).reverse())await dispose();});
function fixture(format=universeSaveFormat){
  const world=new World(DEFAULT_UNIVERSE);world.spawn({ownerId:'pilot',presetId:'planet-orbit'});let current=world,identity:object={};
  clean.push(()=>world.dispose());const restore=vi.fn(async(raw:unknown,_signal:AbortSignal,guard:()=>void)=>{guard();const loaded=loadWorld(raw);current=loaded.world;clean.push(()=>current.dispose());identity={};});
  const provider=createUniverseSaves({save:saveWorld},format);clean.push(()=>provider.dispose());
  const options={current:()=>({identity,world:current,canSave:true,canLoad:true}),restore};
  return{world,provider,restore,options,commands:provider.create(options),switch(){identity={};}};
}
it('exports the existing universe container and filename, validates loading through the engine and keeps unrelated controllers independent',async()=>{
  const f=fixture(),write=vi.fn(async(_name:string,_bytes:Uint8Array<ArrayBuffer>,_signal:AbortSignal)=>{}),saved=await f.commands.save(write);
  expect(write.mock.calls[0]![0]).toMatch(/\.spaceuniverse$/);expect(saved.ships).toHaveLength(1);
  let bytes!:Uint8Array<ArrayBuffer>;await f.commands.save(async(_name,value)=>{bytes=value;});await f.commands.load(async()=>bytes);expect(f.restore).toHaveBeenCalledTimes(1);
  await expect(f.commands.load(async()=>new Uint8Array([123]))).rejects.toThrow();expect(f.restore).toHaveBeenCalledTimes(1);
  f.commands.dispose();await expect(f.commands.save(write)).rejects.toThrow('disposed');
  const other=f.provider.create(f.options);await expect(other.save(write)).resolves.toMatchObject({format:'space-sim-world'});
});
it('rejects stale sessions, aborts pending IO, retains source snapshots and prevents concurrent commands',async()=>{
  let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
  const format={...universeSaveFormat,async encode(save:WorldSave,signal:AbortSignal){await gate;signal.throwIfAborted();return universeSaveFormat.encode(save,signal);}};
  const f=fixture(format),write=vi.fn(async()=>{}),saving=f.commands.save(write),failed=expect(saving).rejects.toThrow('session changed');
  await expect(f.commands.save(write)).rejects.toThrow('already in progress');f.switch();release();await failed;expect(write).not.toHaveBeenCalled();
  const abort=new AbortController(),waiting=f.commands.load(async signal=>{await new Promise<void>((_done,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return new Uint8Array();},abort.signal),cancelled=expect(waiting).rejects.toThrow('Cancelled');
  abort.abort(new Error('Cancelled'));await cancelled;expect(f.restore).not.toHaveBeenCalled();
  const disposed=f.commands.load(async signal=>{await new Promise<void>((_done,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return new Uint8Array();}),closed=expect(disposed).rejects.toThrow('disposed');f.provider.dispose();await closed;
});
it('checks permissions before IO and guards immediately before host publication',async()=>{
  const f=fixture(),read=vi.fn(async()=>new Uint8Array()),denied=f.provider.create({...f.options,current:()=>({...f.options.current(),canLoad:false,canSave:false})});
  await expect(denied.load(read)).rejects.toThrow('solo game');await expect(denied.save(async()=>{})).rejects.toThrow('cannot save');expect(read).not.toHaveBeenCalled();
  const bytes=await universeSaveFormat.encode(saveWorld(f.world),new AbortController().signal);let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),published=vi.fn();
  const late=f.provider.create({...f.options,async restore(_raw,_signal,guard){await gate;guard();published();}}),loading=late.load(async()=>bytes),failure=expect(loading).rejects.toThrow('session changed');
  for(let i=0;i<20;i++)await Promise.resolve();f.switch();release();await failure;expect(published).not.toHaveBeenCalled();
});
it('captures each queued server save before IO and recovers after failed writes without hiding filesystem errors',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'universe-storage-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
  let fail=true;const io:UniverseDisk={...universeDisk,async replace(path,text){if(fail){fail=false;throw new Error('disk full');}await universeDisk.replace(path,text);}};
  const provider=createServerUniverseStorage(io);clean.push(()=>provider.dispose());const store=provider.create({directory,keepBackups:2,restore:raw=>loadWorld(raw),configurationError:()=>false});
  const f=fixture(),saved=JSON.parse(JSON.stringify(saveWorld(f.world))) as WorldSave;
  await expect(store.save(saved)).rejects.toThrow('disk full');const queued=store.save(saved);(saved as {worldId:string}).worldId='changed-after-enqueue';await queued;
  expect(JSON.parse(await readFile(store.file,'utf8')).worldId).not.toBe('changed-after-enqueue');
  const loaded=await store.load();expect(loaded!.loaded.world.size).toBe(1);loaded!.loaded.world.dispose();
  const bad=createServerUniverseStorage({...io,async names(){throw new Error('permission denied');}});clean.push(()=>bad.dispose());await expect(bad.create({directory,keepBackups:1,restore:raw=>raw,configurationError:()=>false}).backupFiles()).rejects.toThrow('permission denied');
  store.dispose();expect(()=>store.save(saved)).toThrow('disposed');await store.idle();
});
it('does not quarantine a universe when exact installed packages are missing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'universe-packages-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
  const provider=createServerUniverseStorage(universeDisk);clean.push(()=>provider.dispose());const missing=new Error('Install exact vehicle package');
  const store=provider.create({directory,keepBackups:2,restore(){throw missing;},configurationError:error=>error===missing});const f=fixture();await store.save(saveWorld(f.world));await expect(store.load()).rejects.toBe(missing);
  expect((await universeDisk.names(directory)).filter(name=>name.includes('unusable'))).toEqual([]);expect(await universeDisk.read(store.file)).toContain('space-sim-world');
});
it('runs actual save and server storage archives with declared ports, rejects missing providers and supports removal',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'universe-archives-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
  for(const name of ['universe-saves','universe-server-storage']){
    const source=join(directory,name),output=join(directory,`${name}.spacemod`);await cp(resolve('modules',name),source,{recursive:true});await buildPortableModule(join(source,'module.json'),output,{typecheck:false});const checked=await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const environment='node',registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])}),profile={format:'space-sim-profile/2' as const,id:'fixture.universe',modules:[{id:checked.id,version:checked.version}],providers:Object.fromEntries((registration.module.manifest as ManifestV2).slots.map(slot=>[slot,checked.id])),capabilities:{},settings:{}};
    const missing=new ModuleRegistryV2();missing.register(registration.module,registration.assets);expect(()=>missing.prepare(profile,environment)).toThrow('core.');
    const graph=new ModuleRegistryV2([...engineModuleServices(),universeSaveFormatService,{key:CORE_UNIVERSE_DISK,service:universeDisk,tiers:['platform'],environments:['node']}]);graph.register(registration.module,registration.assets);const candidate=graph.prepare(profile,environment);
    if(name==='universe-saves'){const f=fixture(),commands=candidate.providedService(UNIVERSE_SAVES).create(f.options);await expect(commands.save(async()=>{})).resolves.toMatchObject({format:'space-sim-world'});candidate.dispose();await expect(commands.load(async()=>new Uint8Array())).rejects.toThrow('disposed');}
    else{const store=candidate.providedService(SERVER_UNIVERSE_STORAGE).create({directory:join(directory,'world'),keepBackups:1,restore:raw=>raw,configurationError:()=>false});const f=fixture();await store.save(saveWorld(f.world));expect(await store.load()).toBeDefined();candidate.dispose();expect(()=>store.save(saveWorld(f.world))).toThrow('disposed');}
    const absent=graph.prepare({...profile,modules:[],providers:{}},environment);absent.dispose();
  }
},60000);

it('keeps a valid mixed-vehicle server universe in place when its packages are unavailable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'server-vehicle-recovery-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
 const world=new World(DEFAULT_UNIVERSE,{vehicles:{format:'space-sim-vehicles/1',defaultId:TRAINER_VEHICLE_ID,definitions:[{id:TRAINER_VEHICLE_ID,name:'Trainer'}]}});clean.push(()=>world.dispose());world.spawn({ownerId:'pilot'});
 const store=new WorldStore(directory,2);clean.push(()=>store.dispose());await store.save(saveWorld(world));await expect(store.load()).rejects.toThrow('Missing required vehicle packages');expect((await universeDisk.names(directory)).filter(name=>name.includes('unusable'))).toEqual([]);
});
