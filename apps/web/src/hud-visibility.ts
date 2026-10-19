import {HudVisibility as SharedHudVisibility} from '../../../modules/hud-layout/src/visibility';
const ITEMS = [
  ['status', 'Status', '.hud-top-left'], ['controls', 'Flight controls', '.hud-quickbar'],
  ['clock', 'Clock', '.view-time'], ['telemetry', 'Flight readings', '.telemetry'],
  ['message', 'Flight hints', '#flight-message'], ['terrain', 'Terrain notices', '#terrain-notice'],
  ['throw', 'Throw readings', '#flight-slingshot-hud'],
  ['players', 'Player readings', ''],
  ['chat', 'Chat', '#chat-overlay'], ['scale', 'Scale bar', ''], ['labels', 'Ship labels', ''], ['planets', 'Planet labels', ''], ['orbits', 'Planet orbits', ''],
] as const;
export type HudVisibilityId = typeof ITEMS[number][0] | 'profiler';

export class HudVisibility extends SharedHudVisibility {constructor(viewport:HTMLElement){super({viewport,list:document.getElementById('hud-visibility')!,items:ITEMS.map(([id,label,selector])=>({id,label,selector,containerClass:id==='players'?'hud-hide-players':undefined})),defaults:{profiler:false},storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)}});}}
