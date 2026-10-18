import {expect,it} from 'vitest';
import {LOCAL_PILOTS,LOCAL_VIEWS,VIEW_CAMERAS,GAMEPAD_INPUT,PROFILERS,type ManifestV2,type ModuleProfileV2,type RegisteredModuleV2} from '../../packages/game-api/src/index';
import {ModuleRegistryV2,moduleAssets} from '../../packages/game-runtime/src/modules-v2';
import {createFollowCameras} from '../../modules/camera-follow/src/follow';
import initializeViews from '../../modules/local-views/src/index';
import viewsDescriptor from '../../modules/local-views/module.json';
import viewsGuide from '../../modules/local-views/docs/creators/usage.json';
import initializePilots from '../../modules/local-pilots/src/index';
import pilotsDescriptor from '../../modules/local-pilots/module.json';
import pilotsGuide from '../../modules/local-pilots/docs/creators/usage.json';
import initializeGamepad from '../../modules/input-gamepad/src/index';
import gamepadDescriptor from '../../modules/input-gamepad/module.json';
import gamepadGuide from '../../modules/input-gamepad/docs/creators/usage.json';
import initializeProfiler from '../../modules/profiler/src/index';
import profilerDescriptor from '../../modules/profiler/module.json';
import profilerGuide from '../../modules/profiler/docs/creators/usage.json';

function register(registry:ModuleRegistryV2,raw:unknown,initialize:RegisteredModuleV2['initialize'],guide:unknown):ManifestV2{
 const manifest=raw as ManifestV2;
 registry.register({manifest,initialize},moduleAssets(new Map([['docs/creators/usage.json',new TextEncoder().encode(JSON.stringify(guide))]])));
 return manifest;
}
function profile(manifests:ManifestV2[]):ModuleProfileV2{
 return{format:'space-sim-profile/2',id:'fixture.cleanup',modules:manifests.map(({id,version})=>({id,version})),providers:Object.fromEntries(manifests.flatMap(m=>m.slots.map(slot=>[slot,m.id]))),capabilities:{},settings:{}};
}
function errors(values:readonly unknown[]):unknown[]{return values.flatMap(value=>value instanceof AggregateError?errors(value.errors):[value]);}

it('candidate disposal closes all local views and cameras on the first pass despite a failing surface',()=>{
 const registry=new ModuleRegistryV2(),manifest=register(registry,viewsDescriptor.manifest,initializeViews,viewsGuide),closed:string[]=[],failure=new Error('surface refused cleanup');
 const cameraManifest:ManifestV2={...manifest,id:'fixture.cameras',requires:[],provides:[{name:'view.camera',version:'1.0.0'}],slots:['view.camera']};
 registry.register({manifest:cameraManifest,initialize(context){const factory=context.own(createFollowCameras());context.provide(VIEW_CAMERAS,{create(id){const camera=factory.create(id),close=camera.dispose.bind(camera);camera.dispose=()=>{closed.push(id+'/camera');close();};return camera;}});}});
 const candidate=registry.prepare(profile([manifest,cameraManifest]),'offline'),factory=candidate.providedService(LOCAL_VIEWS);
 const views=[0,1].map(index=>factory.create({bindings:[{seatId:`seat${index}`,viewportId:`view${index}`}],layout:'auto',mode:'split',surface(){return{resize(){},draw(){},dispose(){closed.push(`view${index}/surface`);if(index===0)throw failure;}};}}));
 const first=views[0]!.camera('view0');candidate.dispose();
 expect(closed).toEqual(['view0/surface','view0/camera','view1/surface','view1/camera']);
 expect(errors(candidate.core.disposalErrors)).toEqual([failure]);expect(views.map(view=>view.count)).toEqual([0,0]);
 expect(()=>first.changeZoom(2)).toThrow('disposed');expect(()=>factory.create({bindings:[],layout:'auto',mode:'split',surface(){throw new Error('unreachable');}})).toThrow('disposed');
 candidate.dispose();views.forEach(view=>view.dispose());expect(closed).toHaveLength(4);
});

it('candidate disposal releases every pilot host once and retains original failures',()=>{
 const registry=new ModuleRegistryV2(),manifest=register(registry,pilotsDescriptor.manifest,initializePilots,pilotsGuide),candidate=registry.prepare(profile([manifest]),'offline'),factory=candidate.providedService(LOCAL_PILOTS),closed:number[]=[],failure=new Error('host refused release');
 const pilots=[0,1].map(index=>factory.create({count:()=>1,playerId:()=>`player${index}`,assign(){},release(){closed.push(index);if(index===0)throw failure;}}));
 candidate.dispose();expect(closed).toEqual([0,1]);expect(errors(candidate.core.disposalErrors)).toEqual([failure]);
 for(const pilot of pilots)expect(()=>pilot.count).toThrow('disposed');
 expect(()=>factory.create({count:()=>1,playerId(){return undefined;},assign(){},release(){}})).toThrow('disposed');
 candidate.dispose();pilots.forEach(pilot=>pilot.dispose());expect(closed).toEqual([0,1]);
});

it('candidate cleanup completes remaining gamepad sources after an independent source fails',()=>{
 const registry=new ModuleRegistryV2(),manifest=register(registry,gamepadDescriptor.manifest,initializeGamepad,gamepadGuide),candidate=registry.prepare(profile([manifest]),'offline'),factory=candidate.providedService(GAMEPAD_INPUT),closed:number[]=[],failure=new Error('source cleanup failed');
 const options={actions:[],bindings:[],deadzone:.15,pad:(pilot:number)=>pilot};
 const sources=[0,1].map(index=>{const source=factory.create(options),close=source.dispose.bind(source);source.dispose=()=>{closed.push(index);close();if(index===0)throw failure;};return source;});
 expect(sources).toHaveLength(2);candidate.dispose();expect(closed).toEqual([0,1]);expect(errors(candidate.core.disposalErrors)).toEqual([failure]);expect(()=>factory.create(options)).toThrow('disposed');candidate.dispose();expect(closed).toEqual([0,1]);
});

it('profiler provider drops every retained history before reporting a child failure',()=>{
 const registry=new ModuleRegistryV2(),manifest=register(registry,profilerDescriptor.manifest,initializeProfiler,profilerGuide),candidate=registry.prepare(profile([manifest]),'offline'),factory=candidate.providedService(PROFILERS),failure=new Error('profiler cleanup failed');
 const first=factory.create(),second=factory.create(),close=first.dispose.bind(first);first.event('one');second.event('two');first.dispose=()=>{close();throw failure;};
 candidate.dispose();expect(first.log()).toEqual([]);expect(second.log()).toEqual([]);expect(errors(candidate.core.disposalErrors)).toEqual([failure]);expect(()=>factory.create()).toThrow('disposed');candidate.dispose();
});
