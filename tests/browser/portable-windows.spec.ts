import {test,expect} from '@playwright/test';
import {cp,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
import {rolldown} from 'rolldown';
let directory:string, bundle:{source:string;css:string};
let hostSource:string;
let shellBundle:{source:string;css:string};
let layoutBundle:{source:string;css:string};
let manualBundle:{source:string;css:string};
test.beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'portable-windows-'));
 const source=join(directory,'source');await cp(resolve('modules/ui-windows'),source,{recursive:true});
 const built=await buildPortableModule(join(source,'module.json'),join(directory,'windows.spacemod'),{typecheck:false});
 bundle={source:built.codeV2!.source,css:new TextDecoder().decode(built.files.get('assets/windows.css')!)};
 const shellFolder=join(directory,'shell');await cp(resolve('modules/ui-shell'),shellFolder,{recursive:true});
 const shell=await buildPortableModule(join(shellFolder,'module.json'),join(directory,'shell.spacemod'),{typecheck:false});
 shellBundle={source:shell.codeV2!.source,css:new TextDecoder().decode(shell.files.get('assets/shell.css')!)};
 const layoutFolder=join(directory,'layout');await cp(resolve('modules/hud-layout'),layoutFolder,{recursive:true});
 const layout=await buildPortableModule(join(layoutFolder,'module.json'),join(directory,'layout.spacemod'),{typecheck:false});
 layoutBundle={source:layout.codeV2!.source,css:new TextDecoder().decode(layout.files.get('assets/layout.css')!)};
 const manualFolder=join(directory,'manual');await cp(resolve('modules/manual'),manualFolder,{recursive:true});
 const manual=await buildPortableModule(join(manualFolder,'module.json'),join(directory,'manual.spacemod'),{typecheck:false});
 manualBundle={source:manual.codeV2!.source,css:new TextDecoder().decode(manual.files.get('assets/manual.css')!)};
 const host=await rolldown({input:resolve('tests/fixtures/window-host.ts'),plugins:[{name:'public-api',resolveId(raw){if(raw==='@space-sim/game-api')return resolve('packages/game-api/src/index.ts');}}]});
 try{hostSource=(await host.generate({format:'iife',name:'WindowHostFixture'})).output[0]!.code;}finally{await host.close();}
});
test('portable Manual readers share removable guide data while owning independent navigation, live revisions and cleanup',async({page})=>{
 await setup(page);
 await page.evaluate(bundle=>{const f=(window as any).fixture,initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();initialize({settings:{},use:(key:any)=>{if(key.slot!=='ui.window-content')throw new Error('Private dependency');return f.contents[0];},assets:{text:()=>bundle.css},contributeGuide(){},own:(resource:any)=>resource,provide:(_key:any,value:any)=>f.manuals=value});},manualBundle);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,one=document.createElement('section'),two=document.createElement('section'),borrowed=document.createElement('p');borrowed.textContent='Original';one.append(borrowed);document.body.append(one,two);let revision=0,mounts=0,closed=0;
  const book={players:{label:'Players',intro:'Independent document reader',pages:[{id:'home',title:'Home',summary:'Reference',mount(root:HTMLElement){mounts++;root.insertAdjacentHTML('beforeend','<details><summary>Details</summary>Read more</details>');return {dispose(){closed++;}};}}]},creators:{label:'Creators',intro:'Creation',pages:[]}};
  const first=f.manuals.create({root:one,idPrefix:'docs-one',storageKey:'docs-one',book,storage:f.storage,revision:()=>String(revision)}),second=f.manuals.create({root:two,idPrefix:'docs-two',storageKey:'docs-two',book,storage:f.storage});
  const details=one.querySelector('details')!;details.open=true;first.refresh();const retained=one.querySelector('details')===details&&details.open;
  revision++;first.refresh();const renewed=one.querySelector('details')!==details;
  const lease=f.manuals.register([{id:'fixture.help',title:'Imported <img>',summary:'Guide',audience:'players',document:{blocks:[{type:'paragraph',text:'Zirconium non-flight instructions <script>'}]}}]);
  const search=one.querySelector<HTMLInputElement>('input')!;search.value='zirconium';search.dispatchEvent(new Event('input'));const titles=[...one.querySelectorAll('.manual-topic b')].map(node=>node.textContent);
  one.querySelector<HTMLButtonElement>('.manual-topic')!.click();const documentVisible=one.querySelector('article')!.textContent!.includes('Zirconium'),otherStayed=two.querySelector('article')!.textContent!.includes('Home'),images=one.querySelectorAll('img,script').length;
  const saved=JSON.parse(f.stored.get('docs-one'));lease.dispose();const fallback=one.querySelector('article')!.textContent!.includes('Home'),catalog=f.manuals.guides('players').length;search.value='';search.dispatchEvent(new Event('input'));const stale=one.querySelector<HTMLButtonElement>('.manual-topic')!;
  first.dispose();second.dispose();const before=mounts;stale.click();first.refresh();first.show('home');f.manuals.dispose();let rejected=false;try{f.manuals.create({root:one,book});}catch{rejected=true;}
  return {retained,renewed,titles,documentVisible,otherStayed,images,saved,fallback,catalog,mounts,closed,inert:mounts===before,restored:one.firstChild===borrowed&&one.childNodes.length===1,empty:two.childNodes.length===0,classes:one.className,rejected,styles:document.head.querySelectorAll('style').length};
 });
 expect(result).toMatchObject({retained:true,renewed:true,titles:['Imported <img>'],documentVisible:true,otherStayed:true,images:0,saved:{audience:'players',page:{players:'fixture.help'}},fallback:true,catalog:0,inert:true,restored:true,empty:true,classes:'',rejected:true,styles:0});expect(result.closed).toBe(result.mounts);
});
test('portable layout and visibility restore borrowed DOM and preferences without stale handles or observers',async({page})=>{
 await setup(page);
 await page.evaluate(bundle=>{
  const f=(window as any).fixture,initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();
  initialize({settings:{moveStepPx:12},use:()=>f.providers[0],assets:{text:()=>bundle.css},contributeGuide(){},own:(resource:any)=>resource,provide:(_key:any,value:any)=>f.layouts=value});
 },layoutBundle);
 const result=await page.evaluate(async()=>{
  const f=(window as any).fixture,root=document.querySelector('main')!,box=document.createElement('article'),toggle=document.createElement('button'),reset=document.createElement('button'),list=document.createElement('div');
  box.id='fixture-box';box.style.cssText='position:absolute;left:20px;top:20px;width:100px;height:40px';root.append(box);document.body.append(toggle,reset,list);
  const layout=f.layouts.create({viewport:root,editor:{toggle,reset,items:[{id:'box',selector:'#fixture-box',label:'box'}],storage:f.storage}});
  const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));await tick();
  const fit=layout.fit({x:20,y:20,width:100,height:40},600,440);toggle.click();
  const handle=box.querySelector('button')!;handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await tick();
  const translate=box.style.translate.split(' ').map(parseFloat),saved=f.stored.get('space-sim:hud-layout:1');
  const visibility=f.layouts.visibility({viewport:root,list,items:[{id:'box',label:'Box',selector:'#fixture-box'}],storage:f.storage});visibility.set('box',false);
  let writes=0;const lease=visibility.bind('optional','Optional',()=>true,()=>writes++,()=>{}),input=list.querySelector<HTMLInputElement>('#hud-visible-optional')!;
  lease.dispose();input.click();const hidden=box.classList.contains('hud-hidden');
  layout.dispose();visibility.dispose();f.layouts.dispose();const revision=layout.revision;
  handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));toggle.click();window.dispatchEvent(new Event('resize'));await tick();
  return {fit,translate,saved,hidden,writes,editing:layout.editing,restored:box.style.translate,handles:root.querySelectorAll('.hud-move-handle,.hud-layout-toolbar').length,controls:list.childElementCount,visible:!box.classList.contains('hud-hidden'),revisionUnchanged:layout.revision===revision,rootClass:root.classList.contains('hud-layout-root'),observers:f.observers(),styles:document.head.querySelectorAll('style').length};
 });
 expect(result).toMatchObject({hidden:true,writes:0,editing:false,restored:'',handles:0,controls:0,visible:true,revisionUnchanged:true,rootClass:false,observers:0,styles:0});expect(result.translate[0]).toBe(12);expect(result.translate[1]??0).toBe(0);expect(JSON.parse(result.saved).box.x).toBeGreaterThan(0);
 expect(result.fit.x>=120||result.fit.x+result.fit.width<=20||result.fit.y>=60||result.fit.y+result.fit.height<=20).toBe(true);
});
test('portable dock leases restore borrowed content and stop callbacks on removal or failed creation',async({page})=>{
 await setup(page);
 await page.evaluate(shellBundle=>{
  const f=(window as any).fixture,initialize=new Function(`"use strict";${shellBundle.source};return SpaceSimModule.default;`)();
  initialize({settings:{},use:(key:any)=>{if(key.slot!=='ui.windows')throw new Error('Private dependency');return f.providers[0];},assets:{text:()=>shellBundle.css},contributeGuide(){},own:(resource:any)=>resource,provide:(_key:any,value:any)=>f.shells=value});
 },shellBundle);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,root=document.querySelector('main')!,source=document.createElement('article'),toggle=document.createElement('button');source.textContent='Borrowed document';toggle.className='original';toggle.textContent='Original toggle';root.append(source,toggle);let releases=0,focused=0;
  const panel={id:'fixture.shell/reader',title:'Reader',label:'<img src=x>',icon:'manual',hint:'Read',content:[source]};
  const options={viewport:root,groups:[[panel]],instrumentToggle:toggle,release:()=>releases++,focus:()=>focused++};
  const shell=f.shells.create(options);shell.open(panel.id);
  const textLabel=root.querySelector('.dock-item span')!.textContent,images=root.querySelectorAll('img').length;
  const instrument=f.providers[0].create({id:'fixture.shell/log',title:'Log',container:root});
  const entry=shell.addInstrument(instrument,'Log','Events'),item=root.querySelector<HTMLButtonElement>('[id="fixture.shell/log-toast"]')!;item.click();const open=instrument.isOpen;
  entry.dispose();instrument.close();item.click();const stale=instrument.isOpen;
  shell.dispose();shell.open(panel.id);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));
  const restored={source:source.parentNode===root,toggle:toggle.parentNode===root,html:toggle.textContent,className:toggle.className,releases,focused,docks:root.querySelectorAll('.hud-dock').length};
  let failed=false;try{f.shells.create({...options,groups:[[panel,panel]]});}catch{failed=true;}
  const afterFailure={source:source.parentNode===root,windows:root.querySelectorAll('.panel-window').length};
  instrument.dispose();f.shells.dispose();for(const provider of f.providers)provider.dispose();
  return {textLabel,images,open,stale,restored,failed,afterFailure,observers:f.observers(),styles:document.head.querySelectorAll('style').length};
 });
 expect(result).toMatchObject({textLabel:'<img src=x>',images:0,open:true,stale:false,restored:{source:true,toggle:true,html:'Original toggle',className:'original',releases:1,focused:0,docks:0},failed:true,afterFailure:{source:true,windows:0},observers:0,styles:0});
});
test('BrowserModuleHost floats imported content outside settings and Manual searches contributed body text',async({page})=>{
 await page.goto('about:blank');
 await page.setContent(`<style>${bundle.css}</style><main style="position:relative;width:800px;height:600px"></main><section id="game-manual"></section>`);
 await page.addScriptTag({content:hostSource});
 const result=await page.evaluate(()=>{
  const api=(window as any).WindowHostFixture,host=new api.BrowserModuleHost(),graph=new api.ModuleRegistryV2(host.hostServices());let calls=0;
  const manifest={format:'space-sim-module/2',apiVersion:'space-sim-game-api/2',id:'fixture.docs',name:'Fixture documentation',version:'1.0.0',kind:'provider',tier:'platform',environments:['browser'],dependencies:[],conflicts:[],provides:[],requires:[{name:'core.ui',version:'^1.0.0'}],slots:[],before:[],after:[],settings:{},license:'MIT'};
  const doc={id:'help',audience:'creators',title:'Fixture help',summary:'A guide',blocks:[{type:'paragraph',text:'Zirconium rendezvous instructions <img src=x>'}]};
  const initialize=(c:any)=>{const shell=c.use({slot:'core.ui',version:'1.0.0'});c.contributeActions([{id:'fixture.docs/apply',label:'Apply',category:'system',mode:'press',defaultKeys:[]}]);
   c.contributeWindow({name:'reader',title:'Custom help',controls:[{kind:'button',id:'apply',label:'Apply',action:'fixture.docs/apply'}],content:[{kind:'instruction',id:'instructions',document:{blocks:doc.blocks}}]});
   c.contributeGuide({id:doc.id,audience:doc.audience,title:doc.title,summary:doc.summary,asset:'docs/creators/help.json'});
   c.own(shell.onAction('fixture.docs/apply',()=>calls++));shell.open('fixture.docs/reader');
  };
  const assets=api.moduleAssets(new Map([['docs/creators/help.json',new TextEncoder().encode(JSON.stringify(doc))]]));graph.register({manifest,initialize},assets);
  const profile={format:'space-sim-profile/2',id:'fixture.viewer',modules:[{id:manifest.id,version:manifest.version}],providers:{},capabilities:{},settings:{}};
  const candidate=graph.prepare(profile,'browser');
  host.configure(candidate);host.activate(document.querySelector('main')!);
  document.querySelector<HTMLButtonElement>('.window-content-form button')!.click();
  const staged=new api.BrowserModuleHost(),replacement=new api.ModuleRegistryV2(staged.hostServices());replacement.register({manifest,initialize},assets);
  const next=replacement.prepare(profile,'browser');staged.configure(next);staged.root.querySelector('.window-content-form button')!.click();
  const stagedWithoutReplacing=!staged.root.isConnected&&host.root.isConnected;staged.dispose();next.dispose();
  // Manual navigation/search reads the same captured document, with ordinary live controls.
  api.initManual({readControls:()=>({keys:{},players:{count:1,slots:[{device:'none'}]},pads:[],controllerEnabled:false}),openControls(){}});
  (window as any).hostFixture={host,candidate,calls:()=>calls};
  return {details:host.root.querySelectorAll('details').length,windows:host.root.querySelectorAll('.flight-window').length,calls,images:host.root.querySelectorAll('img').length,stagedWithoutReplacing};
 });
 expect(result).toEqual({details:0,windows:1,calls:1,images:0,stagedWithoutReplacing:true});
 const panel=page.locator('[id="fixture.docs/reader-window"]');await expect(panel).toBeVisible();
 await panel.locator('[id="fixture.docs/reader-minimize"]').click();await expect(panel.locator('.flight-window-body')).toBeHidden();
 await page.locator('#manual-tab-creators').click();await page.locator('#manual-search').fill('zirconium');
 await expect(page.locator('.manual-topic b')).toHaveText(['Fixture help']);await page.locator('.manual-topic').click();
 await expect(page.locator('#manual-page')).toContainText('Zirconium rendezvous');await expect(page.locator('#manual-page img')).toHaveCount(0);
 const removed=await page.evaluate(()=>{const f=(window as any).hostFixture,button=document.querySelector<HTMLButtonElement>('.window-content-form button')!;f.host.dispose();f.candidate.dispose();button.click();return {calls:f.calls(),windows:document.querySelectorAll('.module-windows').length,topics:document.querySelectorAll('.manual-topic').length};});
 expect(removed).toEqual({calls:1,windows:0,topics:0});
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
async function setup(page:import('@playwright/test').Page){
 await page.goto('about:blank');await page.setContent('<main style="position:relative;width:600px;height:440px"></main>');
 await page.evaluate(bundle=>{
  const initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();
  const providers:any[]=[],contents:any[]=[],stored=new Map<string,string>();let observers=0;
  const NativeResizeObserver=ResizeObserver;
  window.ResizeObserver=class extends NativeResizeObserver{private active=true;constructor(callback:ResizeObserverCallback){super(callback);observers++;}override disconnect(){if(this.active){this.active=false;observers--;}super.disconnect();}};
  for(let i=0;i<2;i++)initialize({assets:{text:(path:string)=>{if(path!=='assets/windows.css')throw new Error('Unexpected asset');return bundle.css;}},
   selected:()=>true,contributeGuide(){},own:(resource:any)=>resource,provide:(key:any,value:any)=>{if(key.slot==='ui.window-content')contents.push(value);else if(key.slot==='ui.windows')providers.push(value);else throw new Error('Unexpected service');}});
  (window as any).fixture={providers,contents,stored,storage:{getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>{stored.set(key,value);}},observers:()=>observers};
 },bundle);
}
test('portable shared chrome renders imported titles as text and owns movement, resizing, stacking and preferences',async({page})=>{
 await setup(page);
 const initial=await page.evaluate(()=>{
  const f=(window as any).fixture,root=document.querySelector('main')!;let releases=0;
  const first=f.providers[0].create({id:'fixture.reader/help',title:'<img src=x onerror=alert(1)> Guide',container:root,storage:f.storage,releaseInput:()=>releases++});
  const hidden=getComputedStyle(first.element).display==='none';first.open();
  const second=f.providers[0].create({id:'fixture.reader/log',title:'Log',container:root,storage:f.storage,place:()=>({x:140,y:80})});second.open();
  const other=f.providers[1].create({id:'fixture.reader/other',title:'Other',container:root});other.open();
  f.first=first;f.second=second;f.other=other;
  return {hidden,releases,title:first.element.querySelector('.flight-window-drag span').textContent,images:first.element.querySelectorAll('img').length,firstFront:first.isFront,secondFront:second.isFront,otherFront:other.isFront};
 });
 expect(initial).toEqual({hidden:true,releases:1,title:'<img src=x onerror=alert(1)> Guide',images:0,firstFront:false,secondFront:true,otherFront:true});
 const first=page.locator('[id="fixture.reader/help-window"]');
 await first.locator('.flight-window-drag').press('ArrowRight');
 expect(await first.evaluate(el=>parseFloat((el as HTMLElement).style.left))).toBe(32);
 const before=await first.evaluate(el=>el.getBoundingClientRect().width);
 await first.locator('.window-resize[data-edge=e]').press('ArrowRight');
 expect(await first.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(before);
 await first.locator('.window-pin').click();
 await first.locator('[id="fixture.reader/help-minimize"]').click();
 await expect(first.locator('.flight-window-body')).toBeHidden();
 await first.locator('[id="fixture.reader/help-minimize"]').click();
 await first.locator('[id="fixture.reader/help-maximize"]').click();
 expect(await first.evaluate(el=>el.getBoundingClientRect().width)).toBe(584);
 await first.locator('[id="fixture.reader/help-maximize"]').click();
 const restored=await page.evaluate(()=>{
  const f=(window as any).fixture,root=document.querySelector('main')!;
  const saved=JSON.parse(f.stored.get('space-sim:flight-window:1:fixture.reader/help'));
  f.first.dispose();const again=f.providers[0].create({id:'fixture.reader/help',title:'Guide',container:root,storage:f.storage});
  const result={saved,open:again.isOpen,pinned:again.pinned,left:again.element.style.left,width:again.element.style.width};f.again=again;return result;
 });
 expect(restored.open).toBe(true);expect(restored.pinned).toBe(true);expect(restored.saved.x).toBe(32);expect(restored.left).toBe('32px');
 expect(parseFloat(restored.width)).toBeGreaterThan(before);
 const closed=await page.evaluate(()=>{const f=(window as any).fixture;for(const provider of f.providers)provider.dispose();return {observers:f.observers(),windows:document.querySelectorAll('.flight-window').length,styles:document.querySelectorAll('style').length};});
 expect(closed).toEqual({observers:0,windows:0,styles:0});
});
test('documents, instruction lists, inspector controls and versioned preview extensions share disposable content',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,content=f.contents[0],root=document.querySelector('main')!,actions:any[]=[],pages:string[]=[],controls=new Map();
  const options={action:(...args:any[])=>actions.push(args),navigate:(page:string)=>pages.push(page),control:(id:string,node:HTMLElement)=>controls.set(id,node)};
  const doc={blocks:[{type:'heading',text:'Read <script>alert(1)</script>'},{type:'paragraph',text:'A reusable reader'},
   {type:'list',ordered:true,items:['First','Second']},{type:'code',text:'<img onerror=alert(1)>'},{type:'link',text:'More',page:'fixture.docs/help'}]};
  const reading=content.document(root,doc,options);root.querySelector('a')!.click();
  const form=content.mount(root,{kind:'inspector',id:'fields',controls:[{kind:'toggle',id:'enabled',label:'Enabled',action:'fixture.docs/enable'},
   {kind:'slider',id:'size',label:'Size',action:'fixture.docs/size',minimum:1,maximum:5,step:1}]},options);
  const toggle=controls.get('enabled') as HTMLInputElement;toggle.click();
  const log=content.mount(root,{kind:'log',id:'events',items:['Arrived','Departed']});
  const type={name:'fixture.orbit',version:'1.0.0'};let disposed=0,resized=0,retained:any,immutable=false;
  const registration=content.register({type,validate(data:any){immutable=Object.isFrozen(data)&&Object.isFrozen(data.points);return data;},mount(target:HTMLElement,_data:any,callbacks:any){
   retained=callbacks;target.textContent='Independent preview';return {resize(){resized++;},dispose(){disposed++;}};}});
  let duplicate=false,missing=false;
  try{content.register({type,validate(){},mount(){}});}catch{duplicate=true;}
  try{content.mount(root,{kind:'preview',id:'missing',type:{...type,version:'2.0.0'},data:null});}catch{missing=true;}
  const preview=content.mount(root,{kind:'preview',id:'preview',type,data:{points:[1,2]}},options);
  retained.action('fixture.docs/size',2);registration.dispose();retained.action('fixture.docs/size',3);
  const before={text:root.textContent,images:root.querySelectorAll('img,script').length,ordered:root.querySelectorAll('.window-content-document ol li').length,logs:root.querySelectorAll('[role=log] li').length};
  reading.dispose();form.dispose();log.dispose();preview.dispose();toggle.click();retained.navigate('stale');content.dispose();
  let rejected=false;try{content.document(root,doc);}catch{rejected=true;}
  return {before,actions,pages,disposed,resized,immutable,duplicate,missing,rejected,observers:f.observers(),remaining:root.childElementCount};
 });
 expect(result).toMatchObject({actions:[['fixture.docs/enable',true],['fixture.docs/size',2]],pages:['fixture.docs/help'],disposed:1,immutable:true,duplicate:true,missing:true,rejected:true,observers:0,remaining:0});
 expect(result.resized).toBeGreaterThan(0);expect(result.before).toMatchObject({images:0,ordered:2,logs:2});expect(result.before.text).toContain('<script>alert(1)</script>');
});
test('failed construction and provider disposal release borrowed resources and prevent stale callbacks',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{
  const f=(window as any).fixture,root=document.querySelector('main')!,provider=f.providers[0];let decoratedClosed=0,changes=0;
  let failed=false;try{provider.create({id:'fixture.failure',title:'Bad',container:root,decorate(){throw new Error('Decoration failed');}});}catch{failed=true;}
  const afterFailure=root.querySelectorAll('.flight-window').length;
  const first=provider.create({id:'fixture.cleanup',title:'Cleanup',container:root,decorate(){return {dispose(){decoratedClosed++;throw new Error('Cleanup failed');}};}});
  let duplicate=false;try{provider.create({id:'fixture.cleanup',title:'Duplicate',container:root});}catch{duplicate=true;}
  first.onChange(()=>changes++);first.open();const before=changes;
  const borrowed=document.createElement('section');root.append(borrowed);provider.resize(borrowed,root,'Borrowed',{change(){},end(){}});provider.raise(borrowed);
  let cleanupFailed=false;try{provider.dispose();}catch{cleanupFailed=true;}
  document.dispatchEvent(new Event('hud-layout-reset'));first.open();first.setPinned(true);first.element.querySelector('.window-pin').click();
  let rejected=false;try{provider.create({id:'fixture.closed',title:'Closed',container:root});}catch{rejected=true;}
  f.providers[1].dispose();
  return {failed,afterFailure,duplicate,cleanupFailed,decoratedClosed,rejected,changes,before,windows:root.querySelectorAll('.flight-window').length,borrowedStillOwnedByCaller:borrowed.isConnected,borrowedHandles:borrowed.querySelectorAll('.window-resize').length,observers:f.observers(),styles:document.querySelectorAll('style').length,open:first.isOpen};
 });
 expect(result).toMatchObject({failed:true,afterFailure:0,duplicate:true,cleanupFailed:true,decoratedClosed:1,rejected:true,windows:0,borrowedStillOwnedByCaller:true,borrowedHandles:0,observers:0,styles:0,open:false});expect(result.changes).toBe(result.before);
});
