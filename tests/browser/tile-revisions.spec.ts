import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';

test.beforeAll(async()=>{await build({configFile:false,logLevel:'error',define:{__CULLING_FIXTURE_SLOT__:JSON.stringify('contract')},
 resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},
 build:{outDir:'dist',emptyOutDir:false,lib:{entry:resolve('tests/browser/fixtures/tile-culling.ts'),formats:['iife'],name:'TileRevisionContract',fileName:()=> 'tile-revisions.js'}}});});

for(const factory of [false,true])test((factory?'factory scene':'direct flight')+' revision protocol preserves pixels, shared lifetime and replacement',async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:640,height:480});
 // Repeated readbacks can change Chromium's Canvas raster path. Keep cold and
 // replacement contexts on the same readback setup; these are pixel, not FPS tests.
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=new Proxy(get,{apply(fn,self,args){return Reflect.apply(fn,self,args[0]==='2d'?[args[0],{...args[1],willReadFrequently:true}]:args);}});
 });
 await page.route('**/revision-fixture.html',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"></body></html>'}));
 await page.goto('/revision-fixture.html');await page.addScriptTag({url:'/tile-revisions.js'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const run=async(renderer:'Canvas'|'WebGL',extra:Record<string,unknown>={})=>page.evaluate(async t=>{
  const f=(window as unknown as {tileCulling_contract:{run(t:unknown):Promise<{digest:string;sentinel:number[];glError:number;ownerDisposed:boolean;ownerPreserved:boolean;revisionCaps:{version:number;maxEntries:number;maxBytes:number};epoch:number}>}}).tileCulling_contract;
  return f.run(t);
 },{renderer,contentId:renderer==='Canvas'?0:2,cap:1,rotation:Math.PI/4,cameraRotation:Math.PI/2,x:140,y:120,base:1e12,mix:true,factory,scene:factory,...extra});
 const action=async(name:'close'|'release'|'lose',renderer:'Canvas'|'WebGL')=>page.evaluate(({name,renderer,factory})=>{
  const f=(window as unknown as {tileCulling_contract:Record<string,(t:unknown)=>boolean>}).tileCulling_contract;
  return f[name]!({renderer,contentId:renderer==='Canvas'?0:2,cap:1,factory});
 },{name,renderer,factory});
 const rows=[];
 for(const renderer of ['Canvas','WebGL'] as const){
  const legacy=await run(renderer),revision=await run(renderer,{revision:0,validated:true});
  expect(revision.digest).toBe(legacy.digest);expect(revision.ownerPreserved).toBe(true);expect(revision.revisionCaps).toEqual({version:1,maxEntries:512,maxBytes:2*1024*1024});
  const changed=await run(renderer,{revision:1,mutate:true,validated:true});expect(changed.digest).not.toBe(revision.digest);
  expect(changed.digest).toBe((await run(renderer,{mutate:true})).digest);
  const palette=await run(renderer,{revision:1,mutate:true,paletteFlip:true,validated:true});expect(palette.digest).not.toBe(changed.digest);
  expect(palette.digest).toBe((await run(renderer,{mutate:true,paletteFlip:true})).digest);
  await expect(run(renderer,{revision:Number.MAX_SAFE_INTEGER+1,x:-10000,mutate:true,paletteFlip:true})).rejects.toThrow('safe integers');
  expect(await action('release',renderer)).toBe(false);
  if(renderer==='WebGL')expect(await action('lose',renderer)).toBe(true);
  expect(await action('close',renderer)).toBe(false);
  const replaced=await run(renderer,{revision:1,mutate:true,paletteFlip:true,validated:true});expect(replaced.digest).toBe(palette.digest);
  expect(replaced.ownerDisposed).toBe(false);expect(replaced.glError).toBe(0);expect(replaced.sentinel).toEqual([0,255,0,255]);
  rows.push({renderer,legacy,revision,changed,palette,replaced});
 }
 expect(await page.evaluate(()=>(window as unknown as {tileCulling_contract:{disposeOwner():boolean}}).tileCulling_contract.disposeOwner())).toBe(true);
 for(const renderer of ['Canvas','WebGL'] as const){await expect(run(renderer,{revision:1,validated:true})).rejects.toThrow('disposed');
  expect(await action('release',renderer)).toBe(true);expect((await run(renderer)).glError).toBe(0);}
 const epoch=await page.evaluate(()=>(window as unknown as {tileCulling_contract:{newWorld():number}}).tileCulling_contract.newWorld());
 for(const renderer of ['Canvas','WebGL'] as const){const r=await run(renderer,{revision:0,validated:true});expect(r.epoch).toBe(epoch);expect(r.ownerDisposed).toBe(false);}
 expect(errors).toEqual([]);
 await writeFile(info.outputPath('revision-contract.json'),JSON.stringify({browser:info.project.name,factory,rows,epoch},null,2));
});
