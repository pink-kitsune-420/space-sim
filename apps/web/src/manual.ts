import { captureDocument, type Disposable, type ManualGuide, type ManualReader, type ManualReaderOptions, type ManualService } from '../../../packages/game-api/src/index';
import { createWindowContent } from '../../../modules/ui-windows/src/content';
import { createManuals } from '../../../modules/manual/src/index';
import type { ModuleCandidateV2 } from '../../../packages/game-runtime/src/modules-v2';
import { BUILD_INFO, VERSION } from '../../../packages/game-runtime/src/build-info';
import apiReference from './api-reference.json';

// Compatibility composition until Phase 4 selects the Manual and document services by manifest.
let defaults: ManualService | undefined;
function defaultManuals(): ManualService {
 if(!defaults){
  defaults=createManuals(createWindowContent());
  // Captured only by the compatibility host, never for an independent selected reader.
  defaults.register(apiReference.pages.map(page=>({id:page.id,audience:'creators',title:page.title,summary:page.summary,document:captureDocument(page)})));
 }
 return defaults;
}
/** Modules whose shipped guides are verified against source; listed by the generated API reference. */
export const DOCUMENTED_MODULES:ReadonlySet<string>=new Set(apiReference.modules);
/** Capture guide assets while their exact candidate is available; registration is a removable lease.
 * `modules` limits registration to those modules' guides, as for shipped game targets. */
export function registerModuleGuides(candidate:ModuleCandidateV2,modules?:ReadonlySet<string>):Disposable {
 return defaultManuals().register(candidate.contributions('guide').filter(entry=>!modules||modules.has(entry.moduleId)).map(entry=>({...entry.value,id:entry.id,document:captureDocument(JSON.parse(candidate.guideDocuments.get(entry.id)!))})) satisfies readonly ManualGuide[],{replace:true});
}
/** Host composition of the existing reader. Content and live revisions belong to the caller's game.
 * Passing an explicitly selected service keeps another game's guide catalog independent. */
export function initManual(options: { root?: HTMLElement; service?: ManualService; book?: ManualReaderOptions['book']; revision?: () => string; storageKey?: string } = {}): ManualReader | undefined {
 const root=options.root??document.getElementById('game-manual');if(!root)return;
 const reader=(options.service??defaultManuals()).create({root,book:options.book??{
  players:{label:'Players',intro:'Guides for this game.',pages:[]},creators:{label:'Creators',intro:'Create and customize this game.',pages:[]}},
  scrollContainer:root.closest<HTMLElement>('.flight-window-body')??undefined,
  storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},storageKey:options.storageKey,revision:options.revision});
 const version=document.createElement('p');version.id='manual-build-version';version.className='module-note';version.textContent=`Spacelab ${VERSION}${BUILD_INFO.development?' · dev build':''}`;version.title=BUILD_INFO.revision?`Source revision ${BUILD_INFO.revision}`:'Source revision unavailable';root.prepend(version);
 return reader;
}
