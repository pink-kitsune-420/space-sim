import { waitForWorldReady } from '../helpers/loading';
import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {useCanvas,useLowGraphics} from '../helpers/canvas';
const evidence='private-docs/proposals/games/evidence/successor-renderer-conformance';

test.beforeAll(async()=>{
  await mkdir(evidence,{recursive:true});
  await build({configFile:false,logLevel:'error',resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},
    build:{outDir:'dist',emptyOutDir:false,lib:{entry:resolve('tests/browser/fixtures/tile-conformance.ts'),formats:['iife'],name:'TileConformance',fileName:()=> 'tile-conformance.js'}}});
});

for(const dpr of [1,2])test(`production dense pixels agree across body/camera rotation, clip, supplied light and palette lifetime DPR${dpr}`,async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:640,height:480},deviceScaleFactor:dpr});
  const page=await context.newPage();
  test.setTimeout(180000);await page.setViewportSize({width:640,height:480});
  await page.route('**/fixture.html', route => route.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('/fixture.html'); await waitForWorldReady(page);
  await page.setContent('<canvas id="fixture" style="width:320px;height:240px" width="320" height="240"></canvas>');
  await page.addScriptTag({url:'/tile-conformance.js'});
  const results=[];
  for(const rotation of [0,Math.PI/4,Math.PI/2])for(const cameraRotation of [0,Math.PI/4,Math.PI/2]){
    const cases=[];
    for(const renderer of ['Canvas','WebGL'] as const){
      const row=await page.evaluate(trial=>(window as unknown as {tileFixture:{run(t:unknown):{samples:number[][];glError:number}}}).tileFixture.run(trial),{renderer,rotation,cameraRotation});
      expect(row.glError).toBe(0);
      for(const [index,rgb] of [[0,51],[1,255],[2,140],[3,136]] as const)for(const c of row.samples[index]!.slice(0,3))expect(Math.abs(c-rgb)).toBeLessThanOrEqual(1);
      cases.push({renderer,...row});
      if(cameraRotation===0)await page.screenshot({path:`${evidence}/${renderer}-rotation-${Math.round(rotation*180/Math.PI)}-${info.project.name}-DPR${dpr}.png`});
    }
    for(let i=0;i<5;i++)for(let c=0;c<3;c++)expect(Math.abs(cases[0]!.samples[i]![c]!-cases[1]!.samples[i]![c]!)).toBeLessThanOrEqual(1);
    results.push({rotation,cameraRotation,cases});
  }
  for(const renderer of ['Canvas','WebGL'] as const)for(const options of [{light:false},{unknownPalette:true},{replace:true},{legacy:true},{alpha:true},{reuse:true}]){
    const row=await page.evaluate(trial=>(window as unknown as {tileFixture:{run(t:unknown):{samples:number[][];glError:number}}}).tileFixture.run(trial),{renderer,rotation:0,cameraRotation:0,...options});
    expect(row.glError).toBe(0);
    if('alpha' in options)for(const [c,value] of [64,32,16].entries())expect(Math.abs(row.samples[3]![c]!-value)).toBeLessThanOrEqual(1);
    if('reuse' in options)expect(row.samples[0]!.slice(0,3)).toEqual([255,255,255]);
    if('unknownPalette' in options)expect(row.samples[1]!.slice(0,3)).toEqual([110,115,123]);
    if('light' in options || 'replace' in options)expect(row.samples[1]!.slice(0,3)).toEqual([255,255,255]);
    results.push({renderer,options,row});
  }
  await writeFile(`${evidence}/pixels-${info.project.name}-DPR${dpr}.json`,JSON.stringify({browser:browser.version(),viewport:{width:640,height:480},dpr,results},null,2));
  await context.close();
});

for(const offline of [false,true])test(`successor ${offline?'offline':'hosted'} no-WebGL startup and renderer replacement`,async({page,context})=>{
  await useCanvas(page);await useLowGraphics(page);
  if(offline){await context.route(/^https?:/,route=>route.abort());await page.goto('file://'+resolve('dist/space-lab-offline.html')+'?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page);}
  else await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect.poll(async()=>JSON.parse(await page.locator('#debug').textContent()||'{}').renderer).toBe('builtin.canvas');
  const d=JSON.parse(await page.locator('#debug').textContent()||'{}');expect(d.tileCapabilities.lightEncoding).toBe('nibble');expect(d.successorTiles.visibleChunks).toBeGreaterThan(0);
});

test('production renderer replacement re-registers successor palettes and retains physical state',async({page})=>{
  test.setTimeout(120000);await useLowGraphics(page);await page.setViewportSize({width:640,height:480});
  await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page);await expect(page.locator('#status')).toHaveText('LANDED');
  for(const renderer of ['builtin.webgl','builtin.canvas','builtin.webgl','builtin.canvas']){
    await expect.poll(async()=>JSON.parse(await page.locator('#debug').textContent()||'{}').renderer).toBe(renderer);
    const d=JSON.parse(await page.locator('#debug').textContent()||'{}');expect(d.tileCapabilities.lightEncoding).toBe('nibble');expect(d.successorTiles.visibleChunks).toBeGreaterThan(0);expect(Math.abs(d.groundClearance)).toBeLessThan(1e-6);
    await page.evaluate(()=>document.querySelector<HTMLButtonElement>('[data-workspace="settings"]')!.click());
    await page.locator('#renderer-toggle').click();
    await page.evaluate(()=>{for(const e of document.querySelectorAll<HTMLButtonElement>('.panel-window:not([hidden]) [data-window-close]'))e.click();});
  }
});
