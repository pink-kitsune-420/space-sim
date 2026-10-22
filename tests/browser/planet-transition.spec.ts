import{test,expect}from'@playwright/test';import{build}from'vite';import{resolve}from'node:path';import{writeFile}from'node:fs/promises';
test.beforeAll(async()=>{await build({configFile:false,logLevel:'error',resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},build:{outDir:'dist',emptyOutDir:false,lib:{entry:resolve('tests/browser/fixtures/planet-transition.ts'),formats:['iife'],name:'PlanetTransitionFixture',fileName:()=> 'planet-transition.js'}}});});
for(const backend of['WebGL','Canvas']as const)for(const rocky of[false,true])test(`${backend} ${rocky?'Parvus':'Primus'} intermediate rock stays continuous through spin, pan and zoom`,async({page},info)=>{
 test.setTimeout(120000);await page.route('**/planet-transition.html',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0">'}));await page.goto('/planet-transition.html');await page.addScriptTag({url:'/planet-transition.js'});
 const result=await page.evaluate(({b,rocky})=>(window as unknown as{PlanetTransition:{run:(b:'WebGL'|'Canvas',rocky:boolean)=>{rows:{scale:number;error:number;probes:{water:boolean;rgb:number[]}[]}[]}}}).PlanetTransition.run(b,rocky),{b:backend,rocky});await writeFile(info.outputPath('coarse-coast-probes.json'),JSON.stringify(result,null,2));
 for(const row of result.rows){expect(row.error).toBe(0);if(!rocky)expect(row.probes.some(p=>p.water)).toBe(true);expect(row.probes.some(p=>!p.water)).toBe(true);for(const p of row.probes)expect(p.rgb,JSON.stringify({backend,scale:row.scale,...p})).toEqual(rocky?[48,52,58]:[69,59,46]);}
});

test('actual GPU last atlas texels agree with the physical equatorial coast',async({page},info)=>{
 test.setTimeout(120000);await page.route('**/planet-transition.html',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0">'}));await page.goto('/planet-transition.html');await page.addScriptTag({url:'/planet-transition.js'});
 const r=await page.evaluate(()=>(window as unknown as{PlanetTransition:{runRim:()=>{error:number;probes:{wet:boolean;wrong:boolean}[]}}}).PlanetTransition.runRim());await writeFile(info.outputPath('physical-rim-probes.json'),JSON.stringify(r,null,2));expect(r.error).toBe(0);expect(r.probes.length).toBeGreaterThan(100);expect(r.probes.filter(p=>p.wet).length).toBeGreaterThan(20);expect(r.probes.filter(p=>!p.wet).length).toBeGreaterThan(20);expect(r.probes.filter(p=>p.wrong)).toEqual([]);
});

test('actual coastal approach stays covered while panning across fine-tile LOD thresholds',async({page},info)=>{
 test.setTimeout(180000);await page.setViewportSize({width:1280,height:900});await page.addInitScript(()=>localStorage.setItem('space-sim.graphics/1','low'));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const debug=async()=>JSON.parse(await page.locator('#debug').textContent()||'{}');
 await page.goto('/?game=space-sim-successor&planetPreview=1&planetPreset=coast&planetView=ground&planetPaused=1&successorAir=clouds');await expect(page.locator('#status')).toHaveText('PAUSED');await expect.poll(async()=>(await debug()).successorOverview?.mapPixels).toBeGreaterThan(100000);
 const rows=[];for(const scale of[.6,1,2,3.9,4.1,6,10,30,10,4.1,3.9,2,.6]){
  await page.locator('#flight-view').hover();for(let n=0;n<14;n++){const before=(await debug()).camera.scale;if(Math.abs(Math.log(before/scale))<.002)break;const delta=Math.max(-490,Math.min(490,-Math.log(scale/before)/.002));await page.mouse.wheel(0,delta);await expect.poll(async()=>Math.abs(Math.log((await debug()).camera.scale/(before*Math.exp(-delta*.002))))).toBeLessThan(.002);}
  const d=await debug();expect(Math.abs(Math.log(d.camera.scale/scale))).toBeLessThan(.002);expect(d.groundClearance).toBeCloseTo(0,5);expect(d.successorTiles.residentChunks).toBeLessThanOrEqual(512);rows.push({scale,camera:d.camera,tiles:d.successorTiles});await page.screenshot({path:info.outputPath(`coast-transition-${rows.length}-${scale}.png`)});
  const box=await page.locator('#flight-view').boundingBox();if(!box)throw Error('Missing flight view');await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down({button:'middle'});await page.mouse.move(box.x+box.width*.5+(rows.length%2?8:-8),box.y+box.height*.5,{steps:4});await page.mouse.up({button:'middle'});
 }
 expect(errors).toEqual([]);await writeFile(info.outputPath('coastal-lod-motion.json'),JSON.stringify(rows,null,2));
});
