import { element } from './ui';

type Panel = 'data' | 'fleet' | 'multiplayer' | 'library' | 'tools';

/** Keep flight in one viewport; secondary tools share one nonmodal drawer. */
export class Workspace {
  private active: Panel | undefined;
  private readonly drawer = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly content = document.createElement('div');
  private readonly panels = new Map<Panel, HTMLElement>();

  private readonly titles = new Map<Panel, string>();

  constructor(private readonly release: () => void) {
    const take = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
    const setup = take('.setup-card'), controls = take('.controls');
    element('flight-console').prepend(setup);
    element('flight-console').append(controls);
    controls.append(take('.instruments-card'));
    const groups: [Panel, string, string[]][] = [
      ['data', 'Flight data', ['.path-card', '#module-panels']],
      ['fleet', 'Fleet', ['.fleet-card']],
      ['multiplayer', 'Multiplayer', ['.multiplayer']],
      ['library', 'Games & plugins', ['#lab-manager']],
      ['tools', 'Tools & manual', ['.utility-grid', '.debug']],
    ];
    const shortLabels: Record<Panel, string> = {
      data: 'Data',
      fleet: 'Fleet',
      multiplayer: 'Online',
      library: 'Games',
      tools: 'Tools',
    };
    this.drawer.className = 'workspace-drawer';
    this.drawer.id = 'workspace-drawer';
    this.drawer.hidden = true;
    this.drawer.setAttribute('role', 'dialog');
    this.drawer.setAttribute('aria-modal', 'false');
    this.drawer.setAttribute('aria-labelledby', 'drawer-title');
    this.title.id = 'drawer-title';
    const heading = document.createElement('div'); heading.className = 'drawer-heading';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Close ×'; close.setAttribute('aria-label', 'Close panel');
    close.onclick = () => this.close(true);
    heading.append(this.title, close);
    this.content.className = 'drawer-content';
    this.drawer.append(heading, this.content);
    document.body.append(this.drawer);
    const nav = take('.workspace-nav'); nav.replaceChildren();
    const flight = document.createElement('button');
    flight.type = 'button'; flight.textContent = 'Flight'; flight.dataset.workspace = 'flight';
    flight.onclick = () => this.close(true); nav.append(flight);
    for (const [id, title, selectors] of groups) {
      this.titles.set(id, title);
      const panel = document.createElement('div');
      panel.dataset.workspacePanel = id; panel.hidden = true;
      panel.append(...selectors.map(take));
      this.panels.set(id, panel); this.content.append(panel);
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.workspace = id;
      const longSpan = document.createElement('span');
      longSpan.className = 'nav-long';
      longSpan.textContent = title;
      const shortSpan = document.createElement('span');
      shortSpan.className = 'nav-short';
      shortSpan.textContent = shortLabels[id];
      button.append(longSpan, shortSpan);
      button.setAttribute('aria-controls', this.drawer.id); button.setAttribute('aria-expanded', 'false');
      button.onclick = () => this.active === id ? this.close(true) : this.open(id);
      nav.append(button);
    }
    document.querySelector('.workspace > aside')?.remove();
    // Keep the game's identity visible without spending a second row on a page title.
    document.querySelector('header .wordmark')!.after(element('active-game'));
    document.querySelector('.intro')?.remove();
    document.querySelector('footer')?.remove();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.active) { event.preventDefault(); this.close(true); }
    });
    document.addEventListener('pointerdown', event => {
      if (event.target instanceof HTMLCanvasElement && event.target.id === 'flight-view') this.close();
    }, true);
    // Imports remain reviewable even when initiated through a hidden file input.
    document.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      if (['lab-file', 'module-file', 'code-module-file'].includes(input.id)) this.open('library');
      if (input.id === 'shader-file') this.open('tools');
      if (input.id === 'world-file') this.open('fleet');
    }, true);
    const measure = (): void => {
      const toolbar = take('.view-toolbar').getBoundingClientRect();
      const bottom = take('.telemetry').getBoundingClientRect();
      document.documentElement.style.setProperty('--drawer-top', `${toolbar.bottom + 6}px`);
      document.documentElement.style.setProperty('--drawer-bottom', `${innerHeight - bottom.top + 6}px`);
    };
    const observer = new ResizeObserver(measure);
    for (const node of [take('header'), setup, controls, take('.view-toolbar'), take('.flight-panel')]) observer.observe(node);
    window.addEventListener('resize', measure);
    measure();
  }

  open(panel: Panel): void {
    this.release();
    this.active = panel;
    for (const [id, content] of this.panels) content.hidden = id !== panel;
    this.drawer.hidden = false;
    this.drawer.classList.toggle('wide', panel === 'library' || panel === 'tools');
    this.title.textContent = this.titles.get(panel) ?? '';
    this.updateButtons();
  }

  private close(focus = false): void {
    this.active = undefined; this.drawer.hidden = true; this.updateButtons();
    if (focus) element('flight-view').focus({ preventScroll: true });
  }

  private updateButtons(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-workspace]')) {
      const active = button.dataset.workspace === (this.active ?? 'flight');
      button.setAttribute('aria-pressed', String(active));
      if (button.dataset.workspace !== 'flight') button.setAttribute('aria-expanded', String(active));
    }
  }
}
