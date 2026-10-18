import type {Disposable} from './modules';
import type {ServiceKey} from './modules-v2';
import type {ThemePreferences} from './theme';
export interface HudRect {readonly x:number;readonly y:number;readonly width:number;readonly height:number}
export interface HudEditorItem {readonly id:string;readonly selector:string;readonly label:string}
export interface HudEditorOptions {
 readonly viewport:HTMLElement;readonly toggle:HTMLElement;readonly reset:HTMLElement;readonly items:readonly HudEditorItem[];
 readonly storage?:ThemePreferences;readonly storageKey?:string;changed():void;
 readonly hint?:string;
 readonly moveStepPx?:number;readonly fastMoveStepPx?:number;
}
export interface HudEditor extends Disposable {readonly editing:boolean;refresh():HTMLElement[]}
export interface HudLayoutOptions {
 readonly viewport:HTMLElement;
 readonly editor?:Omit<HudEditorOptions,'viewport'|'changed'>;
 /** Optional responsive arrangement; games supply their own DOM roles. */
 readonly roles?:{readonly status:HTMLElement;readonly right:HTMLElement;readonly dock:HTMLElement;readonly chat:HTMLElement;readonly telemetry:HTMLElement};
 readonly touchSelector?:string;readonly discoverSelector?:string;
}
export interface HudLayout extends Disposable {
 readonly editing:boolean;readonly revision:number;
 fit(preferred:HudRect,width:number,height:number,canvas?:HTMLCanvasElement,avoid?:boolean):HudRect;
}
export interface HudVisibilityItem {readonly id:string;readonly label:string;readonly selector?:string;readonly containerClass?:string;readonly default?:boolean}
export interface HudVisibilityOptions {
 readonly viewport:HTMLElement;readonly list:HTMLElement;readonly items:readonly HudVisibilityItem[];
 readonly defaults?:Readonly<Record<string,boolean>>;readonly storage?:ThemePreferences;readonly storageKey?:string;
}
export interface HudVisibilityController extends Disposable {
 visible(id:string):boolean;set(id:string,value:boolean):void;
 bind(id:string,label:string,read:()=>boolean,write:(value:boolean)=>void,reset:()=>void):Disposable;
}
export interface HudLayoutFactory extends Disposable {
 create(options:HudLayoutOptions):HudLayout;
 visibility(options:HudVisibilityOptions):HudVisibilityController;
}
export const HUD_LAYOUT:ServiceKey<HudLayoutFactory>=Object.freeze({slot:'ui.hud-layout',version:'1.0.0'});
