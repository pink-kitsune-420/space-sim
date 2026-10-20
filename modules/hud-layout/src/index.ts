import {HUD_LAYOUT,WINDOWS,type Disposable,type HudEditorOptions,type HudLayoutFactory,type ModuleInitializationV2,type WindowSystem} from '@space-sim/game-api';
import {createHudLayout} from './layout';
import {HudVisibility} from './visibility';
export function createHudLayouts(windows:Pick<WindowSystem,'icon'>,css='',defaults:Pick<HudEditorOptions,'moveStepPx'|'fastMoveStepPx'>={}):HudLayoutFactory {
 const resources=new Set<Disposable>(),styles=new Map<Document,HTMLStyleElement>();let disposed=false;
 const own=<T extends Disposable>(document:Document,create:()=>T):T=>{
  if(disposed)throw new Error('HUD layout provider disposed');
  if(css&&!styles.has(document)){const style=document.createElement('style');style.textContent=css;document.head.append(style);styles.set(document,style);}
  const resource=create(),close=resource.dispose.bind(resource);let closed=false;
  resource.dispose=()=>{if(closed)return;closed=true;resources.delete(resource);close();};resources.add(resource);return resource;
 };
 return Object.freeze<HudLayoutFactory>({create:options=>own(options.viewport.ownerDocument,()=>createHudLayout({...options,editor:options.editor?{...defaults,...options.editor}:undefined},windows.icon)),
  visibility:options=>own(options.viewport.ownerDocument,()=>new HudVisibility(options)),
  dispose(){if(disposed)return;disposed=true;const errors:unknown[]=[];for(const resource of resources){try{resource.dispose();}catch(error){errors.push(error);}}for(const style of styles.values())style.remove();styles.clear();if(errors.length)throw new AggregateError(errors,'HUD layout cleanup failed');}});
}
/**
 * Contributes HUD positioning, drag/keyboard layout editing, and component visibility management.
 * Provides ui.hud-layout@1.0.0 in the ui.hud-layout slot; requires ui.windows@^1.0.0.
 */
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'HUD layout and visibility',summary:'Optional viewer layout, movement and visibility with complete cleanup.',asset:'docs/creators/usage.json'});
 context.provide(HUD_LAYOUT,context.own(createHudLayouts(context.use(WINDOWS),context.assets.text('assets/layout.css'),{moveStepPx:context.settings.moveStepPx,fastMoveStepPx:context.settings.fastMoveStepPx})));
}
