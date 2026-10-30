// Copyright (c) 2026 pink-kitsune-420
// SPDX-License-Identifier: MIT

import { ACTION_DEFINITIONS, formatKeyCode, isFlightAction, type ActionCategory, type ActionId, type KeyBindings } from './input-config';
import { formatControllerButton, type ControllerProfile, type GamepadDiagnostic } from './gamepad';
import { keyboardOwner, padOwner, type LocalPlayersConfig } from './local-players';
import { MANUAL, type ManualAudience } from './manual-content';
import { type Disposable, type ManualSection as ReaderSection } from '../../../packages/game-api/src/index';

import { initManual } from './manual';
let active: Disposable | undefined;
const CATEGORY_TITLES:Readonly<Record<ActionCategory,string>>={flight:'Flight',warp:'Time warp',view:'Camera & view',system:'System'};
interface ManualControls {
 readonly keys:KeyBindings;readonly players:LocalPlayersConfig;readonly pads:readonly GamepadDiagnostic[];readonly controllerEnabled:boolean;
}
/** Game adapter owns live control references; the module owns navigation/search/preferences and reading. */
export function initFlightManual(options:{readControls:()=>ManualControls;openControls:()=>void}):Disposable|undefined {
 const root=document.getElementById('game-manual');if(!root)return;active?.dispose();
 const section=(audience:ManualAudience):ReaderSection=>({...MANUAL[audience],pages:MANUAL[audience].pages.map(page=>({id:page.id,title:page.title,summary:page.summary,
  searchText:page.html.replace(/<[^>]+>|\{\{[^}]+\}\}/g,' '),mount(target:HTMLElement){
   const bindings=options.readControls(),title=target.ownerDocument.createElement('h2');title.textContent=page.title;
   target.innerHTML=expandKeys(page.html,bindings);target.prepend(title);
   for(const slot of target.querySelectorAll<HTMLElement>('[data-manual-controls]'))slot.replaceWith(controlsTable(bindings));
   for(const slot of target.querySelectorAll<HTMLElement>('[data-manual-configure]')){
    const button=target.ownerDocument.createElement('button');button.type='button';button.className='manual-configure';
    button.textContent='Configure controls…';button.setAttribute('aria-haspopup','dialog');button.addEventListener('click',options.openControls);slot.replaceWith(button);
   }
   for(const link of target.querySelectorAll<HTMLAnchorElement>('a[data-page]'))link.href=`#manual-${link.dataset.page}`;
  }}))});
 const book={players:section('players'),creators:section('creators')};
 const reader=initManual({root,book,revision:()=>{const b=options.readControls();return JSON.stringify([b.keys,b.players,b.controllerEnabled,b.pads.map(pad=>[pad.index,pad.family])]);}})!;
 const controller=new AbortController(),signal=controller.signal,refresh=()=>reader.refresh();
 document.getElementById('controls-dialog')?.addEventListener('close',refresh,{signal});
 window.addEventListener('gamepadconnected',refresh,{signal});window.addEventListener('gamepaddisconnected',refresh,{signal});
 document.addEventListener('window-change',event=>{if((event as CustomEvent<{id:string}>).detail?.id==='manual'&&root.offsetParent!==null)refresh();},{signal});
 let disposed=false;const lease={dispose(){if(disposed)return;disposed=true;controller.abort();reader.dispose();if(active===lease)active=undefined;}};active=lease;return lease;
}

function expandKeys(html: string, bindings: ManualControls): string {
  return html.replace(/\{\{key:(\w+)\}\}/g, (_, id: string) => {
    const action = id as ActionId;
    return [keyboardLabels(action, bindings), controllerLabels(action, bindings)]
      .filter(labels => labels.length).map(labels => labels.map(label => `<kbd>${escape(label)}</kbd>`).join(' / ')).join(' or ')
      || '<span class="unbound">unbound (configure controls)</span>';
  });
}

function keyboardLabels(action: ActionId, bindings: ManualControls): string[] {
  if (isFlightAction(action) && keyboardOwner(bindings.players) !== 0) return [];
  return (bindings.keys[action] ?? []).map(formatKeyCode);
}

function controllerLabels(action: ActionId, bindings: ManualControls): string[] {
  const slot = bindings.players.slots[0]!;
  if (!bindings.controllerEnabled || slot.device === 'keyboard' || slot.device === 'none') return [];
  const connected = bindings.pads.map(pad => pad.index);
  const pad = bindings.pads.find(pad => padOwner(bindings.players, pad.index, connected) === 0);
  const profile: ControllerProfile = slot.profile;
  const labels = profile.buttons[action].map(button => formatControllerButton(button, pad?.family ?? 'xbox'));
  const axis = (index: number, positive: boolean): void => { if (index >= 0) labels.push(`Axis ${index} ${positive ? '+' : '−'}`); };
  if (action === 'turnLeft' || action === 'turnRight') axis(profile.turnAxis, (action === 'turnRight') !== profile.invertTurn);
  if (action === 'throttleUp' || action === 'throttleDown') axis(profile.throttleAxis, (action === 'throttleUp') !== profile.invertThrottle);
  if (action === 'zoomIn' || action === 'zoomOut') axis(profile.zoomAxis, (action === 'zoomIn') !== profile.invertZoom);
  return labels;
}

function controlsTable(bindings: ManualControls): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'manual-controls';
  for (const category of Object.keys(CATEGORY_TITLES) as ActionCategory[]) {
    const actions = ACTION_DEFINITIONS.filter(action => action.category === category);
    if (!actions.length) continue;
    const table = document.createElement('table');
    table.innerHTML = `<caption>${CATEGORY_TITLES[category]}</caption><thead><tr><th scope="col">Action</th><th scope="col">Keyboard</th><th scope="col">Player 1 controller</th></tr></thead><tbody>${actions.map(action => {
      const cells = [keyboardLabels(action.id, bindings), controllerLabels(action.id, bindings)].map((labels, index) =>
        `<td class="manual-${index === 0 ? 'keyboard' : 'controller'}">${labels.length ? labels.map(label => `<kbd>${escape(label)}</kbd>`).join(' ') : '<span class="unbound">—</span>'}</td>`).join('');
      return `<tr title="${escape(action.description)}"><th scope="row">${escape(action.name)}</th>${cells}</tr>`;
    }).join('')}</tbody>`;
    wrap.append(table);
  }
  return wrap;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}
