import {createHudEditor} from '../../../modules/hud-layout/src/editor';
import {icon} from './ui-icons';
const ITEMS = [
  ['status', '.hud-top-left', 'status'], ['controls', '.hud-quickbar', 'flight controls'],
  ['clock', '.view-time', 'clock'], ['dock', '.hud-dock', 'dock'],
  ['telemetry', '.telemetry', 'flight readings'], ['message', '#flight-message', 'flight hint'],
  ['terrain', '#terrain-notice', 'terrain notice'], ['profiler', '#profiler', 'profiler'],
  ['stick', '.touch-stick-zone', 'touch joystick'], ['burn', '.touch-actions-zone', 'touch actions'],
] as const;
export const HUD_EDITOR_ITEMS=ITEMS.map(([id,selector,label])=>({id,selector,label}));
export function initHudEditor(viewport:HTMLElement,changed:()=>void){return createHudEditor({viewport,changed,items:HUD_EDITOR_ITEMS,toggle:document.getElementById('hud-layout-toggle')!,reset:document.getElementById('hud-layout-reset')!,storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},hint:'Drag grips or navballs to move.'},icon);}
