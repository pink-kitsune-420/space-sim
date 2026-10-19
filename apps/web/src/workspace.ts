import { element } from './ui';
import { FloatingWindow } from './floating-window';
import { icon, type IconName } from './ui-icons';
import { Workspace as SharedWorkspace } from '../../../modules/ui-shell/src/index';
export type Panel = 'setup' | 'fleet' | 'multiplayer' | 'data' | 'settings' | 'tools' | 'manual' | 'library';
interface PanelSpec { readonly id:Panel; readonly title:string; readonly label:string; readonly icon:IconName; readonly hint:string; readonly sources:readonly string[] }
/** Dock groups, top to bottom. Instrument windows join the second group as they are created. */
const GROUPS: readonly (readonly PanelSpec[])[] = [[
  { id: 'setup', title: 'Flight setup', label: 'Setup', icon: 'setup', hint: 'Universe, system, scenario and reset', sources: ['.setup-card'] },
  { id: 'fleet', title: 'Fleet', label: 'Fleet', icon: 'fleet', hint: 'Ships in this world, saves', sources: ['.fleet-card'] },
  { id: 'multiplayer', title: 'Multiplayer', label: 'Online', icon: 'online', hint: 'Host or join a shared world', sources: ['.multiplayer'] },
], [
  { id: 'data', title: 'Instruments', label: 'Instruments', icon: 'instruments', hint: 'Choose what the flight view shows', sources: ['.instruments-card', '#module-panels'] },
], [
  { id: 'settings', title: 'Settings', label: 'Settings', icon: 'settings', hint: 'Display, controls, gameplay and diagnostics', sources: ['.settings-card', '.controls'] },
  { id: 'tools', title: 'Tools', label: 'Tools', icon: 'tools', hint: 'Planet designer, shaders, stress test and diagnostics', sources: ['.utility-grid', '.debug'] },
  { id: 'manual', title: 'Manual', label: 'Manual', icon: 'manual', hint: 'How to play, and how to make your own content', sources: ['#game-manual'] },
  { id: 'library', title: 'ModMenu', label: 'ModMenu', icon: 'library', hint: 'Games, plugins and universes', sources: ['#lab-manager'] },
]];


export class Workspace extends SharedWorkspace {
 constructor(release:()=>void,onClose?:()=>void) {
  super({create:options=>new FloatingWindow(options),icon},{
   viewport:document.querySelector<HTMLElement>('#flight-console .viewport')!,overlayRoot:document.body,
   groups:GROUPS.map(group=>group.map(spec=>({...spec,global:spec.id==='library'||spec.id==='manual',content:spec.sources.map(selector=>document.querySelector<HTMLElement>(selector)!)}))),
   instrumentToggle:document.getElementById('chat-toggle') ?? undefined,release,onClose,
   focus(){const orbit=!document.getElementById('orbit-sandbox-workspace')?.hidden;(orbit?document.getElementById('orbit-canvas'):element('flight-view'))?.focus({preventScroll:true});},
   captureEscape(event){const controls=document.getElementById('controls-dialog') as HTMLDialogElement|null;return !!(controls?.open || event.target instanceof Node&&controls?.contains(event.target));},
   dismissModal(){for(const id of ['controls-dialog','theme-dialog']){const modal=document.getElementById(id) as HTMLDialogElement|null;if(modal?.open||modal?.classList.contains('visible')){if(typeof modal.close==='function')modal.close();else modal.removeAttribute('open');modal.classList.remove('visible');return true;}}return false;},
   filePanel(input){if(input.id==='universe-file')return 'setup';if(['lab-file','module-file','code-module-file'].includes(input.id))return 'library';if(input.id==='shader-file')return 'tools';if(input.id==='world-file')return 'fleet';return undefined;}
  });
  document.querySelector('.workspace > aside')?.remove();
 }
}
