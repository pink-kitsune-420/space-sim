import { FLIGHT_SPLIT_STYLE } from './style';
import { FLEET_VIEWS, FLIGHT_CAMERAS, FLIGHT_PROFILES, FLIGHT_SPLIT, LOCAL_PILOTS, LOCAL_VIEWS, PREDICTIONS, GAMEPAD_INPUT,
  type Controls, type ResolvedBody, type State, type Renderer, type RendererProvider, type ShaderPack, type Vec, type Ship,
  type FlightActionId as ActionId, type FlightCameraController, type FlightPrediction, type FlightFleetView,
  type SessionRead, type FlightLocalSession, type FlightGuestPilot, type FlightSplitScreen, type FlightSplitScreenHost,
  type FlightSplitServices, type LocalPlayersConfig, type ModuleInitializationV2 } from '@space-sim/game-api';
const EMPTY_PADS: number[] = [];
const IDLE: Controls = Object.freeze({ turn: 0, throttle: 0, engine: false });
/** Actions that change the shared world clock or the whole screen; any player may use them. */
const SHARED_ACTIONS = new Set<ActionId>(['warpUp', 'warpDown', 'warpReset', 'pause', 'fullscreen', 'profiler']);
/** Start / Menu / Options on the standard mapping: an unclaimed controller joins with it. */
const JOIN_BUTTON = 9;
function closeAll(tasks: readonly (() => void)[], message: string): void {
  const errors: unknown[] = [];
  for (const close of tasks) { try { close(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, message);
}

/** Pilot state and view for one split-screen guest (players 2 to 4). Player 1 is the
 * console's own pilot. */
export class GuestPilot implements FlightGuestPilot {
  readonly camera: FlightCameraController;
  readonly prediction: FlightPrediction;
  readonly fleetView: FlightFleetView;
  readonly pane = document.createElement('div');
  canvas = document.createElement('canvas');
  playerId: string | undefined;
  shipId: string | undefined;
  body: ResolvedBody | undefined;
  state: State | undefined;
  view: State | undefined;
  controls: Controls = IDLE;
  renderer: Renderer | undefined;
  provider: RendererProvider | undefined;
  shaders: ShaderPack | undefined;
  /** Why this pilot cannot fly, shown on their pane. */
  problem = '';
  private spawnTried = false;
  private disposed = false;
  private readonly events = new AbortController();

  onPointerDown?: (event: PointerEvent) => boolean;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;

  constructor(readonly slot: number, private readonly services: FlightSplitServices,
    private readonly isSessionError: (error: unknown) => error is Error,
    private readonly releaseTarget: (guest: FlightGuestPilot) => void, private readonly isSlotThrowing?: (slot: number) => boolean) {
    this.camera = services.cameras.create();
    let prediction: FlightPrediction | undefined;
    try { this.prediction = prediction = services.predictions.create(() => {}); this.fleetView = services.fleets.create(); }
    catch (error) {
      try { closeAll([() => prediction?.dispose(), () => this.camera.dispose()], 'Partial guest cleanup failed'); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Guest creation and cleanup failed'); }
      throw error;
    }
    this.prediction.maxMs = services.tuning?.guestPredictionMs ?? 1.5;
    this.pane.className = 'split-pane';
    this.pane.dataset.slot = String(slot);
    this.pane.style.setProperty('--player-color', this.services.preferences.colors[slot]!);
    this.canvas.setAttribute('aria-label', `Player ${slot + 1} flight view`);
    this.pane.append(this.canvas);
    this.camera.horizon = true;
    this.pane.addEventListener('wheel', event => {
      event.preventDefault();
      this.camera.changeZoom(Math.exp(-event.deltaY * (services.tuning?.wheelZoom ?? 0.0015)));
    }, { passive: false, signal: this.events.signal });

    let dragStart: { x: number; y: number } | undefined;
    let isThrowing = false;
    this.pane.addEventListener('pointerdown', event => {
      if (this.onPointerDown?.(event) || this.isSlotThrowing?.(this.slot)) {
        isThrowing = true;
        dragStart = undefined;
        return;
      }
      isThrowing = false;
      dragStart = { x: event.clientX, y: event.clientY };
      try { this.pane.setPointerCapture(event.pointerId); } catch {}
    }, { signal: this.events.signal });
    this.pane.addEventListener('pointermove', event => {
      if (isThrowing || this.isSlotThrowing?.(this.slot)) {
        this.onPointerMove?.(event);
        return;
      }
      if (!dragStart) return;
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      dragStart = { x: event.clientX, y: event.clientY };
      if (this.view) {
        this.camera.drag({ x: dx, y: dy }, { x: 0, y: 0 }, this.view.position, this.canvas.clientWidth, this.canvas.clientHeight);
      }
    }, { signal: this.events.signal });
    const stopDrag = (event: PointerEvent): void => {
      if (isThrowing) {
        isThrowing = false;
        this.onPointerUp?.(event);
        return;
      }
      if (!dragStart) return;
      dragStart = undefined;
      try { this.pane.releasePointerCapture(event.pointerId); } catch {}
    };
    this.pane.addEventListener('pointerup', stopDrag, { signal: this.events.signal });
    this.pane.addEventListener('pointercancel', stopDrag, { signal: this.events.signal });
  }

  ship(session: SessionRead): Ship | undefined {
    return this.shipId ? session.world.ship(this.shipId) : undefined;
  }

  /** Pick an owned ship, launching one when the seat has none. */
  ensureShip(local: FlightLocalSession, presetId: string, godMode = false): void {
    if (!this.playerId) return;
    const record = this.shipId ? local.world.record(this.shipId) : undefined;
    if (record?.ownerId === this.playerId) return;
    const owned = [...local.world.ownedBy(this.playerId)].filter(id => local.world.record(id));
    if (owned.length) { this.select(owned[0]); return; }
    if (this.spawnTried) return;
    this.spawnTried = true;
    try {
      this.select(local.spawnGuest(this.playerId, local.world.presetId(presetId), godMode));
      this.problem = '';
      this.camera.followShip();
      this.camera.zoom = 10;
    } catch (error) {
      if (!this.isSessionError(error)) throw error;
      this.problem = error.message;
    }
  }

  select(shipId: string | undefined): void {
    if (this.shipId !== shipId) { this.releaseTarget(this); this.controls = IDLE; }
    this.shipId = shipId;
    this.body = undefined;
    this.prediction.invalidate();
    this.camera.recenter();
  }

  /** Allow another launch attempt (after the world was reset or room was made). */
  retrySpawn(): void { this.spawnTried = false; }

  /** Follow the ship's latest state and its sphere of influence. */
  refresh(session: SessionRead): void {
    const ship = this.ship(session);
    if (!ship) { this.state = undefined; return; }
    const world = session.world;
    if (this.body && ship.bodyId !== this.body.id && world.hasBody(this.body.id)) {
      const time = ship.state.time;
      this.camera.rebase(world.system.getBodyPosition(this.body.id, time), world.system.getBodyPosition(ship.bodyId, time));
      this.prediction.invalidate();
    }
    this.body = world.body(ship.bodyId);
    this.state = ship.state;
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    const renderer = this.renderer;
    this.renderer = undefined;
    this.onPointerDown = undefined; this.onPointerMove = undefined; this.onPointerUp = undefined;
    closeAll([() => this.events.abort(), () => this.releaseTarget(this), () => renderer?.dispose?.(), () => this.prediction.dispose(),
      () => this.camera.dispose(), () => this.fleetView.dispose(), () => this.pane.remove()], 'Guest cleanup failed');
  }
}

/** Up to four pilots on one screen. Player 1 keeps the console's canvas, HUD and windows;
 * players 2 to 4 are local seats in this browser's world, each with a pane of their own. */
export class SplitScreen implements FlightSplitScreen {
  config: LocalPlayersConfig;
  readonly guests = new Map<number, GuestPilot>();
  readonly separatedGuests = new Set<number>();
  private readonly candidateSeparation = new Map<number, boolean>();
  private readonly lastSeparationChange = new Map<number, number>();
  private readonly tags: HTMLElement[] = [];
  private readonly layer = document.createElement('div');
  private seated: FlightLocalSession | undefined;
  private suspendedNotice = false;
  private dirty = true;
  private readonly observer: ResizeObserver;
  private readonly style: HTMLStyleElement;
  private disposed = false;

  constructor(private readonly viewport: HTMLElement, private readonly host: FlightSplitScreenHost, private readonly services: FlightSplitServices) {
    if (!host.primaryCanvas()) throw new Error('Flight split screen requires the primary renderer canvas');
    host.primaryCanvas().setAttribute('data-local-primary', ''); viewport.setAttribute('data-flight-split', '');
    this.config = this.services.preferences.loadLocalPlayers(this.services.profiles.legacy());
    this.style = document.createElement('style'); this.style.textContent = FLIGHT_SPLIT_STYLE; viewport.append(this.style);
    this.layer.className = 'split-layer';
    for (let slot = 0; slot < this.services.preferences.colors.length; slot++) {
      const tag = document.createElement('div');
      tag.className = 'split-tag';
      tag.style.setProperty('--player-color', this.services.preferences.colors[slot]!);
      tag.hidden = true;
      tag.innerHTML = '<b></b><span class="split-status"></span><span class="split-stats"></span>';
      this.tags.push(tag);
      this.layer.append(tag);
    }
    viewport.append(this.layer);
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(viewport);
  }

  /** Players actually on screen: the configured count while this browser's world is played. */
  get active(): number { return this.host.ownWorld() ? this.config.count : 1; }
  get split(): boolean { return this.active > 1; }

  isSeparated(slot: number): boolean {
    if (slot === 0) return true;
    if (slot >= this.active) return false;
    if (this.config.screenMode === 'split') return true;
    return this.separatedGuests.has(slot);
  }

  setConfig(next: LocalPlayersConfig): void {
    const local = this.host.ownWorld();
    const pads = this.connectedPads();
    for (const pad of pads) {
      const before = this.services.preferences.padOwner(this.config, pad, pads);
      const after = this.services.preferences.padOwner(next, pad, pads);
      if (before !== after || before !== undefined && this.config.slots[before]?.profile !== next.slots[before]?.profile)
        this.host.gamepads?.release(pad);
    }
    for (let slot = 0; slot < this.config.count; slot++) {
      if (slot < next.count && this.config.slots[slot]?.device === next.slots[slot]?.device) continue;
      this.host.releaseInput?.(slot); this.host.releaseFlight?.(slot);
      const guest = this.guests.get(slot);
      if (guest) {
        guest.controls = IDLE;
        if (guest.playerId && guest.shipId) local?.guestControls(guest.playerId, guest.shipId, IDLE);
      }
    }
    const prevMode = this.config.screenMode;
    this.config = next;
    this.services.preferences.saveLocalPlayers(next);
    if (next.screenMode === 'split' && prevMode !== 'split') {
      for (let s = 1; s < this.active; s++) this.separatedGuests.add(s);
    }
    this.dirty = true;
    this.host.changed();
  }

  private captureId: number | undefined;
  private connectedPads(): number[] { return this.host.gamepads?.connected(this.captureId) ?? EMPTY_PADS; }

  /** Player 1's controllers, for the console's own flight input. */
  padsOf(slot: number): number[] {
    const connected = this.connectedPads();
    return connected.filter(i => this.services.preferences.padOwner(this.activeConfig, i, connected) === slot);
  }
  get keyboardSlot(): number | undefined { return this.services.preferences.keyboardOwner(this.activeConfig); }
  /** In someone else's game only player 1 plays. */
  private get activeConfig(): LocalPlayersConfig {
    return this.active === this.config.count ? this.config : { ...this.config, count: 1 };
  }

  /** Read every controller once per frame and route presses to their players. Runs while
   * paused, so Start can resume. */
  pollPads(captureId?: number): void {
    this.captureId = captureId;
    const connected = this.connectedPads();
    const config = this.activeConfig;
    this.host.gamepads?.update(
      pad => { const slot = this.services.preferences.padOwner(config, pad, connected); return slot === undefined ? undefined : config.slots[slot]!.profile; },
      (pad, action) => {
        // The cursor owns the held throw gesture; it must not toggle mouse throw mode.
        if (this.host.inputEnabled?.() === false || action === 'throwShip') return;
        const slot = this.services.preferences.padOwner(config, pad, connected) ?? 0;
        if (action === 'throttleRecall' && (this.host.consumesPad?.(slot, pad) || this.host.isSlotThrowing?.(slot))) return;
        this.action(slot, action);
      },
      (pad, button) => {
        if (this.host.inputEnabled?.() === false) return;
        if (button !== (this.services.tuning?.joinButton ?? JOIN_BUTTON) || !this.split || this.services.preferences.padOwner(config, pad, connected) !== undefined) return;
        this.join(pad);
      }, captureId);
  }

  /** An unclaimed controller takes the first free seat (Start in split screen, or from the menu). */
  join(pad: number): boolean {
    if (!this.host.ownWorld()) { this.host.notify('Split screen works in your own world (solo or hosting).'); return false; }
    let config = this.config;
    const existing = config.slots.findIndex((s, i) => i < config.count && s.device === this.services.preferences.padDevice(pad));
    if (existing >= 0) return true;
    // Reuse an active seat with no device before adding one.
    let slot = config.slots.findIndex((s, i) => i > 0 && i < config.count && s.device === 'none');
    if (slot < 0) {
      if (config.count >= config.slots.length) { this.host.notify('All four seats are taken.'); return false; }
      slot = config.count;
      config = this.services.preferences.setPlayerCount(config, config.count + 1);
    }
    this.setConfig(this.services.preferences.assignDevice(config, slot, this.services.preferences.padDevice(pad)));
    this.host.notify(`Player ${slot + 1} joined on controller ${pad + 1}.`);
    return true;
  }

  /** Run `action` for the player in `slot`. Shared actions and player 1's go to the console. */
  action(slot: number, action: ActionId): void {
    if (this.host.isSlotThrowing?.(slot)) {
      const cameraAlteringActions = new Set<ActionId>([
        'camera', 'cameraRotateLeft', 'cameraRotateRight', 'orientation', 'cycleShip', 'cycleShipPrev', 'cyclePlanet', 'cyclePlanetPrev', 'zoomIn', 'zoomOut',
      ]);
      if (cameraAlteringActions.has(action)) return;
    }
    if (action === 'throttleCut' || action === 'throttleRecall' || action === 'throttleRemember') { this.host.throttleAction?.(slot, action); return; }
    const guest = this.guests.get(slot);
    if (slot === 0 || SHARED_ACTIONS.has(action) || !guest) { this.host.execute(action); return; }
    const session = this.host.session();
    switch (action) {
      case 'camera': guest.camera.cycle([], guest.body?.radius); break;
      case 'cameraRotateLeft': case 'cameraRotateRight': {
        const rotation = (guest.camera.manualRotation ?? guest.camera.rotation) + (action === 'cameraRotateLeft' ? -15 : 15) * Math.PI / 180;
        guest.camera.manualRotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
        break;
      }
      case 'orientation':
        guest.camera.horizon = guest.camera.manualRotation !== undefined || !guest.camera.horizon;
        guest.camera.manualRotation = undefined;
        break;
      case 'zoomIn': guest.camera.changeZoom(1.3); break;
      case 'zoomOut': guest.camera.changeZoom(1 / 1.3); break;
      case 'cycleShip': case 'cycleShipPrev': {
        if (!guest.playerId) break;
        const own = [...session.world.ownedBy(guest.playerId)].filter(id => session.world.record(id));
        const step = action === 'cycleShip' ? 1 : -1;
        if (own.length >= 2) {
          guest.select(own[(own.indexOf(guest.shipId ?? '') + step + own.length) % own.length]);
        } else {
          const bodies = session.world.system.getAllBodies();
          if (bodies.length === 0) break;
          const currentTargetId = guest.camera.focusTarget?.kind === 'body' ? guest.camera.focusTarget.id : (guest.body?.id ?? bodies[0]!.id);
          const currentIndex = bodies.findIndex(b => b.id === currentTargetId);
          const nextIndex = (currentIndex + step + bodies.length) % bodies.length;
          const nextBody = bodies[nextIndex]!;
          guest.camera.planetView(nextBody.radius);
          guest.camera.focusTarget = { kind: 'body', id: nextBody.id, name: nextBody.name };
          guest.camera.mode = 'free';
          guest.camera.dragged = false;
          guest.camera.rotation = 0;
        }
        break;
      }
      case 'cyclePlanet': case 'cyclePlanetPrev': {
        const bodies = session.world.system.getAllBodies();
        if (bodies.length === 0) break;
        const step = action === 'cyclePlanet' ? 1 : -1;
        const currentTargetId = guest.camera.focusTarget?.kind === 'body' ? guest.camera.focusTarget.id : (guest.body?.id ?? bodies[0]!.id);
        const currentIndex = bodies.findIndex(b => b.id === currentTargetId);
        const nextIndex = (currentIndex + step + bodies.length) % bodies.length;
        const nextBody = bodies[nextIndex]!;
        guest.camera.planetView(nextBody.radius);
        guest.camera.focusTarget = { kind: 'body', id: nextBody.id, name: nextBody.name };
        guest.camera.mode = 'free';
        guest.camera.dragged = false;
        guest.camera.rotation = 0;
        break;
      }
      case 'reset': {
        const local = this.host.ownWorld();
        if (!local || !guest.playerId) break;
        this.host.releaseFlight?.(slot);
        const isGod = this.host.isGodMode();
        try {
          if (guest.shipId && local.world.record(guest.shipId)) local.respawnGuest(guest.playerId, guest.shipId, local.world.presetId(this.host.presetId()), isGod);
          else { guest.retrySpawn(); guest.ensureShip(local, this.host.presetId(), isGod); }
          guest.prediction.invalidate();
          guest.camera.followShip();
        } catch (error) {
          if (!this.host.isSessionError(error)) throw error;
          guest.problem = error.message;
        }
        break;
      }
      default: break;
    }
  }

  /** Seat, unseat and lay out players to match the configuration and the current world. */
  sync(): void {
    const local = this.host.ownWorld();
    if (local !== this.seated) {
      // A new world (or none): old seats went with the old one.
      for (const guest of this.guests.values()) {
        if (guest.playerId) this.seated?.unseatGuest(guest.playerId);
        guest.dispose();
      }
      this.guests.clear();
      this.separatedGuests.clear();
      this.candidateSeparation.clear();
      this.lastSeparationChange.clear();
      this.seated = local;
      this.dirty = true;
      if (!local && this.config.count > 1 && !this.suspendedNotice) {
        this.suspendedNotice = true;
        this.host.notify('Split screen is paused in someone else\'s game; it returns in your own world.');
      }
      if (local) this.suspendedNotice = false;
    }
    const isGod = this.host.isGodMode();
    if (!this.dirty) {
      if (local) for (const guest of this.guests.values()) guest.ensureShip(local, this.host.presetId(), isGod);
      return;
    }
    this.dirty = false;
    const count = this.active;
    for (const [slot, guest] of this.guests) {
      if (slot < count) continue;
      if (local && guest.playerId) local.unseatGuest(guest.playerId);
      guest.dispose();
      this.guests.delete(slot);
      this.separatedGuests.delete(slot);
      this.candidateSeparation.delete(slot);
      this.lastSeparationChange.delete(slot);
    }
    if (local) {
      for (let slot = 1; slot < count; slot++) {
        let guest = this.guests.get(slot);
        if (!guest) {
          const newGuest = new GuestPilot(slot, this.services, error => this.host.isSessionError(error), guest => {
            for (const pad of this.padsOf(slot)) this.host.gamepads?.release(pad);
            this.host.releaseInput?.(slot); this.host.releaseFlight?.(slot);
            if (guest.playerId && guest.shipId) local.guestControls(guest.playerId, guest.shipId, IDLE);
          }, s => this.host.isSlotThrowing?.(s) ?? false);
          newGuest.onPointerDown = e => this.host.onGuestPointer?.(newGuest, 'down', e) ?? false;
          newGuest.onPointerMove = e => this.host.onGuestPointer?.(newGuest, 'move', e);
          newGuest.onPointerUp = e => this.host.onGuestPointer?.(newGuest, 'up', e);
          guest = newGuest;
          this.guests.set(slot, guest);
          this.host.primaryCanvas().after(guest.pane);
        }
        const config = this.config.slots[slot]!;
        try {
          guest.playerId = local.seatGuest(config.name || `Pilot ${slot + 1}`, config.token);
          guest.problem = '';
        } catch (error) {
          if (!this.host.isSessionError(error)) throw error;
          guest.playerId = undefined;
          guest.problem = error.message;
        }
        guest.retrySpawn();
        guest.ensureShip(local, this.host.presetId(), isGod);
      }
    }
    this.layout();
  }

  /** Every new world starts its guests over at the selected scenario. */
  resetGuests(): void {
    this.separatedGuests.clear();
    this.candidateSeparation.clear();
    this.lastSeparationChange.clear();
    for (const guest of this.guests.values()) guest.retrySpawn();
  }

  layout(): void {
    if (this.disposed) return;
    this.host.primaryCanvas().setAttribute('data-local-primary', '');
    const count = this.active;
    const { rects, visible } = this.config.screenMode === 'dynamic'
      ? this.services.layouts.dynamicPaneRects(count, this.separatedGuests, this.config.twoPlayerLayout, this.viewport.clientWidth, this.viewport.clientHeight)
      : { rects: this.services.layouts.paneRects(count, this.config.twoPlayerLayout, this.viewport.clientWidth, this.viewport.clientHeight), visible: new Array(count).fill(true) };

    const pct = (v: number): string => `${(v * 100).toFixed(4)}%`;
    this.viewport.toggleAttribute('data-split', count > 1);
    const p1 = rects[0]!;
    this.viewport.style.setProperty('--p1-x', pct(p1.x));
    this.viewport.style.setProperty('--p1-y', pct(p1.y));
    this.viewport.style.setProperty('--p1-w', pct(p1.w));
    this.viewport.style.setProperty('--p1-h', pct(p1.h));
    for (const [slot, guest] of this.guests) {
      const r = rects[slot];
      if (!r) continue;
      const isVis = visible[slot] ?? false;
      Object.assign(guest.pane.style, {
        left: pct(r.x),
        top: pct(r.y),
        width: pct(r.w),
        height: pct(r.h),
        opacity: isVis ? '1' : '0',
        pointerEvents: isVis ? 'auto' : 'none',
      });
    }

    const sharedSlots: number[] = [0];
    for (let slot = 1; slot < count; slot++) {
      if (!visible[slot]) sharedSlots.push(slot);
    }

    this.tags.forEach((tag, slot) => {
      if (count < 2 || slot >= count) {
        tag.hidden = true;
        return;
      }
      tag.hidden = false;
      const r = rects[slot];
      if (visible[slot] && r && (slot === 0 || r.w > 0)) {
        Object.assign(tag.style, { left: pct(r.x + r.w / 2), top: pct(r.y + r.h) });
      } else {
        const sharedIndex = sharedSlots.indexOf(slot);
        if (sharedIndex >= 0) {
          const frac = (sharedIndex + 0.5) / sharedSlots.length;
          Object.assign(tag.style, { left: pct(p1.x + p1.w * frac), top: pct(p1.y + p1.h) });
        }
      }
    });
  }

  /** Dynamic viewport manager: checks camera modes, SOI, and distance hysteresis to pack
   * screens together or split into independent panes. Returns centroid and zoom multiplier
   * when players share Pane 0. */
  updateDynamic(
    p1View: State | undefined,
    p1Body: ResolvedBody | undefined,
    p1Camera: FlightCameraController,
    width: number,
    height: number,
    now = performance.now(),
  ): { centroid?: Vec; zoomScale?: number } {
    if (!this.split) {
      this.separatedGuests.clear();
      this.candidateSeparation.clear();
      this.lastSeparationChange.clear();
      return {};
    }

    if (this.host.isSlotThrowing?.(0) || Array.from(this.guests.keys()).some(s => this.host.isSlotThrowing?.(s))) {
      return {};
    }

    if (this.config.screenMode === 'split') {
      let layoutChanged = false;
      for (let slot = 1; slot < this.active; slot++) {
        if (!this.separatedGuests.has(slot)) {
          this.separatedGuests.add(slot);
          layoutChanged = true;
        }
      }
      this.candidateSeparation.clear();
      this.lastSeparationChange.clear();
      if (layoutChanged) this.layout();
      return {};
    }

    const minDim = Math.min(width, height);
    const p1Scale = p1Camera.scale(width, height);
    const p1MapActive = p1Camera.mode !== 'follow' || p1Camera.dragged || !!p1Camera.focusTarget;
    let layoutChanged = false;

    for (let slot = 1; slot < this.active; slot++) {
      const guest = this.guests.get(slot);
      let immediateSplit = false;

      if (!guest || !guest.view || !guest.body || !p1View || !p1Body) {
        immediateSplit = true;
      } else if (guest.body.id !== p1Body.id) {
        immediateSplit = true;
      } else if (p1MapActive) {
        immediateSplit = true;
      } else if (guest.camera.mode !== 'follow' || guest.camera.dragged || !!guest.camera.focusTarget) {
        immediateSplit = true;
      } else {
        const dx = guest.view.position.x - p1View.position.x;
        const dy = guest.view.position.y - p1View.position.y;
        const worldDist = Math.hypot(dx, dy);
        const pxDist = worldDist * p1Scale;
        if (pxDist > (this.services.tuning?.separateScreenRatio ?? .55) * minDim || worldDist > (this.services.tuning?.separateDistance ?? 5000)) {
          immediateSplit = true;
        }
      }

      const currentlySeparated = this.separatedGuests.has(slot);

      if (immediateSplit) {
        this.candidateSeparation.delete(slot);
        this.lastSeparationChange.delete(slot);
        if (!currentlySeparated) {
          this.separatedGuests.add(slot);
          layoutChanged = true;
        }
      } else {
        const dx = guest!.view!.position.x - p1View!.position.x;
        const dy = guest!.view!.position.y - p1View!.position.y;
        const worldDist = Math.hypot(dx, dy);
        const pxDist = worldDist * p1Scale;
        const canMerge = pxDist < (this.services.tuning?.mergeScreenRatio ?? .35) * minDim && worldDist < (this.services.tuning?.mergeDistance ?? 3500);

        if (currentlySeparated) {
          if (canMerge) {
            const candidate = this.candidateSeparation.get(slot);
            const since = this.lastSeparationChange.get(slot) ?? now;
            if (candidate !== false) {
              this.candidateSeparation.set(slot, false);
              this.lastSeparationChange.set(slot, now);
            } else if (now - since >= (this.services.tuning?.mergeDelayMs ?? 600)) {
              this.separatedGuests.delete(slot);
              this.candidateSeparation.delete(slot);
              this.lastSeparationChange.delete(slot);
              layoutChanged = true;
            }
          } else {
            this.candidateSeparation.delete(slot);
            this.lastSeparationChange.delete(slot);
          }
        } else {
          this.candidateSeparation.delete(slot);
          this.lastSeparationChange.delete(slot);
        }
      }
    }

    if (layoutChanged) {
      this.layout();
    }

    if (p1MapActive || !p1View) {
      return {};
    }

    const sharedPositions: Vec[] = [p1View.position];
    for (let slot = 1; slot < this.active; slot++) {
      if (!this.separatedGuests.has(slot)) {
        const guest = this.guests.get(slot);
        if (guest?.view && guest.body?.id === p1Body?.id) {
          sharedPositions.push(guest.view.position);
        }
      }
    }

    if (sharedPositions.length <= 1) {
      return {};
    }

    let sumX = 0, sumY = 0;
    for (const pos of sharedPositions) {
      sumX += pos.x;
      sumY += pos.y;
    }
    const centroid: Vec = { x: sumX / sharedPositions.length, y: sumY / sharedPositions.length };

    let maxDist = 0;
    for (const pos of sharedPositions) {
      const d = Math.hypot(pos.x - centroid.x, pos.y - centroid.y);
      if (d > maxDist) maxDist = d;
    }
    const span = maxDist * 2;
    let zoomScale = 1;
    if (span > 0 && p1Scale > 0) {
      const spanPx = span * p1Scale;
      if (spanPx > minDim * 0.40) {
        zoomScale = Math.max(0.35, Math.min(1.0, (minDim * 0.40) / spanPx));
      }
    }

    return { centroid, zoomScale };
  }

  /** Held controls for every guest, before the world steps. */
  applyInput(elapsed: number): void {
    const local = this.host.ownWorld();
    if (!local) return;
    const keyboard = this.keyboardSlot;
    const connected = this.connectedPads();
    for (const [slot, guest] of this.guests) {
      if (!guest.playerId || !guest.shipId) continue;
      if (this.host.inputEnabled?.() === false) {
        guest.controls = IDLE;
        local.guestControls(guest.playerId, guest.shipId, IDLE);
        continue;
      }
      const device = this.config.slots[slot]!.device;
      let controls: Controls = IDLE;
      if (keyboard === slot) controls = this.host.keyboardFlight();
      const pad = this.services.preferences.deviceIndex(device);
      if (this.host.gamepads && pad !== undefined && connected.includes(pad) && !this.host.consumesPad?.(slot, pad)) {
        const input = this.host.gamepads.flight(pad);
        controls = { turn: input.turn || controls.turn, throttle: input.throttle || controls.throttle, engine: input.engine || controls.engine };
        const isSlotThrowing = this.host.isSlotThrowing?.(slot) ?? false;
        if (input.zoom && !isSlotThrowing) guest.camera.changeZoom(Math.exp(input.zoom * 2.2 * elapsed));
      }
      guest.controls = local.paused ? IDLE : this.host.resolveFlight?.(slot, controls, elapsed) ?? controls;
      local.guestControls(guest.playerId, guest.shipId, guest.controls);
    }
  }

  /** Name tags with each player's status, at most a few times a second. */
  updateTags(player1: { readonly name: string; readonly text: string; readonly status: string }, describe: (guest: FlightGuestPilot) => { status: string; text: string }): void {
    if (!this.split) return;
    const connected = this.connectedPads();
    this.tags.forEach((tag, slot) => {
      if (tag.hidden) return;
      const config = this.config.slots[slot]!;
      const guest = this.guests.get(slot);
      const pad = this.services.preferences.deviceIndex(config.device);
      const missing = slot > 0 && (config.device === 'none' || (pad !== undefined && !connected.includes(pad)));
      const info = slot === 0 ? player1 : guest ? describe(guest) : { status: '', text: '' };
      const name = slot === 0 ? player1.name : config.name || `Pilot ${slot + 1}`;
      write(tag.children[0] as HTMLElement, `P${slot + 1} · ${name}`);
      write(tag.children[1] as HTMLElement, guest?.problem ? 'NO SHIP' : info.status);
      write(tag.children[2] as HTMLElement, guest?.problem ? guest.problem
        : missing ? (config.device === 'none' ? 'No controller · press Start on a free controller' : `Controller ${pad! + 1} disconnected`)
        : info.text);
    });
  }

  /** Each guest's renderer from the console's current provider and shaders. */
  rendererFor(guest: FlightGuestPilot, provider: RendererProvider | undefined, shaders: ShaderPack): Renderer | undefined {
    if (!provider) return undefined;
    if (guest.provider !== provider) {
      guest.renderer?.dispose?.();
      guest.renderer = undefined;
      guest.provider = provider;
      // A context cannot change type, so every provider gets a fresh canvas.
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', guest.canvas.getAttribute('aria-label') ?? '');
      guest.canvas.replaceWith(canvas);
      guest.canvas = canvas;
      try {
        guest.renderer = provider.create(canvas, provider.capabilities.shaders ? { shaders } : {});
        guest.shaders = shaders;
      } catch (error) {
        guest.problem = `Renderer failed: ${(error instanceof Error ? error.message : String(error))}`;
      }
    } else if (guest.renderer && guest.shaders !== shaders) {
      guest.shaders = shaders;
      try { guest.renderer.features?.shaders?.set(shaders); } catch { /* keeps the previous pack */ }
    }
    return guest.renderer;
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    const tasks: (() => void)[] = [() => this.observer.disconnect()];
    for (const guest of this.guests.values()) {
      tasks.push(() => { if (guest.playerId) this.seated?.unseatGuest(guest.playerId); },
        () => this.host.releaseInput?.(guest.slot), () => this.host.releaseFlight?.(guest.slot), () => guest.dispose());
    }
    tasks.push(() => this.layer.remove(), () => this.style.remove(), () => this.viewport.removeAttribute('data-split'),
      () => this.viewport.removeAttribute('data-flight-split'), () => this.host.primaryCanvas().removeAttribute('data-local-primary'),
      () => { for (const key of ['--p1-x', '--p1-y', '--p1-w', '--p1-h']) this.viewport.style.removeProperty(key); });
    try { closeAll(tasks, 'Split-screen cleanup failed'); }
    finally {
      this.guests.clear(); this.separatedGuests.clear(); this.candidateSeparation.clear(); this.lastSeparationChange.clear();
    }
  }

}

function write(target: HTMLElement, text: string): void {
  if (target.textContent !== text) target.textContent = text;
}

/**
 * Contributes flight split-screen management with dynamic multi-seat joining and viewport splitting.
 * Provides view.flight-split@1.0.0 in the view.flight-split slot.
 */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({"id": "usage", "audience": "creators", "title": "Flight split screen", "summary": "Independent local flight seats and split/dynamic panes over a borrowed session.", "asset": "docs/creators/usage.json"});
  if((context.settings.mergeScreenRatio??.35)>(context.settings.separateScreenRatio??.55)||(context.settings.mergeDistance??3500)>(context.settings.separateDistance??5000))throw new Error('Split-screen merge thresholds must not exceed separation thresholds');
  const services: FlightSplitServices = { preferences: context.use(LOCAL_PILOTS).preferences(), profiles: context.use(FLIGHT_PROFILES),
    cameras: context.use(FLIGHT_CAMERAS), predictions: context.use(PREDICTIONS), fleets: context.use(FLEET_VIEWS), layouts: context.use(LOCAL_VIEWS),tuning:context.settings };
  const gamepads = context.tryUse(GAMEPAD_INPUT);
  const instances = new Set<SplitScreen>(); let disposed = false;
  context.own({ dispose() {
    disposed = true;
    try { closeAll(Array.from(instances, split => () => split.dispose()), 'Flight split-screen provider cleanup failed'); }
    finally { instances.clear(); }
  } });
  context.provide(FLIGHT_SPLIT, Object.freeze({ create(viewport: HTMLElement, host: FlightSplitScreenHost) {
    if (disposed) throw new Error('Flight split-screen provider is disposed');
    const ownedPads = host.gamepads ? undefined : gamepads?.createFlight();
    let split: SplitScreen;
    try { split = new SplitScreen(viewport, { ...host, gamepads: host.gamepads ?? ownedPads }, services); }
    catch (error) { ownedPads?.dispose(); throw error; }
    const dispose = split.dispose.bind(split);
    split.dispose = () => { try { dispose(); } finally { try { ownedPads?.dispose(); } finally { instances.delete(split); } } }; instances.add(split); return split;
  } }));
}
