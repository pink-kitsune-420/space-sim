import { Clock, IDLE, type Controls, type Vec } from '../../../packages/sim-core/src/index';
import type { SavedPlayer } from '../../../packages/sim-core/src/save';
import type { Ship, World, WorldEvent } from '../../../packages/sim-core/src/world';
import { HostSession, SessionError } from '../../../packages/net/src/host';
import type { ClientSession } from '../../../packages/net/src/client';
import type { Connection } from '../../../packages/net/src/connection';
import type { NetPlayer } from '../../../packages/net/src/protocol';
import { newToken } from '../../../packages/net/src/sha256';

export type ChatLine = { readonly from?: string; readonly name: string; readonly text: string };

/** What the flight loop needs from a game, whether this browser owns the world or follows
 * someone else's. */
export interface GameSession {
  readonly kind: 'local' | 'client';
  readonly world: World;
  readonly playerId: string;
  readonly paused: boolean;
  readonly pauseReason: string;
  readonly warp: number;
  readonly requestedWarp: number;
  readonly warpReason: string;
  /** True if this seat controls time warp (only the host can activate warp). */
  readonly canWarp: boolean;
  setWarp(factor: number): void;
  /** Presentation fraction of the next fixed step. */
  readonly alpha: number;
  /** Ship record before the latest fixed step, for interpolation. */
  previous(shipId: string): Ship | undefined;
  /** Fading body-relative display correction; zero for local worlds. */
  displayOffset(shipId: string): Vec;
  /** Advance by wall-clock seconds. Held controls apply to `shipId` only. */
  update(seconds: number, shipId: string | undefined, controls: Controls): WorldEvent[];
  /** Returns the new ship's id when it exists immediately (local worlds). */
  spawn(presetId: string, godMode: boolean): string | undefined;
  respawn(shipId: string, presetId: string): void;
  /** Place an owned ship (throw, orbit and teleport cheats). Local worlds apply it now or
   * throw a SessionError; remote hosts check it and answer with the next snapshot or a notice. */
  teleport(shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): void;
  remove(shipId: string): void;
  setThrottle(shipId: string, throttle: number): void;
  setGodMode(shipId: string, enabled: boolean): void;
  setGodModeAll(enabled: boolean): void;
  /** A module command for an owned ship. Local worlds apply it now through the host's
   * checks (or throw a SessionError); remote results arrive with the next snapshot. */
  command(shipId: string, commandId: string, args?: Readonly<Record<string, number>>): void;
  players(): readonly NetPlayer[];
  playerName(id: string): string | undefined;
  /** Say something to everyone in this world (just this pilot when playing alone). */
  chat(text: string): void;
  /** Every chat line in this world, this pilot's own included. */
  onchat: ((line: ChatLine) => void) | null;
}

/** This browser's own world: single player, or the authoritative host for remote players. */
export class LocalSession implements GameSession {
  readonly kind = 'local';
  readonly host: HostSession;
  readonly playerId: string;
  /** Secret for this seat; stored only once the world is hosted or saved. */
  readonly token: string;
  /** Accepting remote players. */
  hosting = false;
  private readonly clock = new Clock();
  /** Interpolation is off until the next step after a reset or pause. */
  private settled = true;
  private controlled?: string;

  constructor(world: World, options: { readonly name: string; readonly token?: string; readonly hostId?: string;
    readonly players?: readonly SavedPlayer[] }) {
    this.host = new HostSession(world, { maxShipsPerPlayer: 16, maxShips: 64, maxPlayers: 8 }, { players: options.players ?? [] });
    this.token = options.token ?? newToken();
    this.playerId = this.host.seatHost(options.name, this.token, options.hostId);
  }

  get world(): World { return this.host.world; }
  get paused(): boolean { return this.host.paused; }
  get pauseReason(): string { return this.host.pauseReason; }
  get warp(): number { return this.host.warp; }
  get requestedWarp(): number { return this.host.requestedWarp; }
  get warpReason(): string { return this.host.warpReason; }
  get canWarp(): boolean { return true; }
  setWarp(factor: number): void { this.host.setWarp(factor, this.playerId); }
  get alpha(): number { return this.clock.alpha; }
  /** Fixed steps taken by the latest update, and wall time dropped by stalled frames. */
  get clockStats(): { readonly steps: number; readonly droppedSeconds: number } {
    return { steps: this.clock.lastSteps, droppedSeconds: this.clock.droppedSeconds };
  }
  previous(shipId: string): Ship | undefined { return this.settled ? undefined : this.world.previous(shipId); }
  displayOffset(): Vec { return { x: 0, y: 0 }; }

  /** A local flight assistant may supply controls before each normal-speed physics tick.
   * It runs inside the clock loop so short burns cannot overrun on slow frames. */
  update(seconds: number, shipId: string | undefined, controls: Controls, beforeStep?: () => Controls): WorldEvent[] {
    const events: WorldEvent[] = [];
    if (this.controlled !== shipId && this.controlled && this.world.record(this.controlled)?.ownerId === this.playerId) {
      this.host.setControls(this.playerId, this.controlled, IDLE);
    }
    this.controlled = shipId;
    if (!this.paused) {
      if (shipId && this.world.record(shipId)?.ownerId === this.playerId) this.host.setControls(this.playerId, shipId, controls);
      if (this.host.warp > 1) {
        this.settled = false;
        events.push(...this.host.advance(seconds));
      } else {
        this.clock.advance(seconds, () => {
          if (beforeStep && shipId && this.world.record(shipId)?.ownerId === this.playerId) {
            this.host.setControls(this.playerId, shipId, beforeStep());
          }
          this.settled = false;
          events.push(...this.host.step());
        });
      }
    }
    this.host.service();
    return events;
  }

  /** A hidden tab's timers fire about once a second; keep hosted players' world moving in
   * bounded chunks instead of dropping that time. */
  catchUp(seconds: number, shipId: string | undefined): WorldEvent[] {
    const events: WorldEvent[] = [];
    for (let left = Math.min(seconds, 2); left > 1e-9; left -= 0.2) events.push(...this.update(Math.min(left, 0.2), shipId, IDLE));
    return events;
  }

  setPaused(paused: boolean, reason = ''): void {
    this.host.setPaused(paused, reason);
    this.clock.reset();
    this.settled = true;
  }
  /** Drop interpolation history, e.g. after a reset. */
  settle(): void { this.clock.reset(); this.settled = true; }

  spawn(presetId: string, godMode: boolean): string | undefined {
    return this.host.spawnShip(this.playerId, presetId, godMode).id;
  }
  respawn(shipId: string, presetId: string): void {
    const ownerId = this.world.record(shipId)?.ownerId ?? this.playerId;
    this.host.respawnShip(ownerId, shipId, presetId);
  }
  teleport(shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): void {
    const ownerId = this.world.record(shipId)?.ownerId ?? this.playerId;
    this.host.teleportShip(ownerId, shipId, bodyId, position, velocity, heading);
    this.settle();
  }
  remove(shipId: string): void {
    const ownerId = this.world.record(shipId)?.ownerId ?? this.playerId;
    this.host.removeShip(ownerId, shipId);
  }
  setThrottle(shipId: string, throttle: number): void {
    const ownerId = this.world.record(shipId)?.ownerId ?? this.playerId;
    this.host.setThrottle(ownerId, shipId, throttle);
  }
  setGodMode(shipId: string, enabled: boolean): void {
    const ownerId = this.world.record(shipId)?.ownerId ?? this.playerId;
    this.host.setGodMode(ownerId, shipId, enabled);
  }
  setGodModeAll(enabled: boolean): void { this.host.setGodModeAll(enabled); }
  command(shipId: string, commandId: string, args?: Readonly<Record<string, number>>): void {
    const ownerId = this.world.record(shipId)?.ownerId ?? this.playerId;
    this.host.command(ownerId, shipId, commandId, args);
  }
  /** Split-screen seats: extra pilots on this screen, each a player of their own. */
  seatGuest(name: string, token: string): string { return this.host.seatLocal(name, token); }
  unseatGuest(playerId: string): void { this.host.unseatLocal(playerId); }
  /** Held controls for a guest seat's ship; applied by the next `update`. */
  guestControls(playerId: string, shipId: string, controls: Controls): void {
    if (!this.paused && this.world.record(shipId)?.ownerId === playerId) this.host.setControls(playerId, shipId, controls);
  }
  spawnGuest(playerId: string, presetId: string, godMode = false): string { return this.host.spawnShip(playerId, presetId, godMode).id; }
  respawnGuest(playerId: string, shipId: string, presetId: string, godMode?: boolean): void {
    this.host.respawnShip(playerId, shipId, presetId, godMode);
    this.settle();
  }
  setGuestThrottle(playerId: string, shipId: string, throttle: number): void { this.host.setThrottle(playerId, shipId, throttle); }
  accept(connection: Connection): void { this.host.accept(connection); }
  players(): readonly NetPlayer[] { return this.host.playerList(); }
  playerName(id: string): string | undefined { return this.host.playerName(id); }
  chat(text: string): void { this.host.chat(this.playerId, text); }
  get onchat(): ((line: ChatLine) => void) | null { return this.host.onchat; }
  set onchat(listener: ((line: ChatLine) => void) | null) { this.host.onchat = listener; }
}

/** A world hosted elsewhere, mirrored and predicted locally. Commands are requests; their
 * results arrive with the next snapshot. */
export class RemoteSession implements GameSession {
  readonly kind = 'client';
  constructor(readonly client: ClientSession) {}
  get world(): World { return this.client.world!; }
  get playerId(): string { return this.client.playerId!; }
  get paused(): boolean { return this.client.paused; }
  get pauseReason(): string { return this.client.pauseReason || 'Paused by the host'; }
  get warp(): number { return this.client.warp; }
  get requestedWarp(): number { return this.client.warp; }
  get warpReason(): string { return this.client.warp > 1 ? 'Time warp set by host' : ''; }
  get canWarp(): boolean { return false; }
  setWarp(_factor: number): void { throw new SessionError('Only the host can activate time warp.'); }
  get alpha(): number { return this.client.alpha; }
  previous(shipId: string): Ship | undefined { return this.client.previous(shipId); }
  displayOffset(shipId: string): Vec { return this.client.displayOffset(shipId); }
  update(_seconds: number, shipId: string | undefined, controls: Controls): WorldEvent[] {
    this.client.control(shipId, controls);
    return this.client.update();
  }
  spawn(presetId: string): undefined { this.client.spawn(presetId); return undefined; }
  respawn(shipId: string, presetId: string): void { this.client.respawn(shipId, presetId); }
  teleport(shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): void {
    if (this.client.rules && !this.client.rules.allowGodMode) throw new SessionError('Cheats (teleport, throw, orbit) are disabled on this server.');
    this.client.teleport(shipId, bodyId, position, velocity, heading);
  }
  remove(shipId: string): void { this.client.remove(shipId); }
  setThrottle(shipId: string, throttle: number): void { this.client.setThrottle(shipId, throttle); }
  setGodMode(shipId: string, enabled: boolean): void { this.client.setGodMode(shipId, enabled); }
  setGodModeAll(enabled: boolean): void {
    for (const ship of this.world.ships()) {
      if (ship.ownerId === this.playerId) this.client.setGodMode(ship.id, enabled);
    }
  }
  command(shipId: string, commandId: string, args?: Readonly<Record<string, number>>): void { this.client.command(shipId, commandId, args); }
  players(): readonly NetPlayer[] { return this.client.players; }
  playerName(id: string): string | undefined { return this.client.players.find(p => p.id === id)?.name; }
  chat(text: string): void { this.client.chat(text); }
  get onchat(): ((line: ChatLine) => void) | null { return this.client.onchat; }
  set onchat(listener: ((line: ChatLine) => void) | null) { this.client.onchat = listener; }
}

export { SessionError };
