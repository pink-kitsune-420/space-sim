import type {HudRect,HudLayout,HudLayoutOptions,WindowIcon} from '@space-sim/game-api';
import {createHudEditor} from './editor';
/** Nearest free position in a pane, minimizing overlap first if crowded. All units are CSS pixels.
 * Bounded layout-change work; callers cache results rather than searching in the frame loop. */
export function fitHudRect(preferred: HudRect, width: number, height: number, obstacles: readonly HudRect[]): HudRect {
  const clampX = (x: number): number => Math.max(8, Math.min(Math.max(8, width - preferred.width - 8), x));
  const clampY = (y: number): number => Math.max(8, Math.min(Math.max(8, height - preferred.height - 8), y));
  const x = clampX(preferred.x), y = clampY(preferred.y);
  const xs = [x, 8, clampX(width)], ys = [y, 8, clampY(height)];
  for (const r of obstacles) {
    xs.push(clampX(r.x - preferred.width - 8), clampX(r.x + r.width + 8));
    ys.push(clampY(r.y - preferred.height - 8), clampY(r.y + r.height + 8));
  }
  let bestX = x, bestY = y, bestArea = Infinity, bestDistance = Infinity;
  for (const cx of xs) for (const cy of ys) {
    let area = 0;
    for (const r of obstacles) area += Math.max(0, Math.min(cx + preferred.width, r.x + r.width + 8) - Math.max(cx, r.x - 8))
      * Math.max(0, Math.min(cy + preferred.height, r.y + r.height + 8) - Math.max(cy, r.y - 8));
    const distance = (cx - x) ** 2 + (cy - y) ** 2;
    if (area < bestArea || (area === bestArea && distance < bestDistance)) {
      bestArea = area; bestDistance = distance; bestX = cx; bestY = cy;
    }
  }
  return { ...preferred, x: bestX, y: bestY };
}

/** Measure HUD obstacles on layout changes. Drawing and picking share cached navball centres. */
export function createHudLayout(options:HudLayoutOptions,icon:(name:WindowIcon)=>string):HudLayout {
  const viewport=options.viewport,document=viewport.ownerDocument,window=document.defaultView!;
  const hadRoot=viewport.classList.contains('hud-layout-root');viewport.classList.add('hud-layout-root');
  const controller=new window.AbortController(),signal=controller.signal;let disposed=false,frame:number|undefined;
  const styleKeys=['--hud-touch-inset','--hud-status-bottom','--hud-dock-inset','--hud-message-top','--hud-notice-top','--chat-telemetry-inset'];
  const previousStyles=styleKeys.map(key=>[key,viewport.style.getPropertyValue(key),viewport.style.getPropertyPriority(key)] as const);
  const stacked=viewport.classList.contains('hud-top-stacked'),overlap=viewport.classList.contains('chat-overlaps-telemetry');
  let pending = false, revision = 0;
  let obstacles: HudRect[] = [];
  const nonBlocking = options.editor?.items.filter(item=>item.obstacle===false).map(item=>item.selector)??[];
  const panes = new Map<HTMLCanvasElement, HudRect>(), observed = new Set<HTMLElement>();
  
  const schedule = (): void => { if (!disposed && !pending) { pending = true; frame=window.requestAnimationFrame(update); } };
  const editor=options.editor?createHudEditor({...options.editor,viewport,changed:schedule},icon):undefined;
  const observer = new window.ResizeObserver(schedule);
  function update(): void {
    pending = false;frame=undefined;if(disposed)return;
    const bounds = viewport.getBoundingClientRect();
    editor?.refresh();
    const touch = options.touchSelector?[...viewport.querySelectorAll<HTMLElement>(options.touchSelector)]
      .filter(element => element.getClientRects().length > 0):[];
    // Responsive defaults use the home anchors. A player moving a control to the top must
    // not push unrelated default readouts outside the screen. Actual boxes still block navballs.
    const touchInset = touch.length ? Math.ceil(bounds.height - Math.min(...touch.map(e => e.offsetTop)) + 8) : 0;
    viewport.style.setProperty('--hud-touch-inset', `${touchInset}px`);
    const roles=options.roles;
    if(roles){
    const {status,right:rightElement,dock,chat,telemetry}=roles;
    const left = { right: bounds.left + status.offsetLeft + status.offsetWidth,
      bottom: bounds.top + status.offsetTop + status.offsetHeight };
    const right = rightElement.getBoundingClientRect();
    viewport.style.setProperty('--hud-status-bottom', `${left.bottom - bounds.top + 8}px`);
    viewport.classList.toggle('hud-top-stacked', left.right + 8 > right.left);
    // Keep the touch deck beside the desktop dock, including its compact height variant.
    // offsetLeft uses the home anchor so saved HUD translations remain independent.
    viewport.style.setProperty('--hud-dock-inset', `${bounds.width > 650 ? bounds.width - dock.offsetLeft + 8 : 0}px`);
    const topBottom = Math.max(left.bottom, rightElement.getBoundingClientRect().bottom,
      bounds.width <= 650 ? bounds.top + dock.offsetTop + dock.offsetHeight : bounds.top);
    viewport.style.setProperty('--hud-message-top', `${topBottom - bounds.top + 8}px`);
    viewport.style.setProperty('--hud-notice-top', `${topBottom - bounds.top + 42}px`);
    editor?.refresh();
    const chatBounds = chat.getBoundingClientRect(), instruments = telemetry.getBoundingClientRect();
    const bottom = bounds.bottom - Math.max(bounds.width <= 650 ? 8 : 12, touchInset);
    const overlaps = chatBounds.height > 0 && chatBounds.right + 12 > instruments.left
      && chatBounds.left - 12 < instruments.right && chatBounds.bottom + 12 > bottom - instruments.height && chatBounds.top - 12 < bottom;
    viewport.style.setProperty('--chat-telemetry-inset', `${Math.min(bounds.height - instruments.height - 8,
      Math.max(touchInset, Math.ceil(bounds.bottom - chatBounds.top + 8)))}px`);
    viewport.classList.toggle('chat-overlaps-telemetry', overlaps);
    }
    const elements=editor?.refresh()??[];
    const rect = (element: HTMLElement): HudRect => {
      const r = element.getBoundingClientRect();
      return { x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height };
    };
    obstacles = [...elements, ...(roles?[roles.chat]:[])].filter(e => e.getClientRects().length > 0 && !nonBlocking.some(selector=>e.matches(selector))).map(rect);
    panes.clear();
    const canvases = [...viewport.querySelectorAll<HTMLCanvasElement>('canvas')];
    for (const canvas of canvases) panes.set(canvas, rect(canvas));
    const current = new Set<HTMLElement>([viewport,...(roles?[roles.chat,roles.right]:[]),...elements,...canvases]);
    for (const element of observed) if (!current.has(element)) { observer.unobserve(element); observed.delete(element); }
    for (const element of current) if (!observed.has(element)) { observed.add(element); observer.observe(element); }
    revision++;
  }
  viewport.addEventListener('hud-layout-change', schedule,{signal});
  viewport.addEventListener('window-change', schedule,{signal});
  viewport.addEventListener('transitionend', schedule,{capture:true,signal});
  window.addEventListener('resize', schedule,{signal});
  // Ignore changing text; discover renderer replacements and late-created touch controls.
  const mutation=new window.MutationObserver(records => {
    if (records.some(r => [...r.addedNodes].some(n => n instanceof HTMLElement
      && (n.matches(options.discoverSelector??'canvas') || n.querySelector(options.discoverSelector??'canvas')))
      || [...r.removedNodes].some(n => n instanceof HTMLElement && (n.matches('.hud-move-handle') || n.matches(options.discoverSelector??'canvas'))))) schedule();
  });mutation.observe(viewport, {childList:true,subtree:true});
  schedule();
  return {
    get editing(){return editor?.editing??false;},get revision(){return revision;},
    fit(preferred,width,height,canvas,avoid=true){const pane=canvas?panes.get(canvas):undefined;
      const blocked=avoid?obstacles.map(rect=>({...rect,x:rect.x-(pane?.x??0),y:rect.y-(pane?.y??0)})):[];
      return fitHudRect(preferred,width,height,blocked);
    },
    dispose(){if(disposed)return;disposed=true;controller.abort();if(frame!==undefined)window.cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();editor?.dispose();panes.clear();observed.clear();obstacles=[];
      for(const [key,value,priority] of previousStyles){if(value)viewport.style.setProperty(key,value,priority);else viewport.style.removeProperty(key);}viewport.classList.toggle('hud-top-stacked',stacked);viewport.classList.toggle('chat-overlaps-telemetry',overlap);if(!hadRoot)viewport.classList.remove('hud-layout-root');}
  };
}
