import {test,expect} from '@playwright/test';
import {cp,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPortableModule} from '../../packages/module-tools/package.mjs';
let folder:string,bundle:{source:string;css:string};
test.beforeAll(async()=>{folder=await mkdtemp(join(tmpdir(),'portable-mod-menu-'));await cp('modules/mod-menu',join(folder,'source'),{recursive:true});const built=await buildPortableModule(join(folder,'source/module.json'),join(folder,'mod-menu.spacemod'),{typecheck:false});bundle={source:built.codeV2!.source,css:new TextDecoder().decode(built.files.get('assets/mod-menu.css')!)};});
test.afterAll(async()=>{await rm(folder,{recursive:true,force:true});});
test('bundled source catalogue is inert, filters metadata and restores borrowed content on disposal',async({page})=>{
 await page.goto('about:blank');await page.setContent('<main><p>Borrowed content</p></main>');
 const result=await page.evaluate(bundle=>{
  const exports=new Function(`"use strict";${bundle.source};return SpaceSimModule;`)(),root=document.querySelector('main')!,borrowed=root.firstChild;
  const entries=[{id:'test.flight',name:'Flight <img>',version:'1.0.0',tier:'authoritative',environments:['browser'],description:'A flight package',folder:'flight'},{id:'test.sound',name:'Sound',version:'1.0.0',tier:'presentation',environments:['offline'],description:'An audio package',folder:'sound'}];
  const view=exports.mountBundledCatalogue(root,entries),search=root.querySelector('input')!,count=root.querySelector('[role="status"]')!,list=root.querySelector('ul')!;
  search.value='sound';search.dispatchEvent(new Event('input'));const shown=[...list.children].filter(node=>!(node as HTMLElement).hidden).map(node=>(node as HTMLElement).dataset.bundledModule),text=count.textContent,images=root.querySelectorAll('img').length;
  const link=root.querySelector('a')!,href=link.href;view.dispose();view.dispose();search.value='absent';search.dispatchEvent(new Event('input'));
  return {shown,text,images,href,inert:root.querySelectorAll('input[type="checkbox"],button').length===0,restored:root.childNodes.length===1&&root.firstChild===borrowed,stale:count.textContent};
 },bundle);
 expect(result).toMatchObject({shown:['test.sound'],text:'1 of 2 bundled packages',images:0,href:'https://github.com/pink-kitsune-420/space-sim',inert:true,restored:true,stale:'1 of 2 bundled packages'});
});
test('portable module editor keeps exact releases, numeric help, provider choices and cancellation behind its host port',async({page})=>{
 await page.goto('about:blank');await page.setContent('<details open><p>Borrowed</p></details>');
 const result=await page.evaluate(async bundle=>{
  const initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();let modMenu:any;initialize({assets:{text:()=>bundle.css},contributeGuide(){},own:(value:any)=>value,provide:(_key:any,value:any)=>modMenu=value});
  const base={format:'space-sim-module/2',apiVersion:'space-sim-game-api/2',id:'test.config',name:'Config <img>',version:'1.0.0',tier:'platform',kind:'provider',environments:['browser'],dependencies:[],conflicts:[],provides:[],requires:[{name:'test.extra',version:'^1.0.0',optional:true}],slots:[],before:[],after:[],settings:{gain:{type:'number',default:1,minimum:0,maximum:10,step:.5,label:'Gain',description:'A described numeric value.'}},license:'MIT'};
  const a={manifest:base,digest:'a'.repeat(64)},b={manifest:{...base,version:'2.0.0'},digest:'b'.repeat(64)},provider={manifest:{...base,id:'test.provider',name:'Extra provider',provides:[{name:'test.extra',version:'1.0.0'}],requires:[],settings:{},slots:['test.extra']},digest:'c'.repeat(64)};
  const state:any={installed:[a,b,provider],selected:{[base.id]:a.digest},providers:{},capabilities:{},settings:{},activeDigests:[a.digest],editable:true,busy:false};
  let writes=0,cancelled=0,applications=0,published=false,held:AbortSignal|undefined,resume:(()=>void)|undefined;
  const root=document.querySelector('details')!,borrowed=root.firstChild;
  const view=modMenu.modules(root,{state:()=>state,compatible:()=>[provider],select:(id:string,digest:string)=>{writes++;if(digest)state.selected[id]=digest;else delete state.selected[id];},version:(id:string,digest:string)=>{state.selected[id]=digest;delete state.settings[id];},setting:(id:string,key:string,value:number)=>{(state.settings[id]??={})[key]=value;},capability:(id:string,name:string,digest:string)=>{state.selected[provider.manifest.id]=digest;(state.capabilities[id]??={})[name]=provider.manifest.id;},provider(){},includeRequired(){},removeDependents(){},cancel(){cancelled++;},async apply(signal:AbortSignal){applications++;held=signal;await new Promise<void>(resolve=>resume=resolve);signal.throwIfAborted();published=true;},async remove(){}},{prefix:'fixture-modules'});
  const row=()=>root.querySelector('li')!,stale=row().querySelector<HTMLInputElement>('input[type=checkbox]')!,activeProtected=row().querySelector<HTMLButtonElement>('button')!.disabled;
  const versions=row().querySelector('select')!;versions.value=b.digest;versions.dispatchEvent(new Event('change'));stale.click();const inert=writes===0;
  const input=row().querySelector<HTMLInputElement>('input[type=number]')!,help=input.getAttribute('aria-describedby')!;input.value='2.5';input.dispatchEvent(new Event('change'));
  const capability=row().querySelectorAll('select')[1]!;capability.value=provider.digest;capability.dispatchEvent(new Event('change'));const description=root.querySelector(`[id="${help}"]`)!.textContent;
  const apply=root.querySelector<HTMLButtonElement>('#fixture-modules-apply')!;apply.click();apply.click();await Promise.resolve();root.querySelector<HTMLButtonElement>('#fixture-modules-cancel')!.click();resume!();await new Promise(resolve=>setTimeout(resolve,0));const aborted=held!.aborted;
  const text=root.textContent,images=root.querySelectorAll('img').length;view.dispose();modMenu.dispose();apply.click();
  return {activeProtected,inert,version:state.selected[base.id],gain:state.settings[base.id].gain,provider:state.capabilities[base.id]['test.extra'],description,applications,cancelled,aborted,published,text,images,restored:root.childNodes.length===1&&root.firstChild===borrowed,styles:document.head.querySelectorAll('style').length};
 },bundle);
 expect(result).toMatchObject({activeProtected:true,inert:true,version:'b'.repeat(64),gain:2.5,provider:'test.provider',description:'A described numeric value.',applications:1,cancelled:1,aborted:true,published:false,images:0,restored:true,styles:0});expect(result.text).toContain('Dependencies: none. Capabilities: test.extra@^1.0.0 (optional).');
});
test('legacy profile drafts and installed-artifact commands remain separate from v2 locks and authoritative application',async({page})=>{
 await page.goto('about:blank');await page.setContent('<ul id="available"><li>Original list</li></ul><div id="providers"></div><ul id="installed"></ul><button id="apply" disabled></button>');
 const result=await page.evaluate(async bundle=>{
  const initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();let modMenu:any;initialize({assets:{text:()=>bundle.css},contributeGuide(){},own:(value:any)=>value,provide:(_key:any,value:any)=>modMenu=value});
  const manifest={format:'space-sim-module/1',apiVersion:'space-sim-game-api/1',id:'test.profile',name:'Legacy profile',version:'1.0.0',kind:'provider',authority:'authoritative',environments:['browser'],dependencies:[],provides:[],requires:[],slots:['content'],before:[],after:[],settings:{gain:{type:'number',default:1,minimum:0,maximum:10,step:.5,label:'Gain',description:'A bounded numeric value.'}},license:'MIT'};
  const panel={...manifest,id:'test.panel',name:'Panel',authority:'presentation',slots:[]},initial={format:'space-sim-profile/1',id:'test.game',modules:[],providers:{},settings:{}};
  const elements={list:document.querySelector('#available')!,providers:document.querySelector('#providers')!,installed:document.querySelector('#installed')!,apply:document.querySelector<HTMLButtonElement>('#apply')!},borrowed=elements.list.firstChild;
  let changed=0,exports=0,removed=0,display:any;const view=modMenu.profile(elements,{changed(){changed++;},error(message:string){throw new Error(message);},async exportModule(){exports++;},async removeModule(){removed++;},async presentationSettings(id:string,values:any){display={id,values};}},initial);
  view.refresh({applied:initial,available:[manifest],editable:true,installed:[{manifest,active:false},{manifest:panel,active:true,values:{gain:1}}]});
  const checkbox=elements.list.querySelector<HTMLInputElement>('input[type=checkbox]')!;checkbox.click();const input=elements.list.querySelector<HTMLInputElement>('input[type=number]')!;input.value='2.5';input.dispatchEvent(new Event('change'));const select=elements.providers.querySelector('select')!;select.value=manifest.id;select.dispatchEvent(new Event('change'));const draft=view.draft();
  const refreshState={applied:initial,available:[manifest],editable:true,installed:[{manifest,active:false},{manifest:panel,active:true,values:{gain:1}}]};view.refresh({...refreshState,applied:{...initial}});const refreshedDraft=view.draft();
  view.refresh({...refreshState,applied:{...initial,id:'test.second-game'}});const resetDraft=view.draft();
  const exportButton=elements.installed.querySelector<HTMLButtonElement>('button')!;exportButton.click();await Promise.resolve();view.select([]);exportButton.click();
  const panelRow=elements.installed.children[1]!,number=panelRow.querySelector<HTMLInputElement>('input[type=number]')!;number.value='5';[...panelRow.querySelectorAll('button')].find(button=>button.textContent==='Apply presentation settings')!.click();await Promise.resolve();
  const protectedActive=[...panelRow.querySelectorAll('button')].find(button=>button.textContent==='Remove')!.disabled,empty=view.draft();view.dispose();modMenu.dispose();checkbox.click();exportButton.click();
  return {draft,refreshedDraft,resetDraft,empty,changed,exports,removed,display,protectedActive,restored:elements.list.firstChild===borrowed&&elements.list.childNodes.length===1,providers:elements.providers.childNodes.length,installed:elements.installed.childNodes.length,disabled:elements.apply.disabled,styles:document.head.querySelectorAll('style').length};
 },bundle);
 expect(result).toMatchObject({draft:{format:'space-sim-profile/1',modules:[{id:'test.profile',version:'1.0.0'}],providers:{content:'test.profile'},settings:{'test.profile':{gain:2.5}}},empty:{modules:[],settings:{}},changed:3,exports:1,removed:0,display:{id:'test.panel',values:{gain:5}},protectedActive:true,restored:true,providers:0,installed:0,disabled:true,styles:0});
 expect(result.refreshedDraft).toEqual(result.draft);
 expect(result.resetDraft).toMatchObject({modules:[],providers:{},settings:{}});
});
test('portable ModMenu uses metadata and explicit commands, isolates failed play and cancels removal without stale UI',async({page})=>{
 await page.goto('about:blank');await page.setContent('<main></main>');
 const result=await page.evaluate(async bundle=>{
  const initialize=new Function(`"use strict";${bundle.source};return SpaceSimModule.default;`)();let modMenu:any;
  initialize({settings:{},assets:{text:()=>bundle.css},contributeGuide(){},own:(resource:any)=>resource,provide:(_key:any,value:any)=>modMenu=value});
  const main=document.querySelector('main')!,node=(tag:string)=>{const result=document.createElement(tag);main.append(result);return result;};
  const e:any={importButton:node('button'),importFile:node('input'),save:node('button'),export:node('button'),name:node('input'),folder:node('input'),search:node('input'),sort:node('select'),favorites:node('input'),list:node('ul'),empty:node('p'),status:node('p')};e.importFile.type='file';e.favorites.type='checkbox';const borrowed=document.createElement('li');borrowed.textContent='Original list';e.list.append(borrowed);e.status.textContent='Original status';
  let items=[{id:'local.reader',name:'Reader <img>',description:'Non-flight example',folder:'Examples',favorite:false,builtin:false,dataModules:1,codeModules:1}],active='old',calls=0;
  let held:AbortSignal|undefined,resume:(()=>void)|undefined,mode='failed';const exports:string[]=[];
  const port={entries:()=>items.map(item=>({...item})),editable:()=>true,
   async importFile(file:File,signal:AbortSignal){signal.throwIfAborted();return `Imported ${file.name}`;},
   async save(name:string,folder:string,signal:AbortSignal){signal.throwIfAborted();items.push({...items[0]!,id:'local.saved',name,folder});return 'Saved';},
   async export(id:string){exports.push(id);},
   async play(_id:string,signal:AbortSignal){calls++;if(mode==='failed')throw new Error('incompatible game');held=signal;await new Promise<void>(resolve=>resume=resolve);signal.throwIfAborted();active='new';return 'Playing';},
   async organize(id:string,changes:any,signal:AbortSignal){signal.throwIfAborted();items=items.map(item=>item.id===id?{...item,...changes}:item);},
   async remove(id:string,signal:AbortSignal){signal.throwIfAborted();items=items.filter(item=>item.id!==id);return 'Removed';}
  };
  const view=modMenu.library(e,port),tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
  const buttons=()=>[...e.list.querySelectorAll('button')] as HTMLButtonElement[],button=(name:string)=>buttons().find(button=>button.textContent===name)!;
  const images=main.querySelectorAll('img').length,stale=button('☆ Favorite');stale.click();await tick();const favorite=items[0]!.favorite;stale.click();await tick();const stillFavorite=items[0]!.favorite;
  button('Export game').click();await tick();button('Play · new world').click();await tick();const failure=e.status.textContent,retained=active;
  e.search.value='missing';e.search.dispatchEvent(new Event('input'));const empty=e.list.childElementCount===0&&!e.empty.hidden;e.search.value='';e.search.dispatchEvent(new Event('input'));
  mode='pending';const pendingButton=button('Play · new world');pendingButton.click();await tick();view.dispose();const aborted=held!.aborted;resume!();await tick();pendingButton.click();view.refresh();modMenu.dispose();
  return {images,favorite,stillFavorite,exports,failure,retained,empty,aborted,active,calls,restored:e.list.firstChild===borrowed&&e.list.childElementCount===1,status:e.status.textContent,styles:document.head.querySelectorAll('style').length};
 },bundle);
 expect(result).toMatchObject({images:0,favorite:true,stillFavorite:true,exports:['local.reader'],failure:'Could not complete the action: incompatible game',retained:'old',empty:true,aborted:true,active:'old',calls:2,restored:true,status:'Original status',styles:0});
});
