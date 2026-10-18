import {computeNavballCenter,type NavballPlacement} from './local-players';
import {HUD_EDITOR_ITEMS} from './hud-editor';
import {icon} from './ui-icons';
import {createHudLayout} from '../../../modules/hud-layout/src/layout';
import {navballFootprint} from '../../../modules/navball/src/drawing';
import {THROTTLE_LEVER_SPACE} from './throttle-lever';
export {fitHudRect} from '../../../modules/hud-layout/src/layout';
export type {HudRect} from '../../../packages/game-api/src/index';
export function initHudLayout(){
 const viewport=document.querySelector<HTMLElement>('#flight-console .viewport')!;
 const layout=createHudLayout({viewport,editor:{items:HUD_EDITOR_ITEMS,toggle:document.getElementById('hud-layout-toggle')!,reset:document.getElementById('hud-layout-reset')!,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},hint:'Drag grips or navballs to move.'},roles:{status:viewport.querySelector<HTMLElement>('.hud-top-left')!,right:viewport.querySelector<HTMLElement>('.hud-top-right')!,dock:viewport.querySelector<HTMLElement>('.hud-dock')!,chat:document.getElementById('chat-overlay')!,telemetry:viewport.querySelector<HTMLElement>('.telemetry')!},touchSelector:'.touch-stick-zone, .touch-actions-zone',discoverSelector:'canvas, #touch-overlay'},icon);
 const cached=new WeakMap<NavballPlacement,{key:string;center:{x:number;y:number}}>();
 return {get editing(){return layout.editing;},dispose:()=>layout.dispose(),
    navballCenter(placement: NavballPlacement, width: number, height: number, scale: number, canvas: HTMLCanvasElement, trajectory = false) {
      const key = `${layout.revision}/${width}/${height}/${scale}/${trajectory}`;
      const previous = cached.get(placement);
      if (previous?.key === key) return previous.center;
      const preferred = computeNavballCenter(placement, width, height, scale);
      // Include marker stems, drag banner, pin label and readouts. Text remains 11 px on small dials.
      const { side, above, below } = navballFootprint(scale, trajectory);
      const left = side + THROTTLE_LEVER_SPACE;
      const top = Math.max(above, 76);
      const bottom = Math.max(below, 100);
      const fit = layout.fit({ x: preferred.x - left, y: preferred.y - top, width: left + side, height: top + bottom }, width, height, canvas, placement.anchor!=='custom');
      const center = { x: fit.x + left, y: fit.y + top };
      cached.set(placement, { key, center });
      return center;
    },
 };
}
