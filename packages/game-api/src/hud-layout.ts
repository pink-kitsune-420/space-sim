import type {Disposable} from './modules';
import type {ServiceKey} from './modules-v2';
import type {ThemePreferences} from './theme';
/** CSS-pixel rectangle defining HUD component bounds. */
export interface HudRect {readonly x:number;readonly y:number;readonly width:number;readonly height:number}
/** Metadata describing an editable HUD instrument position. */
export interface HudEditorItem {
 readonly id:string;readonly selector:string;readonly label:string;
 /** Optional selector under the item's parent defining its placement bounds, e.g. its view canvas.
  * Saved normalized coordinates then follow that view as split-screen panes resize. */
 readonly bounds?:string;
 /** False for independently placed controls that should not push automatically fitted instruments. */
 readonly obstacle?:boolean;
}
/** Configuration options for the interactive HUD position editor. */
export interface HudEditorOptions {
 readonly viewport:HTMLElement;readonly toggle:HTMLElement;readonly reset:HTMLElement;readonly items:readonly HudEditorItem[];
 readonly storage?:ThemePreferences;readonly storageKey?:string;changed():void;
 readonly hint?:string;
 readonly moveStepPx?:number;readonly fastMoveStepPx?:number;
}
/** Controller managing interactive HUD component movement, grip focus, and saved placement. */
export interface HudEditor extends Disposable {readonly editing:boolean;refresh():HTMLElement[]}
/** Options configuring responsive HUD layout and obstacle avoidance. */
export interface HudLayoutOptions {
 readonly viewport:HTMLElement;
 readonly editor?:Omit<HudEditorOptions,'viewport'|'changed'>;
 /** Optional responsive arrangement; games supply their own DOM roles. */
 readonly roles?:{readonly status:HTMLElement;readonly right:HTMLElement;readonly dock:HTMLElement;readonly chat:HTMLElement;readonly telemetry:HTMLElement};
 readonly touchSelector?:string;readonly discoverSelector?:string;
}
/** Responsive HUD layout controller fitting instruments around obstacles. */
export interface HudLayout extends Disposable {
 readonly editing:boolean;readonly revision:number;
 fit(preferred:HudRect,width:number,height:number,canvas?:HTMLCanvasElement,avoid?:boolean):HudRect;
}
/** Descriptor for a toggleable HUD element in the visibility panel. */
export interface HudVisibilityItem {readonly id:string;readonly label:string;readonly selector?:string;readonly containerClass?:string;readonly default?:boolean}
/** Options configuring HUD component visibility checkboxes and persistent preferences. */
export interface HudVisibilityOptions {
 readonly viewport:HTMLElement;readonly list:HTMLElement;readonly items:readonly HudVisibilityItem[];
 readonly defaults?:Readonly<Record<string,boolean>>;readonly storage?:ThemePreferences;readonly storageKey?:string;
}
/** Controller managing visibility state and settings persistence for HUD elements. */
export interface HudVisibilityController extends Disposable {
 visible(id:string):boolean;set(id:string,value:boolean):void;
 bind(id:string,label:string,read:()=>boolean,write:(value:boolean)=>void,reset:()=>void):Disposable;
}
/** Factory creating HUD layout managers and visibility controllers. */
export interface HudLayoutFactory extends Disposable {
 create(options:HudLayoutOptions):HudLayout;
 visibility(options:HudVisibilityOptions):HudVisibilityController;
}
/** Service key for the HUD layout and visibility factory (`ui.hud-layout@1.0.0`). */
export const HUD_LAYOUT:ServiceKey<HudLayoutFactory>=Object.freeze({slot:'ui.hud-layout',version:'1.0.0'});
