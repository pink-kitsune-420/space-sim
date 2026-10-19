import {test,expect,type Page} from '@playwright/test';
import {cp,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {rolldown} from 'rolldown';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
let directory:string,hostSource:string;
let bundles:{manifest:unknown;source:string;assets:[string,string][]}[];
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'portable-maneuver-editor-'));bundles=[];
 for(const name of ['ui-windows','flight-prediction','maneuver-burn','maneuver-display','maneuver-editor']){
  const source=join(directory,name);await cp(resolve('modules',name),source,{recursive:true});const built=await buildPortableModule(join(source,'module.json'),join(directory,`${name}.spacemod`),{typecheck:false,shippedBuild:true});
  bundles.push({manifest:built.descriptor.manifest,source:built.codeV2!.source,assets:[...built.descriptor.assets.map(asset=>asset.path),...built.descriptor.guides].map(path=>[path,new TextDecoder().decode(built.files.get(path)!)])});
 }
 const host=await rolldown({input:resolve('tests/fixtures/maneuver-host.ts'),plugins:[{name:'public-api',resolveId(raw){if(raw==='@space-sim/game-api')return resolve('packages/game-api/src/index.ts');}}]});
 try{hostSource=(await host.generate({format:'iife',name:'ManeuverHost'})).output[0]!.code;}finally{await host.close();}
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
async function setup(page:Page,noEngine=false){
 await page.goto('about:blank');await page.setContent('<main style="position:relative;width:800px;height:600px"></main>');await page.addScriptTag({content:hostSource});
 await page.evaluate(({bundles,noEngine})=>{
  const api=(window as any).ManeuverHost,registry=new api.ModuleRegistryV2(api.engineModuleServices());
  for(const bundle of bundles){const initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();registry.register({manifest:bundle.manifest,initialize},api.moduleAssets(new Map(bundle.assets.map(([path,text])=>[path,new TextEncoder().encode(text)]))));}
  const manifests=bundles.map(bundle=>bundle.manifest as any),profile={format:'space-sim-profile/2',id:'fixture.independent-maneuvers',modules:manifests.map(m=>({id:m.id,version:m.version})),providers:Object.fromEntries(manifests.flatMap(m=>m.slots.map((slot:string)=>[slot,m.id]))),capabilities:{},settings:{}};
  const universe=noEngine?{...api.DEFAULT_UNIVERSE,systems:api.DEFAULT_UNIVERSE.systems.map((system:any)=>({...system,vehicleDefaults:{...system.vehicleDefaults,acceleration:0}}))}:api.DEFAULT_UNIVERSE;
  const candidate=registry.prepare(profile,'browser'),factory=candidate.providedService(api.MANEUVER_PLANNERS),prediction=candidate.providedService(api.PREDICTIONS).create(()=>{}),world=new api.World(universe,{id:'independent-preview'}),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});world.step();
  const current=()=>world.ship(ship.id),body=world.body(ship.bodyId);
  for(let frame=0;frame<200&&prediction.pathEnd!=='closed';frame++)prediction.update(world.context,current().state,body,world.surface(body.id),ship.id,.1,false,current().controls,world);
  if(prediction.pathEnd!=='closed')throw new Error('Fixture needs complete prediction');
  const origin=world.system.getBodyPosition(body.id,world.time),camera={center:origin,rotation:0,scale:.3},sample=prediction.path[Math.floor(prediction.path.length/3)],pointer=api.createProjector(camera,800,600)({x:origin.x+sample.position.x,y:origin.y+sample.position.y});
  (window as any).fixture={api,registry,candidate,factory,prediction,world,current,body,origin,camera,pointer,profile,root:document.querySelector('main')};
 },{bundles,noEngine});
}

test('coasting to a zero-delta node needs no engine and issues only warp commands',async({page})=>{
 await setup(page,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:number[]=[];
  let warp=1;const before=JSON.stringify(f.api.saveWorld(world));
  const planner=factory.create({container:root,id:'coast-only',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp,requestedWarp:warp}),
   setWarp(factor:number){warp=factor;commands.push(factor);},setThrottle(){throw new Error('Must not touch throttle');},releaseControls(){throw new Error('Must not arm execution');},notify(){}});
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const timing=document.getElementById('coast-only-time') as HTMLInputElement;timing.value='20';timing.dispatchEvent(new Event('change'));planner.update(.1,prediction,false);
  const button=document.getElementById('coast-only-warp') as HTMLButtonElement,enabled=!button.disabled;
  button.click();planner.beforeAdvance({engine:false,turn:0,throttle:0});const warping=planner.diagnostics()?.warping,executing=planner.executing;
  planner.cancel();planner.dispose();f.candidate.dispose();const preserved=JSON.stringify(f.api.saveWorld(world))===before,acceleration=world.context.vehicle.acceleration;world.dispose();
  return{enabled,warping,executing,commands,preserved,acceleration};
 });
 expect(result).toMatchObject({enabled:true,warping:true,executing:false,preserved:true,acceleration:0});
 expect(result.commands[0]).toBeGreaterThan(1);expect(result.commands.at(-1)).toBe(1);
});

test('independent read-only planner instances edit isolated candidate paths and dispose their windows, dock leases and stale controls',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:string[]=[],events:string[]=[],docks:string[]=[];
  const before=JSON.stringify(f.api.saveWorld(world)),options={container:root,flight:()=>({world,ship:current(),body,enabled:true,canWarp:false,paused:true,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');throw new Error('Read-only warp');},setThrottle(){commands.push('throttle');throw new Error('Read-only throttle');},releaseControls(){commands.push('release');},notify(){},event(kind:string){events.push(kind);},shell:{addInstrument(window:any){const id=window.element.id;docks.push('open:'+id);return{dispose(){docks.push('close:'+id);}};}}};
  const first=factory.create({...options,id:'map-one'}),second=factory.create({...options,id:'map-two'});first.update(0,prediction,false);second.update(0,prediction,false);
  const placed=first.place(f.pointer,f.camera,f.origin,800,600,prediction),input=document.getElementById('map-one-prograde') as HTMLInputElement;input.value='10';input.dispatchEvent(new Event('input'));
  for(let frame=0;frame<100&&(first.snapshot()?.path.length??0)<20;frame++)first.update(.1,prediction,false);
  const planned=first.snapshot(),isolated=second.snapshot()===undefined,disabled=(document.getElementById('map-one-execute') as HTMLButtonElement).disabled&&(document.getElementById('map-one-warp') as HTMLButtonElement).disabled;
  const unique=new Set([...root.querySelectorAll('[id]')].map((node:any)=>node.id)).size===root.querySelectorAll('[id]').length;
  factory.dispose();const count=events.length;input.value='20';input.dispatchEvent(new Event('input'));document.dispatchEvent(new Event('visibilitychange'));const stale=first.place(f.pointer,f.camera,f.origin,800,600,prediction);
  let rejected=false;try{factory.create({...options,id:'late'});}catch{rejected=true;}
  f.candidate.dispose();const preserved=JSON.stringify(f.api.saveWorld(world))===before;world.dispose();
  return{placed,samples:planned?.path.length??0,isolated,disabled,unique,commands,docks,stale,rejected,eventsUnchanged:events.length===count,preserved,windows:root.querySelectorAll('.maneuver-window').length,styles:document.head.querySelectorAll('style').length};
 });
 expect(result).toMatchObject({placed:true,isolated:true,disabled:true,unique:true,commands:[],docks:['open:map-one-window','open:map-two-window','close:map-one-window','close:map-two-window'],stale:false,rejected:true,eventsUnchanged:true,preserved:true,windows:0,styles:0});expect(result.samples).toBeGreaterThan(20);
});

test('a failing warp cancellation still releases host controls, preview resources and all independent editors',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,calls:string[]=[],closed:string[]=[];
  const options={container:root,flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){calls.push('warp');throw new Error('warp port failure');},setThrottle(){calls.push('throttle');},releaseControls(){calls.push('release');},notify(){},shell:{addInstrument(window:any){return{dispose(){closed.push(window.element.id);}};}}};
  const first=factory.create({...options,id:'armed-one'}),second=factory.create({...options,id:'armed-two'});first.update(0,prediction,false);second.update(0,prediction,false);first.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const input=document.getElementById('armed-one-prograde') as HTMLInputElement;input.value='1';input.dispatchEvent(new Event('input'));first.update(.1,prediction,false);
  const button=document.getElementById('armed-one-execute') as HTMLButtonElement;if(button.disabled)throw new Error('Fixture must allow arming');button.click();const armed=first.executing;
  const errors:string[]=[];const flatten=(error:any):void=>{if(error instanceof AggregateError)error.errors.forEach(flatten);else errors.push(error.message);};try{factory.dispose();}catch(error){flatten(error);}factory.dispose();
  const after=first.step({turn:0,throttle:0,engine:false});f.candidate.dispose();world.dispose();
  return{armed,calls,closed,errors,after,windows:root.querySelectorAll('.maneuver-window').length,styles:document.head.querySelectorAll('style').length};
 });
 expect(result).toMatchObject({armed:true,calls:['warp','warp','release'],closed:['armed-one-window','armed-two-window'],errors:['warp port failure','warp port failure'],after:{turn:0,throttle:0,engine:false},windows:0,styles:0});
});
