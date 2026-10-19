import {test,expect,type Page} from '@playwright/test';
import {cp,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {rolldown} from 'rolldown';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
let directory:string,hostSource:string,nodeReference:string;
let bundles:{manifest:unknown;source:string;assets:[string,string][]}[];
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'portable-maneuver-editor-'));bundles=[];
 for(const name of ['ui-windows','flight-prediction','flight-plans','orbital-alarms','alarm-panel','transfer-planner','maneuver-burn','maneuver-display','maneuver-editor']){
  const source=join(directory,name);await cp(resolve('modules',name),source,{recursive:true});const built=await buildPortableModule(join(source,'module.json'),join(directory,`${name}.spacemod`),{typecheck:false,shippedBuild:true});
  bundles.push({manifest:built.descriptor.manifest,source:built.codeV2!.source,assets:[...built.descriptor.assets.map(asset=>asset.path),...built.descriptor.guides].map(path=>[path,new TextDecoder().decode(built.files.get(path)!)])});
 }
 const host=await rolldown({input:resolve('tests/fixtures/maneuver-host.ts'),plugins:[{name:'public-api',resolveId(raw){if(raw==='@space-sim/game-api')return resolve('packages/game-api/src/index.ts');}}]});
 try{hostSource=(await host.generate({format:'iife',name:'ManeuverHost'})).output[0]!.code;}finally{await host.close();}
 const api=new Function(`${hostSource};return ManeuverHost;`)(),registry=new api.ModuleRegistryV2(api.engineModuleServices()),selected=bundles.filter(bundle=>['spacelab.flight-plans','spacelab.transfer-planner'].includes((bundle.manifest as any).id));
 for(const bundle of selected){const initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();registry.register({manifest:bundle.manifest,initialize},api.moduleAssets(new Map(bundle.assets.map(([path,text])=>[path,new TextEncoder().encode(text)]))));}
 const manifests=selected.map(bundle=>bundle.manifest as any),candidate=registry.prepare({format:'space-sim-profile/2',id:'fixture.node-reference',modules:manifests.map(m=>({id:m.id,version:m.version})),providers:Object.fromEntries(manifests.flatMap(m=>m.slots.map((slot:string)=>[slot,m.id]))),capabilities:{},settings:{}},'node');
 const world=new api.World(api.DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});world.step();
 const search=candidate.providedService(api.TRANSFERS).search(world,{shipId:ship.id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100});
 for(let i=0;i<100000;i++){const step=search.next();if(step.done){if(!step.value.options[0])throw Error('Node reference needs a validated moon transfer');nodeReference=JSON.stringify(step.value.options[0].plan.nodes);break;}}
 candidate.dispose();world.dispose();
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
async function setup(page:Page,noEngine=false,sharedPlans=false,transfers=false,alarms=false,alarmPanel=false){
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
 },{bundles:bundles.filter(bundle=>(alarmPanel||(bundle.manifest as any).id!=='spacelab.alarm-panel')&&(alarms||(bundle.manifest as any).id!=='spacelab.orbital-alarms')&&(sharedPlans||(bundle.manifest as any).id!=='spacelab.flight-plans')&&(transfers||(bundle.manifest as any).id!=='spacelab.transfer-planner')),noEngine});
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
  const plannedSamples=planned?.path.length??0;
  factory.dispose();const count=events.length;input.value='20';input.dispatchEvent(new Event('input'));document.dispatchEvent(new Event('visibilitychange'));const stale=first.place(f.pointer,f.camera,f.origin,800,600,prediction);
  let rejected=false;try{factory.create({...options,id:'late'});}catch{rejected=true;}
  f.candidate.dispose();const preserved=JSON.stringify(f.api.saveWorld(world))===before;world.dispose();
  return{placed,samples:plannedSamples,isolated,disabled,unique,commands,docks,stale,rejected,eventsUnchanged:events.length===count,preserved,windows:root.querySelectorAll('.maneuver-window').length,styles:document.head.querySelectorAll('style').length};
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

test('shared departure/arrival plans chain previews, require review after load and never arm by selection or editing',async({page})=>{
 await setup(page,false,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:string[]=[],notices:string[]=[];
  const before=JSON.stringify(f.api.saveWorld(world)),planner=factory.create({container:root,id:'chain',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(text:string){notices.push(text);}});
  const update=()=>{for(let i=0;i<20;i++)planner.update(.1,prediction,false);};
  const input=(id:string,value:string,type='input')=>{const el=document.getElementById(`chain-${id}`) as HTMLInputElement;el.value=value;el.dispatchEvent(new Event(type));};
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  input('time','12','change');input('prograde','10');update();
  (document.getElementById('chain-add') as HTMLButtonElement).click();input('prograde','2');update();
  const saved=planner.savePlans(),selected=planner.diagnostics(),chain=planner.snapshot(),count=saved.plans[0]?.nodes.length,pathSamples=chain?.path.length??0,markers=chain?.nodes?.length;
  const waiting=(document.getElementById('chain-execute') as HTMLButtonElement).disabled;
  const originalPosition=chain?.position;
  const select=document.getElementById('chain-nodes') as HTMLSelectElement;select.value=saved.plans[0].nodes[0].id;select.dispatchEvent(new Event('change'));
  input('prograde','20');update();select.value=saved.plans[0].nodes[1].id;select.dispatchEvent(new Event('change'));update();
  const moved=JSON.stringify(planner.snapshot()?.position)!==JSON.stringify(originalPosition);
  const archive=JSON.parse(JSON.stringify(planner.savePlans()));archive.armed=true;
  planner.loadPlans(archive);update();const loadedInvalid=planner.diagnostics()?.valid===false,loadedDisabled=(document.getElementById('chain-execute') as HTMLButtonElement).disabled;
  (document.getElementById('chain-review') as HTMLButtonElement).click();update();const reviewed=planner.diagnostics()?.valid===true;
  const inert=JSON.stringify(f.api.saveWorld(world))===before;
  planner.loadPlans(undefined);update();const cleared=planner.diagnostics()===null;
  planner.dispose();f.candidate.dispose();world.dispose();
  return{count,pathSamples,markers,waiting,moved,loadedInvalid,loadedDisabled,reviewed,inert,cleared,commands,selected};
 });
 expect(result).toMatchObject({count:2,markers:2,waiting:true,moved:true,loadedInvalid:true,loadedDisabled:true,reviewed:true,inert:true,cleared:true,commands:[]});expect(result.pathSamples).toBeGreaterThan(20);
});

test('a missed first burn invalidates later nodes and marking it flown still requires actual-flight review',async({page})=>{
 await setup(page,false,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:string[]=[];
  const planner=factory.create({container:root,id:'missed',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(){}});
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);(document.getElementById('missed-add') as HTMLButtonElement).click();
  const archive=planner.savePlans(),select=document.getElementById('missed-nodes') as HTMLSelectElement;select.value=archive.plans[0].nodes[0].id;select.dispatchEvent(new Event('change'));
  while(world.time<archive.plans[0].nodes[0].time+2)world.step();planner.update(.1,prediction,false);
  const missed=planner.diagnostics()?.valid===false;
  select.value=archive.plans[0].nodes[1].id;select.dispatchEvent(new Event('change'));planner.update(.1,prediction,false);const laterInvalid=planner.diagnostics()?.valid===false;
  select.value=archive.plans[0].nodes[0].id;select.dispatchEvent(new Event('change'));(document.getElementById('missed-flown') as HTMLButtonElement).click();
  select.value=archive.plans[0].nodes[1].id;select.dispatchEvent(new Event('change'));planner.update(.1,prediction,false);const stillInvalid=planner.diagnostics()?.valid===false;
  (document.getElementById('missed-review') as HTMLButtonElement).click();planner.update(.1,prediction,false);const reviewed=planner.diagnostics()?.valid===true;
  planner.dispose();f.candidate.dispose();world.dispose();return{missed,laterInvalid,stillInvalid,reviewed,commands};
 });
 expect(result).toEqual({missed:true,laterInvalid:true,stillInvalid:true,reviewed:true,commands:[]});
});

test('using a generated transfer preserves another ship’s plan and disposed search buttons cannot install anything',async({page})=>{
 await setup(page,false,true,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,body,root}=f,first=f.current(),other=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),commands:string[]=[];let selected=first.id;
  const planner=factory.create({container:root,id:'fleet-transfer',flight:()=>({world,ship:world.ship(selected),body,enabled:true,canWarp:true,paused:true,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(){}});
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const delta=document.getElementById('fleet-transfer-prograde') as HTMLInputElement;delta.value='10';delta.dispatchEvent(new Event('input'));
  const before=JSON.stringify(planner.savePlans().plans.find((p:any)=>p.shipId===first.id));
  selected=other.id;planner.update(.1,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  (document.getElementById('fleet-transfer-transfer-find') as HTMLButtonElement).click();
  for(let i=0;i<500&&!document.getElementById('fleet-transfer-transfer-use-efficient');i++)planner.update(.1,prediction,false);
  const use=document.getElementById('fleet-transfer-transfer-use-efficient') as HTMLButtonElement;if(!use)throw Error('No validated transfer');use.click();planner.update(.1,prediction,false);
  const saved=planner.savePlans(),preserved=JSON.stringify(saved.plans.find((p:any)=>p.shipId===first.id))===before,count=saved.plans.length,nodes=saved.plans.find((p:any)=>p.shipId===other.id)?.nodes.length;
  planner.dispose();use.click();const stalePlans=planner.savePlans().plans.length;f.candidate.dispose();world.dispose();return{preserved,count,nodes,stalePlans,commands};
 });
 expect(result).toEqual({preserved:true,count:2,nodes:2,stalePlans:0,commands:[]});
});

test('manual burn alarms clamp warp, include finite-burn preparation and notify once with engines untouched',async({page})=>{
 await setup(page,false,true,false,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:string[]=[],notices:string[]=[];let warp=10000,paused=false;
  const planner=factory.create({container:root,id:'manual-alarm',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused,inputBlocked:false,warp,requestedWarp:warp}),setWarp(value:number){warp=value;commands.push('warp');},setPaused(value:boolean){paused=value;commands.push('pause');},setThrottle(){throw Error('Reminder must not touch throttle');},releaseControls(){throw Error('Reminder must not arm');},notify(text:string){notices.push(text);}});
  const idle={turn:0,throttle:0,engine:false};planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const input=(id:string,value:string,type='input')=>{const el=document.getElementById(`manual-alarm-${id}`) as HTMLInputElement;el.value=value;el.dispatchEvent(new Event(type));};input('time','30','change');input('prograde','250');
  const centre=planner.savePlans().plans[0].nodes[0].time,half=planner.snapshot().burnSeconds/2;
  planner.beforeAdvance(idle);const clamped=warp<10000&&warp>1;
  while(world.time<centre-half-10+.02)world.step();const at=world.time;planner.beforeAdvance(idle);planner.beforeAdvance(idle);
  const fired=planner.savePlans(),firstNotices=notices.filter(n=>n.startsWith('Burn alarm')).length,noEngine=!current().controls.engine&&!planner.executing,stopped=warp===1;
  // Loading must retain delivery state and require review without a replay.
  planner.loadPlans(JSON.parse(JSON.stringify(fired)));planner.beforeAdvance(idle);(document.getElementById('manual-alarm-review') as HTMLButtonElement).click();planner.beforeAdvance(idle);
  const replay=notices.filter(n=>n.startsWith('Burn alarm')).length!==firstNotices;
  // A future edit explicitly rearms; enabling pause then deleting removes its event.
  input('time','30','change');planner.update(.1,prediction,false);
  const pause=root.querySelector('[data-alarm="pause"]') as HTMLInputElement;pause.checked=true;pause.dispatchEvent(new Event('change'));
  const rearms=planner.savePlans().plans[0].nodes[0].alarm.notified===false;
  (document.getElementById('manual-alarm-delete') as HTMLButtonElement).click();warp=10000;planner.beforeAdvance(idle);const deleted=warp===10000;
  planner.dispose();f.candidate.dispose();world.dispose();return{clamped,stopped,at,centre,half,firstNotices,noEngine,replay,rearms,deleted,paused,commands,settings:fired.plans[0].nodes[0].alarm};
 });
 expect(result).toMatchObject({clamped:true,stopped:true,firstNotices:1,noEngine:true,replay:false,rearms:true,deleted:true,paused:false,settings:{enabled:true,leadSeconds:10,pause:false,notified:true}});expect(result.at).toBeLessThan(result.centre-result.half-9.9);expect(result.commands.every(c=>c==='warp')).toBe(true);
});

test('burn alarms pause optionally and ignore changed flight or unresolved later nodes',async({page})=>{
 await setup(page,false,true,false,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,notices:string[]=[];let warp=1000,paused=false;
  const planner=factory.create({container:root,id:'pause-alarm',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused,inputBlocked:false,warp,requestedWarp:warp}),setWarp(value:number){warp=value;},setPaused(value:boolean){paused=value;},setThrottle(){throw Error('No engine commands');},releaseControls(){throw Error('No engine commands');},notify(text:string){notices.push(text);}});
  const idle={turn:0,throttle:0,engine:false},input=(id:string,value:string)=>{const el=document.getElementById(`pause-alarm-${id}`) as HTMLInputElement;el.value=value;el.dispatchEvent(new Event('change'));};
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);input('time','30');
  const lead=root.querySelector('[data-alarm="lead"]') as HTMLInputElement;lead.value='5';lead.dispatchEvent(new Event('change'));
  const pause=root.querySelector('[data-alarm="pause"]') as HTMLInputElement;pause.checked=true;pause.dispatchEvent(new Event('change'));
  const centre=planner.savePlans().plans[0].nodes[0].time;while(world.time<centre-4.98)world.step();planner.beforeAdvance(idle);
  const pauseWorked=paused&&warp===1,one=notices.filter(n=>n.startsWith('Burn alarm')).length,settings=planner.savePlans().plans[0].nodes[0].alarm;
  // Before UI validation, a same-time flight replacement must suppress stale reminders.
  paused=false;input('time','30');const moved=current();world.put({...moved,state:{...moved.state,velocity:{x:moved.state.velocity.x+1,y:moved.state.velocity.y}}});warp=1000;planner.beforeAdvance(idle);const staleSuppressed=warp===1000;
  planner.update(.1,prediction,false);const invalid=planner.diagnostics()?.valid===false;
  (document.getElementById('pause-alarm-review') as HTMLButtonElement).click();(document.getElementById('pause-alarm-add') as HTMLButtonElement).click();planner.update(.1,prediction,false);
  const archive=planner.savePlans(),second=archive.plans[0].nodes[1];second.alarm={enabled:true,leadSeconds:86400,pause:true};planner.loadPlans(archive);(document.getElementById('pause-alarm-review') as HTMLButtonElement).click();paused=false;warp=1000;planner.beforeAdvance(idle);
  const laterSuppressed=!paused&&notices.filter(n=>n.startsWith('Burn alarm')).length===one;
  planner.dispose();f.candidate.dispose();world.dispose();return{pauseWorked,one,settings,staleSuppressed,invalid,laterSuppressed};
 });
 expect(result).toMatchObject({pauseWorked:true,one:1,settings:{enabled:true,leadSeconds:5,pause:true,notified:true},staleSuppressed:true,invalid:true,laterSuppressed:true});
});

test('a default reminder preserves the faster explicitly armed automatic approach',async({page})=>{
 await setup(page,false,true,false,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f;let warp=1;const notices:string[]=[];
  const planner=factory.create({container:root,id:'armed-alarm',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp,requestedWarp:warp}),setWarp(value:number){warp=value;},setThrottle(){},releaseControls(){},notify(text:string){notices.push(text);}});
  const idle={turn:0,throttle:0,engine:false};planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const time=document.getElementById('armed-alarm-time') as HTMLInputElement;time.value='30';time.dispatchEvent(new Event('change'));const dv=document.getElementById('armed-alarm-prograde') as HTMLInputElement;dv.value='1';dv.dispatchEvent(new Event('input'));planner.update(.1,prediction,false);
  (document.getElementById('armed-alarm-execute') as HTMLButtonElement).click();const armed=planner.executing;planner.beforeAdvance(idle);
  while(world.time<20.02)world.step();planner.beforeAdvance(idle);planner.beforeAdvance(idle);
  const retained=planner.executing,stopped=warp===1,alarm=notices.some(n=>n.startsWith('Burn alarm'));planner.cancel();planner.dispose();f.candidate.dispose();world.dispose();return{armed,retained,stopped,alarm};
 });
 expect(result).toEqual({armed:true,retained:true,stopped:false,alarm:true});
});

test('a longer manual alarm lead ends planner warp without restarting it, even without shared plans or engines',async({page})=>{
 await setup(page,true,false,false,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,notices:string[]=[],warps:number[]=[];let warp=1;
  const planner=factory.create({container:root,id:'early-alarm',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp,requestedWarp:warp}),setWarp(value:number){warp=value;warps.push(value);},setThrottle(){throw Error('No engine commands');},releaseControls(){throw Error('No execution');},notify(text:string){notices.push(text);}});
  const idle={turn:0,throttle:0,engine:false};planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const time=document.getElementById('early-alarm-time') as HTMLInputElement;time.value='25';time.dispatchEvent(new Event('change'));planner.update(.1,prediction,false);
  if(Math.abs(planner.diagnostics().time-world.time-25)>1e-7)throw Error('Fixture node must be within the single-orbit preview');
  const lead=root.querySelector('[data-alarm="lead"]') as HTMLInputElement;lead.value='20';lead.dispatchEvent(new Event('change'));
  (document.getElementById('early-alarm-warp') as HTMLButtonElement).click();planner.beforeAdvance(idle);const started=planner.diagnostics().warping;
  while(world.time<4.8)world.step();planner.beforeAdvance(idle);const stopped=!planner.diagnostics().warping&&warp===1,count=warps.length;planner.beforeAdvance(idle);const noRestart=warps.length===count&&warp===1;
  while(world.time<5.03)world.step();planner.beforeAdvance(idle);const alarm=notices.filter(n=>n.startsWith('Burn alarm')).length,noEngine=!current().controls.engine&&!planner.executing;
  planner.dispose();f.candidate.dispose();world.dispose();return{started,stopped,noRestart,alarm,noEngine};
 });
 expect(result).toEqual({started:true,stopped:true,noRestart:true,alarm:1,noEngine:true});
});

test('the Alarms dock panel reads the existing node clock, follows sessions and can be removed without removing alarms',async({page})=>{
 await setup(page,false,true,false,true,true);
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,{candidate,factory,prediction,world,current,body,root}=f;let session:object=world,leaseClosed=false;
  const planner=factory.create({container:root,id:'catalogue-node',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:false,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){},setThrottle(){throw Error('No thrust');},releaseControls(){throw Error('No arming');},notify(){}});
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const time=document.getElementById('catalogue-node-time') as HTMLInputElement;time.value='25';time.dispatchEvent(new Event('change'));
  const idle={turn:0,throttle:0,engine:false};planner.beforeAdvance(idle);
  const catalogue=candidate.providedService(f.api.ALARM_CATALOGUE),before=catalogue.read(world),dock=document.createElement('button');root.append(dock);
  const panel=candidate.providedService(f.api.ALARM_PANELS).create({container:root,id:'alarm-dock',session:()=>session,shell:{addInstrument(window:any,label:string){dock.textContent=label;dock.onclick=()=>window.open();return{dispose(){leaseClosed=true;dock.remove();}};}}});
  dock.click();panel.update();const pending=document.querySelector('#alarm-dock-window output')?.textContent,rows=document.querySelectorAll('#alarm-dock-window [data-alarm-id]').length,icon=document.querySelector('#alarm-dock-window svg')?.innerHTML;
  while(world.time<15.03)world.step();planner.beforeAdvance(idle);await new Promise(r=>setTimeout(r,210));panel.update();const delivered=document.querySelector('#alarm-dock-window output')?.textContent;
  session={};await new Promise(r=>setTimeout(r,210));panel.update();const empty=document.querySelector('#alarm-dock-window output')?.textContent;
  panel.dispose();const clocksRemain=catalogue.read(world).length===1,noWindow=!document.getElementById('alarm-dock-window');planner.dispose();const clocksRemoved=catalogue.read(world).length===0;candidate.dispose();world.dispose();return{pending,rows,icon,delivered,empty,leaseClosed,noWindow,clocksRemain,clocksRemoved,before:before.length};
 });
 expect(result).toMatchObject({pending:'1 pending · 0 delivered',rows:1,delivered:'0 pending · 1 delivered',leaseClosed:true,noWindow:true,clocksRemain:true,clocksRemoved:true,before:1});expect(result.empty).toContain('No active reminders');expect(result.icon).toContain('circle');
});

test('transfer destinations distinguish current orbit, local moons, parent exits and interplanetary bodies without duplicates',async({page})=>{
 await setup(page,false,true,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,root}=f,first=f.current(),other=world.spawn({ownerId:'pilot',presetId:'moon-orbit'});let selected=first.id;
  const planner=factory.create({container:root,id:'destinations',flight:()=>{const ship=world.ship(selected);return{world,ship,body:world.body(ship.bodyId),enabled:true,canWarp:true,paused:true,inputBlocked:false,warp:1,requestedWarp:1};},setWarp(){throw Error('No warp');},setThrottle(){throw Error('No ignition');},releaseControls(){throw Error('No arming');},notify(){}});
  const groups=()=>[...root.querySelectorAll('#destinations-transfer-destination optgroup')].map((g:any)=>({label:g.label,ids:[...g.querySelectorAll('option')].map((o:any)=>o.value)}));
  planner.update(0,prediction,false);const planetGroups=groups(),select=document.getElementById('destinations-transfer-destination') as HTMLSelectElement;
  const values=[...select.options].map(o=>o.value);select.value='moon';select.dispatchEvent(new Event('input'));
  const unsupported=(document.getElementById('destinations-transfer-find') as HTMLButtonElement).disabled,reason=document.getElementById('destinations-transfer-status')?.textContent;
  selected=other.id;planner.update(.1,prediction,false);const moonGroups=groups(),current=select.value,context=document.getElementById('destinations-transfer-context')?.textContent;
  const clear=!document.getElementById('destinations-transfer-use-efficient'),before=world.tick;planner.dispose();f.candidate.dispose();world.dispose();return{planetGroups,moonGroups,current,context,unsupported,reason,unique:values.length===new Set(values).size,count:values.length,clear,tick:before};
 });
 expect(result.planetGroups).toEqual(expect.arrayContaining([{label:'Moons of Primus',ids:['moon']},{label:'Interplanetary destinations',ids:['ignis','velum','magnus']}]));
 expect(result.moonGroups).toEqual(expect.arrayContaining([{label:'Parent body · leave the current SOI',ids:['planet']},{label:'Interplanetary destinations',ids:['ignis','velum','magnus']}]));
 expect(result).toMatchObject({current:'moon',unsupported:false,unique:true,count:8,clear:true,tick:1});expect(result.context).toContain('Parvus');expect(result.reason).toContain('Inputs changed');
});

test('cross-body transfer plans remain editable, frame-correct, inert and reviewable through save/load',async({page})=>{
 await setup(page,false,true,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,root}=f,commands:string[]=[];
  const planner=factory.create({container:root,id:'interbody',flight:()=>({world,ship:current(),body:world.body(current().bodyId),enabled:true,canWarp:true,paused:true,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(){}});
  planner.update(0,prediction,false);const before=JSON.stringify(f.api.saveWorld(world));
  const destination=document.getElementById('interbody-transfer-destination') as HTMLSelectElement;destination.value='moon';destination.dispatchEvent(new Event('input'));
  const low=document.getElementById('interbody-transfer-low') as HTMLInputElement;low.value='100';low.dispatchEvent(new Event('input'));
  document.getElementById('interbody-transfer-find')!.click();let frames=0;const started=performance.now();
  // Compare the completed search with Node; early best-so-far options may differ.
  while(!(document.getElementById('interbody-transfer-cancel') as HTMLButtonElement).hidden&&performance.now()-started<25000){planner.update(.1,prediction,false);frames++;}
  if(!document.getElementById('interbody-transfer-use-efficient'))throw Error(document.getElementById('interbody-transfer-status')?.textContent??'No option');
  const comparison=document.getElementById('interbody-transfer-choices')?.textContent;
  document.getElementById('interbody-transfer-use-efficient')!.click();for(let i=0;i<1000&&!planner.snapshot()?.valid;i++)planner.update(.1,prediction,false);
  const saved=planner.savePlans(),select=document.getElementById('interbody-nodes') as HTMLSelectElement;
  select.value='arrival';select.dispatchEvent(new Event('change'));planner.update(.1,prediction,false);
  const snapshot=planner.snapshot(),arrival=saved.plans[0].nodes[1],moon=world.system.getBodyPosition('moon',arrival.time),planet=world.system.getBodyPosition('planet',arrival.time),localRadius=Math.hypot(snapshot.position.x-moon.x+planet.x,snapshot.position.y-moon.y+planet.y);
  const input=document.getElementById('interbody-radial') as HTMLInputElement;input.value=String(Number(input.value)+1);input.dispatchEvent(new Event('input'));
  for(let i=0;i<1000&&!planner.snapshot()?.valid;i++)planner.update(.1,prediction,false);
  const edited=planner.savePlans(),valid=planner.snapshot()?.valid,blocked=(document.getElementById('interbody-execute') as HTMLButtonElement).disabled;
  planner.loadPlans(saved);const needsReview=!planner.snapshot()?.valid;document.getElementById('interbody-review')!.click();for(let i=0;i<1000&&!planner.snapshot()?.valid;i++)planner.update(.1,prediction,false);
  const reviewed=planner.snapshot()?.valid,preserved=JSON.stringify(f.api.saveWorld(world))===before,executing=planner.executing;
  planner.dispose();f.candidate.dispose();world.dispose();return{nodes:JSON.stringify(saved.plans[0].nodes),frames,comparison,bodies:saved.plans[0].nodes.map((n:any)=>n.bodyId),localRadius,valid,blocked,needsReview,reviewed,preserved,executing,commands,changed:edited.plans[0].nodes[1].radial!==saved.plans[0].nodes[1].radial};
 });
 expect(result).toMatchObject({bodies:['planet','moon'],valid:true,blocked:true,needsReview:true,reviewed:true,preserved:true,executing:false,commands:[],changed:true});
 expect(result.nodes).toBe(nodeReference);expect(result.localRadius).toBeCloseTo(228,2);expect(result.frames).toBeGreaterThan(1);expect(result.comparison).toContain('At 50% throttle');
});

test('burn duration responds to current throttle without ignition or changing the full-throttle executor estimate',async({page})=>{
 await setup(page);
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:string[]=[];
  const planner=factory.create({container:root,id:'thrust-estimate',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:true,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(){}});
  planner.update(0,prediction,false);planner.place(f.pointer,f.camera,f.origin,800,600,prediction);
  const input=document.getElementById('thrust-estimate-prograde') as HTMLInputElement;input.value='20';input.dispatchEvent(new Event('input'));world.setThrottle(current().id,.25);planner.update(.1,prediction,false);
  const partial=planner.snapshot(),summary=document.getElementById('thrust-estimate-summary')?.textContent;
  world.setThrottle(current().id,0);await new Promise(r=>setTimeout(r,110));planner.update(.1,prediction,false);const zero=planner.snapshot(),zeroSummary=document.getElementById('thrust-estimate-summary')?.textContent;
  const engine=current().controls.engine,executing=planner.executing;planner.dispose();f.candidate.dispose();world.dispose();return{partial,zero,summary,zeroSummary,commands,engine,executing};
 });
 expect(result.partial.throttleBurnSeconds).toBeCloseTo(result.partial.burnSeconds*4,10);expect(result.zero.throttleBurnSeconds).toBeNull();expect(result.zero.burnSeconds).toBe(result.partial.burnSeconds);
 expect(result.summary).toContain('25% throttle');expect(result.zeroSummary).toContain('No thrust');expect(result).toMatchObject({commands:[],engine:false,executing:false});
});

test('arrival waits for actual-flight review after departure and a moving SOI handoff',async({page})=>{
 await setup(page,false,true,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,root}=f,commands:string[]=[];
  const service=f.candidate.providedService(f.api.FLIGHT_PLANS),solver=f.candidate.providedService(f.api.TRANSFERS),search=solver.search(world,{shipId:current().id,destinationId:'moon',periapsisAltitude:100,apoapsisAltitude:100});
  let plan:any;for(let i=0;i<100000;i++){const step=search.next();if(step.done){plan=step.value.options[0]?.plan;break;}}if(!plan)throw Error('Fixture needs a validated moon plan');
  let evaluated:any;const job=service.evaluateAsync(plan,world);for(let i=0;i<100000;i++){const step=job.next();if(step.done){evaluated=step.value;break;}}
  const planner=factory.create({container:root,id:'arrival-review',flight:()=>({world,ship:current(),body:world.body(current().bodyId),enabled:true,canWarp:true,paused:true,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(){}});
  planner.update(0,prediction,false);planner.loadPlans({format:'space-sim-flight-plans/1',plans:[plan]});
  document.getElementById('arrival-review-review')!.click();for(let i=0;i<1000&&!planner.snapshot()?.valid;i++)planner.update(.1,prediction,false);
  const departure=evaluated[0].after;world.restoreClock(Math.round(departure.time/.01),departure.time);world.put({...current(),state:departure});
  document.getElementById('arrival-review-flown')!.click();const select=document.getElementById('arrival-review-nodes') as HTMLSelectElement;select.value='arrival';select.dispatchEvent(new Event('change'));
  const afterBurnNeedsReview=!planner.snapshot()?.valid;document.getElementById('arrival-review-review')!.click();for(let i=0;i<1000&&!planner.snapshot()?.valid;i++)planner.update(.1,prediction,false);
  const beforeHandoffValid=planner.snapshot()?.valid,blocked=(document.getElementById('arrival-review-execute') as HTMLButtonElement).disabled;
  for(let i=0;i<100000&&current().bodyId==='planet';i++)world.step();planner.update(.1,prediction,false);
  const afterHandoffNeedsReview=!planner.snapshot()?.valid;document.getElementById('arrival-review-review')!.click();for(let i=0;i<1000&&!planner.snapshot()?.valid;i++)planner.update(.1,prediction,false);
  const reviewed=planner.snapshot()?.valid,body=current().bodyId,engine=current().controls.engine,executing=planner.executing;
  planner.dispose();f.candidate.dispose();world.dispose();return{afterBurnNeedsReview,beforeHandoffValid,blocked,afterHandoffNeedsReview,reviewed,body,engine,executing,commands};
 });
 expect(result).toEqual({afterBurnNeedsReview:true,beforeHandoffValid:true,blocked:true,afterHandoffNeedsReview:true,reviewed:true,body:'moon',engine:false,executing:false,commands:[]});
});

test('the compact tabs open transfers without a node and preserve full precision behind rounded fields',async({page})=>{
 await setup(page,false,true,true);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,{factory,prediction,world,current,body,root}=f,commands:string[]=[];
  const planner=factory.create({container:root,id:'compact-tool',flight:()=>({world,ship:current(),body,enabled:true,canWarp:true,paused:true,inputBlocked:false,warp:1,requestedWarp:1}),setWarp(){commands.push('warp');},setThrottle(){commands.push('throttle');},releaseControls(){commands.push('release');},notify(){}});
  planner.update(0,prediction,false);planner.openTransfers();const empty=planner.savePlans().plans.length===0,transfers=!document.getElementById('compact-tool-transfers')!.hidden;
  document.getElementById('compact-tool-transfers-tab')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  const keyboard=document.getElementById('compact-tool-node-tab')!.getAttribute('aria-selected')==='true';
  const service=f.candidate.providedService(f.api.FLIGHT_PLANS),plan=service.capture(world,current(),[{id:'precise',label:'Precise',bodyId:body.id,time:20,prograde:1.234567890123,radial:1e-12}]);
  planner.loadPlans({format:'space-sim-flight-plans/1',plans:[plan]});document.getElementById('compact-tool-review')!.click();planner.update(.1,prediction,false);
  // Refresh the selected input strings from exact intent, just as selecting a node does.
  const select=document.getElementById('compact-tool-nodes') as HTMLSelectElement;select.dispatchEvent(new Event('change'));
  const prograde=document.getElementById('compact-tool-prograde') as HTMLInputElement,radial=document.getElementById('compact-tool-radial') as HTMLInputElement;
  const display=[prograde.value,radial.value],untouched=planner.savePlans().plans[0].nodes[0];
  prograde.value='2.5';prograde.dispatchEvent(new Event('input'));const edited=planner.savePlans().plans[0].nodes[0],advanced=(document.getElementById('compact-tool-plan-actions') as HTMLDetailsElement).open;
  planner.dispose();f.candidate.dispose();world.dispose();return{empty,transfers,keyboard,display,untouched,edited,advanced,commands};
 });
 expect(result).toMatchObject({empty:true,transfers:true,keyboard:true,display:['1.2345679','0'],advanced:false,commands:[]});
 expect(result.untouched.prograde).toBe(1.234567890123);expect(result.untouched.radial).toBe(1e-12);expect(result.edited.prograde).toBe(2.5);expect(result.edited.radial).toBe(1e-12);
});
