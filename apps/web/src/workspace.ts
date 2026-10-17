import { element } from './ui';
import { FloatingWindow } from './floating-window';
import { icon, type IconName } from './ui-icons';

export type Panel = 'setup' | 'ship' | 'fleet' | 'multiplayer' | 'data' | 'settings' | 'tools' | 'manual' | 'library';

const ESCAPE_TOGGLE_WAIT_MS = 300;

interface PanelSpec {
  readonly id: Panel;
  readonly title: string;
  readonly label: string;
  readonly icon: IconName;
  readonly hint: string;
  readonly sources: readonly string[];
}

/** Dock groups, top to bottom. Instrument windows join the second group as they are created. */
const GROUPS: readonly (readonly PanelSpec[])[] = [[
  { id: 'setup', title: 'Flight setup', label: 'Setup', icon: 'setup', hint: 'Universe, system, scenario and reset', sources: ['.setup-card'] },
  { id: 'ship', title: 'Ship controls', label: 'Ship', icon: 'ship', hint: 'Throttle, steering and engine', sources: ['.controls'] },
  { id: 'fleet', title: 'Fleet', label: 'Fleet', icon: 'fleet', hint: 'Ships in this world, saves', sources: ['.fleet-card'] },
  { id: 'multiplayer', title: 'Multiplayer', label: 'Online', icon: 'online', hint: 'Host or join a shared world', sources: ['.multiplayer'] },
], [
  { id: 'data', title: 'Instruments', label: 'Instruments', icon: 'instruments', hint: 'Choose what the flight view shows', sources: ['.instruments-card', '#module-panels'] },
], [
  { id: 'settings', title: 'Settings', label: 'Settings', icon: 'settings', hint: 'Display, controls, gameplay and diagnostics', sources: ['.settings-card'] },
  { id: 'tools', title: 'Tools', label: 'Tools', icon: 'tools', hint: 'Planet designer, shaders, stress test and diagnostics', sources: ['.utility-grid', '.debug'] },
  { id: 'manual', title: 'Manual', label: 'Manual', icon: 'manual', hint: 'How to play, and how to make your own content', sources: ['#game-manual'] },
  { id: 'library', title: 'Load game & plugins', label: 'Library', icon: 'library', hint: 'Games, plugins and universes', sources: ['#lab-manager'] },
]];

/**
 * Keeps flight in one full-bleed viewport. A dock along the right edge opens every section as its own
 * floating window. Unpinned windows behave like tabs (one at a time, closed by returning to the flight
 * view or Esc); pinned windows stay open while flying.
 */
export class Workspace {
  private lastPanel: Panel = 'setup';
  private lastEscapeToggleAt = -Infinity;
  private readonly dock = document.createElement('nav');
  private readonly instrumentGroup: HTMLElement;
  private readonly chatItem: HTMLElement | undefined;
  private readonly windows = new Map<Panel, FloatingWindow>();
  private readonly viewport: HTMLElement;

  constructor(
    private readonly release: () => void,
    private readonly onClose?: () => void,
  ) {
    this.viewport = document.querySelector<HTMLElement>('#flight-console .viewport')!;
    const layer = document.createElement('div');
    layer.id = 'window-layer';
    layer.className = 'window-layer';
    document.body.append(layer);

    this.dock.className = 'hud-dock';
    this.dock.setAttribute('aria-label', 'Windows');
    const groups = GROUPS.map(specs => {
      const group = document.createElement('div');
      group.className = 'dock-group';
      group.setAttribute('role', 'group');
      for (const spec of specs) group.append(this.createPanel(spec, spec.id === 'library' ? layer : this.viewport));
      this.dock.append(group);
      return group;
    });
    this.instrumentGroup = groups[1]!;
    // Chat keeps its own window; its toggle joins the dock beside the other instruments.
    const chat = document.getElementById('chat-toggle');
    if (chat) {
      chat.className = 'dock-item';
      chat.innerHTML = `${icon('chat')}<span>Chat</span>`;
      chat.setAttribute('aria-label', 'Chat');
      this.instrumentGroup.append(chat);
      this.chatItem = chat;
    }
    this.viewport.append(this.dock);
    document.querySelector('.workspace > aside')?.remove();

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      const controlsModal = document.getElementById('controls-dialog') as HTMLDialogElement | null;
      if (controlsModal?.open || (event.target instanceof Node && controlsModal?.contains(event.target))) return;
      event.preventDefault();
      const now = performance.now();
      if (now - this.lastEscapeToggleAt < ESCAPE_TOGGLE_WAIT_MS) return;
      this.lastEscapeToggleAt = now;
      this.toggle(true);
    });
    // Imports remain reviewable even when initiated through a hidden file input.
    document.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      if (input.id === 'universe-file') this.open('setup');
      if (['lab-file', 'module-file', 'code-module-file'].includes(input.id)) this.open('library');
      if (input.id === 'shader-file') this.open('tools');
      if (input.id === 'world-file') this.open('fleet');
    }, true);
  }

  /** Whether a temporary (unpinned) window is open; Esc closes these. */
  get isOpen(): boolean {
    for (const window of this.windows.values()) if (window.isOpen && !window.pinned) return true;
    return false;
  }

  /** Add an instrument window's toggle to the dock. */
  addInstrument(window: FloatingWindow, label: string, hint: string): void {
    const item = this.dockItem(window.element.id, label, window, hint, () => {
      if (window.isFront) window.close();
      else window.open();
    });
    this.instrumentGroup.insertBefore(item, this.chatItem ?? null);
    // Existing id kept for saved scripts and tests that open these windows.
    item.id = `${window.element.id.replace(/-window$/, '')}-toast`;
  }

  toggle(fromEscape = false): void {
    if (this.isOpen) this.close(true, fromEscape);
    else this.open(this.lastPanel);
  }

  /** When a browser (such as Firefox) intercepts Escape to exit DOM fullscreen, toggle the menu if keydown hasn't just toggled it. */
  handleFullscreenEscape(): void {
    const now = performance.now();
    if (now - this.lastEscapeToggleAt < ESCAPE_TOGGLE_WAIT_MS) return;
    const controlsModal = document.getElementById('controls-dialog') as HTMLDialogElement | null;
    if (controlsModal?.open) {
      this.lastEscapeToggleAt = now;
      controlsModal.close();
      return;
    }
    const themeModal = document.getElementById('theme-dialog') as HTMLDialogElement | null;
    if (themeModal?.open || themeModal?.classList.contains('visible')) {
      this.lastEscapeToggleAt = now;
      if (typeof themeModal.close === 'function') themeModal.close();
      else themeModal.removeAttribute('open');
      themeModal.classList.remove('visible');
      return;
    }
    this.lastEscapeToggleAt = now;
    this.toggle(true);
  }

  /** Open a section window, replacing any other temporary window. */
  open(panel: Panel = this.lastPanel): void {
    this.release();
    this.lastPanel = panel;
    for (const [id, window] of this.windows) if (id !== panel && !window.pinned) window.close();
    this.windows.get(panel)!.open();
  }

  /** Close temporary windows; pinned windows stay. */
  close(focus = false, fromEscape = false): void {
    let closed = false;
    for (const window of this.windows.values()) {
      if (!window.isOpen || window.pinned) continue;
      window.close();
      closed = true;
    }
    if (focus) this.focusView();
    if (closed && !fromEscape) this.onClose?.();
  }

  private createPanel(spec: PanelSpec, container: HTMLElement): HTMLElement {
    const window = new FloatingWindow({
      id: spec.id,
      title: spec.title,
      icon: spec.icon,
      container,
      className: `panel-window panel-${spec.id}`,
      place: (parent, panel) => spec.id === 'library'
        ? { x: (parent.clientWidth - panel.offsetWidth) / 2, y: Math.max(12, (parent.clientHeight - panel.offsetHeight) / 2) }
        : this.besideDock(parent, panel),
      onCloseButton: () => {
        this.focusView();
        if (![...this.windows.values()].some(other => other.isOpen)) this.onClose?.();
      },
    });
    window.body.dataset.workspacePanel = spec.id;
    for (const selector of spec.sources) window.body.append(document.querySelector<HTMLElement>(selector)!);
    this.windows.set(spec.id, window);
    return this.dockItem(`${spec.id}-window`, spec.label, window, spec.hint, () => {
      if (window.isFront) {
        window.close();
        if (!this.isOpen) this.onClose?.();
      } else this.open(spec.id);
    }, spec.id);
  }

  private dockItem(controls: string, label: string, window: FloatingWindow, hint: string, activate: () => void, panel?: Panel): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dock-item';
    if (panel) item.dataset.workspace = panel;
    item.title = `${label}: ${hint}`;
    item.setAttribute('aria-label', label);
    item.setAttribute('aria-controls', controls);
    item.innerHTML = `${icon(window.icon)}<span>${label}</span>`;
    item.addEventListener('click', activate);
    const sync = (): void => {
      item.setAttribute('aria-expanded', String(window.isOpen));
      item.classList.toggle('front', window.isFront);
    };
    window.onChange(sync);
    document.addEventListener('hud-window-raise', sync);
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

  private focusView(): void {
    const isOrbitActive = !document.getElementById('orbit-sandbox-workspace')?.hidden;
    if (isOrbitActive) document.getElementById('orbit-canvas')?.focus({ preventScroll: true });
    else element('flight-view').focus({ preventScroll: true });
  }
}
