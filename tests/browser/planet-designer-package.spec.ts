import {test,expect,type Page} from '@playwright/test';
import {cp,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {rolldown} from 'rolldown';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {useCanvas} from '../helpers/canvas';
let directory:string,hostSource:string,bundle:{manifest:unknown;source:string;assets:[string,string][]};
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'portable-designer-'));const source=join(directory,'source');await cp(resolve('modules/planet-designer'),source,{recursive:true});const built=await buildPortableModule(join(source,'module.json'),join(directory,'designer.spacemod'),{typecheck:false});
 bundle={manifest:built.descriptor.manifest,source:built.codeV2!.source,assets:[...built.descriptor.assets.map(a=>a.path),...built.descriptor.guides].map(path=>[path,new TextDecoder().decode(built.files.get(path)!)])};
 const host=await rolldown({input:resolve('tests/fixtures/designer-host.ts')});try{hostSource=(await host.generate({format:'iife',name:'DesignerHost'})).output[0]!.code;}finally{await host.close();}
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
async function setup(page:Page,preview=false){
 await page.goto('about:blank');await page.setContent('<main id="one"><p>Borrowed one</p></main><main id="two"><p>Borrowed two</p></main>');await page.addScriptTag({content:hostSource});
 await page.evaluate(({bundle,preview})=>{
  const api=(window as any).DesignerHost,registry=new api.ModuleRegistryV2(api.engineModuleServices()),initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();
  registry.register({manifest:bundle.manifest,initialize},api.moduleAssets(new Map(bundle.assets.map(([path,text])=>[path,new TextEncoder().encode(text)]))));
  const m=bundle.manifest as any,modules=[{id:m.id,version:m.version}],providers:any=Object.fromEntries(m.slots.map((slot:string)=>[slot,m.id])),draws:any[]=[],closed:number[]=[],previews:any[]=[];
  if(preview){
   const manifest={format:'space-sim-module/2',apiVersion:'space-sim-game-api/2',id:'fixture.preview',version:'1.0.0',kind:'provider',name:'Preview recorder',license:'MIT',environments:['browser','offline'],tier:'presentation',dependencies:[],conflicts:[],provides:[{name:'render.webgl',version:'1.0.0'},{name:'render.vector-shaders',version:'1.0.0'}],requires:[],slots:['render.webgl','render.vector-shaders'],before:[],after:[],settings:{}};
   registry.register({manifest,initialize(context:any){context.provide(api.WEBGL_DRAWING,{preview(){const id=previews.length,item={ready:true,draw(body:any){draws.push({id,body});},dispose(){closed.push(id);if(id===0&&(window as any).fixture.failCleanup)throw new Error('preview cleanup failure');}};previews.push(item);return item;},create(){throw new Error('Scene creation not expected');},dispose(){}});context.provide(api.VECTOR_SHADERS,{defaults:{},validate(){throw new Error('Not expected');},parse(){throw new Error('Not expected');}});}});
   modules.push({id:manifest.id,version:manifest.version});for(const slot of manifest.slots)providers[slot]=manifest.id;
  }
  const candidate=registry.prepare({format:'space-sim-profile/2',id:'fixture.designer',modules,providers,capabilities:{},settings:{}},'browser'),factory=candidate.providedService(api.PLANET_DESIGNERS),world=new api.World(api.DEFAULT_UNIVERSE,{id:'body-viewer'}),before=JSON.stringify(api.saveWorld(world)),body=world.system.getAllBodies().find((b:any)=>b.surfaceFeatures!=='star'),stores=[new Map<string,string>(),new Map<string,string>()],downloads:any[]=[];
  const options=(index:number)=>({root:document.getElementById(index===0?'one':'two'),idPrefix:index===0?'first':'second',world:()=>world,current:()=>body.id,storage:{getItem:(key:string)=>stores[index]!.get(key)??null,setItem:(key:string,value:string)=>stores[index]!.set(key,value)},download:(name:string,blob:Blob)=>downloads.push({name,blob}),confirm:()=>true,copy:async()=>{}});
  const first=factory.create(options(0)),second=factory.create(options(1));first.open();second.open();
  (window as any).fixture={api,registry,candidate,factory,world,before,body,stores,downloads,options,first,second,draws,closed,previews};
 },{bundle,preview});
}

test('real designer archive edits and exports viewer-only looks, cleanly reimports them and isolates two body viewers',async({page})=>{
 await setup(page);
 await expect(page.locator('#one .designer-status')).toContainText('Preview provider absent');
 await page.locator('#one .designer-presets button').filter({hasText:'Ocean world'}).click();await page.locator('#one .designer-actions button.primary').click();await page.locator('#first-name').fill('Independent ocean');await page.getByRole('button',{name:'Save design',exact:true}).first().click();await page.getByRole('button',{name:'Export My planets',exact:true}).first().click();
 const exported=await page.evaluate(async()=>{const f=(window as any).fixture;return await f.downloads[0].blob.text();});expect(JSON.parse(exported).format).toBe('space-sim-planets/1');
 await page.locator('#two input[type=file]').setInputFiles({name:'my-planets.json',mimeType:'application/json',buffer:Buffer.from(exported)});await expect(page.locator('#two .designer-status')).toContainText('Imported 1 design');
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,original=f.body.appearance,applied=f.first.appearanceFor(f.world,f.body),other=f.second.appearanceFor(f.world,f.body),foreign={universe:{id:'other-universe'},systemId:f.world.systemId};
  const scoped=f.first.appearanceFor(foreign,f.body)===original;
  const unique=new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size===document.querySelectorAll('[id]').length;
  const stale=document.querySelector('#one button.primary') as HTMLButtonElement,storeBefore=JSON.stringify([...f.stores[0]]);f.candidate.dispose();stale.click();
  return{applied:applied.style,isolated:other===original,scoped,unique,preserved:JSON.stringify(f.api.saveWorld(f.world))===f.before,staleSafe:JSON.stringify([...f.stores[0]])===storeBefore,roots:[document.getElementById('one')!.textContent,document.getElementById('two')!.textContent],styles:document.head.querySelectorAll('style').length,defaults:f.first.appearanceFor(f.world,f.body)===original};
 });expect(result).toMatchObject({applied:'oceanic',isolated:true,scoped:true,unique:true,preserved:true,staleSafe:true,roots:['Borrowed one','Borrowed two'],styles:0,defaults:true});
});

test('preview instances remain independent and failing cleanup still closes peers and restores borrowed roots',async({page})=>{
 await setup(page,true);await expect.poll(()=>page.evaluate(()=>(window as any).fixture.draws.length)).toBeGreaterThan(1);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture;f.failCleanup=true;const errors:string[]=[],flatten=(error:any):void=>{if(error instanceof AggregateError)error.errors.forEach(flatten);else errors.push(error.message);};
  try{f.factory.dispose();}catch(error){flatten(error);}f.factory.dispose();f.candidate.dispose();
  return{drawn:[...new Set(f.draws.map((d:any)=>d.id))],closed:f.closed,errors,preserved:JSON.stringify(f.api.saveWorld(f.world))===f.before,roots:[document.getElementById('one')!.textContent,document.getElementById('two')!.textContent],styles:document.head.querySelectorAll('style').length};
 });expect(result).toMatchObject({drawn:[0,1],closed:[0,1],errors:['preview cleanup failure'],preserved:true,roots:['Borrowed one','Borrowed two'],styles:0});
});

test('disposed editors ignore pending file reads, clipboard completions, PNG callbacks and stale controls',async({page})=>{
 await setup(page,true);
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,root=document.getElementById('two')!,fileInput=root.querySelector('input[type=file]') as HTMLInputElement;let resolveText!:(text:string)=>void,resolveCopy!:()=>void,png:BlobCallback|undefined;
  const pending=new Promise<string>(resolve=>{resolveText=resolve;});Object.defineProperty(fileInput,'files',{value:[{name:'late.json',size:20,text:()=>pending}]});fileInput.dispatchEvent(new Event('change'));
  f.first.dispose();const options=f.options(0);options.copy=()=>new Promise<void>(resolve=>{resolveCopy=resolve;});const third=f.factory.create(options);third.open();const rootOne=document.getElementById('one')!,canvas=rootOne.querySelector('canvas')!;canvas.toBlob=callback=>{png=callback;};
  for(const name of ['Copy JSON','Download PNG'])Array.from(rootOne.querySelectorAll('button')).find(b=>b.textContent===name)!.click();const stale=rootOne.querySelector('button.primary') as HTMLButtonElement;
  f.factory.dispose();const before=JSON.stringify(f.stores.map((store:Map<string,string>)=>[...store]));resolveText(JSON.stringify({designs:[{name:'late',appearance:{style:'rocky',colors:['#000000','#000000','#000000','#000000']}}]}));resolveCopy();png?.(new Blob(['late']));stale.click();await Promise.resolve();await Promise.resolve();f.candidate.dispose();
  return{unchanged:JSON.stringify(f.stores.map((store:Map<string,string>)=>[...store]))===before,downloads:f.downloads.length,roots:[document.getElementById('one')!.textContent,root.textContent],preserved:JSON.stringify(f.api.saveWorld(f.world))===f.before};
 });expect(result).toMatchObject({unchanged:true,downloads:0,roots:['Borrowed one','Borrowed two'],preserved:true});
});

test('production designer preserves scoped applied looks, JSON export and restore across reload',async({page})=>{
 await useCanvas(page);await page.goto('/');await expect(page.locator('#status')).toHaveText('LANDED');
 const open=async()=>{await page.evaluate(()=>document.querySelector<HTMLButtonElement>('[data-workspace="tools"]')!.click());await page.locator('.planet-designer summary').click();await expect(page.locator('#designer-body option')).not.toHaveCount(0);};
 await open();await page.locator('#planet-designer .designer-presets button').filter({hasText:'Ocean world'}).click();await page.locator('#planet-designer button.primary').click();await page.locator('#designer-name').fill('Production ocean');await page.locator('#planet-designer').getByRole('button',{name:'Save design',exact:true}).click();
 const stored=await page.evaluate(()=>localStorage.getItem('space-sim.planet-looks/1'));expect(stored).toContain('oceanic');
 const downloaded=page.waitForEvent('download');await page.locator('#planet-designer').getByRole('button',{name:'Export My planets',exact:true}).click();const file=await downloaded;expect(file.suggestedFilename()).toBe('my-planets.json');
 await page.reload();await expect(page.locator('#status')).toHaveText('LANDED');await open();await expect(page.locator('#planet-designer .designer-status')).toContainText('shows your design');await expect(page.locator('#planet-designer .designer-library')).toContainText('Production ocean');
 await page.locator('#planet-designer').getByRole('button',{name:'Restore original',exact:true}).click();await expect(page.locator('#planet-designer .designer-status')).toContainText('shows its own look');expect(await page.evaluate(()=>localStorage.getItem('space-sim.planet-looks/1'))).toBe('{}');
});

test('design imports reject nonfinite tuning, invalid palettes and oversized files before changing viewer storage',async({page})=>{
 await setup(page);
 for(const content of [
  '{"designs":[{"name":"bad","appearance":{"style":"rocky","colors":["#000000","#000000","#000000","#000000"],"seed":1e999}}]}',
  JSON.stringify({designs:[{name:'bad',appearance:{style:'rocky',colors:['#000000','#000000','#000000','red']}}]}),
  JSON.stringify({designs:[{name:'bad',appearance:{style:'rocky',colors:['#000000','#000000','#000000','#000000'],water:2}}]}),
  ' '.repeat(1048577),
 ]){
  await page.locator('#two input[type=file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(content)});
  await expect(page.locator('#two .designer-status')).toContainText('Could not import invalid.json');
 }
 expect(await page.evaluate(()=>{const f=(window as any).fixture;const result={empty:f.stores.every((store:Map<string,string>)=>store.size===0),preserved:JSON.stringify(f.api.saveWorld(f.world))===f.before};f.candidate.dispose();return result;})).toEqual({empty:true,preserved:true});
});
