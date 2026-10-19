import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {resolve} from 'node:path';
import {useLowGraphics} from '../helpers/canvas';
let script:string;
test.beforeAll(async()=>{
 const output=await build({configFile:false,logLevel:'silent',resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},build:{write:false,
  lib:{entry:resolve('tests/helpers/trajectory-harness.ts'),name:'trajectoryHarness',formats:['iife']}}});
 const bundle=Array.isArray(output)?output[0]!:output;if(!('output'in bundle))throw Error('Missing bundle');
 const chunk=bundle.output.find(c=>c.type==='chunk');if(!chunk||chunk.type!=='chunk')throw Error('Missing chunk');script=chunk.code;
});
for(const renderer of ['canvas','webgl'] as const)test(`${renderer} displays continuous encounter legs and timed vector markers`,async({page},info)=>{
 await useLowGraphics(page);await page.setViewportSize({width:820,height:620});await page.goto('about:blank');await page.addScriptTag({content:script});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const result=await page.evaluate(kind=>(window as any).trajectoryHarness.draw(kind),renderer);
 expect(result.encounters.slice(0,2)).toEqual([{from:'planet',to:'moon'},{from:'moon',to:'planet'}]);
 expect(result.outlinePixels).toBeGreaterThan(10);expect(result.bodyDisplacement).toBeGreaterThan(1);
 expect(result.amber).toBeGreaterThan(50);expect(result.mint).toBeGreaterThan(50);expect(result.error).toBe(0);expect(result.tick).toBe(0);expect(errors).toEqual([]);
 await page.screenshot({path:info.outputPath(`trajectory-${renderer}.png`)});await info.attach('trajectory-profile',{body:JSON.stringify(result),contentType:'application/json'});
});
