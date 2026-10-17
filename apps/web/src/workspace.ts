import { element } from './ui';

export type Panel = 'setup' | 'data' | 'fleet' | 'multiplayer' | 'library' | 'tools';

const ESCAPE_TOGGLE_WAIT_MS = 300;

/** Keep flight in one full-bleed viewport; all settings and tools share one tabbed menu drawer. */
export class Workspace {
  private active: Panel | undefined;
  private lastPanel: Panel = 'setup';
  private lastEscapeToggleAt = -Infinity;
  private readonly drawer = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly content = document.createElement('div');
  private readonly menuButton = document.createElement('button');
  private readonly panels = new Map<Panel, HTMLElement>();
  private readonly titles = new Map<Panel, string>();

  constructor(
    private readonly release: () => void,
    private readonly onClose?: () => void,
  ) {
    const take = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
    const viewport = take('.viewport');
    const setup = take('.setup-card');
    const controls = take('.controls');
    const toolbar = take('.view-toolbar');
    const viewTitle = take('.view-title');
    const viewLabel = take('.view-label');
    const viewTime = take('.view-time');
    const connection = take('.connection');
    const telemetry = take('.telemetry');
    const terrainNotice = element('terrain-notice');

    // Minimal overlaid HUD in the full-bleed viewport
    const hudTopLeft = document.createElement('div');
    hudTopLeft.className = 'hud-top-left';
    this.menuButton.id = 'menu-toggle';
    this.menuButton.className = 'menu-toggle';
    this.menuButton.type = 'button';
    this.menuButton.title = 'Open menu (Esc)';
    this.menuButton.setAttribute('aria-label', 'Menu');
    this.menuButton.setAttribute('aria-controls', 'workspace-drawer');
    this.menuButton.setAttribute('aria-expanded', 'false');
    this.menuButton.setAttribute('aria-pressed', 'false');
    this.menuButton.innerHTML = '<span class="menu-icon" aria-hidden="true">☰</span><span>Menu</span><kbd>Esc</kbd>';
    this.menuButton.onclick = () => this.toggle(false);

    const hudStatus = document.createElement('div');
    hudStatus.className = 'hud-status';
    hudStatus.append(viewTitle, viewLabel);
    hudTopLeft.append(this.menuButton, hudStatus);

    viewTime.append(connection);
    viewport.append(hudTopLeft, terrainNotice, telemetry);

    controls.append(take('.instruments-card'));
    toolbar.classList.add('card');

    const groups: [Panel, string, HTMLElement[]][] = [
      ['setup', 'Flight & setup', [toolbar, setup, controls]],
      ['data', 'Flight data', [element('module-panels')]],
      ['fleet', 'Fleet', [take('.fleet-card')]],
      ['multiplayer', 'Multiplayer', [take('.multiplayer')]],
      ['library', 'Load game & plugins', [element('lab-manager')]],
      ['tools', 'Tools & manual', [take('.utility-grid'), take('.debug')]],
    ];
    const shortLabels: Record<Panel, string> = {
      setup: 'Setup',
      data: 'Data',
      fleet: 'Fleet',
      multiplayer: 'Online',
      library: 'Load Game',
      tools: 'Tools',
    };

    this.drawer.className = 'workspace-drawer';
    this.drawer.id = 'workspace-drawer';
    this.drawer.hidden = true;
    this.drawer.setAttribute('role', 'dialog');
    this.drawer.setAttribute('aria-modal', 'false');
    this.drawer.setAttribute('aria-labelledby', 'drawer-title');
    this.title.id = 'drawer-title';

    const heading = document.createElement('div');
    heading.className = 'drawer-heading';
    const topBar = document.createElement('div');
    topBar.className = 'drawer-top-bar';
    const brand = document.createElement('div');
    brand.className = 'drawer-brand';
    brand.append(take('header .wordmark'), element('active-game'), this.title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'drawer-close';
    close.textContent = 'Close ×';
    close.setAttribute('aria-label', 'Close panel');
    close.onclick = () => this.close(true, false);
    topBar.append(brand, close);

    const nav = take('.workspace-nav');
    nav.replaceChildren();

    for (const [id, title, nodes] of groups) {
      this.titles.set(id, title);
      const panel = document.createElement('div');
      panel.dataset.workspacePanel = id;
      panel.hidden = true;
      panel.append(...nodes);
      this.panels.set(id, panel);
      this.content.append(panel);

      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.workspace = id;
      const longSpan = document.createElement('span');
      longSpan.className = 'nav-long';
      longSpan.textContent = title;
      const shortSpan = document.createElement('span');
      shortSpan.className = 'nav-short';
      shortSpan.textContent = shortLabels[id];
      button.append(longSpan, shortSpan);
      button.setAttribute('aria-controls', this.drawer.id);
      button.setAttribute('aria-expanded', 'false');
      button.onclick = () => this.open(id);
      nav.append(button);
    }

    heading.append(topBar, nav);
    this.content.className = 'drawer-content';
    this.drawer.append(heading, this.content);
    document.body.append(this.drawer);

    document.querySelector('.workspace > aside')?.remove();
    document.querySelector('.intro')?.remove();
    document.querySelector('header')?.remove();
    document.querySelector('footer')?.remove();

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
    document.addEventListener('pointerdown', event => {
      if (event.target instanceof HTMLCanvasElement && event.target.id === 'flight-view') this.close(false, false);
    }, true);
    // Imports remain reviewable even when initiated through a hidden file input.
    document.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      if (input.id === 'universe-file') this.open('setup');
      if (['lab-file', 'module-file', 'code-module-file'].includes(input.id)) this.open('library');
      if (input.id === 'shader-file') this.open('tools');
      if (input.id === 'world-file') this.open('fleet');
    }, true);
    this.updateButtons();
  }

  get isOpen(): boolean {
    return this.active !== undefined;
  }

  toggle(fromEscape = false): void {
    if (this.active) this.close(true, fromEscape);
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

  open(panel: Panel = this.lastPanel): void {
    this.release();
    this.active = panel;
    this.lastPanel = panel;
    for (const [id, content] of this.panels) content.hidden = id !== panel;
    this.drawer.hidden = false;
    this.drawer.classList.toggle('wide', panel === 'library' || panel === 'tools');
    this.title.textContent = this.titles.get(panel) ?? '';
    this.updateButtons();
  }

  close(focus = false, fromEscape = false): void {
    const wasOpen = this.active !== undefined;
    this.active = undefined;
    this.drawer.hidden = true;
    this.updateButtons();
    if (focus) {
      const isOrbitActive = !document.getElementById('orbit-sandbox-workspace')?.hidden;
      if (isOrbitActive) {
        document.getElementById('orbit-canvas')?.focus({ preventScroll: true });
      } else {
        element('flight-view').focus({ preventScroll: true });
      }
    }
    if (wasOpen && !fromEscape) this.onClose?.();
  }

  private updateButtons(): void {
    const isOpen = this.active !== undefined;
    this.menuButton.setAttribute('aria-expanded', String(isOpen));
    this.menuButton.setAttribute('aria-pressed', String(isOpen));
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-workspace]')) {
      const active = button.dataset.workspace === (this.active ?? 'flight');
      button.setAttribute('aria-pressed', String(active));
      if (button.dataset.workspace !== 'flight') button.setAttribute('aria-expanded', String(active));
    }
  }
}
