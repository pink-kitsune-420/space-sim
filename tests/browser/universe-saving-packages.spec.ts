import {test,expect,type Page} from '@playwright/test';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {rolldown} from 'rolldown';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
let directory:string,script:string,bundles:any[];
test.beforeAll(async()=>{
  const bundle=await rolldown({input:'tests/fixtures/vehicle-host.ts',platform:'browser'});try{script=(await bundle.generate({format:'iife',name:'UniverseHost',exports:'named'})).output[0]!.code;}finally{await bundle.close();}
  directory=await mkdtemp(join(tmpdir(),'universe-ui-'));bundles=[];
  for(const name of ['universe-saves','universe-files','universe-save-controls']){
    const folder=join(directory,name);await cp(resolve('modules',name),folder,{recursive:true});const built=await buildPortableModule(join(folder,'module.json'),undefined,{typecheck:false});bundles.push({manifest:built.descriptor.manifest,source:built.codeV2!.source,digest:built.integrity.digest,assets:[...built.files].filter(([path])=>built.descriptor.guides.includes(path)).map(([path,bytes])=>[path,Array.from(bytes)])});
  }
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
async function load(page:Page){
  await page.goto('about:blank');await page.setContent('<div id="a"><p>Borrowed A</p></div><div id="b"><p>Borrowed B</p></div>');await page.addScriptTag({content:script});
  await page.evaluate(bundles=>{
    const h=(window as any).UniverseHost,graph=new h.ModuleRegistryV2([...h.engineModuleServices(),h.universeSaveFormatService]);
    for(const b of bundles){graph.register({manifest:b.manifest,contentDigest:b.digest,supportsMultiplayer:true,initialize:new Function(`"use strict";\n${b.source}\n;return SpaceSimModule.default;`)()},h.moduleAssets(new Map(b.assets.map(([path,bytes]:any)=>[path,new Uint8Array(bytes)]))));}
    const profile={format:'space-sim-profile/2',id:'fixture.universe-ui',modules:bundles.map(b=>({id:b.manifest.id,version:b.manifest.version})),providers:Object.fromEntries(bundles.flatMap(b=>b.manifest.slots.map((slot:string)=>[slot,b.manifest.id]))),capabilities:{},settings:{}};
    const candidate=graph.prepare(profile,'browser');let world=new h.World(h.DEFAULT_UNIVERSE),identity:object={},release:(()=>void)|undefined,hold=false;
    world.spawn({ownerId:'reader',presetId:'planet-orbit'});world.advanceTo(100);const events:string[]=[],commands:any[]=[],controls:any[]=[];
    for(const prefix of ['a','b']){
      const command=candidate.providedService(h.UNIVERSE_SAVES).create({current:()=>({identity,world,canSave:true,canLoad:true}),async restore(raw:any,signal:AbortSignal,guard:()=>void){if(hold)await new Promise<void>(done=>{release=done;signal.addEventListener('abort',()=>done(),{once:true});});guard();const loaded=h.loadWorld(raw);world.dispose();world=loaded.world;identity={};}});commands.push(command);
      controls.push(candidate.providedService(h.UNIVERSE_SAVE_CONTROLS).mount({root:document.getElementById(prefix),prefix,commands:command,saved(){events.push(prefix+':saved');},loaded(){events.push(prefix+':loaded');},error(operation:string,error:Error){events.push(prefix+':'+operation+':'+error.message);}}));
    }
    (window as any).universeFixture={h,candidate,get world(){return world;},commands,controls,events,hold(){hold=true;},release(){release?.();},switch(){identity={};},snapshot(){return JSON.stringify(h.saveWorld(world));}};
  },bundles);
}
test('independent imported universe controls export and reload .spaceuniverse files with engine validation',async({page})=>{
  await load(page);const download=page.waitForEvent('download');await page.locator('#a-save').click();const saved=await download;expect(saved.suggestedFilename()).toMatch(/\.spaceuniverse$/);
  const bytes=await readFile((await saved.path())!);expect(bytes[0]).toBe(0x50);await expect.poll(()=>page.evaluate(()=>(window as any).universeFixture.events)).toContain('a:saved');
  await page.evaluate(()=>{const f=(window as any).universeFixture;f.world.advanceTo(250);});
  await page.locator('#b-file').setInputFiles({name:'universe.spaceuniverse',mimeType:'application/zip',buffer:bytes});
  await expect.poll(()=>page.evaluate(()=>(window as any).universeFixture.events)).toContain('b:loaded');expect(await page.evaluate(()=>(window as any).universeFixture.world.tick)).toBe(100);
  const before=await page.evaluate(()=>(window as any).universeFixture.snapshot());await page.locator('#a-file').setInputFiles({name:'bad.spaceuniverse',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await expect.poll(()=>page.evaluate(()=>(window as any).universeFixture.events.some((event:string)=>event.startsWith('a:load:')))).toBe(true);expect(await page.evaluate(()=>(window as any).universeFixture.snapshot())).toBe(before);
  expect(await page.locator('#a-file').inputValue()).toBe('');expect(await page.locator('#b-file').inputValue()).toBe('');
});
test('stale and cancelled loads retain the current world and disposal restores borrowed roots without live stale buttons',async({page})=>{
  await load(page);const download=page.waitForEvent('download');await page.locator('#a-save').click();const saved=await download,bytes=await readFile((await saved.path())!);
  await page.evaluate(()=>{const f=(window as any).universeFixture;f.hold();f.world.advanceTo(200);});const before=await page.evaluate(()=>(window as any).universeFixture.snapshot());
  await page.locator('#a-file').setInputFiles({name:'universe.spaceuniverse',mimeType:'application/zip',buffer:bytes});
  await expect.poll(()=>page.evaluate(()=>(window as any).universeFixture.controls[0].busy)).toBe(true);
  await page.evaluate(()=>{const f=(window as any).universeFixture;f.switch();f.release();});
  await expect.poll(()=>page.evaluate(()=>(window as any).universeFixture.events.some((event:string)=>event.includes('session changed')))).toBe(true);expect(await page.evaluate(()=>(window as any).universeFixture.snapshot())).toBe(before);
  await page.locator('#b-file').setInputFiles({name:'universe.spaceuniverse',mimeType:'application/zip',buffer:bytes});await expect.poll(()=>page.evaluate(()=>(window as any).universeFixture.controls[1].busy)).toBe(true);
  const result=await page.evaluate(async()=>{const f=(window as any).universeFixture,stale=document.getElementById('a-save')!,events=f.events.length;f.controls[1].dispose();f.candidate.dispose();f.release();stale.click();for(let i=0;i<20;i++)await Promise.resolve();return{before:f.snapshot(),events:f.events.length,expected:events,rootA:document.getElementById('a')!.textContent,rootB:document.getElementById('b')!.textContent};});
  expect(result).toMatchObject({before,rootA:'Borrowed A',rootB:'Borrowed B'});expect(result.events).toBe(result.expected);
});
