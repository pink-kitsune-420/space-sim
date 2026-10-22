import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ocean from '../../games/space-sim/universes/sandbox/ocean/universe.json' with { type: 'json' };
import { useCanvas, useLowGraphics } from '../helpers/canvas';
import { disableNetwork } from '../helpers/offline';
import { openPanel } from '../helpers/workspace';

const sea=532,hull=2.5;
function fixture(){
  const raw=structuredClone(ocean),sys=raw.systems[0]!,body=sys.bodies[0]!;
  raw.id='wet-hull-example';raw.name='Circular hull water test';
  Object.assign(sys,{vehicleDefaults:{contactRadiusMetres:hull,acceleration:125,initialThrottle:.5,turnRate:1.227184630308513}});
  body.surface.seaRadiusMetres=sea;body.surface.pads[0]!.elevationMetres=32;
  for(const p of sys.presets){if(p.id==='splash'||p.id==='heavy'){p.position=[sea+hull+.001,0];p.velocity=[p.id==='splash'?-1:-8,0];}if(p.id==='submerged')p.position=[sea-1,0];}
  return raw;
}
async function debug(page:Page){return JSON.parse(await page.locator('#debug').textContent()||'{}');}
for(const mode of ['webgl-http','canvas-offline'] as const)test(`${mode}: finite hull soft splash, heavy impact, recovery and underwater motion`,async({page,context},info)=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  if(mode==='canvas-offline'){await useCanvas(page);await disableNetwork(context);}else await useLowGraphics(page);
  await page.goto(mode==='canvas-offline'?pathToFileURL(resolve('dist/space-lab-offline.html')).href:'/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#universe-file').setInputFiles({name:'wet-hull.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page,'setup');
  await page.locator('#preset').evaluate(el=>{(el as HTMLSelectElement).value='heavy';el.dispatchEvent(new Event('change'));document.getElementById('pause')!.click();});
  await expect.poll(async()=>(await debug(page)).predictionEnd).toBe('impact');
  const predicted=(await debug(page)).predictionLast;expect(Math.hypot(predicted.position.x,predicted.position.y)).toBeCloseTo(sea+hull,6);
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('CRASHED');await expect(page.locator('#flight-message')).toContainText('Heavy water impact');
  await expect.poll(async()=>(await debug(page)).contact?.material).toBe('water');expect((await debug(page)).contact.time).toBeCloseTo(predicted.time,8);
  await openPanel(page,'settings');await page.locator('#god-mode').check();
  await expect(page.locator('#status')).toHaveText('FLOATING',{timeout:20000});await page.locator('#god-mode').uncheck();
  const floated=await debug(page);expect(Math.hypot(floated.position.x,floated.position.y)).toBeCloseTo(sea,5);
  await openPanel(page,'setup');await page.locator('#preset').selectOption('splash');
  await expect(page.locator('#status')).toHaveText('FLOATING',{timeout:20000});
  await page.screenshot({path:info.outputPath('hull-floating.png')});
  await page.locator('#preset').selectOption('submerged');
  await expect(page.locator('#status')).toHaveText('FLOATING',{timeout:20000});
  expect(errors).toEqual([]);await info.attach('wet-hull-proof',{body:JSON.stringify({mode,sea,hull,predicted,floated,final:await debug(page),errors},null,2),contentType:'application/json'});
});
