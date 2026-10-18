import type {Disposable} from './modules';
import type {ServiceKey} from './modules-v2';
import type {ThemePreferences} from './theme';
import type {WindowDocument} from './window-content';
export type ManualAudience='players'|'creators';
export interface ManualTopic {
 readonly id:string;readonly title:string;readonly summary:string;
 /** Plain additional search text for a trusted custom renderer. Structured body text is automatic. */
 readonly searchText?:string;
 readonly document?:WindowDocument;
 /** Explicit trusted host/content adapter, never constructed from imported HTML strings. */
 readonly mount?:(root:HTMLElement)=>Disposable|void;
}
export interface ManualGuide extends ManualTopic {readonly audience:ManualAudience}
export interface ManualSection {readonly label:string;readonly intro:string;readonly pages:readonly ManualTopic[]}
export interface ManualReaderOptions {
 readonly root:HTMLElement;readonly book:Readonly<Record<ManualAudience,ManualSection>>;
 readonly storage?:ThemePreferences;readonly storageKey?:string;readonly idPrefix?:string;
 readonly configure?:{readonly label:string;open():void};
 /** Host-controlled live-content revision; ordinary chrome refresh preserves scroll/details. */
 readonly revision?:()=>string;
 readonly scrollContainer?:HTMLElement;
}
export interface ManualReader extends Disposable {refresh():void;show(pageId:string):void}
export interface ManualService extends Disposable {
 /** Candidate publication may temporarily shadow matching IDs; disposing its lease restores
  * the prior guides. Duplicate IDs inside one registration always fail. */
 register(pages:readonly ManualGuide[],options?:{readonly replace?:boolean}):Disposable;
 /** Guides remain discoverable by recovery/library UI without mounting a Manual reader. */
 guides(audience:ManualAudience):readonly ManualGuide[];
 create(options:ManualReaderOptions):ManualReader;
}
export const MANUAL_READER:ServiceKey<ManualService>=Object.freeze({slot:'ui.manual',version:'1.0.0'});
