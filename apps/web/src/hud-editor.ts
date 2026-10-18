/** Viewport-relative HUD preferences; presentation only, independent of world saves. */
const KEY = 'space-sim:hud-layout:1';
const ITEMS = [
  ['status', '.hud-top-left', 'status'], ['controls', '.hud-quickbar', 'flight controls'],
  ['clock', '.view-time', 'clock'], ['dock', '.hud-dock', 'dock'],
  ['telemetry', '.telemetry', 'flight readings'], ['message', '#flight-message', 'flight hint'],
  ['terrain', '#terrain-notice', 'terrain notice'], ['profiler', '#profiler', 'profiler'],
  ['stick', '.touch-stick-zone', 'touch joystick'], ['burn', '.touch-actions-zone', 'touch actions'],
] as const;
interface Position { x: number; y: number }

export function initHudEditor(viewport: HTMLElement, changed: () => void) {
  let positions: Record<string, Position> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    for (const [id] of ITEMS) {
      const p = saved?.[id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = {
        x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)),
      };
    }
  } catch { /* Layout remains usable without storage. */ }
  let editing = false;
  const shifts = new WeakMap<HTMLElement, Position>();
  const toggle = document.getElementById('hud-layout-toggle')!;
  const toolbar = document.createElement('div');
  toolbar.className = 'hud-layout-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<span>Drag the move handles. Windows and navballs have their own handles.</span><button type="button">Done</button>';
  viewport.append(toolbar);
  const save = (): void => {
    try { localStorage.setItem(KEY, JSON.stringify(positions)); } catch { /* Session-only preferences. */ }
  };
  function setEditing(value: boolean): void {
    editing = value;
    viewport.classList.toggle('hud-editing', value);
    toolbar.hidden = !value;
    toggle.setAttribute('aria-pressed', String(value));
    viewport.dispatchEvent(new CustomEvent('hud-layout-edit', { detail: value }));
    changed();
    if (value) toolbar.querySelector('button')!.focus();
  }
  toggle.addEventListener('click', () => setEditing(!editing));
  toolbar.querySelector('button')!.addEventListener('click', () => setEditing(false));
  document.addEventListener('keydown', event => {
    if (editing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); }
  }, true);
  toolbar.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') setEditing(false); });
  document.getElementById('hud-layout-reset')!.addEventListener('click', () => {
    positions = {}; save();
    viewport.dispatchEvent(new Event('hud-layout-reset', { bubbles: true }));
    changed();
  });
  function remember(id: string, element: HTMLElement, left: number, top: number): void {
    positions[id] = {
      x: Math.max(0, Math.min(1, (left - 8) / Math.max(1, viewport.clientWidth - element.offsetWidth - 16))),
      y: Math.max(0, Math.min(1, (top - 8) / Math.max(1, viewport.clientHeight - element.offsetHeight - 16))),
    };
    changed();
  }
  function attach(id: string, element: HTMLElement, label: string): void {
    element.classList.add('hud-movable');
    const handle = document.createElement('button');
    handle.type = 'button'; handle.className = 'hud-move-handle';
    handle.setAttribute('aria-label', `Move ${label}`);
    handle.title = `Move ${label}; arrow keys move, Shift moves faster`;
    handle.textContent = `↔ ${label}`;
    element.append(handle);
    let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
    handle.addEventListener('pointerdown', event => {
      if (!editing || !event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const rect = element.getBoundingClientRect(), parent = viewport.getBoundingClientRect();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      event.stopPropagation();
      remember(id, element, drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    });
    const end = (): void => { if (drag) { drag = undefined; save(); } };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, end);
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); setEditing(false); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect(), parent = viewport.getBoundingClientRect(), step = event.shiftKey ? 32 : 8;
      remember(id, element, rect.left - parent.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        rect.top - parent.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
      save();
    });
    handle.addEventListener('keyup', event => event.stopPropagation());
  }
  return {
    get editing() { return editing; },
    /** Restore preferences without rewriting their responsive anchors when the viewport shrinks. */
    refresh(): HTMLElement[] {
      const parent = viewport.getBoundingClientRect(), elements: HTMLElement[] = [];
      for (const [id, selector, label] of ITEMS) {
        const element = viewport.querySelector<HTMLElement>(selector);
        if (!element) continue;
        if (!element.querySelector(':scope > .hud-move-handle')) attach(id, element, label);
        elements.push(element);
        const previous = shifts.get(element) ?? { x: 0, y: 0 };
        const rect = element.getBoundingClientRect(), preferred = positions[id];
        const shift = preferred && rect.width && rect.height ? {
          x: 8 + preferred.x * Math.max(0, parent.width - rect.width - 16) - (rect.left - parent.left - previous.x),
          y: 8 + preferred.y * Math.max(0, parent.height - rect.height - 16) - (rect.top - parent.top - previous.y),
        } : { x: 0, y: 0 };
        element.style.translate = `${shift.x}px ${shift.y}px`;
        shifts.set(element, shift);
      }
      return elements;
    },
  };
}
