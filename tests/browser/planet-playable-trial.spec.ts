import{test,expect}from'@playwright/test';
import{resolve}from'node:path';import{pathToFileURL}from'node:url';import{writeFile}from'node:fs/promises';
import{useCanvas}from'../helpers/canvas';import{openPanel}from'../helpers/workspace';
const debug=async(p:import('@playwright/test').Page)=>JSON.parse(await p.locator('#debug').textContent()||'{}');
for(const offline of[false,true])test(`generated Primus gentle water, floating, airless Parvus and legacy return (${offline?'offline Canvas':'hosted WebGL'})`,async({page,context},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:1280,height:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));if(offline){await useCanvas(page);await context.route(/^https?:/,r=>r.abort());}else await page.addInitScript(()=>localStorage.setItem('space-sim.graphics/1','low'));
 const base=offline?pathToFileURL(resolve('dist/space-lab-offline.html')).href:'/';
 const go=async(preset:string,view='ground')=>{await page.goto(base+`?game=space-sim-successor&planetPreview=1&planetPreset=${preset}&planetView=${view}&successorAir=clouds`);};
 await go('gentle-splash');await expect(page.locator('#status')).toHaveText(/SUBMERGED|FLOATING/);await expect(page.locator('#clearance-kind')).toHaveText('SEABED CLEARANCE');
 const wet=await debug(page);expect(wet.water).not.toBeNull();expect(wet.groundClearance).toBeGreaterThan(0);expect(wet.renderer).toBe(offline?'builtin.canvas':'builtin.webgl');
 await page.locator('#pause').click();await expect(page.locator('#status')).toHaveText('PAUSED');await page.waitForTimeout(350);const paused=await debug(page);await page.waitForTimeout(400);const still=await debug(page);expect(still.time).toBe(paused.time);expect(still.successorAir.seconds).toBeCloseTo(paused.successorAir.seconds,3);
 await go('already-floating');await expect(page.locator('#status')).toHaveText('FLOATING');const floating=await debug(page);expect(floating.water).toBe('floating');await page.screenshot({path:info.outputPath('primus-floating.png')});
 await go('parvus-pad','orbit');await expect(page.locator('#status')).toHaveText('LANDED');const moon=await debug(page);expect(moon.body).toBe('moon');expect(moon.water).toBeNull();expect(moon.successorTiles.fineRequests).toBe(0);await page.screenshot({path:info.outputPath('parvus-orbit.png')});
 await openPanel(page,'setup');await page.locator('#successor-planet-preview').click();await expect(page).not.toHaveURL(/planetPreview/);await expect(page.locator('#status')).toHaveText('LANDED');await expect.poll(async()=>(await debug(page)).successorOverview?.mapPixels).toBe(0);
 expect(errors).toEqual([]);await writeFile(info.outputPath('playable-trial.json'),JSON.stringify({wet,floating,moon,legacy:await debug(page)},null,2));
});

for(const offline of[false,true])test(`generated preview defaults to the close player camera with explicit orbit retained (${offline?'offline Canvas':'hosted WebGL'})`,async({page,context},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:1366,height:612});if(offline){await useCanvas(page);await context.route(/^https?:/,r=>r.abort());}const base=offline?pathToFileURL(resolve('dist/space-lab-offline.html')).href:'/';
 const go=async(view?:string)=>{await page.goto(base+'?game=space-sim-successor&planetPreview=1&planetPaused=1'+(view?'&planetView='+view:''));await expect(page.locator('#status')).toHaveText('PAUSED');await expect.poll(async()=>(await debug(page)).successorOverview?.mapPixels,{timeout:30000}).toBeGreaterThan(100000);return debug(page);};
 const normal=await go();expect(normal.camera.mode).toBe('follow');expect(normal.camera.follow).toBe(true);expect(normal.camera.scale).toBeGreaterThan(5);await page.screenshot({path:info.outputPath('default-player-start.png')});
 const explicit=await go('ground');expect(explicit.camera).toEqual(normal.camera);expect(explicit.position).toEqual(normal.position);
 const orbit=await go('orbit');expect(orbit.camera.mode).toBe('free');expect(orbit.camera.scale).toBeLessThan(.2);expect(orbit.successorTiles.fineRequests).toBe(0);await writeFile(info.outputPath('startup-camera.json'),JSON.stringify({normal:normal.camera,explicit:explicit.camera,orbit:orbit.camera},null,2));
});
