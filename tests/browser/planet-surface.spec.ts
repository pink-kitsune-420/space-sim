import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import type {run} from './fixtures/planet-surface';
let script:string,expected:ReturnType<typeof run>;
test.beforeAll(async()=>{
 const built=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:resolve('tests/browser/fixtures/planet-surface.ts'),formats:['iife'],name:'PlanetSurfaceProof'}}});
 const out=Array.isArray(built)?built[0]!:built;if(!('output' in out))throw Error('Missing fixture output');script=out.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n');
 // Use the bundled first-party fixture in Node too: native ESM cannot load the
 // host's JSON imports, whereas the browser bundle already contains those data.
 expected=new Function(script+'\nreturn PlanetSurfaceProof.run();')() as ReturnType<typeof run>;
});
for(const environment of ['browser','offline'])test('shared physical map/profile and world save ('+environment+')',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 if(environment==='offline'){const path=info.outputPath('planet-surface.html');await writeFile(path,'<!doctype html><meta charset="utf-8"><script>'+script.replaceAll('</script','<\\/script')+'</script>');await page.goto(pathToFileURL(path).href);}
 else{await page.route('**/planet-surface-proof.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}));await page.goto('/planet-surface-proof.html');await page.addScriptTag({content:script});}
 const result=await page.evaluate(()=>(window as unknown as {PlanetSurfaceProof:{run:typeof run}}).PlanetSurfaceProof.run());
 for(const key of ['exactRing','exactWater','roundtrip','privateEquator','predictionMatches'] as const)expect(result[key],key).toBe(true);
 expect(result).toEqual(expected);expect(result.status).toBe('flying');expect(result.water).toBe('submerged');expect(errors).toEqual([]);
 await writeFile(info.outputPath('planet-surface-proof.json'),JSON.stringify(result,null,2));
});
