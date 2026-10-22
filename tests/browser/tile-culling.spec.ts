import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const guards: Record<string,string> = {
  [resolve('modules/render-webgl/src/webgl.ts')]: 'if (right <= left || top <= bottom) continue;',
  [resolve('modules/render-canvas/src/canvas.ts')]: 'if (maxX < -marginX || maxY < -marginY || minX > width + marginX || minY > height + marginY) { ctx.restore(); continue; }',
};

test.beforeAll(async () => {
  for (const slot of ['reference','candidate']) await build({ configFile:false,logLevel:'error',
    define:{__CULLING_FIXTURE_SLOT__:JSON.stringify(slot)},
    resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},
    plugins:slot==='reference'?[{name:'unculled-raster-reference',enforce:'pre',async load(id){
      const guard=guards[id];if(!guard)return;
      const source=await readFile(id,'utf8');
      if(source.split(guard).length!==2)throw Error('Expected exactly one culling guard in '+id);
      // Only disable rejection: raster/clipping/state remain actual production code.
      return source.replace(guard,'');
    }}]:[],
    build:{outDir:'dist',emptyOutDir:false,lib:{entry:resolve('tests/browser/fixtures/tile-culling.ts'),formats:['iife'],name:'TileCulling'+slot,fileName:()=> 'tile-culling-'+slot+'.js'}}
  });
});

for (const dpr of [1,2]) test('empty-clip culling preserves every raster pixel and subsequent state DPR'+dpr, async ({browser},info) => {
  test.setTimeout(180000);
  const context=await browser.newContext({viewport:{width:640,height:480},deviceScaleFactor:dpr});
  const page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/culling-fixture.html',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"></body></html>'}));
  await page.goto('/culling-fixture.html');
  for(const slot of ['reference','candidate'])await page.addScriptTag({url:'/tile-culling-'+slot+'.js'});
  const trials=[];
  for(const [rotation,cameraRotation] of [[0,0],[Math.PI/4,0],[0,Math.PI/4],[Math.PI/2,Math.PI/4]])
    for(const [x,y] of [[-48,120],[-.01,120],[160,120],[320.01,120],[368,120],[160,-48],[160,-.01],[160,240.01],[160,288]])
      trials.push({rotation,cameraRotation,x,y});
  for(const base of [-1e12,1e12])for(const mutate of [false,true])trials.push({rotation:Math.PI/4,cameraRotation:Math.PI/2,x:-48,y:120,base,mix:true,mutate});
  for(const scale of [.03125,1e4])for(const x of [-.01,368])trials.push({rotation:Math.PI/2,cameraRotation:Math.PI/4,x,y:120,scale});
  const rows=[];let savedTiles=0,savedFills=0;
  for(const cap of dpr===1?[.5,1]:[2])for(const renderer of ['Canvas','WebGL'])for(const trial of trials){
    const result=await page.evaluate(async t=>{
      const fixture=window as unknown as Record<string,{run(t:unknown):Promise<{digest:string;backing:number[];sentinel:number[];counts:{tiles:number;fills:number};glError:number}>}>;
      return {reference:await fixture.tileCulling_reference!.run(t),candidate:await fixture.tileCulling_candidate!.run(t)};
    },{...trial,renderer,cap});
    expect(result.candidate.digest,JSON.stringify({renderer,cap,...trial})).toBe(result.reference.digest);
    expect(result.candidate.backing).toEqual([320*cap,240*cap]);
    for(const row of [result.reference,result.candidate]){expect(row.glError).toBe(0);expect(row.sentinel).toEqual([0,255,0,255]);}
    expect(result.candidate.counts.tiles).toBeLessThanOrEqual(result.reference.counts.tiles);
    expect(result.candidate.counts.fills).toBeLessThanOrEqual(result.reference.counts.fills);
    savedTiles+=result.reference.counts.tiles-result.candidate.counts.tiles;
    savedFills+=result.reference.counts.fills-result.candidate.counts.fills;
    rows.push({renderer,cap,...trial,...result});
  }
  expect(savedTiles).toBeGreaterThan(0);expect(savedFills).toBeGreaterThan(0);expect(errors).toEqual([]);
  const evidence = info.outputPath('full-pixel-parity.json');
  await writeFile(evidence,JSON.stringify({browser:browser.version(),dpr,savedTiles,savedFills,rows},null,2));
  await info.attach('full-pixel-parity',{path:evidence,contentType:'application/json'});
  await context.close();
});
