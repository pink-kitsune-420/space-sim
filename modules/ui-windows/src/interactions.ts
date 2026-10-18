import type { Disposable } from '@space-sim/game-api';
/** Every HUD window shares one stacking order, so clicking any window brings it in front of the rest. */
export function createInteractions() {
const stack: HTMLElement[] = [];
const BASE_Z = 26;

function raiseWindow(panel: HTMLElement): void {
  const index = stack.indexOf(panel);
  if (index >= 0) stack.splice(index, 1);
  stack.push(panel);
  stack.forEach((window, order) => {
    window.style.zIndex = String(BASE_Z + order);
    window.classList.toggle('front', order === stack.length - 1);
  });
  panel.ownerDocument.dispatchEvent(new Event('hud-window-raise'));
}

/** Release a removed window from the shared stack. */
function releaseWindow(panel: HTMLElement): void {
  const index = stack.indexOf(panel); if (index >= 0) stack.splice(index, 1);
  panel.classList.remove('front'); panel.style.zIndex = '';
  stack.forEach((window, order) => { window.style.zIndex = String(BASE_Z + order); window.classList.toggle('front', order === stack.length - 1); });
  panel.ownerDocument.dispatchEvent(new Event('hud-window-raise'));
}

/** The topmost window that is currently shown. */
function isFrontWindow(panel: HTMLElement): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const window = stack[i]!;
    if (window.hidden || !window.isConnected || window.offsetParent === null) continue;
    return window === panel;
  }
  return false;
}

/** Pointer/touch and keyboard resizing for the HUD's independent windows. */
function attachWindowResize(panel: HTMLElement, viewport: HTMLElement, title: string, options: {
  start?: () => void;
  /** Geometry in viewport-local pixels, with the opposite edge held in place. */
  change: (width: number, height: number, x: number, y: number) => void;
  end: () => void;
}): Disposable {
  const document = panel.ownerDocument;
  const controller = new (document.defaultView?.AbortController ?? AbortController)(), endings: (() => void)[] = [];
  const handles: HTMLElement[] = [];
  for (const edge of ['se', 's', 'e', 'n', 'w', 'ne', 'nw', 'sw']) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'window-resize';
    handle.dataset.edge = edge;
    const names: Record<string, string> = { s: 'bottom', e: 'right', n: 'top', w: 'left', ne: 'top right', nw: 'top left', sw: 'bottom left' };
    handle.setAttribute('aria-label', `Resize ${title} window${edge === 'se' ? '' : ` from ${names[edge]}`}`);
    handle.title = 'Drag to resize; arrow keys resize the window';
    handle.textContent = edge === 'se' ? '◢' : '';
    panel.append(handle); handles.push(handle);
    let drag: { pointer: number; x: number; y: number; bounds: DOMRect } | undefined;
    function size(bounds: DOMRect, dx: number, dy: number): void {
      const container = viewport.getBoundingClientRect();
      const minWidth = Math.min(240, Math.max(1, container.width - 16));
      const minHeight = Math.min(120, Math.max(1, container.height - 16));
      let left = bounds.left - container.left, top = bounds.top - container.top;
      let right = left + bounds.width, bottom = top + bounds.height;
      if (edge.includes('w')) left = Math.max(8, Math.min(left + dx, right - minWidth));
      if (edge.includes('e')) right = Math.min(container.width - 8, Math.max(right + dx, left + minWidth));
      if (edge.includes('n')) top = Math.max(8, Math.min(top + dy, bottom - minHeight));
      if (edge.includes('s')) bottom = Math.min(container.height - 8, Math.max(bottom + dy, top + minHeight));
      options.change(right - left, bottom - top, left, top);
    }
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      raiseWindow(panel);
      options.start?.();
      const bounds = panel.getBoundingClientRect();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, bounds };
      handle.setPointerCapture(event.pointerId);
    }, { signal: controller.signal });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      size(drag.bounds, event.clientX - drag.x, event.clientY - drag.y);
    }, { signal: controller.signal });
    const end = (): void => { if (drag) { drag = undefined; options.end(); } };
    endings.push(end);
    handle.addEventListener('pointerup', end, { signal: controller.signal });
    handle.addEventListener('pointercancel', end, { signal: controller.signal });
    handle.addEventListener('lostpointercapture', end, { signal: controller.signal });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      options.start?.();
      const bounds = panel.getBoundingClientRect(), step = event.shiftKey ? 32 : 8;
      size(bounds, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
        event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
      options.end();
    }, { signal: controller.signal });
  }
  return { dispose() { controller.abort(); endings.forEach(end => end()); handles.forEach(handle => handle.remove()); } };
}

return {raise: raiseWindow, release: releaseWindow, isFront: isFrontWindow, resize: attachWindowResize};
}
export const legacyInteractions = createInteractions();
export const raiseWindow = legacyInteractions.raise, releaseWindow = legacyInteractions.release, isFrontWindow = legacyInteractions.isFront, attachWindowResize = legacyInteractions.resize;
