import { IDLE, type Controls, type ResolvedBody, type State } from '../../../packages/sim-core/src/index';
import type { Renderer, RendererProvider, ShaderPack, Vec } from '../../../packages/game-api/src/index';
import type { Ship } from '../../../packages/sim-core/src/world';
import { CameraController } from './camera';
import { FleetView } from './fleet-view';
import { Prediction } from './prediction';
import { SessionError, type GameSession, type LocalSession } from './session';
import { GamepadManager } from './gamepad';
import type { ActionId } from './input-config';
import {
  PLAYER_COLORS, assignDevice, deviceIndex, keyboardOwner, loadLocalPlayers, padDevice, padOwner, paneRects,
  saveLocalPlayers, setPlayerCount, dynamicPaneRects, type LocalPlayersConfig,
} from './local-players';
import { message } from './ui';

/** Actions that change the shared world clock or the whole screen; any player may use them. */
const SHARED_ACTIONS = new Set<ActionId>(['warpUp', 'warpDown', 'warpReset', 'pause', 'fullscreen', 'profiler']);
/** Start / Menu / Options on the standard mapping: an unclaimed controller joins with it. */
const JOIN_BUTTON = 9;

/** Pilot state and view for one split-screen guest (players 2 to 4). Player 1 is the
 * console's own pilot. */
export class GuestPilot {
  readonly camera = new CameraController();
  readonly prediction = new Prediction(() => {});
  readonly fleetView = new FleetView();
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

  onPointerDown?: (event: PointerEvent) => boolean;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;

  constructor(readonly slot: number, private readonly isSlotThrowing?: (slot: number) => boolean) {
    this.prediction.maxMs = 1.5;
    this.pane.className = 'split-pane';
    this.pane.dataset.slot = String(slot);
    this.pane.style.setProperty('--player-color', PLAYER_COLORS[slot]!);
    this.canvas.setAttribute('aria-label', `Player ${slot + 1} flight view`);
    this.pane.append(this.canvas);
    this.camera.horizon = true;
    this.pane.addEventListener('wheel', event => {
      event.preventDefault();
      this.camera.changeZoom(Math.exp(-event.deltaY * 0.0015));
    }, { passive: false });

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
    });
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
    });
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
    this.pane.addEventListener('pointerup', stopDrag);
    this.pane.addEventListener('pointercancel', stopDrag);
  }

  ship(session: GameSession): Ship | undefined {
    return this.shipId ? session.world.ship(this.shipId) : undefined;
  }

  /** Pick an owned ship, launching one when the seat has none. */
  ensureShip(local: LocalSession, presetId: string, godMode = false): void {
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
      if (!(error instanceof SessionError)) throw error;
      this.problem = error.message;
    }
  }

  select(shipId: string | undefined): void {
    this.shipId = shipId;
    this.body = undefined;
    this.prediction.invalidate();
    this.camera.recenter();
  }

  /** Allow another launch attempt (after the world was reset or room was made). */
  retrySpawn(): void { this.spawnTried = false; }

  /** Follow the ship's latest state and its sphere of influence. */
  refresh(session: GameSession): void {
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
    this.renderer?.dispose?.();
    this.renderer = undefined;
    this.prediction.invalidate();
    this.pane.remove();
  }
}

export interface SplitScreenHost {
  readonly gamepads: GamepadManager;
  session(): GameSession;
  /** This browser's own world when it is the one being played; split screen needs it. */
  ownWorld(): LocalSession | undefined;
  presetId(): string;
  isGodMode(): boolean;
  /** Held keyboard flight input (no touch, no pointer). */
  keyboardFlight(): Controls;
  /** Merge persistent console flight controls after held device input has been collected. */
  resolveFlight?(slot: number, controls: Controls, elapsed: number): Controls;
  throttleAction?(slot: number, action: 'throttleCut' | 'throttleRecall' | 'throttleRemember'): void;
  /** Release persistent input before restarting a pilot's ship. */
  releaseFlight?(slot: number): void;
  /** Configuration dialogs consume controllers without sending gameplay input. */
  inputEnabled?(): boolean;
  /** A pad currently interacting with a HUD control or aiming a throw. */
  consumesPad?(slot: number, pad: number): boolean;
  /** A shared or player-1 action, as the console runs it. */
  execute(action: ActionId): void;
  notify(text: string): void;
  /** Called after players, devices or the layout changed (to refresh the menu). */
  changed(): void;
  /** Slingshot throw and pointer interactions on guest panes. */
  onGuestPointer?(guest: GuestPilot, action: 'down' | 'move' | 'up', event: PointerEvent): boolean | void;
  /** True when a player slot is actively aiming with the throw tool or virtual cursor. */
  isSlotThrowing?(slot: number): boolean;
}

/** Up to four pilots on one screen. Player 1 keeps the console's canvas, HUD and windows;
 * players 2 to 4 are local seats in this browser's world, each with a pane of their own. */
export class SplitScreen {
  config: LocalPlayersConfig;
  readonly guests = new Map<number, GuestPilot>();
  readonly separatedGuests = new Set<number>();
  private readonly candidateSeparation = new Map<number, boolean>();
  private readonly lastSeparationChange = new Map<number, number>();
  private readonly tags: HTMLElement[] = [];
  private readonly layer = document.createElement('div');
  private seated: LocalSession | undefined;
  private suspendedNotice = false;
  private dirty = true;

  constructor(private readonly viewport: HTMLElement, private readonly host: SplitScreenHost) {
    this.config = loadLocalPlayers(GamepadManager.legacyProfile());
    this.layer.className = 'split-layer';
    for (let slot = 0; slot < PLAYER_COLORS.length; slot++) {
      const tag = document.createElement('div');
      tag.className = 'split-tag';
      tag.style.setProperty('--player-color', PLAYER_COLORS[slot]!);
      tag.hidden = true;
      tag.innerHTML = '<b></b><span class="split-status"></span><span class="split-stats"></span>';
      this.tags.push(tag);
      this.layer.append(tag);
    }
    viewport.append(this.layer);
    new ResizeObserver(() => this.layout()).observe(viewport);
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
    const prevMode = this.config.screenMode;
    this.config = next;
    saveLocalPlayers(next);
    if (next.screenMode === 'split' && prevMode !== 'split') {
      for (let s = 1; s < this.active; s++) this.separatedGuests.add(s);
    }
    this.dirty = true;
    this.host.changed();
  }

  /** Player 1's controllers, for the console's own flight input. */
  padsOf(slot: number): number[] {
    const connected = this.host.gamepads.connected();
    return connected.filter(i => padOwner(this.activeConfig, i, connected) === slot);
  }
  get keyboardSlot(): number | undefined { return keyboardOwner(this.activeConfig); }
  /** In someone else's game only player 1 plays. */
  private get activeConfig(): LocalPlayersConfig {
    return this.active === this.config.count ? this.config : { ...this.config, count: 1 };
  }

  /** Read every controller once per frame and route presses to their players. Runs while
   * paused, so Start can resume. */
  pollPads(): void {
    const connected = this.host.gamepads.connected();
    const config = this.activeConfig;
    this.host.gamepads.update(
      pad => { const slot = padOwner(config, pad, connected); return slot === undefined ? undefined : config.slots[slot]!.profile; },
      (pad, action) => {
        // The cursor owns the held throw gesture; it must not toggle mouse throw mode.
        if (this.host.inputEnabled?.() === false || action === 'throwShip') return;
        const slot = padOwner(config, pad, connected) ?? 0;
        if (action === 'throttleRecall' && (this.host.consumesPad?.(slot, pad) || this.host.isSlotThrowing?.(slot))) return;
        this.action(slot, action);
      },
      (pad, button) => {
        if (this.host.inputEnabled?.() === false) return;
        if (button !== JOIN_BUTTON || !this.split || padOwner(config, pad, connected) !== undefined) return;
        this.join(pad);
      });
  }

  /** An unclaimed controller takes the first free seat (Start in split screen, or from the menu). */
  join(pad: number): boolean {
    if (!this.host.ownWorld()) { this.host.notify('Split screen works in your own world (solo or hosting).'); return false; }
    let config = this.config;
    const existing = config.slots.findIndex((s, i) => i < config.count && s.device === padDevice(pad));
    if (existing >= 0) return true;
    // Reuse an active seat with no device before adding one.
    let slot = config.slots.findIndex((s, i) => i > 0 && i < config.count && s.device === 'none');
    if (slot < 0) {
      if (config.count >= config.slots.length) { this.host.notify('All four seats are taken.'); return false; }
      slot = config.count;
      config = setPlayerCount(config, config.count + 1);
    }
    this.setConfig(assignDevice(config, slot, padDevice(pad)));
    this.host.notify(`Player ${slot + 1} joined on controller ${pad + 1}.`);
    return true;
  }

  /** Run `action` for the player in `slot`. Shared actions and player 1's go to the console. */
  action(slot: number, action: ActionId): void {
    if (this.host.isSlotThrowing?.(slot)) {
      const cameraAlteringActions = new Set<ActionId>([
        'camera', 'orientation', 'cycleShip', 'cycleShipPrev', 'cyclePlanet', 'cyclePlanetPrev', 'zoomIn', 'zoomOut',
      ]);
      if (cameraAlteringActions.has(action)) return;
    }
    if (action === 'throttleCut' || action === 'throttleRecall' || action === 'throttleRemember') { this.host.throttleAction?.(slot, action); return; }
    const guest = this.guests.get(slot);
    if (slot === 0 || SHARED_ACTIONS.has(action) || !guest) { this.host.execute(action); return; }
    const session = this.host.session();
    switch (action) {
      case 'camera': guest.camera.cycle([], guest.body?.radius); break;
      case 'orientation': guest.camera.horizon = !guest.camera.horizon; break;
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
          if (!(error instanceof SessionError)) throw error;
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
          const newGuest = new GuestPilot(slot, s => this.host.isSlotThrowing?.(s) ?? false);
          newGuest.onPointerDown = e => this.host.onGuestPointer?.(newGuest, 'down', e) ?? false;
          newGuest.onPointerMove = e => this.host.onGuestPointer?.(newGuest, 'move', e);
          newGuest.onPointerUp = e => this.host.onGuestPointer?.(newGuest, 'up', e);
          guest = newGuest;
          this.guests.set(slot, guest);
          this.viewport.querySelector('canvas#flight-view')!.after(guest.pane);
        }
        const config = this.config.slots[slot]!;
        try {
          guest.playerId = local.seatGuest(config.name || `Pilot ${slot + 1}`, config.token);
          guest.problem = '';
        } catch (error) {
          if (!(error instanceof SessionError)) throw error;
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
    const count = this.active;
    const { rects, visible } = this.config.screenMode === 'dynamic'
      ? dynamicPaneRects(count, this.separatedGuests, this.config.twoPlayerLayout, this.viewport.clientWidth, this.viewport.clientHeight)
      : { rects: paneRects(count, this.config.twoPlayerLayout, this.viewport.clientWidth, this.viewport.clientHeight), visible: new Array(count).fill(true) };

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
    p1Camera: CameraController,
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
        if (pxDist > 0.55 * minDim || worldDist > 5000) {
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
        const canMerge = pxDist < 0.35 * minDim && worldDist < 3500;

        if (currentlySeparated) {
          if (canMerge) {
            const candidate = this.candidateSeparation.get(slot);
            const since = this.lastSeparationChange.get(slot) ?? now;
            if (candidate !== false) {
              this.candidateSeparation.set(slot, false);
              this.lastSeparationChange.set(slot, now);
            } else if (now - since >= 600) {
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
    const connected = this.host.gamepads.connected();
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
      const pad = deviceIndex(device);
      if (pad !== undefined && connected.includes(pad) && !this.host.consumesPad?.(slot, pad)) {
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
  updateTags(player1: { readonly name: string; readonly text: string; readonly status: string }, describe: (guest: GuestPilot) => { status: string; text: string }): void {
    if (!this.split) return;
    const connected = this.host.gamepads.connected();
    this.tags.forEach((tag, slot) => {
      if (tag.hidden) return;
      const config = this.config.slots[slot]!;
      const guest = this.guests.get(slot);
      const pad = deviceIndex(config.device);
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
  rendererFor(guest: GuestPilot, provider: RendererProvider | undefined, shaders: ShaderPack): Renderer | undefined {
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
        guest.problem = `Renderer failed: ${message(error)}`;
      }
    } else if (guest.renderer && guest.shaders !== shaders) {
      guest.shaders = shaders;
      try { guest.renderer.features?.shaders?.set(shaders); } catch { /* keeps the previous pack */ }
    }
    return guest.renderer;
  }
}

function write(target: HTMLElement, text: string): void {
  if (target.textContent !== text) target.textContent = text;
}
