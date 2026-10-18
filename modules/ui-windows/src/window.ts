import type { Disposable, WindowChrome, WindowChromeOptions } from '@space-sim/game-api';
import { icon } from './icons';
import { legacyInteractions, type createInteractions } from './interactions';
const STORAGE_PREFIX = 'space-sim:flight-window:1:';
const MARGIN = 8;
interface WindowSettings { x?: number; y?: number; pinned: boolean; minimized: boolean; maximized?: boolean; open: boolean; width?: number; height?: number }

/** A translucent, draggable, resizable, pinnable and minimizable HUD window that remembers its layout. */
export class FloatingWindow implements WindowChrome {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  private readonly controller: AbortController;
  private readonly resources: Disposable[] = [];
  private disposed = false;
  private settings: WindowSettings;
  private readonly listeners = new Set<() => void>();
  private readonly pin: HTMLButtonElement;
  private readonly minimize: HTMLButtonElement;
  private readonly maximize: HTMLButtonElement;

  constructor(private readonly options: WindowChromeOptions, private readonly interactions: ReturnType<typeof createInteractions> = legacyInteractions) {
    if (typeof options.id !== 'string' || !options.id || options.id.length > 256 || typeof options.title !== 'string' || !options.title || options.title.length > 512) throw new Error('Invalid window identity/title');
    const document = options.container.ownerDocument;
    this.controller = new (document.defaultView?.AbortController ?? AbortController)();
    this.element = document.createElement('section'); this.body = document.createElement('div');
    try {
    const { id, title, container } = options;
    const name = title.toLowerCase();
    const panel = this.element;
    panel.id = `${id}-window`;
    panel.className = `flight-window ${options.className ?? ''}`.trim();
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', `${id}-window-title`);
    const header = document.createElement('div'); header.className = 'flight-window-header';
    const button = (kind: string, label: string): HTMLButtonElement => {
      const node = document.createElement('button'); node.type = 'button'; node.className = kind; node.setAttribute('aria-label',label); header.append(node); return node;
    };
    const drag = button('flight-window-drag',`Move ${name} window`); drag.title = 'Drag to move; arrow keys move the window';
    // Only these fixed, first-party vector paths use HTML. All module titles/IDs are DOM data.
    drag.innerHTML = icon(options.icon ?? 'manual');
    const titleNode = document.createElement('span'); titleNode.id = `${id}-window-title`; titleNode.textContent = title; drag.append(titleNode);
    this.pin = button('window-chrome window-pin',`Pin ${name} window`); this.pin.id = `${id}-pin`; this.pin.innerHTML = icon('pin'); this.pin.setAttribute('aria-pressed','false');
    this.minimize = button('window-chrome',`Minimize ${name} window`); this.minimize.id = `${id}-minimize`; this.minimize.setAttribute('aria-controls',`${id}-window-body`); this.minimize.setAttribute('aria-expanded','true'); this.minimize.textContent = '−';
    this.maximize = button('window-chrome',`Maximize ${name} window size`); this.maximize.id = `${id}-maximize`; this.maximize.setAttribute('aria-pressed','false'); this.maximize.textContent = '□';
    const close = button('window-chrome',`Close ${name} window`); close.id = `${id}-close`; close.dataset.windowClose = ''; close.title = 'Close window'; close.textContent = '×';
    panel.append(header);
    this.body.id = `${id}-window-body`;
    this.body.className = 'flight-window-body';
    panel.append(this.body);
    container.append(panel);
    const decoration = options.decorate?.(panel); if (decoration) this.resources.push(decoration);
    this.settings = { pinned: options.pinned ?? false, minimized: false, open: false };
    try {
      const stored = JSON.parse(options.storage?.getItem((options.storagePrefix ?? STORAGE_PREFIX) + id) ?? 'null') as Partial<WindowSettings> | null;
      if (stored) {
        const pinned = typeof stored.pinned === 'boolean' ? stored.pinned : this.settings.pinned;
        this.settings = {
          x: Number.isFinite(stored.x) ? stored.x : undefined,
          y: Number.isFinite(stored.y) ? stored.y : undefined,
          pinned,
          minimized: stored.minimized === true,
          maximized: stored.maximized === true,
          open: stored.open === true && pinned,
          width: Number.isFinite(stored.width) && stored.width! > 0 ? stored.width : undefined,
          height: Number.isFinite(stored.height) && stored.height! > 0 ? stored.height : undefined,
        };
      }
    } catch { /* Saved layout is optional. */ }

    const signal = this.controller.signal;
    panel.addEventListener('pointerdown', () => this.raise(), {signal});
    panel.addEventListener('focusin', () => this.raise(), {signal});
    close.addEventListener('click', () => {
      this.close();
      options.onCloseButton?.();
    }, {signal});
    this.pin.addEventListener('click', () => { this.settings.pinned = !this.settings.pinned; this.render(); }, {signal});
    this.minimize.addEventListener('click', () => { this.settings.minimized = !this.settings.minimized; this.render(); }, {signal});
    this.maximize.addEventListener('click', () => {
      // Keep the normal geometry untouched so restoring also works after a reload.
      if (!this.settings.maximized) {
        this.settings.width = panel.offsetWidth;
        if (!this.settings.minimized) this.settings.height = panel.offsetHeight;
      }
      this.settings.maximized = !this.settings.maximized;
      this.settings.minimized = false;
      this.raise();
      this.render();
    }, {signal});
    // Unpinned windows are temporary: they close when you return to the flight view.
    document.addEventListener('pointerdown', event => {
      if (!this.settings.pinned && options.dismissOn?.(event.target)) this.close();
    }, {capture:true, signal});
    this.attachDrag(drag);
    this.resources.push(this.interactions.resize(panel, container, name, {
      change: (width, height, x, y) => {
        this.settings.width = width; this.settings.height = height;
        this.settings.x = x; this.settings.y = y; this.position();
      },
      end: () => this.save(),
    }));
    const observer = new (document.defaultView?.ResizeObserver ?? ResizeObserver)(() => this.position());
    observer.observe(container);
    observer.observe(panel);
    this.resources.push({dispose: () => observer.disconnect()});
    document.addEventListener('hud-layout-reset', () => {
      this.settings.x = this.settings.y = this.settings.width = this.settings.height = undefined;
      this.settings.maximized = false;
      this.render();
    }, {signal});
    this.render();
    } catch (error) {
      this.controller.abort();
      for (const resource of this.resources.splice(0).reverse()) {try {resource.dispose();} catch { /* Preserve the constructor failure. */ }}
      this.interactions.release(this.element); this.element.remove(); throw error;
    }
  }

  get icon() { return this.options.icon ?? 'manual' as const; }
  get isOpen(): boolean { return !this.disposed && this.settings.open; }
  get pinned(): boolean { return this.settings.pinned; }
  get isFront(): boolean { return !this.disposed && this.settings.open && this.interactions.isFront(this.element); }

  onChange(listener: () => void): Disposable { if (!this.disposed) this.listeners.add(listener); return {dispose: () => {this.listeners.delete(listener);}}; }

  open(): void {
    if (this.disposed) return; this.options.releaseInput?.();
    if (!this.settings.open) {
      this.settings.open = true;
      this.render();
    }
    this.raise();
  }

  close(): void {
    if (this.disposed) return;
    if (!this.settings.open) return;
    this.settings.open = false;
    this.render();
  }

  setPinned(pinned: boolean): void {
    if (this.disposed) return;
    this.settings.pinned = pinned;
    this.render();
  }

  raise(): void {
    if (!this.disposed && this.settings.open) this.interactions.raise(this.element);
  }

  private render(): void {
    const { id, title } = this.options;
    const name = title.toLowerCase();
    const wasHidden = this.element.hidden;
    this.element.hidden = !this.settings.open;
    this.body.hidden = this.settings.minimized;
    this.element.classList.toggle('minimized', this.settings.minimized);
    this.element.classList.toggle('maximized', this.settings.maximized === true);
    this.element.classList.toggle('pinned', this.settings.pinned);
    this.pin.setAttribute('aria-pressed', String(this.settings.pinned));
    this.pin.setAttribute('aria-label', `${this.settings.pinned ? 'Unpin' : 'Pin'} ${name} window`);
    this.pin.title = this.settings.pinned ? 'Pinned: stays open while you fly. Click to unpin' : 'Pin: keep open while you fly';
    this.minimize.textContent = this.settings.minimized ? '+' : '−';
    this.minimize.setAttribute('aria-label', `${this.settings.minimized ? 'Restore' : 'Minimize'} ${name} window`);
    this.minimize.setAttribute('aria-expanded', String(!this.settings.minimized));
    this.minimize.title = this.settings.minimized ? 'Restore window' : 'Minimize to title bar';
    this.maximize.textContent = this.settings.maximized ? '❐' : '□';
    this.maximize.setAttribute('aria-pressed', String(this.settings.maximized === true));
    this.maximize.setAttribute('aria-label', `${this.settings.maximized ? 'Restore' : 'Maximize'} ${name} window size`);
    this.maximize.title = this.settings.maximized ? 'Restore previous size and position' : 'Maximize window';
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
    if (this.settings.maximized) {
      panel.style.width = `${Math.max(1, width - 2 * MARGIN)}px`;
      panel.style.height = this.settings.minimized ? '' : `${Math.max(1, height - 2 * MARGIN)}px`;
      panel.style.left = panel.style.top = `${MARGIN}px`;
      return;
    }
    panel.style.width = this.settings.width ? `${Math.max(1, Math.min(this.settings.width, width - 2 * MARGIN))}px` : '';
    panel.style.height = this.settings.height && !this.settings.minimized ? `${Math.max(1, Math.min(this.settings.height, height - 2 * MARGIN))}px` : '';
    if (this.settings.x === undefined || this.settings.y === undefined) {
      const place = this.options.place?.(container, panel) ?? {x:24,y:64};
      this.settings.x = place.x;
      this.settings.y = place.y;
    }
    this.settings.x = Math.max(MARGIN, Math.min(this.settings.x, width - panel.offsetWidth - MARGIN));
    this.settings.y = Math.max(MARGIN, Math.min(this.settings.y, height - panel.offsetHeight - MARGIN));
    panel.style.left = `${this.settings.x}px`;
    panel.style.top = `${this.settings.y}px`;
  }

  private save(): void {
    try { this.options.storage?.setItem((this.options.storagePrefix ?? STORAGE_PREFIX) + this.options.id, JSON.stringify(this.settings)); } catch { /* Layout lasts for this session. */ }
  }

  private attachDrag(handle: HTMLButtonElement): void {
    const signal = this.controller.signal;
    let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
    handle.addEventListener('pointerdown', event => {
      if (this.settings.maximized) return;
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: this.settings.x ?? 0, top: this.settings.y ?? 0 };
      handle.setPointerCapture(event.pointerId);
    }, {signal});
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      this.settings.x = drag.left + event.clientX - drag.x;
      this.settings.y = drag.top + event.clientY - drag.y;
      this.position();
    }, {signal});
    const endDrag = (): void => { if (drag) { drag = undefined; this.save(); } };
    handle.addEventListener('pointerup', endDrag, {signal});
    handle.addEventListener('pointercancel', endDrag, {signal});
    handle.addEventListener('lostpointercapture', endDrag, {signal});
    handle.addEventListener('keydown', event => {
      if (this.settings.maximized) return;
      const moves: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 8;
      this.settings.x = (this.settings.x ?? 0) + move[0] * step;
      this.settings.y = (this.settings.y ?? 0) + move[1] * step;
      this.position();
      this.save();
    }, {signal});
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.controller.abort();
    const errors: unknown[]=[];
    for (const resource of this.resources.splice(0).reverse()) {try {resource.dispose();} catch(error) {errors.push(error);}}
    this.listeners.clear(); this.interactions.release(this.element); this.element.remove();
    if (errors.length) throw new AggregateError(errors,'Window cleanup failed');
  }

}
