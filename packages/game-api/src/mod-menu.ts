import type {Disposable,ModuleManifest,ModuleProfile,ModuleReference} from './modules';
import type {CapabilityNeed,ManifestV2,ServiceKey} from './modules-v2';
/** Library display data, never installed archive bytes or an enabled module profile. */
export interface ModMenuGame {
 readonly id:string;readonly name:string;readonly description:string;readonly folder:string;readonly favorite:boolean;readonly builtin:boolean;
 readonly dataModules:number;readonly codeModules:number;
 /** Host-selected entries sort first, while still respecting search and favorites filters. */
 readonly pinned?:boolean;
 /** Optional display grouping; omitted entries belong to Games. This does not affect game compatibility. */
 readonly category?:'game'|'example';
 /** Host explains when a runnable source fixture has no portable game adapter yet. */
 readonly exportUnavailable?:string;
}
/** Host owns verification, persistence, trust, exact selection and atomic game replacement.
 * Commands must honor cancellation before publishing; importing installs inert content only. */
export interface ModMenuLibraryPort {
 entries():readonly ModMenuGame[];editable():boolean;
 importFile(file:File,signal:AbortSignal):Promise<string>;
 save(name:string,folder:string,signal:AbortSignal):Promise<string>;
 export(id:string|undefined,name:string,signal:AbortSignal):Promise<string|void>;
 play(id:string,signal:AbortSignal):Promise<string>;
 organize(id:string,changes:{readonly name?:string;readonly folder?:string;readonly favorite?:boolean},signal:AbortSignal):Promise<void>;
 remove(id:string,signal:AbortSignal):Promise<string>;
}
export interface ModMenuLibraryElements {
 readonly importButton:HTMLButtonElement;readonly importFile:HTMLInputElement;
 readonly save:HTMLButtonElement;readonly export:HTMLButtonElement;readonly name:HTMLInputElement;readonly folder:HTMLInputElement;
 readonly search:HTMLInputElement;readonly sort:HTMLSelectElement;readonly favorites:HTMLInputElement;
 readonly list:HTMLElement;readonly empty:HTMLElement;readonly status:HTMLElement;
}
export interface ModMenuLibraryView extends Disposable {refresh():void;status(message:string):void}
export interface ModMenuModuleRelease {readonly manifest:ManifestV2;readonly digest:string}
export interface ModMenuModuleState {
 readonly installed:readonly ModMenuModuleRelease[];
 readonly selected:Readonly<Record<string,string>>;
 readonly providers:Readonly<Record<string,string>>;
 readonly capabilities:Readonly<Record<string,Readonly<Record<string,string>>>>;
 readonly settings:Readonly<Record<string,Readonly<Record<string,number>>>>;
 readonly activeDigests:readonly string[];readonly editable:boolean;readonly busy:boolean;
}
/** Metadata suggestions come from the host's compatibility rules, never a second UI resolver. */
export interface ModMenuModulePort {
 state():ModMenuModuleState;
 compatible(need:CapabilityNeed):readonly ModMenuModuleRelease[];
 select(id:string,digest:string|undefined):void;
 version(id:string,digest:string):void;
 setting(id:string,key:string,value:number):void;
 capability(id:string,name:string,providerDigest:string|undefined):void;
 provider(slot:string,id:string,digest:string):void;
 includeRequired():void;removeDependents():void;cancel():void;
 apply(signal:AbortSignal):Promise<void>;
 remove(digest:string,signal:AbortSignal):Promise<void>;
}
export interface ModMenuModuleOptions {
 readonly prefix?:string;readonly title?:string;readonly notice?:string;
 readonly ids?:{readonly list:string;readonly status:string;readonly apply:string;readonly cancel:string};
 readonly applyLabel?:string;
}
export interface ModMenuModuleView extends Disposable {refresh():void;status(message:string):void}
export interface ModMenuInstalledModule {
 readonly manifest:ModuleManifest;readonly active:boolean;readonly digest?:string;
 readonly inputs?:readonly {readonly path:string;readonly license:string;readonly attribution:string}[];
 /** Defined only when compatible live presentation settings can be edited. */
 readonly values?:Readonly<Record<string,number>>;
}
export interface ModMenuProfileState {
 readonly applied:ModuleProfile;readonly available:readonly ModuleManifest[];
 readonly installed:readonly ModMenuInstalledModule[];readonly editable:boolean;
}
export interface ModMenuProfileElements {readonly list:HTMLElement;readonly providers:HTMLElement;readonly installed:HTMLElement;readonly apply:HTMLButtonElement}
/** Explicit legacy compatibility view; no conversion to a v2 lock or silent schema upgrade. */
export interface ModMenuProfilePort {
 changed():void;error(message:string):void;
 exportModule(id:string,signal:AbortSignal):Promise<void>;
 removeModule(id:string,signal:AbortSignal):Promise<void>;
 presentationSettings(id:string,values:Readonly<Record<string,number>>,signal:AbortSignal):Promise<void>;
}
export interface ModMenuProfileView extends Disposable {
 refresh(state:ModMenuProfileState):void;
 draft():ModuleProfile;
 select(modules:readonly ModuleReference[]):void;
}
export interface ModMenuService extends Disposable {
 library(elements:ModMenuLibraryElements,port:ModMenuLibraryPort):ModMenuLibraryView;
 modules(root:HTMLElement,port:ModMenuModulePort,options?:ModMenuModuleOptions):ModMenuModuleView;
 profile(elements:ModMenuProfileElements,port:ModMenuProfilePort,initial:ModuleProfile):ModMenuProfileView;
}
export const MOD_MENU:ServiceKey<ModMenuService>=Object.freeze({slot:'ui.mod-menu',version:'1.0.0'});
