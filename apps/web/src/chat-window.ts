import { attachWindowResize, raiseWindow } from './window-resize';

const STORAGE_KEY = 'space-sim:chat-window:1';
interface ChatLayout { x?: number; y?: number; width?: number; height?: number }

export function initChatWindow(): void {
  const viewport = document.querySelector<HTMLElement>('#flight-console .viewport')!;
  const panel = document.getElementById('chat-overlay')!;
  let layout: ChatLayout = {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ChatLayout;
    for (const key of ['x', 'y', 'width', 'height'] as const) if (Number.isFinite(saved[key]) && ((key === 'x' || key === 'y') || saved[key]! > 0)) layout[key] = saved[key];
  } catch { /* Layout is optional. */ }
  const notify = (): void => { viewport.dispatchEvent(new Event('hud-layout-change')); };
  function save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* Session-only layout. */ }
    notify();
  }
  function position(): void {
    const minimized = panel.classList.contains('minimized');
    panel.classList.toggle('user-sized', !!layout.width || !!layout.height);
    panel.style.width = !minimized && layout.width ? `${Math.min(layout.width, viewport.clientWidth - 16)}px` : '';
    panel.style.height = !minimized && layout.height ? `${Math.min(layout.height, viewport.clientHeight - 16)}px` : '';
    // Minimized chat drops back to its home at the bottom of the screen; restoring returns it to the saved spot.
    if (minimized || layout.x === undefined || layout.y === undefined) {
      panel.style.left = panel.style.top = panel.style.bottom = '';
      return;
    }
    layout.x = Math.max(8, Math.min(layout.x, viewport.clientWidth - panel.offsetWidth - 8));
    layout.y = Math.max(8, Math.min(layout.y, viewport.clientHeight - panel.offsetHeight - 8));
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.bottom = 'auto';
  }
  function anchor(): void {
    const bounds = panel.getBoundingClientRect(), container = viewport.getBoundingClientRect();
    layout.x = bounds.left - container.left;
    layout.y = bounds.top - container.top;
    position();
  }
  panel.addEventListener('pointerdown', () => raiseWindow(panel));
  for (const handle of panel.querySelectorAll<HTMLElement>('.chat-title-wrap')) {
    let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
    let moved = false;
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      const bounds = panel.getBoundingClientRect(), container = viewport.getBoundingClientRect();
      moved = false;
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left - container.left, top: bounds.top - container.top };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (!moved) return;
      layout.x = drag.left + dx;
      layout.y = drag.top + dy;
      position();
    });
    const end = (): void => { if (drag) { drag = undefined; if (moved) save(); } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('click', event => {
      if (moved) { event.preventDefault(); event.stopImmediatePropagation(); moved = false; }
    }, true);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      anchor();
      const step = event.shiftKey ? 32 : 8;
      layout.x! += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
      layout.y! += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
      position(); save();
    });
  }
  attachWindowResize(panel, viewport, 'chat', {
    start: anchor,
    change: (width, height) => { layout.width = width; layout.height = height; position(); },
    end: save,
  });
  new ResizeObserver(() => { position(); notify(); }).observe(viewport);
  new ResizeObserver(() => { position(); notify(); }).observe(panel);
  new MutationObserver(() => { position(); }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  position();
}
