/** Viewer-only visibility choices. The dock stays reachable; no preference enters world saves. */
const KEY = 'space-sim:hud-visibility:1';
const ITEMS = [
  ['status', 'Status', '.hud-top-left'], ['controls', 'Flight controls', '.hud-quickbar'],
  ['clock', 'Clock', '.view-time'], ['telemetry', 'Flight readings', '.telemetry'],
  ['message', 'Flight hints', '#flight-message'], ['terrain', 'Terrain notices', '#terrain-notice'],
  ['throw', 'Throw readings', '#flight-slingshot-hud'],
  ['players', 'Player readings', ''],
  ['chat', 'Chat', '#chat-overlay'], ['scale', 'Scale bar', ''], ['labels', 'Ship labels', ''],
] as const;
export type HudVisibilityId = typeof ITEMS[number][0] | 'profiler';

export class HudVisibility {
  private readonly choices: Partial<Record<HudVisibilityId, boolean>> = {};
  private readonly toggles: { input: HTMLInputElement; read: () => boolean; reset: () => void }[] = [];
  private readonly list = document.getElementById('hud-visibility')!;
  constructor(private readonly viewport: HTMLElement) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      for (const id of [...ITEMS.map(item => item[0]), 'profiler'] as HudVisibilityId[]) {
        if (typeof saved?.[id] === 'boolean') this.choices[id] = saved[id];
      }
    } catch { /* Defaults work without storage. */ }
    for (const [id, label] of ITEMS) this.bind(id, label, () => this.visible(id), value => this.set(id, value), () => this.set(id, true));
    const restore = document.createElement('button');
    restore.type = 'button'; restore.className = 'hud-visibility-restore';
    restore.textContent = 'Restore HUD visibility';
    restore.addEventListener('click', () => { for (const toggle of this.toggles) toggle.reset(); this.sync(); });
    this.list.after(restore);
    // Existing instrument, chat, touch and profiler controls remain the same sources of truth.
    document.addEventListener('click', event => {
      // Native activation changes checked before click, then dispatches change. Let its
      // own change handler save that choice before synchronizing from stored state.
      if (!(event.target instanceof HTMLInputElement && event.target.type === 'checkbox')) this.sync();
    });
    document.addEventListener('change', () => this.sync());
    document.addEventListener('hud-window-raise', () => this.sync());
    this.apply();
  }
  visible(id: HudVisibilityId): boolean { return this.choices[id] ?? id !== 'profiler'; }
  set(id: HudVisibilityId, visible: boolean): void {
    this.choices[id] = visible;
    try { localStorage.setItem(KEY, JSON.stringify(this.choices)); } catch { /* Session-only preferences. */ }
    this.apply(); this.sync();
  }
  private apply(): void {
    this.viewport.classList.toggle('hud-hide-players', !this.visible('players'));
    for (const [id, , selector] of ITEMS) {
      if (selector) this.viewport.querySelector(selector)?.classList.toggle('hud-hidden', !this.visible(id));
    }
    this.viewport.dispatchEvent(new Event('hud-layout-change'));
  }
  /** Bind existing optional tools without duplicating their native enabled/preferences state. */
  bind(id: string, label: string, read: () => boolean, write: (visible: boolean) => void, reset: () => void): void {
    const row = document.createElement('label'); row.className = 'hud-visibility-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = `hud-visible-${id}`;
    input.checked = read(); row.append(input, document.createTextNode(label)); this.list.append(row);
    this.toggles.push({ input, read, reset });
    input.addEventListener('change', () => { write(input.checked); this.sync(); });
  }
  private sync(): void { for (const toggle of this.toggles) toggle.input.checked = toggle.read(); }
}
