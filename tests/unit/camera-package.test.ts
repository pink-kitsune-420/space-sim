import {expect,it} from 'vitest';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {FLIGHT_CAMERAS,LOCAL_VIEWS,VIEW_CAMERAS,type Camera,type ModuleProfileV2,type RegisteredModuleV2} from '../../packages/game-api/src/index';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {inspectRuntimePackage} from '../../packages/game-library/src/runtime-package';
import {ModuleRegistryV2} from '../../packages/game-runtime/src/modules-v2';

it('uses actual follow/local-view archives in a non-flight game, replaces camera providers and releases independent instances',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'portable-follow-camera-'));
 try{
  const packages=[];
  for(const name of ['camera-follow','local-views']){
   const source=join(directory,name),output=join(directory,`${name}.spacemod`);await cp(resolve('modules',name),source,{recursive:true});
   await buildPortableModule(join(source,'module.json'),output,{typecheck:false});packages.push(await inspectRuntimePackage(new Uint8Array(await readFile(output))));
  }
  for(const environment of ['browser','offline'] as const){
   const registry=new ModuleRegistryV2(),modules:RegisteredModuleV2[]=[];
   for(const checked of packages){const registration=checked.register({environment,allowRuntimeCode:true,approvedDigests:new Set([checked.digest])});registry.register(registration.module,registration.assets);modules.push(registration.module);}
   const profile:ModuleProfileV2={format:'space-sim-profile/2',id:'fixture.survey-cameras',modules:modules.map(m=>({id:m.manifest.id,version:m.manifest.version})),providers:Object.fromEntries(modules.flatMap(m=>m.manifest.slots.map(s=>[s,m.manifest.id]))),capabilities:{},settings:{'spacelab.camera-follow':{initialZoom:3,referenceMetres:100,orientationSeconds:0}}};
   const candidate=registry.prepare(profile,environment),factory=candidate.providedService(VIEW_CAMERAS),fleet=candidate.providedService(LOCAL_VIEWS);
   const positions={marker:{x:1e12,y:-1e12},beacon:{x:5,y:9}},draws=new Map<string,Camera>(),closed:string[]=[];let steps=0;
   const views=fleet.create({bindings:[{viewportId:'map-a',seatId:'reader',targetId:'marker'},{viewportId:'map-b',seatId:'observer',targetId:'beacon'}],layout:'side',mode:'split',surface(binding){return{resize(){},draw(camera){draws.set(binding.viewportId,{...camera,center:{...camera.center}});},dispose(){closed.push(binding.viewportId);}};}});
   views.reflow(800,600);views.camera('map-a').changeZoom(2);
   const render=()=>views.render(.02,id=>{const position=positions[id as keyof typeof positions];return position?{position,orientation:.75}:undefined;});
   steps++;render();expect(steps).toBe(1);expect(draws.get('map-a')).toEqual({center:positions.marker,rotation:.75,scale:24});expect(draws.get('map-b')?.scale).toBe(12);
   positions.marker.x+=.125;render();expect(draws.get('map-a')?.center.x).toBe(1e12+.125);expect(draws.get('map-b')?.center).toEqual(positions.beacon);expect(steps).toBe(1);
   views.camera('map-a').focus('beacon');render();expect(draws.get('map-a')?.center).toEqual(positions.beacon);
   views.camera('map-a').focus(undefined);positions.beacon.x++;render();expect(draws.get('map-a')?.center.x).toBe(5);expect(draws.get('map-b')?.center.x).toBe(6);
   const flight=candidate.providedService(FLIGHT_CAMERAS).create();flight.fling({x:50,y:0},800,600);expect(flight.follow).toBe(true);
   const stale=views.camera('map-a');candidate.dispose();expect(closed.sort()).toEqual(['map-a','map-b']);expect(()=>stale.changeZoom(2)).toThrow('disposed');expect(()=>factory.create('late')).toThrow('disposed');expect(flight.smartTarget).toBeUndefined();expect(()=>flight.changeZoom(2)).toThrow('disposed');
   const missing={...profile,modules:profile.modules.slice(1),providers:{'view.local':'spacelab.local-views'},settings:{}};
   expect(()=>registry.prepare(missing,environment)).toThrow('view.camera');
   registry.register({manifest:{...modules[0]!.manifest,id:'fixture.overview',version:'0.1.0',provides:[{name:'view.camera',version:'1.0.0'}],slots:['view.camera'],settings:{}},initialize(context){context.provide(VIEW_CAMERAS,{create(viewportId){return{viewportId,targetId:undefined,mode:'free',focus(){},changeZoom(){},frame(){return{center:{x:0,y:0},rotation:0,scale:1};},dispose(){}};}});}});
   const replacement=registry.prepare({...missing,modules:[...missing.modules,{id:'fixture.overview',version:'0.1.0'}],providers:{...missing.providers,'view.camera':'fixture.overview'}},environment);expect(replacement.providedService(VIEW_CAMERAS).create('overview').frame({width:800,height:600,elapsed:0,transform:()=>undefined}).scale).toBe(1);replacement.dispose();
   const partial=registry.prepare({...profile,modules:[...profile.modules,{id:'fixture.overview',version:'0.1.0'}],providers:{...profile.providers,'view.camera':'fixture.overview'},capabilities:{'spacelab.local-views':{'view.camera':'fixture.overview'}}},environment);expect(partial.providedService(FLIGHT_CAMERAS).create().follow).toBe(true);expect(partial.providedService(VIEW_CAMERAS).create('replacement').mode).toBe('free');partial.dispose();
  }
  // The tracking package itself is headless-compatible; local browser views are not selected.
  const checked=packages[0]!,registration=checked.register({environment:'node',allowRuntimeCode:true,approvedDigests:new Set([checked.digest])}),registry=new ModuleRegistryV2();registry.register(registration.module,registration.assets);
  const candidate=registry.prepare({format:'space-sim-profile/2',id:'fixture.headless-camera',modules:[{id:registration.module.manifest.id,version:registration.module.manifest.version}],providers:{'view.camera':registration.module.manifest.id,'view.flight-camera':registration.module.manifest.id},capabilities:{},settings:{}},'node');expect(candidate.providedService(VIEW_CAMERAS).create('report').mode).toBe('free');candidate.dispose();
 }finally{await rm(directory,{recursive:true,force:true});}
},60000);
