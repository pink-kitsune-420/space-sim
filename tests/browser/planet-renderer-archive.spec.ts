import {test,expect} from '@playwright/test';
import {build} from 'vite';
import {buildPortableModule,packModule} from '../../packages/module-tools/package.mjs';
import {cp,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
let script:string;
test.beforeAll(async()=>{
 const temp=await mkdtemp(join(tmpdir(),'space-sim-renderer-archive-')),packages:Record<string,string>={};
 for(const id of['webgl','canvas']){const source=join(temp,id);await cp(resolve('modules/render-'+id),source,{recursive:true});await buildPortableModule(join(source,'module.json'));const archive=join(temp,id+'.spacemod');await packModule(source,archive,{compression:'store'});packages[id]=(await readFile(archive)).toString('base64');}
 const result=await build({configFile:false,logLevel:'error',define:{__RENDER_PACKAGES__:JSON.stringify(packages)},resolve:{alias:{'@space-sim/game-api':resolve('packages/game-api/src/index.ts')}},build:{write:false,lib:{entry:resolve('tests/browser/fixtures/planet-renderer-archive.ts'),formats:['iife'],name:'PlanetRendererArchiveFixture'}}});
 const bundle=Array.isArray(result)?result[0]!:result;if(!('output'in bundle))throw Error('Missing fixture bundle');script=bundle.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n');
});
for(const backend of['webgl','canvas']as const)for(const environment of['browser','offline']as const)test(`independent ${backend} planet map archive and existing shader pack (${environment})`,async({page},info)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 if(environment==='offline'){const path=info.outputPath('renderer-offline.html');await writeFile(path,'<!doctype html><body><script>'+script.replaceAll('</script','<\\/script')+'</script>');await page.goto(pathToFileURL(path).href);}else{await page.route('**/planet-archive.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body>'}));await page.goto('/planet-archive.html');await page.addScriptTag({content:script});}
 const r=await page.evaluate(async t=>(window as unknown as{PlanetRendererArchive:{run:(b:'webgl'|'canvas',e:'browser'|'offline')=>Promise<{error:number;capability:number;blue:number;land:number;rejected:boolean}>}}).PlanetRendererArchive.run(t.backend,t.environment),{backend,environment});
 expect(r.error).toBe(0);expect(r.capability).toBe(1);expect(r.blue).toBeGreaterThan(2000);expect(r.land).toBeGreaterThan(1000);expect(r.rejected).toBe(true);expect(errors).toEqual([]);await writeFile(info.outputPath('renderer-archive.json'),JSON.stringify(r,null,2));
});
