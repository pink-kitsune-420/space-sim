import { createDockButton } from './dock';
export { createActionDock } from './dock';
export type { DockAction, ActionDock } from './dock';
import { WINDOW_SHELL, WINDOWS, type Disposable, type ModuleInitializationV2, type WindowChrome, type WindowShellOptions, type WindowPanelSpec, type WindowSystem, type WindowShellFactory } from '@space-sim/game-api';
const ESCAPE_TOGGLE_WAIT_MS = 300;
/**
 * Keeps flight in one full-bleed viewport. A dock along the right edge opens every section as its own
 * floating window. Unpinned windows behave like tabs (one at a time, closed by returning to the flight
 * view or Esc); pinned windows stay open while flying.
 */
export class Workspace {
  private readonly resources: Disposable[] = [];
  private readonly items = new Map<HTMLElement, Disposable>();
  private readonly controller: AbortController;
  private readonly layer: HTMLElement;
  private disposed = false;
  private get document(): Document { return this.options.viewport.ownerDocument; }
  private lastPanel: string;
  private lastEscapeToggleAt = -Infinity;
  private readonly dock: HTMLElement;
  private readonly instrumentGroup: HTMLElement;
  private readonly chatItem: HTMLElement | undefined;
  private readonly windows = new Map<string, WindowChrome>();
  private readonly viewport: HTMLElement;

  constructor(private readonly windowsService: Pick<WindowSystem, 'create' | 'icon'>, private readonly options: WindowShellOptions) {
    this.viewport = options.viewport;
    this.controller = new (this.document.defaultView?.AbortController ?? AbortController)();
    this.dock = this.document.createElement('nav');
    this.lastPanel = options.groups[0]?.[0]?.id ?? '';
    if(options.escapeToggleMs!==undefined&&(!Number.isFinite(options.escapeToggleMs)||options.escapeToggleMs<0||options.escapeToggleMs>1000))throw new Error('Escape interval must be in [0,1000] ms');
    const layer = this.document.createElement('div');
    layer.className = 'window-layer';
    (options.overlayRoot ?? this.viewport).append(layer); this.layer = layer;

    try {
    this.dock.className = 'hud-dock';
    this.dock.setAttribute('aria-label', 'Windows');
    const groups = options.groups.map(specs => {
      const group = this.document.createElement('div');
      group.className = 'dock-group';
      group.setAttribute('role', 'group');
      for (const spec of specs) group.append(this.createPanel(spec, spec.global ? layer : this.viewport));
      this.dock.append(group);
      return group;
    });
    this.instrumentGroup = groups[options.instrumentGroup ?? 1] ?? groups[0] ?? this.dock;
    // Chat keeps its own window; its toggle joins the dock beside the other instruments.
    const chat = options.instrumentToggle;
    if (chat) {
      const anchor = this.document.createComment('Dock toggle source'); chat.before(anchor);
      const previous = {className:chat.className,html:chat.innerHTML,label:chat.getAttribute('aria-label')};
      this.resources.push({dispose:()=>{anchor.replaceWith(chat);chat.className=previous.className;chat.innerHTML=previous.html;if(previous.label===null)chat.removeAttribute('aria-label');else chat.setAttribute('aria-label',previous.label);}});
      chat.className = 'dock-item';
      chat.innerHTML = `${this.windowsService.icon('chat')}<span>Chat</span>`;
      chat.setAttribute('aria-label', 'Chat');
      this.instrumentGroup.append(chat);
      this.chatItem = chat;
    }
    this.viewport.append(this.dock);


    this.document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      if (options.captureEscape?.(event)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - this.lastEscapeToggleAt < (this.options.escapeToggleMs ?? ESCAPE_TOGGLE_WAIT_MS)) return;
      this.lastEscapeToggleAt = now;
      this.toggle(true);
    }, {signal:this.controller.signal});
    // Imports remain reviewable even when initiated through a hidden file input.
    this.document.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      const panel = options.filePanel?.(input); if (panel) this.open(panel);
    }, {capture:true,signal:this.controller.signal});
    } catch(error) { try {this.dispose();} catch { /* Preserve constructor error. */ } throw error; }
  }

  /** Whether a temporary (unpinned) window is open; Esc closes these. */
  get isOpen(): boolean {
    for (const window of this.windows.values()) if (window.isOpen && !window.pinned) return true;
    return false;
  }

  /** Add an instrument window's toggle to the dock. */
  addInstrument(window: WindowChrome, label: string, hint: string): Disposable {
    if(this.disposed)throw new Error('Window shell disposed');
    const item = this.dockItem(window.element.id, label, window, hint, () => {
      if (window.isFront) window.close();
      else window.open();
    });
    this.instrumentGroup.insertBefore(item, this.chatItem ?? null);
    // Existing id kept for saved scripts and tests that open these windows.
    item.id = `${window.element.id.replace(/-window$/, '')}-toast`;
    return this.items.get(item)!;
  }

  toggle(fromEscape = false): void {
    if (this.isOpen) this.close(true, fromEscape);
    else this.open(this.lastPanel);
  }

  /** When a browser (such as Firefox) intercepts Escape to exit DOM fullscreen, toggle the menu if keydown hasn't just toggled it. */
  handleFullscreenEscape(): void {
    if(this.disposed)return;
    const now = performance.now();
    if (now - this.lastEscapeToggleAt < (this.options.escapeToggleMs ?? ESCAPE_TOGGLE_WAIT_MS)) return;
    if (this.options.dismissModal?.()) { this.lastEscapeToggleAt = now; return; }
    this.lastEscapeToggleAt = now;
    this.toggle(true);
  }

  /** Open a section window, replacing any other temporary window. */
  open(panel: string = this.lastPanel): void {
    if(this.disposed)return;
    const selected=this.windows.get(panel);if(!selected)throw new Error(`Unknown panel ${panel}`);
    this.options.release();
    this.lastPanel = panel;
    for (const [id, window] of this.windows) if (id !== panel && !window.pinned) window.close();
    selected.open();
  }

  /** Close temporary windows; pinned windows stay. */
  close(focus = false, fromEscape = false): void {
    if(this.disposed)return;
    let closed = false;
    for (const window of this.windows.values()) {
      if (!window.isOpen || window.pinned) continue;
      window.close();
      closed = true;
    }
    if (focus) this.options.focus();
    if (closed && !fromEscape) this.options.onClose?.();
  }

  private createPanel(spec: WindowPanelSpec, container: HTMLElement): HTMLElement {
    const window = this.windowsService.create({
      ...this.options.chrome,
      id: spec.id,
      title: spec.title,
      icon: spec.icon,
      container,
      className: `panel-window panel-${spec.id}`,
      place: (parent, panel) => spec.global
        ? { x: (parent.clientWidth - panel.offsetWidth) / 2, y: Math.max(12, (parent.clientHeight - panel.offsetHeight) / 2) }
        : this.besideDock(parent, panel),
      onCloseButton: () => {
        this.options.focus();
        if (![...this.windows.values()].some(other => other.isOpen)) this.options.onClose?.();
      },
    });
    this.windows.set(spec.id, window);
    window.body.dataset.workspacePanel = spec.id;
    for (const node of spec.content) {
      const anchor = this.document.createComment('Window content source'); node.before(anchor);
      this.resources.push({dispose:()=>anchor.replaceWith(node)}); window.body.append(node);
    }
    return this.dockItem(`${spec.id}-window`, spec.label, window, spec.hint, () => {
      if (window.isFront) {
        window.close();
        if (!this.isOpen) this.options.onClose?.();
      } else this.open(spec.id);
    }, spec.id);
  }

  private dockItem(controls: string, label: string, window: WindowChrome, hint: string, activate: () => void, panel?: string): HTMLButtonElement {
    const item = createDockButton(this.document, this.windowsService.icon(window.icon), label, hint, controls);
    if (panel) item.dataset.workspace = panel;
    const controller=new (this.document.defaultView?.AbortController ?? AbortController)();
    item.addEventListener('click', activate, {signal:controller.signal});
    const sync = (): void => {
      item.setAttribute('aria-expanded', String(window.isOpen));
      item.classList.toggle('front', window.isFront);
    };
    const subscription=window.onChange(sync);
    this.document.addEventListener('hud-window-raise', sync, {signal:controller.signal});
    let closed=false;this.items.set(item,{dispose:()=>{if(closed)return;closed=true;controller.abort();subscription.dispose();item.remove();this.items.delete(item);}});
    sync();
    return item;
  }

  /** Temporary windows open beside the dock (or below it, when it runs along the top on phones). */
  private besideDock(parent: HTMLElement, panel: HTMLElement): { x: number; y: number } {
    const dock = this.dock.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
    if (dock.width === 0) return { x: parent.clientWidth - panel.offsetWidth - 8, y: 64 };
    if (dock.width > dock.height) return { x: (parent.clientWidth - panel.offsetWidth) / 2, y: dock.bottom - bounds.top + 8 };
    return { x: dock.left - bounds.left - 10 - panel.offsetWidth, y: dock.top - bounds.top };
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.controller.abort();
    const errors: unknown[] = [];
    for (const resource of this.resources.splice(0).reverse()) {try {resource.dispose();} catch(error) {errors.push(error);}}
    for (const item of this.items.values()) {try {item.dispose();} catch(error) {errors.push(error);}}
    for (const window of this.windows.values()) {try {window.dispose();} catch(error) {errors.push(error);}}
    this.windows.clear(); this.dock.remove(); this.layer.remove();
    if (errors.length) throw new AggregateError(errors,'Window shell cleanup failed');
  }
}
export function createWindowShells(windows: Pick<WindowSystem,'create' | 'icon'>, css = '', defaults: Pick<WindowShellOptions,'escapeToggleMs'> = {}): WindowShellFactory {
  const shells = new Set<Workspace>(), styles = new Map<Document,HTMLStyleElement>(); let disposed = false;
  return Object.freeze<WindowShellFactory>({
    create(options) {
      if(disposed) throw new Error('Window shell provider disposed');
      const document=options.viewport.ownerDocument;
      if(css&&!styles.has(document)){const style=document.createElement('style');style.textContent=css;document.head.append(style);styles.set(document,style);}
      const shell=new Workspace(windows,{...defaults,...options}),close=shell.dispose.bind(shell); let closed=false;
      shell.dispose=()=>{if(closed)return;closed=true;shells.delete(shell);close();};shells.add(shell);return shell;
    },
    dispose() {if(disposed)return;disposed=true;const errors:unknown[]=[];for(const shell of shells){try{shell.dispose();}catch(error){errors.push(error);}}for(const style of styles.values())style.remove();styles.clear();if(errors.length)throw new AggregateError(errors,'Shell provider cleanup failed');}
  });
}
/**
 * Contributes the optional grouped window shell and dock.
 * Provides ui.shell@1.0.0 in slot ui.shell.
 * Requires ui.windows@^1.0.0.
 * Setting escapeToggleMs (default 300 ms) is the minimum wall time between Escape/fullscreen toggles.
 */
export default function initialize(context:ModuleInitializationV2):void {
 context.contributeGuide({id:'usage',audience:'creators',title:'Window shell and dock',summary:'Optional grouped dock and window lifecycle.',asset:'docs/creators/usage.json'});
 context.provide(WINDOW_SHELL,context.own(createWindowShells(context.use(WINDOWS),context.assets.text('assets/shell.css'),{escapeToggleMs:context.settings.escapeToggleMs??300})));
}
