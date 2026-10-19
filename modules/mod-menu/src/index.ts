import {MOD_MENU,type Disposable,type ModuleInitializationV2,type ModMenuGame,type ModMenuLibraryElements,type ModMenuLibraryPort,type ModMenuLibraryView,type ModMenuService} from '@space-sim/game-api';
import {createModuleEditor} from './modules';
import {createProfileEditor} from './profile';
export {mountBundledCatalogue,type BundledModuleEntry} from './catalogue';
/** Metadata-only UI. Opaque item IDs route explicit commands back to the authoritative host. */
function createLibrary(e:ModMenuLibraryElements,port:ModMenuLibraryPort):ModMenuLibraryView {
 const document=e.list.ownerDocument,Controller=document.defaultView?.AbortController??AbortController,controller=new Controller(),signal=controller.signal;
 const previous={children:[...e.list.childNodes],empty:e.empty.hidden,status:e.status.textContent,save:e.save.disabled,export:e.export.disabled};
 let disposed=false,busy=false,pending:AbortController|undefined,rows=new Controller();
 const status=(message:string)=>{if(!disposed)e.status.textContent=message;};
 async function run(action:(signal:AbortSignal)=>Promise<void>):Promise<void> {
  if(disposed||busy)return;busy=true;const task=pending=new AbortController();
  try{refresh();await action(task.signal);}catch(error){if(!disposed&&!task.signal.aborted)status(`Could not complete the action: ${error instanceof Error?error.message:String(error)}`);}
  finally{if(pending===task)pending=undefined;busy=false;if(!disposed){try{refresh();}catch(error){status(`Could not refresh library: ${error instanceof Error?error.message:String(error)}`);}}}
 }
 function button(label:string,action:(signal:AbortSignal)=>Promise<void>,disabled=false):HTMLButtonElement {
  const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled||busy;button.addEventListener('click',()=>{void run(action);},{signal:rows.signal});return button;
 }
 function card(entry:ModMenuGame):HTMLElement {
  const card=document.createElement('li');card.className='game-card';card.dataset.game=entry.id;
  const title=document.createElement('h3'),description=document.createElement('p'),meta=document.createElement('p'),actions=document.createElement('div');title.textContent=entry.name;description.textContent=entry.description;meta.className='module-note';meta.textContent=entry.builtin?'Built-in game':`${entry.folder||'Unfiled'} · Saved game`;actions.className='lab-actions';
  const exportButton=button('Export game',async signal=>{const message=await port.export(entry.id,e.name.value,signal);if(message)status(message);},!!entry.exportUnavailable);
  if(entry.exportUnavailable){const reason=document.createElement('p');reason.className='module-note';reason.textContent=entry.exportUnavailable;exportButton.title=entry.exportUnavailable;card.append(reason);}
  actions.append(button('Play · new world',async signal=>{status(await port.play(entry.id,signal));},!port.editable()),exportButton);card.prepend(title,description,meta,actions);
  if(!entry.builtin){
   const star=button(entry.favorite?'★ Favorite':'☆ Favorite',async signal=>{await port.organize(entry.id,{favorite:!entry.favorite},signal);});star.setAttribute('aria-pressed',String(entry.favorite));actions.append(star);
   const edit=document.createElement('details'),summary=document.createElement('summary'),nameLabel=document.createElement('label'),name=document.createElement('input'),folderLabel=document.createElement('label'),folder=document.createElement('input');summary.textContent='Organize';name.type='text';name.value=entry.name;name.maxLength=256;nameLabel.append('Game name',name);folder.type='text';folder.value=entry.folder;folder.maxLength=80;folderLabel.append('Collection',folder);
   edit.append(summary,nameLabel,folderLabel,button('Save details',async signal=>{if(!name.value.trim())throw new Error('Enter a game name');await port.organize(entry.id,{name:name.value.trim(),folder:folder.value},signal);}),button('Remove from library',async signal=>{status(await port.remove(entry.id,signal));}));card.append(edit);
  }
  return card;
 }
 function refresh():void {
  if(disposed)return;rows.abort();rows=new Controller();
  const search=e.search.value.trim().toLowerCase(),folder=e.sort.value==='folder';
  const entries=port.entries().filter(entry=>(!e.favorites.checked||entry.favorite)&&`${entry.name} ${entry.description} ${entry.folder}`.toLowerCase().includes(search));
  entries.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(b.favorite)-Number(a.favorite)||(folder?a.folder.localeCompare(b.folder):0)||a.name.localeCompare(b.name));
  e.list.replaceChildren(...entries.map(card));e.empty.hidden=entries.length>0;e.save.disabled=e.export.disabled=!port.editable()||busy;
 }
 const view:ModMenuLibraryView={refresh,status,dispose(){if(disposed)return;disposed=true;pending?.abort(new Error('ModMenu removed'));controller.abort();rows.abort();e.list.replaceChildren(...previous.children);e.empty.hidden=previous.empty;e.status.textContent=previous.status;e.save.disabled=previous.save;e.export.disabled=previous.export;}};
 try{
  e.importButton.addEventListener('click',()=>e.importFile.click(),{signal});
  e.importFile.addEventListener('change',()=>{const file=e.importFile.files?.[0];if(!file)return;void run(async signal=>{try{status(await port.importFile(file,signal));}finally{if(!disposed)e.importFile.value='';}});},{signal});
  e.save.addEventListener('click',()=>{void run(async signal=>{status(await port.save(e.name.value,e.folder.value,signal));});},{signal});
  e.export.addEventListener('click',()=>{void run(async signal=>{const message=await port.export(undefined,e.name.value,signal);if(message)status(message);});},{signal});
  e.search.addEventListener('input',refresh,{signal});e.sort.addEventListener('change',refresh,{signal});e.favorites.addEventListener('change',refresh,{signal});refresh();return view;
 }catch(error){view.dispose();throw error;}
}
export function createModMenu(css=''):ModMenuService {
 const views=new Set<Disposable>(),styles=new Map<Document,HTMLStyleElement>();let disposed=false;
 const style=(document:Document)=>{if(css&&!styles.has(document)){const style=document.createElement('style');style.textContent=css;document.head.append(style);styles.set(document,style);}};
 const own=<T extends Disposable>(view:T):T=>{const close=view.dispose.bind(view);let closed=false;view.dispose=()=>{if(closed)return;closed=true;views.delete(view);close();};views.add(view);return view;};
 return Object.freeze<ModMenuService>({
  library(elements,port){if(disposed)throw new Error('ModMenu provider disposed');const document=elements.list.ownerDocument;
   style(document);return own(createLibrary(elements,port));},
  modules(root,port,options){if(disposed)throw new Error('ModMenu provider disposed');style(root.ownerDocument);return own(createModuleEditor(root,port,options));},
  profile(elements,port,initial){if(disposed)throw new Error('ModMenu provider disposed');style(elements.list.ownerDocument);return own(createProfileEditor(elements,port,initial));},
  dispose(){if(disposed)return;disposed=true;const errors:unknown[]=[];for(const view of views){try{view.dispose();}catch(error){errors.push(error);}}for(const style of styles.values())style.remove();styles.clear();if(errors.length)throw new AggregateError(errors,'ModMenu cleanup failed');}
 });
}
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'ModMenu library view',summary:'Metadata browsing and explicit cancellable host commands without archive or world ownership.',asset:'docs/creators/usage.json'});
 context.provide(MOD_MENU,context.own(createModMenu(context.assets.text('assets/mod-menu.css'))));
}
