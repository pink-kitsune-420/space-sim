import type {Disposable,HudEditor,HudEditorOptions,WindowIcon} from '@space-sim/game-api';

/** Viewport-relative HUD preferences; presentation only, independent of world saves. */
const KEY = 'space-sim:hud-layout:1';
interface Position { x: number; y: number }

export function createHudEditor(options:HudEditorOptions,icon:(name:WindowIcon)=>string):HudEditor {
  const {viewport,changed}=options,document=viewport.ownerDocument;
  if([options.moveStepPx??8,options.fastMoveStepPx??32].some(value=>!Number.isFinite(value)||value<1||value>128))throw new Error('HUD movement step must be in [1,128] CSS pixels');
  const controller=new (document.defaultView?.AbortController??AbortController)(),resources=new Map<HTMLElement,Disposable>();let disposed=false;
  const signal=controller.signal;
  const ITEMS=options.items.map(item=>[item.id,item.selector,item.label,item.bounds] as const);
  let positions: Record<string, Position> = Object.create(null);
  try {
    const saved = JSON.parse(options.storage?.getItem(options.storageKey??KEY) ?? '{}');
    for (const [id] of ITEMS) {
      const p = saved?.[id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = {
        x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)),
      };
    }
  } catch { /* Layout remains usable without storage. */ }
  let editing = false;
  const shifts = new WeakMap<HTMLElement, Position>();
  const toggle=options.toggle;
  const pressed=toggle.getAttribute('aria-pressed'),wasEditing=viewport.classList.contains('hud-editing');
  const toolbar = document.createElement('div');
  toolbar.className = 'hud-layout-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<span>Drag grips or navballs to move.</span><button type="button">Done</button>';
  toolbar.querySelector('span')!.textContent=options.hint??'Drag grips to move.';
  viewport.append(toolbar);
  const save = (): void => {
    try { options.storage?.setItem(options.storageKey??KEY, JSON.stringify(positions)); } catch { /* Session-only preferences. */ }
  };
  function setEditing(value: boolean): void {
    if(disposed)return;
    editing = value;
    viewport.classList.toggle('hud-editing', value);
    toolbar.hidden = !value;
    toggle.setAttribute('aria-pressed', String(value));
    viewport.dispatchEvent(new CustomEvent('hud-layout-edit', { detail: value }));
    changed();
    if (value) toolbar.querySelector('button')!.focus();
  }
  toggle.addEventListener('click', () => setEditing(!editing),{signal});
  toolbar.querySelector('button')!.addEventListener('click', () => setEditing(false),{signal});
  document.addEventListener('keydown', event => {
    if (editing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); }
  }, {capture:true,signal});
  toolbar.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') setEditing(false); },{signal});
  options.reset.addEventListener('click', () => {
    positions = Object.create(null); save();
    viewport.dispatchEvent(new Event('hud-layout-reset', { bubbles: true }));
    changed();
  },{signal});
  function bounds(element: HTMLElement, selector?: string): DOMRect {
    const rect = selector ? element.parentElement?.querySelector<HTMLElement>(selector)?.getBoundingClientRect() : undefined;
    return rect?.width && rect.height ? rect : viewport.getBoundingClientRect();
  }
  function remember(id: string, element: HTMLElement, left: number, top: number, selector?: string): void {
    const frame = bounds(element, selector), parent = viewport.getBoundingClientRect();
    positions[id] = {
      x: Math.max(0, Math.min(1, (left - (frame.left - parent.left) - 8) / Math.max(1, frame.width - element.offsetWidth - 16))),
      y: Math.max(0, Math.min(1, (top - (frame.top - parent.top) - 8) / Math.max(1, frame.height - element.offsetHeight - 16))),
    };
    changed();
  }
  function attach(id: string, element: HTMLElement, label: string, selector?: string): void {
    const lifetime = new (document.defaultView?.AbortController??AbortController)(), signal = lifetime.signal;
    const previous={translate:element.style.translate,movable:element.classList.contains('hud-movable'),moving:element.classList.contains('hud-moving')};
    element.classList.add('hud-movable');
    const handle = document.createElement('button');
    handle.type = 'button'; handle.className = 'hud-move-handle';
    handle.setAttribute('aria-label', `Move ${label}`);
    handle.title = `Move ${label}; arrow keys move, Shift moves faster`;
    handle.innerHTML = icon('grip');
    element.append(handle);
    let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
    handle.addEventListener('pointerdown', event => {
      if (!editing || !event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const rect = element.getBoundingClientRect(), parent = viewport.getBoundingClientRect();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top };
      element.classList.add('hud-moving');
      handle.setPointerCapture(event.pointerId);
    },{signal});
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      event.stopPropagation();
      remember(id, element, drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y, selector);
    },{signal});
    const end = (): void => { if (drag) { const pointer=drag.pointer;drag = undefined;if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);element.classList.remove('hud-moving'); if(!disposed)save(); } };
    resources.set(element,{dispose(){lifetime.abort();end();handle.remove();element.style.translate=previous.translate;element.classList.toggle('hud-movable',previous.movable);element.classList.toggle('hud-moving',previous.moving);}});
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, end,{signal});
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); },{signal});
    handle.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); setEditing(false); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect(), parent = viewport.getBoundingClientRect(), step = event.shiftKey ? (options.fastMoveStepPx??32) : (options.moveStepPx??8);
      remember(id, element, rect.left - parent.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        rect.top - parent.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), selector);
      save();
    },{signal});
    handle.addEventListener('keyup', event => event.stopPropagation(),{signal});
  }
  return {
    get editing() { return editing; },
    /** Restore preferences without rewriting their responsive anchors when the viewport shrinks. */
    dispose(){if(disposed)return;disposed=true;editing=false;controller.abort();for(const resource of resources.values())resource.dispose();resources.clear();toolbar.remove();viewport.classList.toggle('hud-editing',wasEditing);if(pressed===null)toggle.removeAttribute('aria-pressed');else toggle.setAttribute('aria-pressed',pressed);},
    refresh(): HTMLElement[] {
      if(disposed)return [];
      for(const [element,resource] of resources) if(!viewport.contains(element)){resource.dispose();resources.delete(element);}
      const parent = viewport.getBoundingClientRect(), elements: HTMLElement[] = [];
      for (const [id, selector, label, boundary] of ITEMS) {
        const element = viewport.querySelector<HTMLElement>(selector);
        if (!element) continue;
        if (!element.querySelector(':scope > .hud-move-handle')) attach(id, element, label, boundary);
        elements.push(element);
        const previous = shifts.get(element) ?? { x: 0, y: 0 };
        const rect = element.getBoundingClientRect(), preferred = positions[id], frame = bounds(element, boundary);
        const shift = preferred && rect.width && rect.height ? {
          x: frame.left - parent.left + 8 + preferred.x * Math.max(0, frame.width - rect.width - 16) - (rect.left - parent.left - previous.x),
          y: frame.top - parent.top + 8 + preferred.y * Math.max(0, frame.height - rect.height - 16) - (rect.top - parent.top - previous.y),
        } : { x: 0, y: 0 };
        element.style.translate = `${shift.x}px ${shift.y}px`;
        shifts.set(element, shift);
      }
      return elements;
    },
  };
}
