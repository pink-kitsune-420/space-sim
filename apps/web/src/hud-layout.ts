import {computeNavballCenter,type NavballPlacement} from './local-players';
import {HUD_EDITOR_ITEMS} from './hud-editor';
import {icon} from './ui-icons';
import {createHudLayout} from '../../../modules/hud-layout/src/layout';
import {navballFootprint} from '../../../modules/navball/src/drawing';
export {fitHudRect} from '../../../modules/hud-layout/src/layout';
export type {HudRect} from '../../../packages/game-api/src/index';
export function initHudLayout(){
 const viewport=document.querySelector<HTMLElement>('#flight-console .viewport')!;
 const layout=createHudLayout({viewport,editor:{items:HUD_EDITOR_ITEMS,toggle:document.getElementById('hud-layout-toggle')!,reset:document.getElementById('hud-layout-reset')!,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},hint:'Drag grips to move.'},roles:{status:viewport.querySelector<HTMLElement>('.hud-top-left')!,right:viewport.querySelector<HTMLElement>('.hud-top-right')!,dock:viewport.querySelector<HTMLElement>('.hud-dock')!,chat:document.getElementById('chat-overlay')!,telemetry:viewport.querySelector<HTMLElement>('.telemetry')!},touchSelector:'.touch-stick-zone, .touch-actions-zone',discoverSelector:'canvas, #touch-overlay, .throttle-lever'},icon);
 const cached=new WeakMap<NavballPlacement,{key:string;center:{x:number;y:number}}>();
 const throttles=new WeakMap<HTMLCanvasElement,({revision:number;width:number;height:number;x:number;y:number;position:{x:number;y:number}}|undefined)[]>();
 return {get editing(){return layout.editing;},dispose:()=>layout.dispose(),
    throttlePosition(slot:number,preferred:{x:number;y:number},width:number,height:number,canvas:HTMLCanvasElement){
      let entries=throttles.get(canvas);const previous=entries?.[slot];
      if(previous?.revision===layout.revision&&previous.width===width&&previous.height===height&&previous.x===preferred.x&&previous.y===preferred.y)return previous.position;
      const fit=layout.fit({x:preferred.x,y:preferred.y,width:48,height:176},width,height,canvas);
      const position={x:fit.x,y:fit.y};if(!entries){entries=[];throttles.set(canvas,entries);}
      entries[slot]={revision:layout.revision,width,height,x:preferred.x,y:preferred.y,position};return position;
    },
    navballCenter(placement: NavballPlacement, width: number, height: number, scale: number, canvas: HTMLCanvasElement, trajectory = false) {
      const key = `${layout.revision}/${width}/${height}/${scale}/${trajectory}`;
      const previous = cached.get(placement);
      if (previous?.key === key) return previous.center;
      const preferred = computeNavballCenter(placement, width, height, scale);
      // Include marker stems, drag banner, pin label and readouts. Text remains 11 px on small dials.
      const { side, above, below } = navballFootprint(scale, trajectory);
      const left = side;
      const top = above;
      const bottom = below;
      const fit = layout.fit({ x: preferred.x - left, y: preferred.y - top, width: left + side, height: top + bottom }, width, height, canvas, placement.anchor!=='custom');
      const center = { x: fit.x + left, y: fit.y + top };
      cached.set(placement, { key, center });
      return center;
    },
 };
}
