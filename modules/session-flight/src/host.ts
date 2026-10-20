import type { ModuleDataCommand, SparsePageStore, SparsePageDelta } from '@space-sim/game-api';
import type { Controls, Vec, SavedPlayer, Ship, WorldEvent, CommandEffect, WorldControl, WorldChanges, FlightSessionServices } from '@space-sim/game-api';
import type { TextConnection as Connection } from '@space-sim/game-api';
import {
  MAX_CHAT, MAX_INPUT_LEAD_TICKS, PROTOCOL, VEHICLE_PROTOCOL, MODULE_DATA_PROTOCOL,
  MAX_SUBSCRIBED_CHUNKS, MAX_CHUNK_BYTES_PER_TICK, uint8ArrayToBase64,
  ProtocolError, parseClientMessage, type ClientMessage, type ErrorCode, type HostMessage, type NetPlayer,
  type NetShip, type SessionRules, type ChunkDeltaPayload, type HostChunkDelta,
} from './protocol';
import { newPlayerId, newToken, sha256Hex } from './sha256';

const MAX_PLAYER_NAME = 24, MAX_SAVE_PLAYERS = 512;
/** Flight roster policy, matching legacy save/player-name handling. */
function cleanName(name: unknown, limit: number): string {
  return typeof name === 'string' ? name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, limit).trim() : '';
}

export interface HostSettings extends SessionRules {
  /** Shown to joining players. */
  readonly name: string;
  /** Empty for none. */
  readonly password: string;
  readonly maxShips: number;
  /** Where joining players' first ship starts; the system's first preset by default. */
  readonly spawnPreset?: string;
  /** Release a silent client's held controls after this long. */
  readonly releaseAfterMs: number;
  /** Drop connections that have not joined within this long. */
  readonly joinTimeoutMs: number;
}
export const DEFAULT_HOST_SETTINGS: HostSettings = Object.freeze({
  name: 'Space Sim', password: '', maxPlayers: 8, maxShipsPerPlayer: 5, maxShips: 64, allowGodMode: true,
  snapshotEveryTicks: 5, releaseAfterMs: 3000, joinTimeoutMs: 15000,
});

export { MAX_INPUT_LEAD_TICKS } from './protocol';
const MAX_QUEUED_INPUTS = 256;
/** Skip snapshots for a peer that has this much unsent data; the next one supersedes them. */
const SNAPSHOT_BACKLOG_BYTES = 1 << 20;
const RATE_PER_SECOND = 150;
const RATE_BURST = 300;
/** A peer may ask for the complete world at most this often. */
const RESYNC_INTERVAL_MS = 1000;
/** Chat lines per pilot: a burst of this many, refilled at one every CHAT_REFILL_MS. */
const CHAT_BURST = 5;
const CHAT_REFILL_MS = 1500;

interface PendingInput { readonly seq: number; readonly tick: number; readonly controls: Controls; readonly set?: number }
/** `local`: a split-screen seat in the hosting browser, present without a connection. */
interface Player { readonly id: string; name: string; tokenHash?: string; peer?: Peer; host?: boolean; local?: boolean }
interface Peer {
  readonly connection: Connection;
  readonly openedAt: number;
  player?: Player;
  lastHeard: number;
  released: boolean;
  allowance: number;
  refilledAt: number;
  closed: boolean;
  /** Never had the world, or the world was rewound (pause): the next snapshot is complete. */
  needsFull: boolean;
  dataRevision: number;
  /** Changes not yet delivered: a peer whose link is backed up skips snapshots and gets
   * everything it missed in the next one it can take. */
  readonly changed: Set<string>;
  readonly removed: Set<string>;
  /** When the peer last asked for the complete world. */
  resyncAt: number;
  chatAllowance: number;
  chatRefilledAt: number;
}

/** Every awake ship is resent within this many snapshots (2 s by default: numerical motion
 * is where two different browser engines could drift apart); a sleeping ship, whose state
 * is a closed-form function of its epoch, within REFRESH_SNAPSHOTS (20 s). */
const AWAKE_REFRESH_SNAPSHOTS = 40;
const REFRESH_SNAPSHOTS = 400;

/** A user-facing refusal (limits, ownership); remote players receive it as a notice. */
export class SessionError extends Error {}

/** Authoritative multiplayer host. It owns the world: remote players send commands, the
 * host validates ownership and timing, advances every ship and publishes snapshots.
 * Transport- and clock-agnostic: the caller drives `step()` at the fixed rate and
 * `service()` regularly, including while paused. */
export class HostSession<W extends WorldControl = WorldControl> {
  readonly world: W;
  private readonly changes: WorldChanges;
  readonly settings: HostSettings;
  paused = false;
  pauseReason = '';
  warp = 1;
  requestedWarp = 1;
  warpReason = '';
  private warpAccumulator = 0;
  /** Wall-clock seconds since the last snapshot while warping, where ticks jump. */
  private warpSnapshotSeconds = 0;
  /** The player playing inside the hosting browser, if any. */
  hostId?: string;
  /** The roster or a connection changed. */
  onplayers: (() => void) | null = null;
  /** Every chat line, as sent to the players. */
  onchat: ((line: { readonly from?: string; readonly name: string; readonly text: string }) => void) | null = null;
  private readonly players = new Map<string, Player>();
  pageStore?: SparsePageStore;
  private readonly subscriptions = new Map<string, Set<string>>();
  private readonly chunkBodies = new Map<string, string>();
  private readonly chunkRevisions = new Map<string, number>();
  private readonly outboundDeltas = new Map<string, Array<{ bodyId: string; delta: ChunkDeltaPayload; byteSize: number }>>();
  private readonly peers = new Set<Peer>();
  private readonly queues = new Map<string, PendingInput[]>();
  private readonly acks = new Map<string, number>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private dirty = false;
  private disposed = false;
  private disposing = false;
  private assertActive(): void { if (this.disposed || this.disposing) throw new SessionError('Flight host is disposed'); }

  constructor(private readonly services: FlightSessionServices, world: W, settings: Partial<HostSettings> = {}, options: {
    readonly players?: readonly SavedPlayer[]; readonly now?: () => number; readonly log?: (message: string) => void;
    readonly pageStore?: SparsePageStore;
  } = {}) {
    this.world = world;
    this.settings = { ...DEFAULT_HOST_SETTINGS, ...settings };
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? (() => {});
    this.pageStore = options.pageStore ?? (world as any).pageStore;
    this.changes = world.subscribeChanges();
    for (const p of options.players ?? []) this.players.set(p.id, { ...p });
  }

  setPageStore(store: SparsePageStore): void {
    this.pageStore = store;
  }

  getSubscriptions(playerId: string): ReadonlySet<string> {
    return this.subscriptions.get(playerId) ?? new Set();
  }

  subscribeChunks(playerId: string, bodyId: string, chunkKeys: readonly string[]): void {
    this.assertActive();
    this.requirePlayer(playerId);
    let current = this.subscriptions.get(playerId);
    if (!current) {
      current = new Set<string>();
      this.subscriptions.set(playerId, current);
    }
    const newCount = chunkKeys.filter(k => !current!.has(k)).length;
    if (current.size + newCount > MAX_SUBSCRIBED_CHUNKS) {
      throw new SessionError(`Exceeded maximum chunk subscriptions (${MAX_SUBSCRIBED_CHUNKS})`);
    }
    for (const key of chunkKeys) {
      current.add(key);
      this.chunkBodies.set(key, bodyId);
    }
  }

  unsubscribeChunks(playerId: string, _bodyId: string, chunkKeys: readonly string[]): void {
    this.assertActive();
    this.requirePlayer(playerId);
    const current = this.subscriptions.get(playerId);
    if (!current) return;
    for (const key of chunkKeys) {
      current.delete(key);
    }
  }

  broadcastChunkDeltas(): void {
    let dirtyPages: readonly SparsePageDelta[] = [];
    if (this.pageStore) {
      dirtyPages = this.pageStore.commitDirtyPages();
    }
    if (this.world.moduleState) {
      for (const modState of Object.values(this.world.moduleState)) {
        if (modState.pages && typeof modState.pages.commitDirtyPages === 'function') {
          const modDeltas = modState.pages.commitDirtyPages();
          if (modDeltas.length > 0) {
            dirtyPages = dirtyPages.length > 0 ? [...dirtyPages, ...modDeltas] : modDeltas;
          }
        }
      }
    }

    if (dirtyPages.length > 0) {
      for (const dirty of dirtyPages) {
        const rev = (this.chunkRevisions.get(dirty.key) ?? 0) + 1;
        this.chunkRevisions.set(dirty.key, rev);
        const base64Delta = uint8ArrayToBase64(dirty.delta);
        const payload: ChunkDeltaPayload = { key: dirty.key, delta: base64Delta, revision: rev };
        const byteSize = dirty.delta.byteLength;

        let bodyId = this.chunkBodies.get(dirty.key);
        if (!bodyId) {
          const match = /^b:([a-z0-9-]+):c:/.exec(dirty.key);
          bodyId = match ? match[1]! : this.world.systemId;
        }

        for (const [playerId, subs] of this.subscriptions) {
          if (subs.has(dirty.key)) {
            let queue = this.outboundDeltas.get(playerId);
            if (!queue) {
              queue = [];
              this.outboundDeltas.set(playerId, queue);
            }
            queue.push({ bodyId, delta: payload, byteSize });
          }
        }
      }
    }

    for (const peer of this.peers) {
      if (!peer.player || peer.closed) continue;
      const playerId = peer.player.id;
      const queue = this.outboundDeltas.get(playerId);
      if (!queue || queue.length === 0) continue;

      let bytesSent = 0;
      const toSendByBody = new Map<string, ChunkDeltaPayload[]>();
      while (queue.length > 0) {
        const item = queue[0]!;
        if (bytesSent > 0 && bytesSent + item.byteSize > MAX_CHUNK_BYTES_PER_TICK) {
          break;
        }
        queue.shift();
        bytesSent += item.byteSize;
        let list = toSendByBody.get(item.bodyId);
        if (!list) {
          list = [];
          toSendByBody.set(item.bodyId, list);
        }
        list.push(item.delta);
      }

      for (const [bodyId, deltas] of toSendByBody) {
        const message: HostChunkDelta = {
          t: 'chunk-delta',
          bodyId,
          tick: this.world.tick,
          deltas,
        };
        peer.connection.send(JSON.stringify(message));
      }
    }
  }

  /** Seat the person playing in the hosting browser: the player holding `token`, else the
   * saved world's host seat, else a new player. Returns the player id. */
  seatHost(name: string, token: string, savedHostId?: string): string {
    this.assertActive();
    const hash = sha256Hex(token);
    let player = [...this.players.values()].find(p => p.tokenHash === hash)
      ?? (savedHostId ? this.players.get(savedHostId) : undefined);
    if (player?.peer) this.drop(player.peer, 'replaced', 'The host took this seat.');
    if (!player) {
      player = { id: this.uniquePlayerId(), name: '' };
      this.players.set(player.id, player);
    }
    player.name = cleanName(name, MAX_PLAYER_NAME) || 'Host';
    player.tokenHash = hash;
    player.host = true;
    this.hostId = player.id;
    this.changedPlayers();
    return player.id;
  }

  /** Seat a split-screen player in the hosting browser: the player holding `token`, else a
   * new one. Local seats count as connected and fly through `setControls` like the host. */
  seatLocal(name: string, token: string): string {
    this.assertActive();
    const hash = sha256Hex(token);
    let player = [...this.players.values()].find(p => p.tokenHash === hash);
    if (player?.host) throw new SessionError('That seat belongs to the host.');
    if (player?.peer) this.drop(player.peer, 'replaced', 'A local player took this seat.');
    if (!player?.local && this.connectedCount() >= this.settings.maxPlayers) {
      throw new SessionError(`The game is full (${this.settings.maxPlayers} players).`);
    }
    if (!player) {
      if (!this.makeRoom()) throw new SessionError('This world remembers too many pilots to add another.');
      player = { id: this.uniquePlayerId(), name: '', tokenHash: hash };
      this.players.set(player.id, player);
    }
    player.name = cleanName(name, MAX_PLAYER_NAME) || 'Pilot';
    player.local = true;
    this.changedPlayers();
    return player.id;
  }

  /** A split-screen player left: their ships stay in the world, like a remote player's. */
  unseatLocal(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player?.local) return;
    player.local = false;
    for (const id of this.world.ownedBy(playerId)) if (this.world.record(id)) this.world.setControls(id, this.services.clock.idle);
    this.changedPlayers();
  }

  accept(connection: Connection): void {
    this.assertActive();
    if (this.world.soloPreview) {
      connection.close('Custom authoritative module profiles are solo previews; multiplayer requires Phase 4 compatibility support.');
      throw new SessionError('Custom authoritative module profiles cannot host multiplayer yet.');
    }
    const now = this.now();
    const peer: Peer = { connection, openedAt: now, lastHeard: now, released: true, allowance: RATE_BURST, refilledAt: now, closed: false,
      dataRevision: 0, needsFull: true, changed: new Set(), removed: new Set(), resyncAt: -Infinity,
      chatAllowance: CHAT_BURST, chatRefilledAt: now };
    this.peers.add(peer);
    connection.onmessage = text => this.receive(peer, text);
    connection.onclose = reason => this.disconnected(peer, reason);
    this.send(peer, { ...(this.world.vehicles ? { vehicles: this.world.vehicles } : {}), ...(this.world.data.schemas.length ? { dataSchemas: this.world.data.schemas } : {}), t: 'info', protocol: PROTOCOL, model: this.services.clock.model, worldId: this.world.id, name: this.settings.name,
      password: this.settings.password !== '', players: this.connectedCount(), maxPlayers: this.settings.maxPlayers,
      fingerprint: this.world.simulationFingerprint, ...(this.hostId ? { host: this.hostId } : {}) });
  }

  /** Players currently in the game, including the host seat. */
  connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.peer || p.host || p.local) n++;
    return n;
  }
  remoteCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.peer) n++;
    return n;
  }
  playerList(): NetPlayer[] {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, connected: !!(p.peer || p.host || p.local), ...(p.host ? { host: true } : {}) }));
  }
  /** Identities to persist with the world. Tokens themselves are never stored. */
  roster(): SavedPlayer[] {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, ...(p.tokenHash ? { tokenHash: p.tokenHash } : {}) }));
  }
  playerName(id: string): string | undefined { return this.players.get(id)?.name; }

  setPaused(paused: boolean, reason = ''): void {
    this.assertActive();
    if (this.paused === paused && this.pauseReason === reason) return;
    this.paused = paused;
    this.pauseReason = paused ? reason : '';
    this.warpAccumulator = 0;
    if (paused && this.warp > 1) this.stopWarp('Simulation paused', false);
    // Clients run ahead of the host; a complete snapshot lets them rewind to the pause.
    for (const peer of this.peers) peer.needsFull = true;
    this.broadcastSnapshot();
  }

  /** Only the host seat or the dedicated server console may activate/adjust time warp. */
  canWarp(playerId?: string): boolean {
    return playerId === undefined || playerId === this.hostId;
  }

  /** Request a target time warp factor. If safe, grants requested warp; otherwise clamps to
   * the maximum safe factor under current flight conditions. Non-hosts are refused. */
  setWarp(factor: number, playerId?: string): { readonly granted: number; readonly reason?: string } {
    this.assertActive();
    if (!this.canWarp(playerId)) {
      throw new SessionError('Only the host can activate time warp.');
    }
    this.requestedWarp = this.services.motion.clampWarpFactor(factor);
    const safety = this.services.motion.checkWarpSafety(this.world);
    this.regulateWarp(safety, false);
    return { granted: this.warp, reason: this.warp < this.services.motion.clampWarpFactor(factor) ? safety.reason ?? '' : '' };
  }

  // Commands, shared by remote players and the host seat. Each throws a SessionError to refuse.
  spawnShip(playerId: string, presetId?: string, godMode = false, vehicleId?: string): Ship {
    this.assertActive();
    this.requirePlayer(playerId);
    const owned = this.ownedCount(playerId);
    if (owned >= this.settings.maxShipsPerPlayer) throw new SessionError(`Ship limit reached (${this.settings.maxShipsPerPlayer} per pilot).`);
    if (this.pilotedShips() >= this.settings.maxShips) throw new SessionError('This world has reached its ship limit.');
    if (presetId !== undefined && !this.world.system.presets.some(p => p.id === presetId)) throw new SessionError(`Unknown start ${presetId}.`);
    if (vehicleId !== undefined) {
      try { this.world.contextFor({ vehicleId }); } catch (error) { throw new SessionError((error as Error).message); }
    }
    const ship = this.world.spawn({ vehicleId, ownerId: playerId, presetId: presetId ?? this.settings.spawnPreset,
      godMode: godMode && this.settings.allowGodMode });
    this.changed();
    return ship;
  }
  respawnShip(playerId: string, shipId: string, presetId?: string, godMode?: boolean): Ship {
    this.assertActive();
    this.owned(playerId, shipId);
    if (presetId !== undefined && !this.world.system.presets.some(p => p.id === presetId)) throw new SessionError(`Unknown start ${presetId}.`);
    this.queues.delete(shipId);
    const ship = this.world.respawn(shipId, presetId, godMode);
    this.changed();
    return ship;
  }
  removeShip(playerId: string, shipId: string): void {
    this.assertActive();
    this.owned(playerId, shipId);
    if (this.ownedCount(playerId) <= 1) throw new SessionError('Keep at least one ship.');
    this.world.remove(shipId);
    this.queues.delete(shipId);
    this.acks.delete(shipId);
    this.changed();
  }
  setGodMode(playerId: string, shipId: string, enabled: boolean): void {
    this.assertActive();
    this.owned(playerId, shipId);
    if (enabled && !this.settings.allowGodMode) throw new SessionError('God mode is disabled on this server.');
    this.world.setGodMode(shipId, enabled);
    this.changed();
  }
  setGodModeAll(enabled: boolean): void {
    this.assertActive();
    if (enabled && !this.settings.allowGodMode) throw new SessionError('God mode is disabled on this server.');
    this.world.setGodModeAll(enabled);
    this.changed();
  }
  /** Place an owned ship with a new body-relative position and velocity: the throw, orbit
   * and teleport cheats. Refused unless the session allows cheats. */
  teleportShip(playerId: string, shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): Ship {
    this.assertActive();
    this.owned(playerId, shipId);
    if (!this.settings.allowGodMode) throw new SessionError('Cheats (teleport, throw, orbit) are disabled on this server.');
    if (!this.world.hasBody(bodyId)) throw new SessionError(`Unknown body ${bodyId}.`);
    const values = [position.x, position.y, velocity.x, velocity.y, heading ?? 0];
    if (!values.every(Number.isFinite)) throw new SessionError('A teleport needs finite coordinates.');
    this.queues.delete(shipId);
    const ship = this.world.teleport(shipId, bodyId, position, velocity, heading);
    this.changed();
    return ship;
  }
  /** Immediate held controls for the host seat; remote players schedule theirs by tick. */
  setControls(playerId: string, shipId: string, controls: Controls): void {
    this.assertActive();
    this.owned(playerId, shipId);
    this.world.setControls(shipId, controls);
    if (this.requestedWarp > 1) this.regulateWarp();
  }

  /** Holds warp at the requested factor within what is safe now. A ceiling above 1x (steering
   * held, low orbit, numerical flight) lifts by itself once it clears; a condition that allows
   * only 1x stops warp until the host asks again. Returns true when the factor changed. */
  private regulateWarp(safety = this.services.motion.checkWarpSafety(this.world), log = true): boolean {
    const granted = Math.min(this.requestedWarp, safety.maxGranted);
    const reason = granted < this.requestedWarp ? safety.reason ?? 'Flight condition requires normal time' : '';
    if (granted <= 1 && this.requestedWarp > 1) return this.stopWarp(reason, log);
    if (granted === this.warp) {
      this.warpReason = reason;
      return false;
    }
    if (log && granted < this.warp) this.log(`Time warp reduced to ${granted}x: ${reason}`);
    this.warp = granted;
    this.warpReason = reason;
    this.warpChanged();
    return true;
  }

  /** Ends warp outright: it stays at 1x until requested again. */
  private stopWarp(reason: string, log = true): boolean {
    const changed = this.warp !== 1;
    if (log && changed) this.log(`Time warp stopped: ${reason}`);
    this.warp = 1;
    this.requestedWarp = 1;
    this.warpReason = reason;
    if (changed) this.warpChanged();
    return changed;
  }

  private warpChanged(): void {
    this.warpAccumulator = 0;
    for (const peer of this.peers) peer.needsFull = true;
    this.broadcastSnapshot();
  }

  setThrottle(playerId: string, shipId: string, throttle: number): void {
    this.assertActive();
    this.owned(playerId, shipId);
    this.world.setThrottle(shipId, throttle);
    this.changed();
  }

  /** A registered module command for one owned ship, applied now (between fixed steps)
   * through the same world operations as the built-in commands above. The runtime
   * validates the arguments and the proposed effect before anything changes. */
  command(playerId: string, shipId: string, commandId: string, args?: unknown): CommandEffect {
    this.assertActive();
    this.owned(playerId, shipId);
    const command = this.world.commands.find(c => c.id === commandId);
    if (!command) throw new SessionError(`This world has no command ${commandId}.`);
    let effect: CommandEffect;
    try { effect = this.services.commands.resolve(command, this.world.ship(shipId)!, args ?? {}, this.world.tick, this.world.time); } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`Refused ${commandId} from ${this.playerName(playerId) ?? playerId}: ${reason}`);
      throw new SessionError(`${command.hook.label} was refused: ${reason}`);
    }
    if (effect.controls) this.world.setControls(shipId, effect.controls);
    if (effect.throttle !== undefined) this.world.setThrottle(shipId, effect.throttle);
    if (effect.moduleEvent && typeof this.world.queueModuleEvent === 'function') {
      this.world.queueModuleEvent(shipId, effect.moduleEvent);
    }
    this.changed();
    return effect;
  }

  /** Send a chat line to everyone: from a player, or from the server console (no id). */
  dataCommand(playerId: string, request: ModuleDataCommand): void {
    this.assertActive();
    if (!this.players.has(playerId)) throw new SessionError('Unknown module-data player.');
    const schema = this.world.data.schemas.find(s => s.id === request.adapter);
    if (!schema) throw new SessionError(`Missing required module-data adapter ${request.adapter}`);
    let ownerId: string | undefined;
    if (schema.scope === 'entity') {
      const entity = this.world.record(request.id);
      if (!entity) throw new SessionError('Unknown module-data entity.');
      ownerId = entity.ownerId;
    } else if (schema.scope === 'player') {
      if (!this.players.has(request.id)) throw new SessionError('Unknown module-data player.');
      ownerId = request.id;
    }
    try { this.world.data.command(request, { playerId, ownerId, tick: this.world.tick }); }
    catch (error) { throw new SessionError(error instanceof Error ? error.message : 'Module-data command failed.'); }
    this.dirty = true;
  }

  chat(playerId: string | undefined, text: string): void {
    this.assertActive();
    const name = playerId === undefined ? 'Server' : this.requirePlayer(playerId).name;
    // One line of printable text; control characters could garble a terminal or log.
    const clean = text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, MAX_CHAT);
    if (!clean) return;
    const line = { ...(playerId !== undefined ? { from: playerId } : {}), name, text: clean };
    this.log(`<${name}> ${clean}`);
    const message = JSON.stringify({ t: 'chat', ...line } satisfies HostMessage);
    for (const peer of this.peers) if (peer.player && !peer.closed) peer.connection.send(message);
    this.onchat?.(line);
  }

  kick(playerId: string, message = 'Removed by the host.'): boolean {
    this.assertActive();
    const peer = this.players.get(playerId)?.peer;
    if (!peer) return false;
    this.drop(peer, 'kicked', message);
    return true;
  }

  private applyDueInputs(tick: number): void {
    for (const [shipId, queue] of this.queues) {
      while (queue.length && queue[0]!.tick <= tick) {
        const input = queue.shift()!;
        if (!this.world.has(shipId)) break;
        this.world.setControls(shipId, input.controls);
        if (input.set !== undefined) this.world.setThrottle(shipId, input.set);
        this.acks.set(shipId, input.seq);
      }
      if (!queue.length || !this.world.has(shipId)) this.queues.delete(shipId);
    }
  }

  private handleFaults(events: readonly WorldEvent[]): void {
    for (const event of events) {
      if (event.type !== 'fault') continue;
      const ship = this.world.record(event.shipId);
      this.log(`${ship?.name ?? event.shipId} stopped: ${event.message}`);
      const peer = ship && this.players.get(ship.ownerId)?.peer;
      if (peer) this.send(peer, { t: 'notice', text: `${ship.name} stopped: ${event.message} Respawn it to fly again.` });
    }
  }

  /** Apply due inputs and advance one fixed step. */
  step(): WorldEvent[] {
    this.assertActive();
    if (this.paused) return [];
    this.applyDueInputs(this.world.tick);
    if (this.requestedWarp > 1) this.regulateWarp();
    const events = this.world.step();
    this.handleFaults(events);
    this.broadcastChunkDeltas();
    if (this.world.tick % this.settings.snapshotEveryTicks === 0) this.broadcastSnapshot();
    return events;
  }

  /** Advance the world simulation by wall-clock seconds, taking time warp into account.
   * If warp is 1, steps normally.
   * If warp > 1, applies safety checks, drops warp if active thrust or collision proximity
   * is detected, fast-forwards on rails up to the target tick or next event/input, and
   * automatically drops back to 1x when an encounter (such as SOI entry/exit) is reached.
   * beforeTick supplies local assistant controls at normal/physical warp (up to 4x),
   * never across an analytic jump. A rate change still executes that commanded tick,
   * then discards the rest of the interval computed at the old rate. */
  advance(seconds: number, beforeTick?: () => void): WorldEvent[] {
    this.assertActive();
    if (this.paused) return [];
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');

    if (this.requestedWarp > 1) this.regulateWarp();

    if (this.warp === 1) {
      const events: WorldEvent[] = [];
      const accepted = Math.min(seconds, 0.2);
      this.warpAccumulator += accepted;
      let steps = 0;
      while (this.warpAccumulator + 1e-12 >= this.services.clock.stepSeconds && steps < 20) {
        beforeTick?.();
        events.push(...this.step());
        this.warpAccumulator -= this.services.clock.stepSeconds;
        steps++;
      }
      return events;
    }

    const events: WorldEvent[] = [];
    const acceptedSeconds = Math.min(seconds, 0.1);
    const effectiveSeconds = acceptedSeconds * this.warp;
    this.warpAccumulator += effectiveSeconds;
    this.warpSnapshotSeconds += acceptedSeconds;

    const totalTicksToAdvance = Math.floor(this.warpAccumulator / this.services.clock.stepSeconds);
    if (totalTicksToAdvance <= 0) return events;

    const targetTick = this.world.tick + totalTicksToAdvance;
    this.warpAccumulator -= totalTicksToAdvance * this.services.clock.stepSeconds;
    const warp = this.warp;

    // Time computed for this warp factor ends when the factor changes.
    while (this.world.tick < targetTick && !this.paused && this.warp === warp) {
      let earliestInputTick = Infinity;
      for (const queue of this.queues.values()) {
        if (queue.length && queue[0]!.tick < earliestInputTick) {
          earliestInputTick = queue[0]!.tick;
        }
      }

      // Due now, or late: an input stamped before the host's clock (a mirror that fell
      // behind, say in a hidden tab) applies at once instead of stalling the loop.
      if (earliestInputTick <= this.world.tick) {
        this.applyDueInputs(this.world.tick);
        if (this.regulateWarp()) break;
        events.push(...this.step());
        continue;
      }

      const nextBound = Math.min(targetTick, earliestInputTick);

      if (nextBound > this.world.tick) {
        const preSafety = this.services.motion.checkWarpSafety(this.world);
        if (preSafety.railsEligible && this.world.rails && !(beforeTick && warp <= 4)) {
          const stepEvents = this.world.advanceTo(nextBound);
          events.push(...stepEvents);
          this.handleFaults(stepEvents);
          if (stepEvents.length > 0 || this.world.awakeCount > 0) {
            this.stopWarp(stepEvents.some(e => e.type === 'soi') ? 'Sphere of influence transition'
              : stepEvents.some(e => e.type === 'contact') ? 'Surface contact'
              : 'Ship woke from rails');
            break;
          }
        } else {
          const maxSteps = 40;
          let steps = 0;
          while (this.world.tick < nextBound && steps < maxSteps && !this.paused && this.warp === warp) {
            beforeTick?.();
            if (this.paused) break;
            events.push(...this.step());
            steps++;
          }
          if (steps >= maxSteps && this.world.tick < nextBound) {
            this.stopWarp('Numerical stepping budget exceeded');
            break;
          }
        }
      }
    }

    // Ticks jump while warping: publish on the wall clock, as often as at normal speed.
    if (this.warpSnapshotSeconds >= this.settings.snapshotEveryTicks * this.services.clock.stepSeconds || this.dirty) this.broadcastSnapshot();
    return events;
  }

  /** Housekeeping on the wall clock: join timeouts, releasing silent players' controls and
   * publishing changes made while paused. */
  service(): void {
    this.assertActive();
    const now = this.now();
    for (const peer of this.peers) {
      if (peer.player && peer.dataRevision !== this.world.data.revision) this.dirty = true;
      if (!peer.player) {
        if (now - peer.openedAt > this.settings.joinTimeoutMs) this.drop(peer, 'timeout', 'Join timed out.');
      } else if (!peer.released && now - peer.lastHeard > this.settings.releaseAfterMs) {
        peer.released = true;
        this.releaseControls(peer.player.id);
      }
    }
    if (this.dirty && this.paused) this.broadcastSnapshot();
  }

  close(reason = 'The host closed the session.'): void {
    const errors: unknown[] = [];
    for (const peer of [...this.peers]) { try { this.drop(peer, 'closing', reason); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Flight peer cleanup failed');
  }

  /** Release this session's delta consumer as well as every peer and held control. */
  dispose(): void {
    if (this.disposed || this.disposing) return; this.disposing = true;
    const errors: unknown[] = [];
    try { this.close(); } catch (error) { errors.push(error); }
    for (const player of this.players.values()) { try { this.releaseControls(player.id); } catch (error) { errors.push(error); } }
    try { this.changes.dispose(); } catch (error) { errors.push(error); }
    this.queues.clear(); this.acks.clear(); this.onchat = null; this.onplayers = null;
    this.subscriptions.clear(); this.outboundDeltas.clear(); this.chunkBodies.clear(); this.chunkRevisions.clear();
    this.disposed = true; this.disposing = false;
    if (errors.length) throw new AggregateError(errors, 'Flight host cleanup failed');
  }

  /** The complete world. */
  snapshot(): HostMessage {
    return { ...(this.world.data.schemas.length ? { data: this.world.data.snapshot() } : {}), t: 'snapshot', tick: this.world.tick, time: this.world.time, paused: this.paused,
      ...(this.paused && this.pauseReason ? { reason: this.pauseReason } : {}),
      ...(this.warp > 1 ? { warp: this.warp } : {}),
      ships: this.netShips(), full: true,
      ...(this.world.rules.length > 0 ? { moduleState: this.world.moduleState } : {}) };
  }

  private netShips(): NetShip[] { return this.world.ships().map(ship => this.netShip(ship)); }
  private netShip(ship: Ship): NetShip {
    const ack = this.acks.get(ship.id);
    return { ...this.services.save.shipToSaved(ship), controls: [ship.controls.turn, ship.controls.throttle, ship.controls.engine ? 1 : 0],
      ...(ack !== undefined ? { ack } : {}) };
  }

  private awakeRefresh?: Iterator<Ship>;
  private refresh?: Iterator<Ship>;
  /** The next `count` ships from a cycle through `source`, restarting it at the end. */
  private take(count: number, cursor: 'awakeRefresh' | 'refresh', source: () => Iterator<Ship>, into: Set<string>): void {
    let iterator = this[cursor] ?? source(), restarted = false;
    while (count > 0) {
      const next = iterator.next();
      if (next.done) {
        if (restarted) break;
        iterator = source(); restarted = true;
        continue;
      }
      into.add(next.value.id); count--;
    }
    this[cursor] = iterator;
  }

  /** Each peer gets the complete world when it needs it, otherwise a delta: ships changed by
   * a command since the last snapshot, ships removed, the peer's own ships (for input
   * acknowledgements and replay), and a rotating slice of awake and of sleeping ships so
   * every ship is refreshed now and then. Idle ships cost no bandwidth. */
  private broadcastSnapshot(): void {
    this.dirty = false;
    this.warpSnapshotSeconds = 0;
    const { changed, removed } = this.changes.take();
    const ready = [...this.peers].filter(p => p.player && !p.closed);
    for (const peer of ready) {
      if (peer.needsFull) continue;
      for (const id of changed) { peer.changed.add(id); peer.removed.delete(id); }
      for (const id of removed) { peer.changed.delete(id); peer.removed.add(id); }
    }
    const live = ready.filter(p => p.connection.bufferedAmount <= SNAPSHOT_BACKLOG_BYTES);
    if (!live.length) return;
    let full: string | undefined;
    const clock = JSON.stringify({ t: 'snapshot' as const, tick: this.world.tick, time: this.world.time, paused: this.paused,
      ...(this.paused && this.pauseReason ? { reason: this.pauseReason } : {}),
      ...(this.warp > 1 ? { warp: this.warp } : {}) }).slice(0, -1);
    const refresh = new Set<string>();
    if (live.some(p => !p.needsFull)) {
      const awake = this.world.awakeCount;
      this.take(Math.ceil(awake / AWAKE_REFRESH_SNAPSHOTS), 'awakeRefresh', () => this.world.awakeShips(), refresh);
      this.take(Math.ceil((this.world.size - awake) / REFRESH_SNAPSHOTS), 'refresh', () => this.world.records(), refresh);
    }
    // Each listed ship is serialized once per broadcast and shared by every peer's message.
    const encoded = new Map<string, string | null>();
    const encode = (id: string): string | null => {
      let text = encoded.get(id);
      if (text === undefined) {
        const ship = this.world.ship(id);
        text = ship ? JSON.stringify(this.netShip(ship)) : null;
        encoded.set(id, text);
      }
      return text;
    };
    for (const peer of live) {
      if (peer.needsFull) {
        full ??= JSON.stringify(this.snapshot());
        peer.connection.send(full);
        peer.dataRevision = this.world.data.revision;
        peer.needsFull = false;
        peer.changed.clear(); peer.removed.clear();
        continue;
      }
      const ids = new Set([...peer.changed, ...refresh, ...this.world.ownedBy(peer.player!.id)]);
      const parts: string[] = [];
      for (const id of ids) { const text = encode(id); if (text) parts.push(text); }
      const gone = peer.removed.size ? `,"gone":${JSON.stringify([...peer.removed])}` : '';
      const moduleState = this.world.rules.length > 0 ? `,"moduleState":${JSON.stringify(this.world.moduleState)}` : '';
      const data = this.world.data.schemas.length && peer.dataRevision !== this.world.data.revision
        ? `,"data":${JSON.stringify(this.world.data.delta(peer.dataRevision))}` : '';
      peer.connection.send(`${clock},"ships":[${parts.join(',')}]${gone}${moduleState}${data}}`);
      peer.dataRevision = this.world.data.revision;
      peer.changed.clear(); peer.removed.clear();
    }
  }

  private receive(peer: Peer, text: string): void {
    if (peer.closed) return;
    const now = this.now();
    peer.allowance = Math.min(RATE_BURST, peer.allowance + (now - peer.refilledAt) * RATE_PER_SECOND / 1000);
    peer.refilledAt = now;
    if (--peer.allowance < 0) { this.drop(peer, 'rate', 'Too many messages.'); return; }
    peer.lastHeard = now;
    peer.released = false;
    let message: ClientMessage;
    try { message = parseClientMessage(text); } catch (error) {
      this.drop(peer, 'invalid', error instanceof ProtocolError ? `Invalid message: ${error.message}` : 'Invalid message.');
      return;
    }
    if (message.t === 'ping') { this.send(peer, { t: 'pong', id: message.id, tick: this.world.tick }); return; }
    try {
      if (message.t === 'join') { this.join(peer, message); return; }
      const player = peer.player;
      if (!player) { this.drop(peer, 'invalid', 'Join first.'); return; }
      switch (message.t) {
        case 'input': this.input(player, message); break;
        case 'spawn': this.spawnShip(player.id, message.preset, false, message.vehicleId); break;
        case 'respawn': this.respawnShip(player.id, message.ship, message.preset); break;
        case 'remove': this.removeShip(player.id, message.ship); break;
        case 'god': this.setGodMode(player.id, message.ship, message.on); break;
        case 'data-command': this.dataCommand(player.id, message.request); break;
        case 'command': this.command(player.id, message.ship, message.command, message.args); break;
        case 'teleport':
          this.teleportShip(player.id, message.ship, message.body, { x: message.x, y: message.y },
            { x: message.vx, y: message.vy }, message.heading);
          break;
        case 'chat': {
          peer.chatAllowance = Math.min(CHAT_BURST, peer.chatAllowance + (now - peer.chatRefilledAt) / CHAT_REFILL_MS);
          peer.chatRefilledAt = now;
          if (peer.chatAllowance < 1) throw new SessionError('You are sending messages too quickly.');
          peer.chatAllowance--;
          this.chat(player.id, message.text);
          break;
        }
        case 'sub-chunks': this.subscribeChunks(player.id, message.bodyId, message.chunkKeys); break;
        case 'unsub-chunks': this.unsubscribeChunks(player.id, message.bodyId, message.chunkKeys); break;
        case 'resync':
          if (now - peer.resyncAt < RESYNC_INTERVAL_MS) break;
          peer.resyncAt = now;
          peer.needsFull = true;
          // Delivered by the next snapshot, or by service() while paused.
          this.dirty = true;
          break;
      }
    } catch (error) {
      if (error instanceof SessionError) { this.send(peer, { t: 'notice', text: error.message }); return; }
      // One player's command must never take the host down.
      this.log(`Command from ${peer.connection.label} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.drop(peer, 'invalid', 'The host could not apply a command.');
    }
  }

  private join(peer: Peer, message: Extract<ClientMessage, { t: 'join' }>): void {
    if (peer.player) { this.drop(peer, 'invalid', 'Already joined.'); return; }
    if (this.world.vehicles && message.vehicleVersion !== VEHICLE_PROTOCOL) {
      this.drop(peer, 'version', 'Missing required mixed-vehicle replication support.'); return;
    }
    if (this.world.data.schemas.length && message.dataVersion !== MODULE_DATA_PROTOCOL) {
      this.drop(peer, 'version', 'Missing required module-data replication support.'); return;
    }
    if (this.settings.password && !sameText(message.password ?? '', this.settings.password)) {
      this.drop(peer, 'password', message.password ? 'Wrong password.' : 'This server needs a password.');
      return;
    }
    const hash = message.token ? sha256Hex(message.token) : undefined;
    let player = hash ? [...this.players.values()].find(p => p.tokenHash === hash) : undefined;
    if (player?.host || player?.local) { this.drop(peer, 'replaced', player.host ? 'That pilot is the host.' : 'That pilot is playing on the host\'s screen.'); return; }
    if (!player?.peer && this.connectedCount() >= this.settings.maxPlayers) {
      this.drop(peer, 'full', `The game is full (${this.settings.maxPlayers} players).`);
      return;
    }
    if (player?.peer) this.drop(player.peer, 'replaced', 'You joined from another window.');
    let token: string | undefined;
    if (!player && !this.makeRoom()) {
      this.drop(peer, 'full', 'This world has no room for new pilots.');
      return;
    }
    if (!player) {
      token = newToken();
      player = { id: this.uniquePlayerId(), name: '', tokenHash: sha256Hex(token) };
      this.players.set(player.id, player);
    }
    player.name = cleanName(message.name, MAX_PLAYER_NAME) || 'Pilot';
    player.peer = peer;
    peer.player = player;
    const playerId = player.id;
    if (!this.ownedCount(playerId)) {
      try { this.spawnShip(playerId); } catch (error) { if (!(error instanceof SessionError)) throw error; }
    }
    this.log(`${player.name} joined (${peer.connection.label})`);
    this.send(peer, { ...(this.world.vehicles ? { vehicles: this.world.vehicles } : {}), ...(this.world.data.schemas.length ? { data: this.world.data.snapshot() } : {}), t: 'welcome', playerId, ...(token ? { token } : {}), universe: this.world.universe,
      systemId: this.world.systemId, tick: this.world.tick, time: this.world.time, paused: this.paused,
      ...(this.paused && this.pauseReason ? { reason: this.pauseReason } : {}),
      ...(this.warp > 1 ? { warp: this.warp } : {}),
      rules: { maxPlayers: this.settings.maxPlayers, maxShipsPerPlayer: this.settings.maxShipsPerPlayer,
        allowGodMode: this.settings.allowGodMode, snapshotEveryTicks: this.settings.snapshotEveryTicks },
      players: this.playerList(), ships: this.netShips(),
      lock: this.world.lock ?? this.services.save.defaultLock,
      fingerprint: this.world.simulationFingerprint,
      ...(this.world.rules.length > 0 ? { moduleState: this.world.moduleState } : {}) });
    peer.needsFull = false; peer.dataRevision = this.world.data.revision;
    this.changedPlayers();
  }

  private input(player: Player, message: Extract<ClientMessage, { t: 'input' }>): void {
    this.owned(player.id, message.ship);
    let queue = this.queues.get(message.ship);
    if (!queue) { queue = []; this.queues.set(message.ship, queue); }
    if (queue.length >= MAX_QUEUED_INPUTS) throw new SessionError('Too many queued inputs.');
    const input: PendingInput = { seq: message.seq,
      tick: Math.min(message.tick, this.world.tick + MAX_INPUT_LEAD_TICKS),
      controls: { turn: message.turn, throttle: message.throttle, engine: message.engine },
      ...(message.set !== undefined ? { set: message.set } : {}) };
    let i = queue.length;
    while (i > 0 && (queue[i - 1]!.tick > input.tick || (queue[i - 1]!.tick === input.tick && queue[i - 1]!.seq > input.seq))) i--;
    queue.splice(i, 0, input);
  }

  private releaseControls(playerId: string): void {
    for (const ship of [...this.world.records()]) {
      if (ship.ownerId !== playerId) continue;
      this.queues.delete(ship.id);
      this.world.setControls(ship.id, this.services.clock.idle);
    }
  }

  private disconnected(peer: Peer, reason: string): void {
    if (!this.peers.delete(peer)) return;
    peer.closed = true;
    const player = peer.player;
    if (player?.peer !== peer) return;
    player.peer = undefined;
    this.subscriptions.delete(player.id);
    this.outboundDeltas.delete(player.id);
    this.releaseControls(player.id);
    this.log(`${player.name} left (${reason})`);
    this.changedPlayers();
  }

  private drop(peer: Peer, code: ErrorCode, message: string): void {
    if (peer.closed) return;
    try { this.send(peer, { t: 'error', code, message }); }
    finally {
      peer.closed = true;
      try { peer.connection.close(message); } finally { this.disconnected(peer, message); }
    }
  }

  private send(peer: Peer, message: HostMessage): void {
    if (!peer.closed) peer.connection.send(JSON.stringify(message));
  }

  private changed(): void { this.dirty = true; }
  private changedPlayers(): void {
    const text = JSON.stringify({ t: 'players', players: this.playerList() } satisfies HostMessage);
    for (const peer of this.peers) if (peer.player && !peer.closed) peer.connection.send(text);
    this.onplayers?.();
  }

  private requirePlayer(playerId: string): Player {
    const player = this.players.get(playerId);
    if (!player) throw new SessionError('Unknown player.');
    return player;
  }
  private ownedCount(playerId: string): number { return this.world.ownedBy(playerId).size; }
  /** Ships that belong to known players; passive objects (asteroids) do not count. */
  private pilotedShips(): number {
    let n = 0;
    for (const id of this.players.keys()) n += this.world.ownedBy(id).size;
    return n;
  }
  private owned(playerId: string, shipId: string): Ship {
    this.requirePlayer(playerId);
    const ship = this.world.record(shipId);
    if (!ship || ship.ownerId !== playerId) throw new SessionError('You can only command your own ships.');
    return ship;
  }
  /** Keep the roster within what a save holds by forgetting a pilot who is away and
   * owns no ships. */
  private makeRoom(): boolean {
    if (this.players.size < MAX_SAVE_PLAYERS) return true;
    const owners = new Set([...this.world.records()].map(s => s.ownerId));
    for (const player of this.players.values()) {
      if (!player.peer && !player.host && !player.local && !owners.has(player.id)) { this.players.delete(player.id); return true; }
    }
    return false;
  }
  private uniquePlayerId(): string {
    let id = newPlayerId();
    while (this.players.has(id)) id = newPlayerId();
    return id;
  }
}

/** Compare without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
