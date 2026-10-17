import { attachWindowResize, raiseWindow } from './window-resize';
import { applyHudThemeToDom, getActiveTheme } from '../../../packages/render-2d/src/theme';

const STORAGE_PREFIX = 'space-sim:flight-window:1:';
interface WindowSettings { x: number; y: number; pinned: boolean; minimized: boolean; open: boolean; width?: number; height?: number }

/** Float the existing live readouts, retaining one set of values and their original IDs. */
export function initFlightWindows(): void {
  const viewport = document.querySelector<HTMLElement>('#flight-console .viewport')!;
  const toasts = document.createElement('div');
  toasts.className = 'flight-window-toasts';
  toasts.setAttribute('aria-label', 'Flight instruments');
  viewport.append(toasts);
  createFlightWindow(viewport, toasts, 'trajectory', 'Trajectory', document.querySelector<HTMLElement>('.path-card')!, 24, 104, false);
  createFlightWindow(viewport, toasts, 'telemetry', 'Telemetry', document.getElementById('module-panels')!, 390, 104, true);
}

function createFlightWindow(viewport: HTMLElement, toasts: HTMLElement, id: string, title: string, card: HTMLElement, x: number, y: number, returnToDrawer: boolean): void {
  const anchor = document.createComment(`${title} source location`);
  card.before(anchor);
  const toggle = document.createElement('button');
  toggle.id = `${id}-toast`;
  toggle.className = 'flight-window-toast';
  toggle.type = 'button';
  toggle.textContent = title;
  toggle.setAttribute('aria-label', `Open ${title.toLowerCase()} window`);
  toggle.setAttribute('aria-controls', `${id}-window`);
  toggle.setAttribute('aria-expanded', 'false');
  toasts.append(toggle);

  const panel = document.createElement('section');
  panel.id = `${id}-window`;
  panel.className = 'flight-window';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', `${id}-window-title`);
  panel.innerHTML = `
    <div class="flight-window-header">
      <button type="button" class="flight-window-drag" aria-label="Move ${title.toLowerCase()} window" title="Drag to move; arrow keys move the window">
        <span aria-hidden="true">⠿</span><span id="${id}-window-title">${title}</span>
      </button>
      <button type="button" id="${id}-pin" aria-label="Pin ${title.toLowerCase()} window" title="Keep visible while flying" aria-pressed="true">Pin</button>
      <button type="button" id="${id}-minimize" aria-label="Minimize ${title.toLowerCase()} window" aria-controls="${id}-window-body" aria-expanded="true">−</button>
      <button type="button" id="${id}-close" aria-label="Close ${title.toLowerCase()} window" title="Close window">×</button>
    </div>
    <div id="${id}-window-body" class="flight-window-body"></div>`;
  viewport.append(panel);
  panel.addEventListener('pointerdown', () => {
    raiseWindow(panel, viewport);
  });
  applyHudThemeToDom(getActiveTheme(), panel);
  const handle = panel.querySelector<HTMLButtonElement>('.flight-window-drag')!;
  const body = panel.querySelector<HTMLElement>('.flight-window-body')!;
  const pin = panel.querySelector<HTMLButtonElement>(`#${id}-pin`)!;
  const minimize = panel.querySelector<HTMLButtonElement>(`#${id}-minimize`)!;
  if (returnToDrawer) {
    const empty = document.createElement('p');
    empty.className = 'flight-window-empty';
    empty.textContent = 'Enable Telemetry in Flight & setup to show readings.';
    body.append(empty);
    const update = (): void => { empty.hidden = card.childElementCount > 0 && !card.hidden; };
    new MutationObserver(update).observe(card, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    update();
  }

  let settings: WindowSettings = { x, y, pinned: true, minimized: false, open: false };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + id) ?? 'null') as Partial<WindowSettings> | null;
    if (stored) settings = {
      x: Number.isFinite(stored.x) ? stored.x! : settings.x,
      y: Number.isFinite(stored.y) ? stored.y! : settings.y,
      pinned: stored.pinned !== false,
      minimized: stored.minimized === true,
      open: stored.open === true && stored.pinned !== false,
      width: Number.isFinite(stored.width) && stored.width! > 0 ? stored.width : undefined,
      height: Number.isFinite(stored.height) && stored.height! > 0 ? stored.height : undefined,
    };
  } catch { /* Saved layout is optional. */ }

  function save(): void {
    try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(settings)); } catch { /* Layout lasts for this session. */ }
  }
  function position(): void {
    if (panel.hidden) return;
    const margin = 8;
    if (settings.width) panel.style.width = `${Math.min(settings.width, viewport.clientWidth - 16)}px`;
    if (settings.height) panel.style.height = settings.minimized ? 'auto' : `${Math.min(settings.height, viewport.clientHeight - 16)}px`;
    settings.x = Math.max(margin, Math.min(settings.x, viewport.clientWidth - panel.offsetWidth - margin));
    settings.y = Math.max(margin, Math.min(settings.y, viewport.clientHeight - panel.offsetHeight - margin));
    panel.style.left = `${settings.x}px`;
    panel.style.top = `${settings.y}px`;
  }
  function render(): void {
    panel.hidden = !settings.open;
    if (settings.open) {
      raiseWindow(panel, viewport);
    }
    if (settings.open || !returnToDrawer) body.append(card);
    else anchor.after(card);
    body.hidden = settings.minimized;
    panel.classList.toggle('minimized', settings.minimized);
    pin.setAttribute('aria-pressed', String(settings.pinned));
    pin.title = settings.pinned ? 'Unpin: close when you click the flight view' : 'Keep visible while flying';
    minimize.textContent = settings.minimized ? '+' : '−';
    minimize.setAttribute('aria-label', `${settings.minimized ? 'Restore' : 'Minimize'} ${title.toLowerCase()} window`);
    minimize.setAttribute('aria-expanded', String(!settings.minimized));
    toggle.hidden = settings.open;
    toggle.setAttribute('aria-expanded', String(settings.open));
    position();
    save();
  }
  function close(): void {
    settings.open = false;
    render();
  }
  toggle.addEventListener('click', () => {
    settings.open = !settings.open;
    if (settings.open) settings.pinned = true;
    render();
  });
  panel.querySelector(`#${id}-close`)!.addEventListener('click', () => {
    close();
    toggle.focus({ preventScroll: true });
  });
  pin.addEventListener('click', () => { settings.pinned = !settings.pinned; render(); });
  minimize.addEventListener('click', () => { settings.minimized = !settings.minimized; render(); });
  // Unpinned windows are temporary; a pinned window leaves flight input available.
  viewport.addEventListener('pointerdown', event => {
    if (event.target instanceof HTMLCanvasElement && event.target.id === 'flight-view' && !settings.pinned) close();
  });

  let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: settings.x, top: settings.y };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    settings.x = drag.left + event.clientX - drag.x;
    settings.y = drag.top + event.clientY - drag.y;
    position();
  });
  const endDrag = (): void => { if (drag) { drag = undefined; save(); } };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', endDrag);
  handle.addEventListener('keydown', event => {
    const moves: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    settings.x += move[0] * step;
    settings.y += move[1] * step;
    position();
    save();
  });
  attachWindowResize(panel, viewport, title.toLowerCase(), {
    change: (width, height) => { settings.width = width; settings.height = height; position(); },
    end: save,
  });
  const observer = new ResizeObserver(() => { position(); });
  observer.observe(viewport);
  observer.observe(panel);
  render();
}
