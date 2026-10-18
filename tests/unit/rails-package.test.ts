import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {BODY_FRAMES,MOTION_CONTEXTS,ORBITAL_MOTION,RAILS_POLICY,SURFACE_GEOMETRY,type ModuleProfileV2,type SimulationContextFactory} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ShippedModuleCatalogue} from '../../packages/game-library/src/shipped-catalogue';
import {normalizeLegacyModule} from '../../packages/game-runtime/src/loader';
import {createLegacyMotion} from '../../modules/physics-rails/src/legacy';
import {moduleAssets} from '../../packages/game-runtime/src/modules-v2';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';
import {canonicalJson,sha256Hex} from '../../packages/game-runtime/src/authoritative';
import {coreMotionService,engineModuleServices} from '../../packages/sim-core/src/module-services';
import {World} from '../../packages/sim-core/src/world';
import {DEFAULT_UNIVERSE} from '../../packages/sim-core/src/universe';
import {saveWorld,loadWorld,DEFAULT_BUILTIN_LOCK} from '../../packages/sim-core/src/save';
import {OCEAN_UNIVERSE,SOLAR_UNIVERSE,TERRAIN_UNIVERSE} from '../../packages/scenarios/builtin';
import {moduleWorldConfiguration} from '../../packages/sim-core/src/module-world';
import {prepareInstalledGame} from '../../packages/game-runtime/src/game-loader';
import {MemoryPackageStore,installPackage} from '../../packages/game-runtime/src/package-store';
import {prepareGame} from '../../packages/modules/src/index';

it('preserves shipped rails services and exact state through public archive composition and legacy saves',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'portable-rails-'));
 try{
  const source=join(directory,'physics'),output=join(directory,'physics.spacemod');await cp(resolve('modules/physics-rails'),source,{recursive:true});
  const built=await buildPortableModule(join(source,'module.json'),output,{typecheck:false,shippedBuild:true}),bytes=new Uint8Array(await readFile(output));
  await expect(inspectRuntimePackage(bytes)).rejects.toThrow('exact shipped catalogue pin');
  const shipped=new ShippedModuleCatalogue([{id:'builtin.motion',version:'0.1.0',digest:built.integrity.digest}]),inspect=(data:Uint8Array)=>inspectRuntimePackage(data,{shipped}),checked=await inspect(bytes),store=new MemoryPackageStore();
  await installPackage(bytes,store,inspect,{source:'Local rails fixture',installedAt:'2026-10-18T00:00:00Z'},{environment:'node',allowRuntimeCode:true});
  const profile:ModuleProfileV2={format:'space-sim-profile/2',id:'fixture.rails',modules:[{id:checked.id,version:checked.version}],providers:Object.fromEntries(['motion','orbits','bodies','surfaces','rails'].map(slot=>[slot,checked.id])),capabilities:{},settings:{}};
  for(const environment of ['browser','offline','node'] as const){
   const registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])}),missing=new ModuleRegistryV2();missing.register(registration.module,registration.assets);expect(()=>missing.prepare(profile,environment)).toThrow('core.motion');
   const registry=new ModuleRegistryV2(engineModuleServices());registry.register(registration.module,registration.assets);const candidate=registry.prepare(profile,environment);
   expect(candidate.soloPreview).toBe(false);const createContext=candidate.providedService(MOTION_CONTEXTS);
   expect(createContext).toBe(coreMotionService.createContext);
   const services={orbits:candidate.providedService(ORBITAL_MOTION),bodies:candidate.providedService(BODY_FRAMES),surfaces:candidate.providedService(SURFACE_GEOMETRY),rails:candidate.providedService(RAILS_POLICY)};
   for(const key of ['orbits','bodies','surfaces','rails'] as const)expect(services[key]).toBe(coreMotionService.services[key]);
   let composed!:SimulationContextFactory;
   const installed=await prepareInstalledGame({profile,packages:[{id:checked.id,version:checked.version,digest:checked.digest}],requiredSlots:['motion']},store,{environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])},{hostServices:engineModuleServices(),staticModules:[],inspect,construct(modules,identity){composed=moduleWorldConfiguration(modules,identity).options.createContext!;return{async start(){},dispose(){}};}},new AbortController().signal);
   // Fixed kernel reference and imported provider run identical commands in isolated worlds.
   for(const universe of [DEFAULT_UNIVERSE,SOLAR_UNIVERSE,TERRAIN_UNIVERSE,OCEAN_UNIVERSE]){
    const baseline=new World(universe,{id:'rails-equivalence'}),extracted=new World(universe,{id:'rails-equivalence',soloPreview:false,createContext:composed});
    try{
     for(const world of [baseline,extracted])for(const preset of world.system.presets)world.spawn({ownerId:'pilot',presetId:preset.id});
     const ship=baseline.ships()[0]!.id;
     for(let tick=0;tick<200;tick++){
      for(const world of [baseline,extracted]){
       if(tick===20)world.setControls(ship,{turn:1,throttle:0,engine:true});
       if(tick===35)world.setControls(ship,{turn:0,throttle:0,engine:false});
       if(tick===60)world.setThrottle(ship,.5);
      }
      expect(extracted.step()).toEqual(baseline.step());
     }
     const expected=saveWorld(baseline),actual=saveWorld(extracted);expect(actual).toEqual(expected);
     expect(sha256Hex(canonicalJson(JSON.parse(JSON.stringify(actual))))).toBe(sha256Hex(canonicalJson(JSON.parse(JSON.stringify(expected)))));
     const restored=loadWorld(actual,{soloPreview:false,createContext:composed});
     try{expect(saveWorld(restored.world)).toEqual(actual);for(let tick=0;tick<50;tick++)expect(restored.world.step()).toEqual(extracted.step());expect(saveWorld(restored.world)).toEqual(saveWorld(extracted));}finally{restored.world.dispose();}
    }finally{baseline.dispose();extracted.dispose();}
   }
   const legacyConsumer=normalizeLegacyModule({manifest:{...createLegacyMotion(coreMotionService).manifest,id:'fixture.legacy-consumer',slots:[],provides:[],dependencies:[{id:'builtin.motion',version:'^0.1.0'}],requires:['builtin.motion/v1']},initialize(){}},moduleAssets());
   registry.register(legacyConsumer);const compatible=registry.prepare({...profile,modules:[...profile.modules,{id:'fixture.legacy-consumer',version:'0.1.0'}]},environment);expect(compatible.lock.order).toContain('fixture.legacy-consumer');compatible.dispose();
   const replacement={...coreMotionService.services.orbits,id:'fixture.orbits',modelIdentity:'fixture.orbits/1'};
   registry.register({manifest:{...registration.module.manifest,id:'fixture.orbits',requires:[],provides:[{name:'orbits',version:'1.0.0'}],slots:['orbits']},supportsMultiplayer:true,initialize(context){context.provide(ORBITAL_MOTION,replacement);}});
   const swapped=registry.prepare({...profile,modules:[...profile.modules,{id:'fixture.orbits',version:'0.1.0'}],providers:{...profile.providers,orbits:'fixture.orbits'}},environment);
   expect(swapped.providedService(ORBITAL_MOTION)).toBe(replacement);expect(swapped.providedService(RAILS_POLICY)).toBe(services.rails);swapped.dispose();
   const omitted=registry.prepare({...profile,modules:[],providers:{}},environment);expect(omitted.lock.order).toEqual([]);omitted.dispose();installed.dispose();candidate.dispose();
  }
  const legacy=prepareGame({environment:'node'});
  const baseline=new World(DEFAULT_UNIVERSE,{id:legacy.world.id,lock:DEFAULT_BUILTIN_LOCK});try{expect(legacy.world.lock).toEqual(baseline.lock);expect(legacy.world.simulationFingerprint).toBe(baseline.simulationFingerprint);expect(legacy.world.context.modelIdentity).toBe(baseline.context.modelIdentity);}finally{baseline.dispose();legacy.candidate.dispose();}
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);
