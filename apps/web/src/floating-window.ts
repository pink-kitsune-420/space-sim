import { attachWindowResize, isFrontWindow, raiseWindow } from './window-resize';
import { icon, type IconName } from './ui-icons';
import { applyHudThemeToDom, getActiveTheme } from '../../../packages/render-2d/src/theme';

const STORAGE_PREFIX = 'space-sim:flight-window:1:';
const MARGIN = 8;
interface WindowSettings { x?: number; y?: number; pinned: boolean; minimized: boolean; open: boolean; width?: number; height?: number }

export interface FloatingWindowOptions {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  /** Positioning parent; the window stays inside it. */
  readonly container: HTMLElement;
  /** Where the window first appears when it has no saved position; measured after it is shown. */
  readonly place: (container: HTMLElement, panel: HTMLElement) => { x: number; y: number };
  /** Pinned windows stay open while flying and reopen after a reload. */
  readonly pinned?: boolean;
  readonly className?: string;
  /** Called after the user closes the window with its × button. */
  readonly onCloseButton?: () => void;
}

/** A translucent, draggable, resizable, pinnable and minimizable HUD window that remembers its layout. */
export class FloatingWindow {
  readonly element = document.createElement('section');
  readonly body = document.createElement('div');
  private settings: WindowSettings;
  private readonly listeners = new Set<() => void>();
  private readonly pin: HTMLButtonElement;
  private readonly minimize: HTMLButtonElement;

  constructor(private readonly options: FloatingWindowOptions) {
    const { id, title, container } = options;
    const name = title.toLowerCase();
    const panel = this.element;
    panel.id = `${id}-window`;
    panel.className = `flight-window ${options.className ?? ''}`.trim();
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', `${id}-window-title`);
    panel.innerHTML = `
      <div class="flight-window-header">
        <button type="button" class="flight-window-drag" aria-label="Move ${name} window" title="Drag to move; arrow keys move the window">
          ${icon(options.icon)}<span id="${id}-window-title">${title}</span>
        </button>
        <button type="button" id="${id}-pin" class="window-chrome window-pin" aria-label="Pin ${name} window" aria-pressed="false">${icon('pin')}</button>
        <button type="button" id="${id}-minimize" class="window-chrome" aria-controls="${id}-window-body" aria-expanded="true">−</button>
        <button type="button" id="${id}-close" class="window-chrome" data-window-close aria-label="Close ${name} window" title="Close window">×</button>
      </div>`;
    this.body.id = `${id}-window-body`;
    this.body.className = 'flight-window-body';
    panel.append(this.body);
    container.append(panel);
    applyHudThemeToDom(getActiveTheme(), panel);
    this.pin = panel.querySelector<HTMLButtonElement>(`#${id}-pin`)!;
    this.minimize = panel.querySelector<HTMLButtonElement>(`#${id}-minimize`)!;

    this.settings = { pinned: options.pinned ?? false, minimized: false, open: false };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + id) ?? 'null') as Partial<WindowSettings> | null;
      if (stored) {
        const pinned = typeof stored.pinned === 'boolean' ? stored.pinned : this.settings.pinned;
        this.settings = {
          x: Number.isFinite(stored.x) ? stored.x : undefined,
          y: Number.isFinite(stored.y) ? stored.y : undefined,
          pinned,
          minimized: stored.minimized === true,
          open: stored.open === true && pinned,
          width: Number.isFinite(stored.width) && stored.width! > 0 ? stored.width : undefined,
          height: Number.isFinite(stored.height) && stored.height! > 0 ? stored.height : undefined,
        };
      }
    } catch { /* Saved layout is optional. */ }

    panel.addEventListener('pointerdown', () => this.raise());
    panel.querySelector(`#${id}-close`)!.addEventListener('click', () => {
      this.close();
      options.onCloseButton?.();
    });
    this.pin.addEventListener('click', () => { this.settings.pinned = !this.settings.pinned; this.render(); });
    this.minimize.addEventListener('click', () => { this.settings.minimized = !this.settings.minimized; this.render(); });
    // Unpinned windows are temporary: they close when you return to the flight view.
    document.addEventListener('pointerdown', event => {
      if (!this.settings.pinned && event.target instanceof HTMLCanvasElement && (event.target.id === 'flight-view' || event.target.id === 'orbit-canvas')) this.close();
    }, true);
    this.attachDrag(panel.querySelector<HTMLButtonElement>('.flight-window-drag')!);
    attachWindowResize(panel, container, name, {
      change: (width, height) => { this.settings.width = width; this.settings.height = height; this.position(); },
      end: () => this.save(),
    });
    const observer = new ResizeObserver(() => this.position());
    observer.observe(container);
    observer.observe(panel);
    this.render();
  }

  get icon(): IconName { return this.options.icon; }
  get isOpen(): boolean { return this.settings.open; }
  get pinned(): boolean { return this.settings.pinned; }
  get isFront(): boolean { return this.settings.open && isFrontWindow(this.element); }

  onChange(listener: () => void): void { this.listeners.add(listener); }

  open(): void {
    if (!this.settings.open) {
      this.settings.open = true;
      this.render();
    }
    this.raise();
  }

  close(): void {
    if (!this.settings.open) return;
    this.settings.open = false;
    this.render();
  }

  setPinned(pinned: boolean): void {
    this.settings.pinned = pinned;
    this.render();
  }

  raise(): void {
    if (this.settings.open) raiseWindow(this.element);
  }

  private render(): void {
    const { id, title } = this.options;
    const name = title.toLowerCase();
    const wasHidden = this.element.hidden;
    this.element.hidden = !this.settings.open;
    this.body.hidden = this.settings.minimized;
    this.element.classList.toggle('minimized', this.settings.minimized);
    this.element.classList.toggle('pinned', this.settings.pinned);
    this.pin.setAttribute('aria-pressed', String(this.settings.pinned));
    this.pin.setAttribute('aria-label', `${this.settings.pinned ? 'Unpin' : 'Pin'} ${name} window`);
    this.pin.title = this.settings.pinned ? 'Pinned: stays open while you fly. Click to unpin' : 'Pin: keep open while you fly';
    this.minimize.textContent = this.settings.minimized ? '+' : '−';
    this.minimize.setAttribute('aria-label', `${this.settings.minimized ? 'Restore' : 'Minimize'} ${name} window`);
    this.minimize.setAttribute('aria-expanded', String(!this.settings.minimized));
    this.minimize.title = this.settings.minimized ? 'Restore window' : 'Minimize to title bar';
    if (this.settings.open && wasHidden) this.raise();
    this.position();
    this.save();
    for (const listener of this.listeners) listener();
    this.element.dispatchEvent(new CustomEvent('window-change', { bubbles: true, detail: { id } }));
  }

  private position(): void {
    const panel = this.element, container = this.options.container;
    if (panel.hidden) return;
    const width = container.clientWidth, height = container.clientHeight;
    panel.style.width = this.settings.width ? `${Math.min(this.settings.width, width - 2 * MARGIN)}px` : '';
    panel.style.height = this.settings.height && !this.settings.minimized ? `${Math.min(this.settings.height, height - 2 * MARGIN)}px` : '';
    if (this.settings.x === undefined || this.settings.y === undefined) {
      const place = this.options.place(container, panel);
      this.settings.x = place.x;
      this.settings.y = place.y;
    }
    this.settings.x = Math.max(MARGIN, Math.min(this.settings.x, width - panel.offsetWidth - MARGIN));
    this.settings.y = Math.max(MARGIN, Math.min(this.settings.y, height - panel.offsetHeight - MARGIN));
    panel.style.left = `${this.settings.x}px`;
    panel.style.top = `${this.settings.y}px`;
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_PREFIX + this.options.id, JSON.stringify(this.settings)); } catch { /* Layout lasts for this session. */ }
  }

  private attachDrag(handle: HTMLButtonElement): void {
    let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: this.settings.x ?? 0, top: this.settings.y ?? 0 };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      this.settings.x = drag.left + event.clientX - drag.x;
      this.settings.y = drag.top + event.clientY - drag.y;
      this.position();
    });
    const endDrag = (): void => { if (drag) { drag = undefined; this.save(); } };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', endDrag);
    handle.addEventListener('keydown', event => {
      const moves: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 8;
      this.settings.x = (this.settings.x ?? 0) + move[0] * step;
      this.settings.y = (this.settings.y ?? 0) + move[1] * step;
      this.position();
      this.save();
    });
  }
}
