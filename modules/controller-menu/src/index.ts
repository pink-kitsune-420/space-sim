import { CONTROLLER_MENU_STYLE } from './style';
import { CONTROLLER_MENUS, FLIGHT_ACTIONS, FLIGHT_PROFILES, GAMEPAD_INPUT, LOCAL_PILOTS,
  type FlightActionId as ActionId, type ControllerFamily, type ControllerProfile, type GamepadDiagnostic, type FlightGamepad,
  type InputDevice, type LocalPlayersConfig, type TwoPlayerLayout, type ScreenMode, type NavballAnchor,
  type ControllerMenuOptions, type ControllerMenuServices, type ModuleInitializationV2 } from '@space-sim/game-api';
import { PLAYERS_CONTENT, GAMEPAD_CONTENT } from './template';
/** Actions a controller can hold or press, in menu order. */
const PAD_ACTIONS: readonly ActionId[] = ['engine', 'throttleUp', 'throttleDown', 'throttleFine', 'throttleCut', 'throttleRecall', 'throttleRemember', 'turnLeft', 'turnRight', 'throwShip', 'warpUp', 'warpDown',
  'warpReset', 'pause', 'reset', 'camera', 'orientation', 'zoomIn', 'zoomOut', 'cycleShip', 'cycleShipPrev', 'cyclePlanet', 'cyclePlanetPrev'];
const MAX_BUTTONS = 4;

function axisLabel(i: number): string {
  return `Axis ${i}${i === 0 ? ' (Left Stick X)' : i === 1 ? ' (Left Stick Y)' : i === 2 ? ' (Right Stick X)' : i === 3 ? ' (Right Stick Y)' : ''}`;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** The Players (split screen) and Controllers tabs of the controls dialog. */
export class ControllerMenu {
  private disposed = false;
  private standalone = false;
  private readonly style: HTMLStyleElement;
  private readonly removals: (() => void)[] = [];
  private readonly root: HTMLElement;
  private readonly split: ControllerMenuOptions['split'];
  private readonly pads: FlightGamepad | undefined;
  private readonly pilotName: () => string;
  private readonly isOpen: () => boolean;
  /** The player whose controller the Controllers tab edits. */
  private player = 0;
  private raf: number | undefined;
  private capture: { readonly kind: 'button'; readonly action: ActionId } | { readonly kind: 'device'; readonly slot: number } | undefined;
  private shownPads = '';
  private readonly note: HTMLElement;

  constructor(options: ControllerMenuOptions, private readonly services: ControllerMenuServices) {
    this.root = options.root; this.split = options.split; this.pads = options.gamepads;
    this.pilotName = () => options.pilotName(); this.isOpen = () => options.isOpen();
    if (!this.root.querySelector('#tab-players') || !this.root.querySelector('#tab-gamepad')) {
      this.standalone = true;
      this.root.innerHTML = '<button type="button" id="tab-gamepad-btn">Controllers</button><section id="tab-players"></section><section id="tab-gamepad"></section>';
      this.root.querySelector('#tab-gamepad-btn')!.addEventListener('click', () => this.open());
    }
    this.style = document.createElement('style'); this.style.textContent = CONTROLLER_MENU_STYLE; this.root.append(this.style);
    this.element('tab-players').innerHTML = PLAYERS_CONTENT;
    this.element('tab-gamepad').innerHTML = GAMEPAD_CONTENT;
    this.note = this.element('split-players-note');
    this.element('split-layout').addEventListener('change', event => {
      this.change({ ...this.config, twoPlayerLayout: (event.target as HTMLSelectElement).value as TwoPlayerLayout });
    });
    this.element('split-screen-mode').addEventListener('change', event => {
      this.change({ ...this.config, screenMode: (event.target as HTMLSelectElement).value as ScreenMode });
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.split-count [data-count]')) {
      button.addEventListener('click', () => this.change(this.services.preferences.setPlayerCount(this.config, Number(button.dataset.count))));
    }
    this.element('split-navball-pin-all')?.addEventListener('click', () => {
      this.change(this.services.preferences.setAllNavballsPinned(this.config, true));
    });
    this.element('split-navball-unpin-all')?.addEventListener('click', () => {
      this.change(this.services.preferences.setAllNavballsPinned(this.config, false));
    });
    this.element('pad-player').addEventListener('change', event => {
      this.player = Number((event.target as HTMLSelectElement).value);
      this.cancelCapture();
      this.renderPad();
    });
    this.element<HTMLInputElement>('gamepad-enabled').addEventListener('change', event => {
      this.pads?.setEnabled((event.target as HTMLInputElement).checked);
    });
    this.element<HTMLInputElement>('gamepad-deadzone').addEventListener('input', event => {
      const value = Number((event.target as HTMLInputElement).value);
      this.element('deadzone-value').textContent = `${value}%`;
      this.setProfile({ deadzone: value / 100 });
    });
    for (const select of this.root.querySelectorAll<HTMLSelectElement>('#tab-gamepad select[data-axis]')) {
      select.addEventListener('change', () => this.setProfile({ [select.dataset.axis!]: Number(select.value) }));
    }
    for (const box of this.root.querySelectorAll<HTMLInputElement>('#tab-gamepad input[data-invert]')) {
      box.addEventListener('change', () => this.setProfile({ [box.dataset.invert!]: box.checked }));
    }
    this.element('reset-gamepad').addEventListener('click', () => {
      this.change(this.services.preferences.updateSlot(this.config, this.player, { profile: this.services.profiles.defaultProfile }));
      this.renderPad();
    });
    const escape = (event: KeyboardEvent): void => {
      if (this.capture && event.code === 'Escape' && this.isOpen()) {
        event.preventDefault();
        event.stopPropagation();
        this.cancelCapture();
      }
    };
    window.addEventListener('keydown', escape, true);
    this.removals.push(() => window.removeEventListener('keydown', escape, true));
  }

  private element<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Controller menu is missing ${id}`); return element;
  }
  private liveInstance(): void { if (this.disposed) throw new Error('Controller menu is disposed'); }
  private get config(): LocalPlayersConfig { return this.split.config; }
  private change(next: LocalPlayersConfig): void {
    this.liveInstance();
    this.split.setConfig(next);
    this.renderPlayers();
  }
  private get profile(): ControllerProfile { return this.config.slots[this.player]!.profile; }
  private setProfile(change: Partial<ControllerProfile>): void {
    this.split.setConfig(this.services.preferences.updateSlot(this.config, this.player, { profile: { ...this.profile, ...change } }));
  }

  /** Open on a tab: re-render both and start the live view. */
  open(): void {
    this.liveInstance();
    this.player = Math.min(this.player, this.config.count - 1);
    this.renderPlayers();
    this.renderPad();
    if (this.raf === undefined) {
      const tick = (): void => {
        if (this.disposed || !this.isOpen()) { this.raf = undefined; this.cancelCapture(); return; }
        this.live();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  private cancelCapture(): void {
    if (!this.capture) return;
    this.capture = undefined;
    this.pads?.captureNextButton(undefined);
    this.renderPlayers();
    this.renderBindings();
  }

  private connected(): GamepadDiagnostic[] { return this.pads?.getDiagnostics() ?? []; }

  private deviceName(device: InputDevice, pads: readonly GamepadDiagnostic[]): string {
    if (device === 'auto') return 'Keyboard, mouse, touch + any free controller';
    if (device === 'keyboard') return 'Keyboard';
    if (device === 'none') return 'Nothing yet';
    const index = this.services.preferences.deviceIndex(device)!;
    const pad = pads.find(p => p.index === index);
    return `Controller ${index + 1}${pad ? ` · ${pad.familyName}` : ' · not connected'}`;
  }

  renderPlayers(): void {
    this.liveInstance();
    const config = this.config, pads = this.connected(), singleView = this.split.singleView === true;
    const count = singleView ? 1 : config.count;
    this.player = Math.min(this.player, count - 1);
    this.shownPads = pads.map(p => p.index).join(',');
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.split-count [data-count]')) {
      const on = Number(button.dataset.count) === count;
      button.disabled = singleView;
      button.classList.toggle('active', on);
      button.setAttribute('aria-checked', String(on));
    }
    this.element<HTMLSelectElement>('split-layout').value = config.twoPlayerLayout;
    this.element<HTMLSelectElement>('split-screen-mode').value = config.screenMode;
    this.element<HTMLSelectElement>('split-layout').disabled = singleView;
    this.element<HTMLSelectElement>('split-screen-mode').disabled = singleView;
    const list = this.element('split-players');
    list.innerHTML = '';
    for (let slot = 0; slot < count; slot++) {
      const s = config.slots[slot]!;
      const row = document.createElement('div');
      row.className = 'split-player';
      row.style.setProperty('--player-color', this.services.preferences.colors[slot]!);
      const options: InputDevice[] = [...(slot === 0 ? ['auto' as const] : ['none' as const]), 'keyboard',
        ...new Set([...pads.map(p => this.services.preferences.padDevice(p.index)), ...(this.services.preferences.deviceIndex(s.device) !== undefined ? [s.device] : [])])];
      const capturing = this.capture?.kind === 'device' && this.capture.slot === slot;
      row.innerHTML = `<span class="split-player-badge">P${slot + 1}</span>
        ${slot === 0 ? `<span class="split-player-name" title="Player 1 uses the pilot name">${escapeHtml(this.pilotName())}</span>`
          : `<input class="split-player-name" type="text" maxlength="24" aria-label="Player ${slot + 1} name" value="${escapeHtml(s.name)}" />`}
        <select aria-label="Player ${slot + 1} input">${options.map(d => `<option value="${d}"${d === s.device ? ' selected' : ''}>${escapeHtml(this.deviceName(d, pads))}</option>`).join('')}</select>
        <button type="button" class="split-assign${capturing ? ' listening' : ''}"${this.pads ? '' : ' disabled'}>${capturing ? 'Press a button…' : 'Press to assign'}</button>
        <button type="button" class="split-configure" title="Controller layout for this player">Buttons…</button>
        <div class="split-player-navball">
          <label>Navball:</label>
          <select class="split-navball-pos" aria-label="Player ${slot + 1} navball location">
            <option value="bottom-right"${s.navball.anchor === 'bottom-right' ? ' selected' : ''}>Bottom-Right</option>
            <option value="bottom-left"${s.navball.anchor === 'bottom-left' ? ' selected' : ''}>Bottom-Left</option>
            <option value="top-left"${s.navball.anchor === 'top-left' ? ' selected' : ''}>Top-Left</option>
            <option value="top-right"${s.navball.anchor === 'top-right' ? ' selected' : ''}>Top-Right</option>
            <option value="center-bottom"${s.navball.anchor === 'center-bottom' ? ' selected' : ''}>Center-Bottom</option>
            <option value="custom"${s.navball.anchor === 'custom' ? ' selected' : ''}>Custom (Dragged)</option>
          </select>
          <button type="button" class="split-navball-pin-btn${s.navball.pinned ? '' : ' unpinned'}" title="Toggle pin / allow dragging">${s.navball.pinned ? '📌 Pinned' : '🔓 Unpinned'}</button>
        </div>
        <span class="split-activity" aria-hidden="true"></span>`;
      const name = row.querySelector<HTMLInputElement>('input.split-player-name');
      name?.addEventListener('change', () => this.change(this.services.preferences.updateSlot(this.config, slot, { name: name.value.trim().slice(0, 24) })));
      row.querySelector('select')!.addEventListener('change', event => {
        this.change(this.services.preferences.assignDevice(this.config, slot, (event.target as HTMLSelectElement).value as InputDevice));
      });
      const navSelect = row.querySelector<HTMLSelectElement>('.split-navball-pos');
      navSelect?.addEventListener('change', () => {
        this.change(this.services.preferences.setSlotNavball(this.config, slot, { anchor: navSelect.value as NavballAnchor }));
      });
      const pinBtn = row.querySelector<HTMLButtonElement>('.split-navball-pin-btn');
      pinBtn?.addEventListener('click', () => {
        this.change(this.services.preferences.setSlotNavball(this.config, slot, { pinned: !s.navball.pinned }));
      });
      row.querySelector('.split-assign')!.addEventListener('click', () => {
        if (!this.pads) return;
        if (capturing) { this.cancelCapture(); return; }
        this.capture = { kind: 'device', slot };
        this.pads?.captureNextButton(pad => {
          this.capture = undefined;
          this.change(this.services.preferences.assignDevice(this.config, slot, this.services.preferences.padDevice(pad)));
          this.note.textContent = `Controller ${pad + 1} now flies for player ${slot + 1}.`;
        });
        this.renderPlayers();
      });
      row.querySelector('.split-configure')!.addEventListener('click', () => {
        this.player = slot;
        this.element('tab-gamepad-btn').click();
      });
      list.append(row);
    }
    if (!this.capture) {
      this.note.textContent = singleView ? 'One local view is available with this game and renderer. Your split-view settings are saved for when multiple views are available.'
        : !this.pads ? 'Gamepad support is not enabled. Keyboard-controlled players and saved profiles remain available.'
        : pads.length ? `${pads.length} controller${pads.length === 1 ? '' : 's'} connected.`
        : 'No controllers detected yet: connect one and press any button.';
    }
    const select = this.element<HTMLSelectElement>('pad-player');
    select.innerHTML = config.slots.slice(0, count)
      .map((s, i) => `<option value="${i}">Player ${i + 1} · ${escapeHtml(i === 0 ? this.pilotName() : s.name || `Pilot ${i + 1}`)}</option>`).join('');
    select.value = String(this.player);
  }

  /** The pad this player is using now, for labels and the live view. */
  private padFor(slot: number, pads: readonly GamepadDiagnostic[]): GamepadDiagnostic | undefined {
    const connected = pads.map(p => p.index);
    return pads.find(p => this.services.preferences.padOwner(this.config, p.index, connected) === slot);
  }

  renderPad(): void {
    this.liveInstance();
    const profile = this.profile, pads = this.connected();
    this.element<HTMLInputElement>('gamepad-enabled').checked = this.pads?.enabled ?? false;
    this.element<HTMLInputElement>('gamepad-enabled').disabled = !this.pads;
    this.element<HTMLInputElement>('gamepad-deadzone').value = String(Math.round(profile.deadzone * 100));
    this.element('deadzone-value').textContent = `${Math.round(profile.deadzone * 100)}%`;
    const axes = Math.max(4, this.padFor(this.player, pads)?.axes.length ?? 0);
    for (const select of this.root.querySelectorAll<HTMLSelectElement>('#tab-gamepad select[data-axis]')) {
      const key = select.dataset.axis as 'turnAxis' | 'throttleAxis' | 'zoomAxis';
      const none = key === 'zoomAxis' ? '<option value="-1">None</option>' : '';
      select.innerHTML = none + Array.from({ length: axes }, (_, i) => `<option value="${i}">${axisLabel(i)}</option>`).join('');
      select.value = String(profile[key]);
    }
    for (const box of this.root.querySelectorAll<HTMLInputElement>('#tab-gamepad input[data-invert]')) {
      box.checked = profile[box.dataset.invert as 'invertTurn' | 'invertThrottle' | 'invertZoom'];
    }
    this.renderBindings();
  }

  private renderBindings(): void {
    const profile = this.profile;
    const family: ControllerFamily = this.padFor(this.player, this.connected())?.family ?? 'xbox';
    const list = this.element('pad-bindings');
    list.innerHTML = '';
    for (const action of PAD_ACTIONS) {
      const def = { name: this.services.actions.label(action) };
      const row = document.createElement('div');
      row.className = 'key-action-row';
      const buttons = profile.buttons[action];
      const capturing = this.capture?.kind === 'button' && this.capture.action === action;
      row.innerHTML = `<div class="key-action-info"><span class="key-action-name">${escapeHtml(def.name)}</span></div><div class="key-badges-cell"></div>`;
      const chips = row.querySelector('.key-badges-cell')!;
      for (const b of buttons) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'key-chip';
        chip.textContent = this.services.formatButton(b, family);
        chip.title = `Remove button ${b} from ${def.name}`;
        chip.addEventListener('click', () => {
          this.setProfile({ buttons: { ...profile.buttons, [action]: buttons.filter(x => x !== b) } });
          this.renderBindings();
        });
        chips.append(chip);
      }
      if (buttons.length < MAX_BUTTONS) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = `add-key-btn${capturing ? ' listening' : ''}`;
        add.textContent = capturing ? 'Press a button…' : '+';
        add.title = `Add a controller button for ${def.name}`;
        add.disabled = !this.pads;
        add.addEventListener('click', () => {
          if (!this.pads) return;
          if (capturing) { this.cancelCapture(); return; }
          this.capture = { kind: 'button', action };
          this.pads?.captureNextButton((_pad, button) => {
            this.capture = undefined;
            const current = this.profile.buttons[action];
            if (!current.includes(button)) this.setProfile({ buttons: { ...this.profile.buttons, [action]: [...current, button] } });
            this.renderBindings();
          });
          this.renderBindings();
        });
        chips.append(add);
      }
      list.append(row);
    }
  }

  /** Connection banner, activity lights and the selected player's live axes and buttons. */
  private live(): void {
    const pads = this.connected();
    if (pads.map(p => p.index).join(',') !== this.shownPads && !this.capture) this.renderPlayers();
    const now = performance.now(), connected = pads.map(p => p.index);
    const rows = this.element('split-players').children;
    for (let slot = 0; slot < rows.length; slot++) {
      const busy = pads.some(p => this.services.preferences.padOwner(this.config, p.index, connected) === slot && now - (this.pads?.activity.get(p.index) ?? -Infinity) < 150);
      rows[slot]?.querySelector('.split-activity')?.classList.toggle('on', busy);
    }
    const status = this.element('gamepad-status');
    const pad = this.padFor(this.player, pads);
    if (!pad) {
      const device = this.config.slots[this.player]!.device;
      status.textContent = !this.pads ? 'Gamepad support is not enabled in this game. Saved controller profiles remain editable.'
        : device === 'keyboard' ? `Player ${this.player + 1} flies with the keyboard. Their layout below applies if you give them a controller.`
        : pads.length ? `No controller is assigned to player ${this.player + 1}. Assign one on the Players tab.`
          : 'No controller detected. Connect a Steam Deck, Xbox, PlayStation (DualSense / DualShock), or joystick and press any button.';
      status.classList.remove('connected');
      this.element('gamepad-axes-display').innerHTML = '';
      this.element('gamepad-buttons-display').innerHTML = '';
      return;
    }
    const text = `Controller ${pad.index + 1}: ${pad.id} · ${pad.familyName} (${pad.axes.length} axes, ${pad.buttons.length} buttons)`;
    if (status.textContent !== text) {
      status.innerHTML = `Controller ${pad.index + 1}: <b>${escapeHtml(pad.id)}</b> <span class="gamepad-family-tag ${pad.family}">${escapeHtml(pad.familyName)}</span> (${pad.axes.length} axes, ${pad.buttons.length} buttons)`;
      status.classList.add('connected');
    }
    this.element('gamepad-axes-display').innerHTML = pad.axes.map((val, i) => {
      const clamped = Math.max(-1, Math.min(1, val));
      const width = Math.abs(clamped) * 50, left = clamped < 0 ? 50 - width : 50;
      return `<div class="axis-meter"><span class="axis-meter-label">Axis ${i}</span><div class="axis-meter-track"><div class="axis-meter-center"></div><div class="axis-meter-fill" style="left:${left}%;width:${width}%"></div></div><span class="axis-meter-val">${clamped >= 0 ? '+' : ''}${clamped.toFixed(2)}</span></div>`;
    }).join('');
    this.element('gamepad-buttons-display').innerHTML = pad.buttons
      .map((b, i) => `<span class="btn-indicator ${b.pressed ? 'pressed' : ''}" title="Button ${i}: ${escapeHtml(b.label)}">${escapeHtml(b.label.slice(0, 3))}</span>`).join('');
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    const errors: unknown[] = [];
    const close = (action: () => void): void => { try { action(); } catch (error) { errors.push(error); } };
    close(() => { if (this.raf !== undefined) cancelAnimationFrame(this.raf); }); this.raf = undefined;
    this.capture = undefined; close(() => this.pads?.captureNextButton(undefined));
    for (const remove of this.removals) close(remove); this.removals.length = 0;
    close(() => this.style.remove());
    if (this.standalone) close(() => { this.root.innerHTML = ''; });
    else {
      close(() => { this.element('tab-players').innerHTML = ''; });
      close(() => { this.element('tab-gamepad').innerHTML = ''; });
    }
    if (errors.length) throw new AggregateError(errors, 'Controller menu cleanup failed');
  }

}

export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({"id": "usage", "audience": "creators", "title": "Controller menu", "summary": "Editable local-player and controller settings UI.", "asset": "docs/creators/usage.json"});
  const gamepad = context.tryUse(GAMEPAD_INPUT);
  const services: ControllerMenuServices = { preferences: context.use(LOCAL_PILOTS).preferences(), profiles: context.use(FLIGHT_PROFILES),
    actions: context.use(FLIGHT_ACTIONS), formatButton: (index, family) => gamepad?.formatButton(index, family) ?? `Button ${index}` };
  const menus = new Set<ControllerMenu>(); let disposed = false;
  context.own({ dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const menu of menus) { try { menu.dispose(); } catch (error) { errors.push(error); } }
    menus.clear(); if (errors.length) throw new AggregateError(errors, 'Controller menu provider cleanup failed'); } });
  context.provide(CONTROLLER_MENUS, Object.freeze({ create(options: ControllerMenuOptions) {
    if (disposed) throw new Error('Controller menu provider is disposed');
    const ownedPads = options.gamepads ? undefined : gamepad?.createFlight();
    let menu: ControllerMenu;
    try { menu = new ControllerMenu({ ...options, gamepads: options.gamepads ?? ownedPads }, services); }
    catch (error) { ownedPads?.dispose(); throw error; }
    const dispose = menu.dispose.bind(menu); let closed = false;
    menu.dispose = () => {
      if (closed) return; closed = true;
      const errors: unknown[] = [];
      try { dispose(); } catch (error) { errors.push(error); }
      try { ownedPads?.dispose(); } catch (error) { errors.push(error); }
      menus.delete(menu);
      if (errors.length) throw new AggregateError(errors, 'Controller menu resources cleanup failed');
    }; menus.add(menu); return menu;
  } }));
}
