import { readZip } from '../../packages/game-library/src/zip';
import { test, expect, type Page } from '@playwright/test';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useCanvas } from '../helpers/canvas';
import { openPanel } from '../helpers/workspace';
import { disableNetwork } from '../helpers/offline';
const debug=async(page:Page)=>JSON.parse(await page.locator('#debug').textContent()||'{}');
const ready=async(page:Page)=>{await expect(page.locator('#startup-loading')).toHaveAttribute('data-state','ready',{timeout:60000});await expect.poll(async()=>(await debug(page)).startupLoading?.ready,{timeout:30000}).toBe(true);};

for(const offline of [false,true])test(`default prepared starter and explicit legacy (${offline?'renamed offline Canvas':'hosted WebGL'})`,async({page,context},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:1366,height:768});const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/starter-products/'))requests.push(r.url())});
 let base='/';if(offline){await useCanvas(page);await disableNetwork(context);const copied=info.outputPath('copied-and-renamed.html');await copyFile(resolve('dist/space-lab-offline.html'),copied);base=pathToFileURL(copied).href;}
 else await page.addInitScript(()=>localStorage.setItem('space-sim.graphics/1','low'));
 await page.goto(base+'?game=space-sim-successor&planetPaused=1',{waitUntil:'domcontentloaded'});await ready(page);
 const state=await debug(page);expect(state.startupLoading.sources).toEqual([{body:'planet',source:'prepared'},{body:'moon',source:'prepared'}]);expect(state.successorOverview.mapPixels).toBeGreaterThan(100000);expect(state.successorOverview.buildMs).toBe(0);expect(state.camera.mode).toBe('follow');expect(state.camera.scale).toBeGreaterThan(5);expect(state.time).toBe(0);expect(state.successorAir.mode).toBe('clouds');expect(state.renderer).toBe(offline?'builtin.canvas':'builtin.webgl');
 expect(requests.length).toBe(offline?0:2);await page.screenshot({path:info.outputPath('default-ready.png')});
 await openPanel(page,'setup');await page.locator('#successor-planet-preview').click();await ready(page);await expect(page).toHaveURL(/planetPreview=0/);expect((await debug(page)).successorOverview.mapPixels).toBe(0);expect(errors).toEqual([]);
 await writeFile(info.outputPath('loading-proof.json'),JSON.stringify({state,requests,legacy:await debug(page)},null,2));
});

test('initial shell paints before a delayed bundle and package/world preparation',async({page},info)=>{
 test.setTimeout(60000);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/assets/*.js',async route=>{await gate;await route.continue()});
 const navigation=page.goto('/?game=space-sim-successor&planetPaused=1',{waitUntil:'commit'});await navigation;
 await expect(page.locator('#startup-loading')).toBeVisible();await expect(page.locator('#loading-stage')).toHaveText('Loading application');await expect(page.locator('#app')).toHaveAttribute('inert','');
 await page.screenshot({path:info.outputPath('first-page-loading.png')});await page.keyboard.press('Space');expect(await page.locator('#debug').textContent()).toBe('');
 release();await ready(page);const state=await debug(page);expect(state.time).toBe(0);expect(state.throttle??state.engine).not.toBe(true);expect(state.startupLoading.stages.map((s:{stage:string})=>s.stage)).toEqual(expect.arrayContaining(['Checking packages','Reading Primus','Checking Primus','Preparing physical world','Preparing view']));
});

for(const fault of ['missing','corrupt'])test(`${fault} product uses deterministic cooperative fallback with painted stages`,async({page},info)=>{
 test.setTimeout(120000);await page.addInitScript(()=>{
 localStorage.setItem('space-sim.graphics/1','low');
 (window as unknown as {loadingObservations:unknown[]}).loadingObservations=[];
 new MutationObserver(()=>{const stage=document.querySelector('#loading-stage')?.textContent;const progress=document.querySelector<HTMLProgressElement>('#loading-progress');if(stage?.startsWith('Preparing Primus'))(window as unknown as {loadingObservations:unknown[]}).loadingObservations.push({stage,value:progress?.value,determinate:progress?.hasAttribute('value'),at:performance.now()})}).observe(document,{subtree:true,childList:true,attributes:true});
 });
 await page.route('**/starter-products/planet-*.bin',async route=>{
  if(fault==='missing'){await route.fulfill({status:404,body:'missing'});return;}
  const response=await route.fetch(), bytes=Buffer.from(await response.body());bytes[0]=bytes[0]!^255;
  await route.fulfill({response,body:bytes});
 });
 await page.goto('/?game=space-sim-successor&planetPaused=1');await ready(page);const state=await debug(page);expect(state.startupLoading.sources[0].source).toBe('generated');expect(state.startupLoading.sources[1].source).toBe('prepared');
 const observations=await page.evaluate(()=>(window as unknown as {loadingObservations:{value:number;determinate:boolean}[]}).loadingObservations);expect(observations.some(o=>o.determinate&&o.value>0&&o.value<1)).toBe(true);
 await writeFile(info.outputPath('fallback.json'),JSON.stringify({state,observations},null,2));await page.screenshot({path:info.outputPath('fallback-ready.png')});
});

test('abandoned world preparation cannot publish into a later legacy start',async({page})=>{
 test.setTimeout(60000);let requested!:()=>void;const seen=new Promise<void>(r=>requested=r);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/starter-products/planet-*.bin',async route=>{requested();await gate;await route.abort().catch(()=>{})});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?game=space-sim-successor',{waitUntil:'domcontentloaded'});await seen;await page.keyboard.press('Space');await page.keyboard.press('KeyP');await page.setViewportSize({width:1000,height:700});
 await page.goto('/?game=space-sim-successor&planetPreview=0');release();await ready(page);expect((await debug(page)).successorOverview.mapPixels).toBe(0);expect(errors).toEqual([]);
});

test('failed save restore leaves the previous exact paused session playable',async({page})=>{
 test.setTimeout(60000);await useCanvas(page);await page.goto('/?game=space-sim-successor&planetPaused=1');await ready(page);const before=await debug(page);
 await openPanel(page,'fleet');const download=page.waitForEvent('download');await page.locator('#save-world').click();const saved=await download;const bytes=await readFile((await saved.path())!);
 // A valid save with an incompatible authoritative fingerprint reaches candidate
 // verification; no caller may bypass it just because prepared products matched.
 const files=await readZip(new Uint8Array(bytes));const json=(name:string)=>JSON.parse(new TextDecoder().decode(files.get(name)!));const descriptor=json('save.json');
 const raw={...json(descriptor.state),universe:json(descriptor.definition),players:json(descriptor.pilots),ships:descriptor.ships.flatMap((name:string)=>json(name)),...json(descriptor.modules),simulationFingerprint:'f'.repeat(64)};
 let reason='';const dialog=page.waitForEvent('dialog').then(async d=>{reason=d.message();await d.accept()});
 await page.locator('#world-file').setInputFiles({name:'mismatched.spaceuniverse',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await dialog;
 expect(reason).toMatch(/exact required|fingerprint|lock/);
 expect((await debug(page)).position).toEqual(before.position);await expect(page.locator('#status')).toHaveText('PAUSED');await expect(page.locator('#startup-loading')).toBeHidden();
});


test('initial failure offers retry and returns to a usable prepared world',async({page})=>{
 test.setTimeout(60000);await page.addInitScript(()=>{
  if(sessionStorage.getItem('loading-retry-exercised'))return;
  sessionStorage.setItem('loading-retry-exercised','1');
  HTMLCanvasElement.prototype.getContext=(()=>null) as typeof HTMLCanvasElement.prototype.getContext;
 });
 await page.goto('/?game=space-sim-successor&planetPaused=1');
 await expect(page.locator('#startup-loading')).toHaveAttribute('data-state','error');await expect(page.locator('#loading-retry')).toBeVisible();
 await page.locator('#loading-retry').click();await ready(page);expect((await debug(page)).startupLoading.sources.every((s:{source:string})=>s.source==='prepared')).toBe(true);
});


test('custom v2 import cancellation and failure retain the previous world, then a fresh import succeeds',async({page},info)=>{
 test.setTimeout(120000);await useCanvas(page);await page.goto('/?game=space-sim-successor&planetPaused=1');await ready(page);
 const original=await debug(page),data=JSON.parse(await readFile(resolve('games/space-sim-successor/planet-preview.json'),'utf8'));
 const custom=data.data.universes[0].definition;custom.id='custom-loading-proof';custom.name='Custom loading proof';
 custom.systems[0].bodies.find((b:{id:string})=>b.id==='planet').surface.seed=742;
 custom.systems[0].presets=custom.systems[0].presets.filter((p:{id:string})=>p.id==='pad');
 const file=()=>({name:'custom.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(custom))});
 await openPanel(page,'setup');await page.locator('#universe-file').setInputFiles(file());
 await expect(page.locator('#loading-stage')).toHaveText('Preparing Primus');
 const dialog=page.waitForEvent('dialog').then(d=>d.accept());await page.locator('#loading-cancel').click();await dialog;await ready(page);await expect(page.locator('#universe-file')).toHaveValue('');
 expect((await debug(page)).universe).toBe(original.universe);expect((await debug(page)).position).toEqual(original.position);await expect(page.locator('#status')).toHaveText('PAUSED');
 await page.locator('#universe-file').setInputFiles(file());await expect(page.locator('#universe-status')).toContainText('Loaded Custom loading proof',{timeout:60000});await ready(page);
 const imported=await debug(page);expect(imported.universe).toBe('custom-loading-proof');expect(imported.successorOverview.mapPixels).toBeGreaterThan(100000);
 await writeFile(info.outputPath('custom-import.json'),JSON.stringify({original,imported},null,2));
});

test('a first-frame presentation error offers retry before flight input is enabled',async({page})=>{
 test.setTimeout(60000);await useCanvas(page);
 await page.addInitScript(()=>{
  if(sessionStorage.getItem('first-frame-failure-seen'))return;
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=new Proxy(original,{apply(target,canvas,args){
   const context=Reflect.apply(target,canvas,args) as CanvasRenderingContext2D|null;
   if(args[0]==='2d'&&canvas.id==='flight-view'&&context){
    const transform=context.setTransform.bind(context);
    context.setTransform=((...parameters: unknown[])=>{
     if(document.getElementById('loading-stage')?.textContent==='Preparing view'&&!sessionStorage.getItem('first-frame-failure-seen')){
      sessionStorage.setItem('first-frame-failure-seen','1');throw Error('First-frame presentation failure');
     }
     Reflect.apply(transform,context,parameters);
    }) as typeof context.setTransform;
   }
   return context;
  }});
 });
 await page.goto('/?game=space-sim-successor&planetPaused=1');
 // Observe the injected presentation fault after asynchronous product preparation.
 await page.waitForFunction(()=>sessionStorage.getItem('first-frame-failure-seen')==='1',undefined,{timeout:60000});
 await expect(page.locator('#startup-loading')).toHaveAttribute('data-state','error');
 await expect(page.locator('#loading-stage')).toContainText('First-frame presentation failure');
 await page.locator('#loading-retry').click();await ready(page);expect((await debug(page)).time).toBe(0);
});
