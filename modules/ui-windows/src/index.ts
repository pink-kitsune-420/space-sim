import {WINDOWS, WINDOW_CONTENT, type Disposable, type ModuleInitializationV2, type WindowChrome, type WindowSystem} from '@space-sim/game-api';
import {createWindowContent} from './content';
import {createInteractions} from './interactions';
import {FloatingWindow} from './window';
import {icon} from './icons';
export function createWindows(css = ''): WindowSystem {
 const interactions=createInteractions(), windows=new Set<WindowChrome>(), resizers=new Set<Disposable>(), raised=new Set<HTMLElement>();
 const styles=new Map<Document,HTMLStyleElement>(); let disposed=false;
 const active=()=>{if(disposed) throw new Error('Window provider disposed');};
 return Object.freeze<WindowSystem>({
  icon,
  raise(panel){if(disposed)return;raised.add(panel);interactions.raise(panel);},
  release(panel){raised.delete(panel);interactions.release(panel);},
  isFront:panel=>!disposed&&interactions.isFront(panel),
  resize(panel,viewport,title,options){active();raised.add(panel);const resize=interactions.resize(panel,viewport,title,options);let closed=false;
   const lease={dispose(){if(closed)return;closed=true;resizers.delete(lease);resize.dispose();}};resizers.add(lease);return lease;},
  create(options) {
   active();
   const document=options.container.ownerDocument;
   // Prepared replacements stay off-DOM while the previous game remains active.
   // Duplicate identities are forbidden within a host and across live hosts.
   if([...windows].some(window=>window.element.id===`${options.id}-window`&&window.element.parentElement===options.container)
     || options.container.isConnected&&document.getElementById(`${options.id}-window`))throw new Error(`Duplicate window ${options.id}`);
   if(css&&!styles.has(document)){const style=document.createElement('style');style.textContent=css;document.head.append(style);styles.set(document,style);}
   const window=new FloatingWindow(options,interactions), close=window.dispose.bind(window);let closed=false;
   window.dispose=()=>{if(closed)return;closed=true;windows.delete(window);close();};windows.add(window);return window;
  },
  dispose(){if(disposed)return;disposed=true;const errors:unknown[]=[];
   for(const resource of [...windows,...resizers]){try{resource.dispose();}catch(error){errors.push(error);}}
   for(const panel of raised)interactions.release(panel);raised.clear();
   for(const style of styles.values())style.remove();styles.clear();
   if(errors.length)throw new AggregateError(errors,'Window provider cleanup failed');}
 });
}
/**
 * Contributes shared floating window chrome and structured window content.
 * Provides ui.windows@1.0.0 in slot ui.windows and ui.window-content@1.0.0 in slot ui.window-content, each only when selected for its slot.
 * Requires nothing; this module has no settings.
 */
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Shared windows',summary:'Independent movable, resizable and disposable windows through public ui.windows@1.',asset:'docs/creators/usage.json'});
 if(context.selected(WINDOWS.slot))context.provide(WINDOWS,context.own(createWindows(context.assets.text('assets/windows.css'))));
 if(context.selected(WINDOW_CONTENT.slot))context.provide(WINDOW_CONTENT,context.own(createWindowContent()));
}
