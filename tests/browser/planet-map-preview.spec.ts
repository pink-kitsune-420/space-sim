import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {useCanvas} from '../helpers/canvas';
const debug=async(page:import('@playwright/test').Page)=>JSON.parse(await page.locator('#debug').textContent()||'{}');
test.beforeAll(async()=>{await build({configFile:false,logLevel:'error',resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},build:{outDir:'dist',emptyOutDir:false,lib:{entry:resolve('tests/browser/fixtures/planet-map-renderer.ts'),formats:['iife'],name:'PlanetMapRendererFixture',fileName:()=> 'planet-map-renderer.js'}}});});
test('actual GPU planet shader is colorful at180px, uploads only visible immutable maps and releases its bounded cache',async({page},info)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/planet-renderer-proof.html',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));await page.goto('/planet-renderer-proof.html');await page.addScriptTag({url:'/planet-map-renderer.js'});
 const r=await page.evaluate(()=>(window as unknown as{PlanetMapRenderer:{run:()=>{invisibleUploads:number;warmUploads:number;resources:{bytes:number;count:number};disposedBytes:number;disposedCount:number;error:number;failed:boolean;blue:number;land:number;colors:number}}}).PlanetMapRenderer.run());
 expect(r.error).toBe(0);expect(r.failed).toBe(false);expect(r.invisibleUploads).toBe(0);expect(r.warmUploads).toBe(0);expect(r.resources.count).toBe(2);expect(r.resources.bytes).toBeLessThan(4*1024*1024);expect(r.disposedBytes).toBe(0);expect(r.disposedCount).toBe(0);expect(r.blue).toBeGreaterThan(2000);expect(r.land).toBeGreaterThan(1000);expect(r.colors).toBeGreaterThan(40);expect(errors).toEqual([]);
 await writeFile(info.outputPath('planet-gpu-resources.json'),JSON.stringify(r,null,2));
});
for(const fallback of[false,true])test(`${fallback?'Canvas':'WebGL'} generated Primus actual flight matched coast, inland and mountain views`,async({page},info)=>{
 test.setTimeout(180000);await page.setViewportSize({width:1280,height:900});if(fallback)await useCanvas(page);else await page.addInitScript(()=>localStorage.setItem('space-sim.graphics/1','low'));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const rows=[];
 for(const location of['coast','inland','mountain'])for(const view of['orbit','intermediate','ground']){
  await page.goto(`/?game=space-sim-successor&planetPreview=1&planetPreset=${location}&planetView=${view}&planetPaused=1&successorAir=clouds`);
  await expect(page.locator('#status')).toHaveText('PAUSED');await expect.poll(async()=>(await debug(page)).successorOverview?.mapPixels,{timeout:30000}).toBeGreaterThan(100000);
  if(view==='ground')await expect.poll(async()=>(await debug(page)).successorTiles.visibleChunks,{timeout:15000}).toBeGreaterThan(0);
  const d=await debug(page);expect(d.renderer).toBe(fallback?'builtin.canvas':'builtin.webgl');if(view==='orbit'){expect(d.successorTiles.fineRequests).toBe(0);expect(d.successorTiles.residentChunks).toBe(0);}expect(d.groundClearance).toBeCloseTo(0,5);
  rows.push({location,view,camera:d.camera,tiles:d.successorTiles,overview:d.successorOverview,water:d.water});await page.screenshot({path:info.outputPath(`${fallback?'canvas':'webgl'}-${location}-${view}.png`)});
 }
 expect(errors).toEqual([]);await writeFile(info.outputPath('matched-views.json'),JSON.stringify(rows,null,2));
});
