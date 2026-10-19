import {decodeLabFile,decodePackage,encodePackage,MAX_ARCHIVE_BYTES,validatePackage,type GamePackage,type PluginPackage} from '../../../packages/game-library/src/archive';
import {validateUniverse} from '../../../packages/sim-core/src/universe';
import type {Disposable,UniverseDefinition,ModMenuGame,ModMenuLibraryView} from '../../../packages/game-api/src/index';
import {parseCodeArtifact} from '../../../packages/game-runtime/src/artifact';
import {parseModuleImport} from './modules';
import {GameLibrary,type LibraryGame} from './game-library';
import {downloadBytes,element,show} from './ui';
import {createModMenu,mountBundledCatalogue} from '../../../modules/mod-menu/src/index';
import bundledModules from 'virtual:spacelab-bundled-modules';

/** Host adapter: codecs, existing storage and world publication stay outside the reusable view. */
export class LabManager implements Disposable {
 readonly library=new GameLibrary();
 private readonly modMenu=createModMenu();
 private readonly view:ModMenuLibraryView;
 private readonly catalogue:Disposable;
 private readonly controller=new AbortController();
 private ready:Promise<void>|undefined;
 private disposed=false;
 constructor(private readonly options:{
  readonly builtin:GamePackage;readonly builtins?:readonly GamePackage[];
  readonly install:(plugin:PluginPackage)=>void;
  readonly installDevicePackage?:(bytes:Uint8Array,source:string)=>Promise<boolean>;
  readonly legacy:(text:string)=>void;readonly universe:(universe:UniverseDefinition)=>void;
  readonly capture:()=>GamePackage|Promise<GamePackage>;
  readonly play:(game:GamePackage,signal:AbortSignal)=>void|Promise<void>;
  readonly editable:()=>boolean;readonly world:()=>object;
 }){
  this.catalogue=mountBundledCatalogue(element('bundled-module-catalogue'),bundledModules);
  element('bundled-module-summary').textContent=`Bundled source packages · ${bundledModules.length}`;
  const browse=element('browse-bundled-modules');browse.textContent=`Browse bundled packages · ${bundledModules.length}`;
  browse.addEventListener('click',()=>{const catalogue=element('bundled-module-catalogue');catalogue.closest('details')!.open=true;catalogue.scrollIntoView({block:'start'});catalogue.querySelector('input')!.focus({preventScroll:true});},{signal:this.controller.signal});
  this.view=this.modMenu.library({importButton:element<HTMLButtonElement>('lab-import'),importFile:element<HTMLInputElement>('lab-file'),save:element<HTMLButtonElement>('lab-save'),export:element<HTMLButtonElement>('lab-export'),name:element<HTMLInputElement>('game-name'),folder:element<HTMLInputElement>('game-folder'),search:element<HTMLInputElement>('game-search'),sort:element<HTMLSelectElement>('game-sort'),favorites:element<HTMLInputElement>('game-favorites'),list:element('game-list'),empty:element('game-empty'),status:element('lab-status')},{
   entries:()=>this.entries().map(entry=>({id:entry.id,name:entry.game.info.name,description:entry.game.info.description,folder:entry.folder,favorite:entry.favorite,builtin:this.isBuiltin(entry.id),pinned:entry.id==='builtin',dataModules:entry.game.bundle.modules.length,codeModules:entry.game.plugins.length} satisfies ModMenuGame)),editable:options.editable,
   importFile:async(file,signal)=>{await this.ready;signal.throwIfAborted();return this.importFile(file,signal);},
   save:async(name,folder,signal)=>{await this.ready;const game=await this.capture(name,signal);await this.library.put(game,{folder});signal.throwIfAborted();return `Saved ${game.info.name} to the library. This game starts a fresh world; use Save universe for flight progress.`;},
   export:async(id,name,signal)=>{await this.ready;const entry=id===undefined?undefined:this.entry(id),game=entry?.game??await this.capture(name,signal);signal.throwIfAborted();
    // Reinspect cached bytes before returning them; the view never receives the archive.
    const bytes=entry?.archive;if(bytes)await decodePackage(bytes);const encoded=bytes??await encodePackage(game);signal.throwIfAborted();downloadBytes(`${game.info.name.replace(/[^a-z0-9-]+/gi,'-').toLowerCase()}.spacegame`,encoded);
    if(id===undefined)return `Exported ${game.info.name} with its selected plugins, data and settings.`;
   },
   play:async(id,signal)=>{await this.ready;signal.throwIfAborted();if(!options.editable())throw new Error('Leave multiplayer before switching games');const entry=this.entry(id);await options.play(entry.game,signal);signal.throwIfAborted();show('active-game',entry.game.info.name);document.title=`Spacelab · ${entry.game.info.name}`;element<HTMLInputElement>('game-name').value=`${entry.game.info.name} remix`;return `Playing ${entry.game.info.name}. Its plugin selection is active in a new world.`;},
   organize:async(id,changes,signal)=>{await this.ready;signal.throwIfAborted();if(this.isBuiltin(id))throw new Error('Save a copy before organizing a built-in game');const entry=this.entry(id);await this.library.put({...entry.game,info:{...entry.game.info,name:changes.name??entry.game.info.name}},{id:entry.id,folder:changes.folder??entry.folder,favorite:changes.favorite??entry.favorite});signal.throwIfAborted();},
   remove:async(id,signal)=>{await this.ready;signal.throwIfAborted();if(this.isBuiltin(id))throw new Error('Built-in games cannot be removed');const entry=this.entry(id);await this.library.remove(id);signal.throwIfAborted();return `Removed ${entry.game.info.name} from the library. The active world is unchanged.`;}
  });
 }
 private builtins():LibraryGame[]{return (this.options.builtins??[this.options.builtin]).map(game=>({id:game.info.id===this.options.builtin.info.id?'builtin':game.info.id,game,folder:'Built-in',favorite:false}));}
 private isBuiltin(id:string):boolean{return this.builtins().some(entry=>entry.id===id);}
 private entries():readonly LibraryGame[]{return [...this.builtins(),...this.library.entries];}
 private entry(id:string):LibraryGame{const entry=this.entries().find(entry=>entry.id===id);if(!entry)throw new Error('This game is no longer in the library');return entry;}
 async start():Promise<void>{if(this.disposed)return;await(this.ready??=this.library.open());if(this.disposed)return;show('library-storage',this.library.persistent?'Games are saved in this browser. Export a file to share or back up a game.':'Browser storage is unavailable. This library lasts until the page closes; export games to keep them.');this.refresh();}
 refresh():void{this.view.refresh();}
 private async capture(name:string,signal:AbortSignal):Promise<GamePackage>{signal.throwIfAborted();if(!this.options.editable())throw new Error('Save or export games from your solo world');const game=await this.options.capture();signal.throwIfAborted();return {...game,info:{...game.info,name:name.trim()||`${game.info.name} remix`}};}
 private async importFile(file:File,signal:AbortSignal):Promise<string>{
  const options=this.options,world=options.world();if(file.size>MAX_ARCHIVE_BYTES)throw new Error('Package must be at most 32 MiB');const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
  if(await options.installDevicePackage?.(bytes,file.name)){signal.throwIfAborted();return 'Installed device module. Code has not run. Review and enable it in Plugins.';}
  const raw=await decodeLabFile(bytes) as {format?:string;schemaVersion?:number;bodies?:unknown[];systems?:unknown[]};signal.throwIfAborted();if(options.world()!==world)throw new Error('The active session changed while importing');
  if(raw&&(Array.isArray(raw.systems)||Array.isArray(raw.bodies))&&!raw.format){if(!options.editable())throw new Error('Import a universe in your solo game');const universe=validateUniverse(raw);options.universe(universe);return `Loaded universe ${universe.name}. Save as a game to keep and share its setup.`;}
  if(raw?.format==='space-sim-world')throw new Error('This file is saved progress. Use Fleet → Load universe… to continue it.');
  if(raw?.format==='space-sim-shaders/1')throw new Error('Use Tools → Load shader… for shader data.');
  let imported;
  if(raw?.format==='space-lab-game/1'||raw?.format==='space-lab-plugin/1')imported=validatePackage(raw);
  else if(raw?.format==='space-sim-code-module/1'){const code=parseCodeArtifact(JSON.stringify(raw));imported={format:'space-lab-plugin/1',info:{id:code.manifest.id,name:code.manifest.name,description:''},data:[],code:[code]} as const;}
  else{const text=JSON.stringify(raw),legacy=parseModuleImport(text);if(legacy.format==='space-sim-module-profile/1'){options.legacy(text);return 'Profile inspected. See plugin configuration for its activation status.';}imported={format:'space-lab-plugin/1',info:{id:legacy.manifest.id,name:legacy.manifest.name,description:''},data:[legacy],code:[]} as const;}
  signal.throwIfAborted();if(options.world()!==world)throw new Error('The active session changed while importing');
  if(imported.format==='space-lab-game/1'){await this.library.put(imported);signal.throwIfAborted();return `Added ${imported.info.name} to your library. Choose Play to enable its plugins and start a new world.`;}
  options.install(imported);element('plugin-manager').hidden=false;document.querySelector<HTMLDetailsElement>('.code-module-settings')!.open=true;return `Installed ${imported.info.name}. Select it in Plugins and apply to enable it. Code has not run.`;
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.controller.abort();this.catalogue.dispose();this.modMenu.dispose();this.library.dispose();}
}
