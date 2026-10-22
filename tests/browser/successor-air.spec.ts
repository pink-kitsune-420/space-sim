import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { useCanvas, useLowGraphics } from '../helpers/canvas';
const dir = 'private-docs/proposals/games/evidence/successor-cloud-air';
test.beforeAll(async () => {
  await mkdir(dir,{recursive:true});
  await build({configFile:false,logLevel:'error',resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},
    build:{outDir:'dist',emptyOutDir:false,lib:{entry:resolve('tests/browser/fixtures/air-conformance.ts'),formats:['iife'],name:'AirConformance',fileName:()=> 'air-conformance.js'}}});
});
for (const dpr of [1,2]) test(`independent air canonical masks, overlap, cues and v1 packs DPR${dpr}`,async({browser},info)=>{
  test.setTimeout(180000);
  const context=await browser.newContext({viewport:{width:640,height:480},deviceScaleFactor:dpr}),page=await context.newPage();
  await page.route('**/air-fixture.html',r=>r.fulfill({contentType:'text/html',body:'<canvas id="fixture" style="width:320px;height:240px"></canvas>'}));
  await page.goto('/air-fixture.html');await page.addScriptTag({url:'/air-conformance.js'});
  const rows=[];
  for(const renderer of ['Canvas','WebGL'])for(const rotation of [0,.7,Math.PI])for(const near of [false,true]){
    const row=await page.evaluate(t=>(window as unknown as {airFixture:{run(t:unknown):{groundChanged:number;overlapChanged:number;cueChanged:number;skyChanged:number;glError:number}}}).airFixture.run(t),
      {renderer,rotation,near,scale:near?2:.8,origin:rotation===.7?1e10:0});
    expect(row.glError).toBe(0);expect(row.groundChanged).toBe(0);expect(row.overlapChanged).toBe(0);expect(row.cueChanged).toBe(0);expect(row.skyChanged).toBeGreaterThan(20);
    rows.push({renderer,rotation,near,...row});
    if(rotation===0)await page.screenshot({path:`${dir}/${renderer}-${near?'near':'orbit'}-${info.project.name}-DPR${dpr}.png`});
  }
  // Strong controlled backgrounds prove near sky is opaque, while overview space returns.
  for(const renderer of ['Canvas','WebGL'])for(const near of [false,true]){
    const captures=[];
    for(const backdrop of ['magenta','green']){
      const row=await page.evaluate(t=>(window as unknown as {airFixture:{run(t:unknown):{offSky:number[];cloudSky:number[];glError:number}}}).airFixture.run(t),
        {renderer,near,rotation:0,scale:near?20:.8,backdrop});
      expect(row.glError).toBe(0);captures.push(row);rows.push({renderer,near,backdrop,...row});
    }
    expect(captures[0]!.offSky).not.toEqual(captures[1]!.offSky);
    if(near)for(let c=0;c<3;c++)expect(Math.abs(captures[0]!.cloudSky[c]!-captures[1]!.cloudSky[c]!)).toBeLessThanOrEqual(1);
    else expect(captures[0]!.cloudSky).not.toEqual(captures[1]!.cloudSky);
  }
  await writeFile(`${dir}/pixels-${info.project.name}-DPR${dpr}.json`,JSON.stringify({browser:browser.version(),dpr,rows},null,2));await context.close();
});
for(const offline of [false,true])test(`cloud trial ${offline?'offline':'hosted'} Canvas fallback and pause clock`,async({page,context})=>{
  await useCanvas(page);await useLowGraphics(page);
  if(offline){await context.route(/^https?:/,r=>r.abort());await page.goto('file://'+resolve('dist/space-lab-offline.html')+'?game=space-sim-successor');}
  else await page.goto('/?game=space-sim-successor');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.evaluate(()=>{document.querySelector<HTMLButtonElement>('[data-workspace="setup"]')!.click();const e=document.querySelector<HTMLSelectElement>('#successor-air-mode')!;e.value='clouds';e.dispatchEvent(new Event('change',{bubbles:true}));for(const e of document.querySelectorAll<HTMLButtonElement>('.panel-window:not([hidden]) [data-window-close]'))e.click();});
  const debug=async()=>JSON.parse(await page.locator('#debug').textContent()||'{}');
  await expect.poll(async()=>(await debug()).successorAir.mode).toBe('clouds');
  expect((await debug()).renderer).toBe('builtin.canvas');expect(Math.abs((await debug()).groundClearance)).toBeLessThan(1e-6);
  await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#pause')!.click());await expect(page.locator('#status')).toHaveText('PAUSED');
  await page.waitForTimeout(350);const seconds=(await debug()).successorAir.seconds;await page.waitForTimeout(600);
  expect((await debug()).successorAir.seconds).toBeCloseTo(seconds,2);
});

test('explicit cloud-review link selects the trial without changing graphics preferences', async ({page}) => {
  await useCanvas(page);
  await page.goto('/?game=space-sim-successor&successorAir=clouds');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect.poll(async()=>JSON.parse(await page.locator('#debug').textContent()||'{}').successorAir.mode).toBe('clouds');
  await expect(page.locator('#successor-air-mode')).toHaveValue('clouds');
  await expect(page.locator('#graphics-toggle')).toHaveAttribute('aria-pressed','false');
});
