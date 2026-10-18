import { captureVehicleCatalog } from '@space-sim/game-api';
import type { ModuleDataCommand, ModuleDataExtension } from '@space-sim/game-api';
import type { WorldControl, WorldFactory, AuthoritativeLock, CommandExtension, ForceExtension, JoinOptions, ModuleLock, SimulationContextFactory, WorldRuleExtension, Controls, Vec, Ship, WorldEvent, FlightSessionServices, TextConnection as Connection } from '@space-sim/game-api';
import {
  MAX_CHAT, MAX_INPUT_LEAD_TICKS, PROTOCOL, MODULE_DATA_PROTOCOL, VEHICLE_PROTOCOL, parseHostMessage, type ClientMessage, type HostMessage, type NetPlayer, type NetShip, type SessionRules,
} from './protocol';

export interface ClientOptions {
  readonly vehicles?: JoinOptions['vehicles'];
  readonly dataAdapters?: readonly ModuleDataExtension[];
  readonly createContext?: SimulationContextFactory;
  readonly worldFactory?: WorldFactory;
  readonly name: string;
  readonly password?: string;
  /** A reconnect token saved for this world, if any. `hostId` is the player seated in the
   * hosting browser: a browser sharing storage with it must not present that seat's token.
   * May await a browser lock to avoid reclaiming a seat in use by another window. */
  readonly token?: JoinOptions['token'];
  /** Store a newly issued token; it reclaims this player's ships later. */
  readonly saveToken?: (worldId: string, token: string, playerId: string) => void;
  /** Milliseconds on a monotonic clock. */
  readonly now?: () => number;
  readonly lock?: AuthoritativeLock | ModuleLock;
  readonly simulationFingerprint?: string;
  readonly rules?: readonly WorldRuleExtension[];
  readonly forces?: readonly ForceExtension[];
  /** This client's installed command definitions; the matching fingerprint pins them to the host's. */
  readonly commands?: readonly CommandExtension[];
  readonly verifyCandidate?: JoinOptions['verifyCandidate'];
}

type Snapshot = Extract<HostMessage, { t: 'snapshot' }>;
interface InputEvent { readonly seq: number; readonly tick: number; readonly shipId: string; readonly controls: Controls; readonly set?: number }
interface Offset { readonly x: number; readonly y: number; readonly bodyId: string; readonly at: number }

const TICK_MS = 10;
/** Assumed round trip until measured. */
const DEFAULT_RTT_MS = 100;
/** Extra lead so inputs arrive before the host simulates their tick. */
const LEAD_MARGIN_MS = 40;
const SYNC_WINDOW_MS = 3000;
const PING_INTERVAL_MS = 1000;
const MAX_STEPS_PER_UPDATE = 60;
const MAX_REPLAY_TICKS = 400;
/** Ask again if a requested complete world has not arrived by then. */
const RESYNC_RETRY_MS = 2000;
/** Deltas waiting for a frame (a hidden tab gets none); past this the complete world is
 * requested instead. */
const MAX_PENDING_SNAPSHOTS = 64;
/** Room left under the host's input horizon for an input's trip to the host. */
const INPUT_HORIZON_MARGIN_TICKS = 20;
/** Unacknowledged inputs this far behind the host are dropped. */
const INPUT_HISTORY_TICKS = 300;
/** Visual corrections fade with this time constant. */
const SMOOTHING_MS = 120;

const sameControls = (a: Controls, b: Controls): boolean => a.turn === b.turn && a.throttle === b.throttle && a.engine === b.engine;

/** Joins a host and keeps a predicted mirror of its world. Every ship advances locally with
 * the same physics: owned ships with this player's inputs, others with the controls the
 * host last reported. Each snapshot rewinds to the authoritative state and replays inputs
 * the host has not acknowledged, so the local ship responds at once. Display corrections
 * fade instead of jumping. */
export class ClientSession {
  phase: 'connecting' | 'joined' | 'closed' = 'connecting';
  world?: WorldControl;
  playerId?: string;
  worldId = '';
  hostName = '';
  /** The player seated in the hosting browser, if the host is a browser. */
  hostSeat?: string;
  players: readonly NetPlayer[] = [];
  rules?: SessionRules;
  paused = false;
  pauseReason = '';
  warp = 1;
  closeReason = '';
  rttMs = NaN;
  /** Presentation fraction of the next fixed step. */
  alpha = 0;
  onjoined: (() => void) | null = null;
  onplayers: (() => void) | null = null;
  onnotice: ((text: string) => void) | null = null;
  /** A chat line from a player (`from`), or from the server console. */
  onchat: ((line: { readonly from?: string; readonly name: string; readonly text: string }) => void) | null = null;
  onclose: ((reason: string) => void) | null = null;

  private readonly connection: Connection;
  private readonly options: ClientOptions;
  private readonly now: () => number;
  /** Snapshots received since the last update, oldest first. Each delta lists only what
   * changed since the one before, so none may be skipped. */
  private pending: Array<{ readonly snapshot: Snapshot; readonly at: number }> = [];
  private overflowed = false;
  private events: InputEvent[] = [];
  private cursor = 0;
  private seq = 0;
  private readonly sent = new Map<string, Controls>();
  private selected?: string;
  private readonly offsets = new Map<string, Offset>();
  private reported = 0;
  private readonly pings = new Map<number, number>();
  private pingId = 0;
  private lastPing = -Infinity;
  private rtts: number[] = [];
  private samples: Array<{ readonly offset: number; readonly at: number }> = [];
  /** The newest tick the host has reported (snapshots, pongs). */
  private hostTick = 0;
  private hostFingerprint?: string;
  /** When the complete world was last requested; deltas wait for it. */
  private resyncAt = -Infinity;

  constructor(private readonly services: FlightSessionServices, connection: Connection, options: ClientOptions) {
    this.connection = connection;
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    connection.onmessage = text => this.receive(text);
    connection.onclose = reason => this.closed(reason);
  }

  ownShips(): Ship[] { return this.world ? [...this.world.records()].filter(s => s.ownerId === this.playerId) : []; }
  previous(shipId: string): Ship | undefined { return this.world?.previous(shipId); }

  /** Body-relative display correction that fades to zero; physics never reads it. */
  displayOffset(shipId: string): Vec {
    const o = this.offsets.get(shipId);
    if (!o) return { x: 0, y: 0 };
    const fade = Math.exp(-(this.now() - o.at) / SMOOTHING_MS);
    if (fade < 1e-3) { this.offsets.delete(shipId); return { x: 0, y: 0 }; }
    return { x: o.x * fade, y: o.y * fade };
  }

  /** Held controls for the piloted ship; call every frame. Changing ships releases the last. */
  control(shipId: string | undefined, controls: Controls): void {
    if (this.phase !== 'joined') return;
    if (this.selected && this.selected !== shipId) this.input(this.selected, this.services.clock.idle);
    this.selected = shipId;
    if (shipId) this.input(shipId, controls);
  }
  setThrottle(shipId: string, throttle: number): void {
    const ship = this.world?.ship(shipId);
    if (ship) this.input(shipId, this.sent.get(shipId) ?? ship.controls, Math.max(0, Math.min(1, throttle)));
  }
  spawn(presetId?: string, vehicleId?: string): void { this.send({ ...(vehicleId ? { vehicleId } : {}), t: 'spawn', ...(presetId ? { preset: presetId } : {}) }); }
  respawn(shipId: string, presetId?: string): void {
    this.sent.delete(shipId);
    this.send({ t: 'respawn', ship: shipId, ...(presetId ? { preset: presetId } : {}) });
  }
  remove(shipId: string): void { this.send({ t: 'remove', ship: shipId }); }
  setGodMode(shipId: string, on: boolean): void { this.send({ t: 'god', ship: shipId, on }); }
  /** Ask the host to place an owned ship (a cheat the host may refuse with a notice). */
  teleport(shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): void {
    // The host releases the ship's controls; held keys are sent again.
    this.sent.delete(shipId);
    this.send({ t: 'teleport', ship: shipId, body: bodyId, x: position.x, y: position.y, vx: velocity.x, vy: velocity.y,
      ...(heading !== undefined ? { heading } : {}) });
  }
  /** A module command request; the host validates and applies it, and the next snapshot
   * carries the result. */
  command(shipId: string, commandId: string, args?: Readonly<Record<string, number>>): void {
    this.send({ t: 'command', ship: shipId, command: commandId, ...(args && Object.keys(args).length ? { args } : {}) });
  }

  dataCommand(request: ModuleDataCommand): void { if (this.phase === 'joined') this.send({ t: 'data-command', request }); }
  chat(text: string): void {
    const line = text.trim().slice(0, MAX_CHAT);
    if (line && this.phase === 'joined') this.send({ t: 'chat', text: line });
  }

  leave(): void { this.connection.close('Left the game.'); }

  /** Apply the newest snapshot, then advance the mirror to the predicted host tick. Returns
   * events from ticks not reported before. */
  update(): WorldEvent[] {
    const out: WorldEvent[] = [];
    const world = this.world;
    if (this.phase !== 'joined' || !world) return out;
    const now = this.now();
    if (now - this.lastPing >= PING_INTERVAL_MS) {
      this.lastPing = now;
      this.pings.set(++this.pingId, now);
      if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!);
      this.send({ t: 'ping', id: this.pingId });
    }
    if (this.overflowed) { this.overflowed = false; this.requestResync(now); }
    const pending = this.pending;
    this.pending = [];
    for (const { snapshot, at } of pending) {
      if (this.phase !== 'joined') return out;
      this.reconcile(snapshot, at, out);
    }
    const target = this.paused ? undefined : this.targetTick(now);
    if (target === undefined) { this.alpha = 1; return out; }
    const goal = Math.floor(target);
    if (world.tick < goal) this.catchUp(goal, out, this.warp > 1 ? Math.min(300, Math.ceil(this.warp * 2)) : MAX_STEPS_PER_UPDATE);
    this.alpha = world.tick === goal ? target - goal : 1;
    return out;
  }

  /** Advance the mirror toward `goal`: on rails while warping and nothing needs stepping
   * (as the host does), otherwise at most `budget` fixed steps. False if it stopped short. */
  private catchUp(goal: number, out: WorldEvent[], budget: number): boolean {
    const world = this.world!;
    let steps = 0;
    while (world.tick < goal && !this.paused) {
      if (this.warp > 1 && this.cursor >= this.events.length && world.awakeCount === 0 && world.rules.length === 0 && world.rails) {
        const before = world.tick;
        out.push(...world.advanceTo(goal));
        this.reported = Math.max(this.reported, world.tick);
        if (world.tick > before) continue;
      }
      if (steps++ >= budget) return false;
      this.stepOnce(out);
    }
    // Paused: the host's clock stands still too.
    return world.tick >= goal || this.paused;
  }

  /** The mirror cannot catch up with a delta in one go: ask for the complete world. */
  private requestResync(now: number): void {
    if (now - this.resyncAt < RESYNC_RETRY_MS) return;
    this.resyncAt = now;
    this.send({ t: 'resync' });
  }

  /** Estimated host tick at local time `now`, from the least-delayed recent clock sample. */
  serverTick(now = this.now()): number | undefined {
    this.samples = this.samples.filter(s => now - s.at <= SYNC_WINDOW_MS);
    if (!this.samples.length) return undefined;
    let best = -Infinity;
    for (const s of this.samples) best = Math.max(best, s.offset);
    const effectiveTickMs = TICK_MS / (this.warp || 1);
    const minRtt = this.rtts.length ? Math.min(...this.rtts) : DEFAULT_RTT_MS;
    return now / effectiveTickMs + best + minRtt / 2 / effectiveTickMs;
  }

  private targetTick(now: number): number | undefined {
    const server = this.serverTick(now);
    if (server === undefined) return undefined;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const rtt = sorted.length ? sorted[sorted.length >> 1]! : DEFAULT_RTT_MS;
    const effectiveTickMs = TICK_MS / (this.warp || 1);
    const target = server + (rtt / 2 + LEAD_MARGIN_MS) / effectiveTickMs;
    // A host that stalls (a hidden or busy tab) still answers, with its real tick. Running
    // past what it will schedule would stamp inputs it moves earlier, and the pilot would
    // see a flight the host never flies; wait for it instead. (Warp ends on any input.)
    return this.warp > 1 ? target : Math.min(target, this.hostTick + MAX_INPUT_LEAD_TICKS - INPUT_HORIZON_MARGIN_TICKS);
  }

  private input(shipId: string, controls: Controls, set?: number): void {
    const world = this.world;
    const ship = world?.ship(shipId);
    if (!world || !ship || ship.ownerId !== this.playerId) return;
    const last = this.sent.get(shipId) ?? ship.controls;
    if (set === undefined && sameControls(last, controls)) return;
    const event: InputEvent = { seq: ++this.seq, tick: world.tick, shipId, controls: { ...controls },
      ...(set !== undefined ? { set } : {}) };
    this.events.push(event);
    this.sent.set(shipId, event.controls);
    this.send({ t: 'input', seq: event.seq, ship: shipId, tick: event.tick, turn: controls.turn,
      throttle: controls.throttle, engine: controls.engine, ...(set !== undefined ? { set } : {}) });
  }

  private applyDue(): void {
    const world = this.world!;
    while (this.cursor < this.events.length && this.events[this.cursor]!.tick <= world.tick) {
      const event = this.events[this.cursor++]!;
      if (!world.ship(event.shipId)) continue;
      world.setControls(event.shipId, event.controls);
      if (event.set !== undefined) world.setThrottle(event.shipId, event.set);
    }
  }

  private stepOnce(out: WorldEvent[]): void {
    const world = this.world!;
    this.applyDue();
    const events = world.step();
    if (world.tick > this.reported) {
      out.push(...events);
      this.reported = world.tick;
    }
  }

  private reconcile(snapshot: Snapshot, at: number, out: WorldEvent[]): void {
    const nextWarp = snapshot.warp ?? 1;
    if (snapshot.paused !== this.paused || nextWarp !== this.warp) this.samples = [];
    this.paused = snapshot.paused;
    this.pauseReason = snapshot.reason ?? '';
    this.warp = nextWarp;
    if (!snapshot.paused) {
      const effectiveTickMs = TICK_MS / (this.warp || 1);
      this.samples.push({ offset: snapshot.tick - at / effectiveTickMs, at });
    }
    this.hostTick = Math.max(this.hostTick, snapshot.tick);
    if (snapshot.full) this.resyncAt = -Infinity;
    // Deltas build on a world this mirror no longer has; the complete one is on its way.
    else if (this.now() - this.resyncAt < RESYNC_RETRY_MS) return;
    if (this.world!.rules.length > 0) this.reconcileWorld(snapshot, out);
    else if (snapshot.full) this.resync(snapshot, out);
    else this.patch(snapshot, out);
  }

  /** Whole-world reconciliation when rules run across the fleet:
   * rewinds all ships and rule states to snapshot tick, rewinds omitted sleeping ships to snapshot time,
   * replays unacknowledged inputs, and advances the world deterministically. */
  private reconcileWorld(snapshot: Snapshot, out: WorldEvent[]): void {
    const world = this.world!;
    const now = this.now();
    const shown = new Map<string, Offset>();
    for (const ship of world.ships()) {
      const o = this.displayOffset(ship.id);
      shown.set(ship.id, { x: ship.state.position.x + o.x, y: ship.state.position.y + o.y, bodyId: ship.bodyId, at: now });
    }
    const predicted = world.tick;
    // Catching up only reports events on the way; a complete world replaces everything.
    if (!this.catchUp(snapshot.tick, out, MAX_REPLAY_TICKS) && !snapshot.full) { this.requestResync(now); return; }

    world.restoreClock(snapshot.tick, snapshot.time);
    if (snapshot.moduleState) {
      world.setModuleState(snapshot.moduleState);
    }
    const acks = new Map<string, number>();
    const seen = new Set<string>();
    for (const raw of snapshot.ships) {
      const record = this.verified(raw, snapshot.time);
      if (!record) continue;
      world.put(record);
      seen.add(record.id);
      if (raw.ack !== undefined && record.ownerId === this.playerId) acks.set(record.id, raw.ack);
    }
    for (const id of snapshot.gone ?? []) {
      world.remove(id);
      this.offsets.delete(id);
    }
    if (snapshot.full) {
      for (const ship of [...world.records()]) if (!seen.has(ship.id)) world.remove(ship.id);
    } else {
      for (const ship of world.ships()) {
        if (!seen.has(ship.id)) {
          const stateAt = world.stateAt(ship.id, snapshot.time);
          if (stateAt) {
            world.put({ ...ship, state: stateAt });
          }
        }
      }
    }
    this.events = this.events.filter(e => world.has(e.shipId) && e.seq > (acks.get(e.shipId) ?? -1)
      && e.tick >= snapshot.tick - INPUT_HISTORY_TICKS);
    this.cursor = 0;
    this.selfHeal();
    if (!this.paused) {
      const goal = Math.min(predicted, snapshot.tick + MAX_REPLAY_TICKS);
      while (world.tick < goal) this.stepOnce(out);
    }
    for (const ship of world.ships()) {
      const old = shown.get(ship.id);
      const dx = old ? old.x - ship.state.position.x : 0, dy = old ? old.y - ship.state.position.y : 0;
      const limit = Math.max(20, this.services.motion.magnitude(ship.state.velocity) * 0.25);
      if (old && old.bodyId === ship.bodyId && (dx || dy) && Math.hypot(dx, dy) <= limit) {
        this.offsets.set(ship.id, { x: dx, y: dy, bodyId: ship.bodyId, at: now });
      } else this.offsets.delete(ship.id);
    }
  }

  /** A delta: adopt each listed ship at the snapshot tick and catch it up to the mirror's
   * tick on its own (replaying this pilot's unacknowledged inputs); everything else is
   * already what the host computes. */
  private patch(snapshot: Snapshot, out: WorldEvent[]): void {
    const world = this.world!;
    const now = this.now();
    // A mirror behind the host first steps up to the snapshot; one far behind (a hidden
    // tab, a stall) asks for the complete world instead of stepping for seconds.
    if (!this.catchUp(snapshot.tick, out, MAX_REPLAY_TICKS)) { this.requestResync(now); return; }
    const ahead = world.tick - snapshot.tick;
    if (ahead < 0) { this.resync({ ...snapshot, full: true }, out); return; }
    const acks = new Map<string, number>();
    for (const raw of snapshot.ships) if (raw.ack !== undefined) acks.set(raw.id, raw.ack);
    this.events = this.events.filter(e => world.has(e.shipId) && e.seq > (acks.get(e.shipId) ?? -1)
      && e.tick >= snapshot.tick - INPUT_HISTORY_TICKS);
    for (const raw of snapshot.ships) {
      const old = world.has(raw.id) ? world.ship(raw.id)! : undefined;
      const shown = old && this.displayOffset(raw.id);
      const record = this.verified(raw, snapshot.time);
      if (!record) continue;
      if (raw.ack !== undefined && record.ownerId !== this.playerId) acks.delete(raw.id);
      const mine = this.events.filter(e => e.shipId === raw.id);
      let next = 0;
      // The replayed steps were all reported when the mirror first took them. Without inputs
      // to replay, a coasting ship skips its catch-up steps on rails.
      world.adopt(record, ahead, mine.length ? (ship, tick) => {
        for (; next < mine.length && mine[next]!.tick <= tick; next++) ship = this.applyInput(ship, mine[next]!);
        return ship;
      } : undefined);
      const ship = world.ship(raw.id)!;
      if (old && shown) {
        const dx = old.state.position.x + shown.x - ship.state.position.x, dy = old.state.position.y + shown.y - ship.state.position.y;
        const limit = Math.max(20, this.services.motion.magnitude(ship.state.velocity) * 0.25);
        if (old.bodyId === ship.bodyId && (dx || dy) && Math.hypot(dx, dy) <= limit) {
          this.offsets.set(ship.id, { x: dx, y: dy, bodyId: ship.bodyId, at: now });
        } else this.offsets.delete(ship.id);
      }
    }
    for (const id of snapshot.gone ?? []) { world.remove(id); this.offsets.delete(id); }
    // Inputs at earlier ticks were replayed into the adopted ships; the rest apply as the
    // mirror steps on.
    this.cursor = 0;
    while (this.cursor < this.events.length && this.events[this.cursor]!.tick < world.tick) this.cursor++;
    this.selfHeal();
  }

  /** This pilot's input applied to a record exactly as the host applies it. */
  private applyInput(ship: Ship, input: InputEvent): Ship {
    const c = input.controls;
    if (ship.controls.turn !== c.turn || ship.controls.throttle !== c.throttle || ship.controls.engine !== c.engine) {
      ship = { ...ship, controls: { turn: Math.max(-1, Math.min(1, c.turn)), throttle: Math.max(-1, Math.min(1, c.throttle)),
        engine: c.engine } };
    }
    if (input.set !== undefined) {
      ship = { ...ship, state: { ...ship.state, throttle: Math.max(0, Math.min(1, input.set)), revision: ship.state.revision + 1 } };
    }
    return ship;
  }

  /** A host record checked against the mirror's bodies at `time`; one that cannot be
   * verified is still shown where the host says it is, stopped. */
  private verified(raw: NetShip, time: number): Ship | undefined {
    const world = this.world!;
    if (world.vehicles && !raw.vehicleId) throw new Error('Mixed-vehicle snapshot is missing a required vehicle identity');
    world.contextFor(raw);
    let ship: Ship;
    try { ship = this.services.save.shipFromSaved(world, raw, 'Ship', time); } catch (error) {
      try {
        ship = this.services.save.shipFromSaved(world, { ...raw, coast: undefined,
          fault: raw.fault ?? `Not verified here: ${(error as Error).message}`.slice(0, 200) }, 'Ship', time);
      } catch { return undefined; }
    }
    return { ...ship, controls: { turn: raw.controls[0], throttle: raw.controls[1], engine: raw.controls[2] === 1 } };
  }

  /** Self-heal: if the host holds different controls and nothing is in flight, resend. */
  private selfHeal(): void {
    for (const ship of this.ownShips()) {
      const sent = this.sent.get(ship.id);
      if (sent && !sameControls(sent, ship.controls) && !this.events.some(e => e.shipId === ship.id)) this.sent.delete(ship.id);
    }
  }

  /** The complete world: rewind the mirror to the snapshot and replay to where it was. */
  private resync(snapshot: Snapshot, out: WorldEvent[]): void {
    const world = this.world!;
    const now = this.now();
    const shown = new Map<string, Offset>();
    for (const ship of world.ships()) {
      const o = this.displayOffset(ship.id);
      shown.set(ship.id, { x: ship.state.position.x + o.x, y: ship.state.position.y + o.y, bodyId: ship.bodyId, at: now });
    }
    const predicted = world.tick;
    const acks = this.apply(snapshot.tick, snapshot.time, snapshot.ships);
    if (snapshot.moduleState) {
      world.setModuleState(snapshot.moduleState);
    }
    this.events = this.events.filter(e => world.has(e.shipId) && e.seq > (acks.get(e.shipId) ?? -1)
      && e.tick >= snapshot.tick - INPUT_HISTORY_TICKS);
    this.cursor = 0;
    this.selfHeal();
    if (!this.paused) {
      const goal = Math.min(predicted, snapshot.tick + MAX_REPLAY_TICKS);
      while (world.tick < goal) this.stepOnce(out);
    }
    for (const ship of world.ships()) {
      const old = shown.get(ship.id);
      const dx = old ? old.x - ship.state.position.x : 0, dy = old ? old.y - ship.state.position.y : 0;
      const limit = Math.max(20, this.services.motion.magnitude(ship.state.velocity) * 0.25);
      if (old && old.bodyId === ship.bodyId && (dx || dy) && Math.hypot(dx, dy) <= limit) {
        this.offsets.set(ship.id, { x: dx, y: dy, bodyId: ship.bodyId, at: now });
      } else this.offsets.delete(ship.id);
    }
  }

  /** Replace the mirror with the host's ships at `tick`. Returns this player's input acks. */
  private apply(tick: number, time: number, ships: readonly NetShip[]): Map<string, number> {
    const world = this.world!;
    world.restoreClock(tick, time);
    const acks = new Map<string, number>();
    const seen = new Set<string>();
    for (const raw of ships) {
      // Shown where the host says it is, but not predicted locally, when it cannot be verified.
      const ship = this.verified(raw, time);
      if (!ship) continue;
      world.put(ship);
      seen.add(ship.id);
      if (raw.ack !== undefined && ship.ownerId === this.playerId) acks.set(ship.id, raw.ack);
    }
    for (const ship of [...world.records()]) if (!seen.has(ship.id)) world.remove(ship.id);
    return acks;
  }

  private receive(text: string): void {
    if (this.phase === 'closed') return;
    let message: HostMessage;
    try { message = parseHostMessage(text); } catch (error) {
      this.fail(`The host sent an invalid message: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    try { this.handle(message); } catch (error) {
      this.fail(`Could not follow the host: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handle(message: HostMessage): void {
    const now = this.now();
    switch (message.t) {
      case 'info':
        if (this.worldId) { this.fail('Unexpected server greeting.'); return; }
        if (message.protocol !== PROTOCOL || message.model !== this.services.clock.model) {
          this.fail(`Version mismatch: the host runs ${message.protocol} / ${message.model}; this game runs ${PROTOCOL} / ${this.services.clock.model}.`);
          return;
        }
        if (!this.options.verifyCandidate && this.options.simulationFingerprint && message.fingerprint && message.fingerprint !== this.options.simulationFingerprint) {
          this.fail(`Simulation mismatch: host fingerprint is ${message.fingerprint}, but local fingerprint is ${this.options.simulationFingerprint}. Presentation-only differences are allowed, but authoritative simulation must match.`);
          return;
        }
        const expectedVehicles = this.options.vehicles ? captureVehicleCatalog(this.options.vehicles) : undefined;
        if (JSON.stringify(expectedVehicles) !== JSON.stringify(message.vehicles)) {
          this.fail('Missing or incompatible required vehicle packages. Load the same exact gameplay packages as the host.'); return;
        }
        const expectedData = (this.options.dataAdapters ?? []).map(({ id, version, scope }) => ({ id, version, scope }));
        const offeredData = message.dataSchemas ?? [];
        if (expectedData.length !== offeredData.length || expectedData.some(e => !offeredData.some(s => s.id === e.id && s.version === e.version && s.scope === e.scope))) {
          this.fail('Missing or incompatible required module-data adapters. Load the same exact gameplay packages as the host.'); return;
        }
        this.worldId = message.worldId;
        this.hostName = message.name;
        this.hostSeat = message.host;
        this.hostFingerprint = message.fingerprint;
        {
          const token = this.options.token?.(message.worldId, message.host);
          const join = (token: string | undefined): void => {
            if (this.phase !== 'connecting') return;
            this.send({ ...(message.vehicles ? { vehicleVersion: VEHICLE_PROTOCOL } : {}), ...(offeredData.length ? { dataVersion: MODULE_DATA_PROTOCOL } : {}), t: 'join', name: this.options.name, ...(token ? { token } : {}),
              ...(this.options.password ? { password: this.options.password } : {}) });
          };
          if (typeof token === 'string' || token === undefined) join(token);
          else void token.then(join, () => {
            if (this.phase === 'connecting') this.fail('Could not reserve your pilot. Try joining again.');
          });
        }
        return;
      case 'welcome': {
        if (this.phase !== 'connecting' || !this.worldId) throw new Error('unexpected welcome');
        if (this.hostFingerprint && message.fingerprint !== this.hostFingerprint) {
          this.fail('The server simulation changed while joining. Try again.');
          return;
        }
        if (JSON.stringify(this.options.vehicles ? captureVehicleCatalog(this.options.vehicles) : undefined) !== JSON.stringify(message.vehicles)) throw new Error('Required vehicle packages changed while joining');
        const universe = this.services.motion.validateUniverse(message.universe);
        let expectedFingerprint = this.options.simulationFingerprint;
        if (this.options.verifyCandidate) {
          const res = this.options.verifyCandidate({ lock: message.lock, fingerprint: message.fingerprint, universe, systemId: message.systemId });
          if (res === false || (typeof res === 'object' && !res.ok)) {
            this.fail(typeof res === 'object' && res.reason ? res.reason : 'Host module configuration is incompatible.');
            return;
          }
          if (typeof res === 'object' && res.simulationFingerprint) expectedFingerprint = res.simulationFingerprint;
        }
        if (expectedFingerprint && message.fingerprint !== expectedFingerprint) {
          this.fail(`Simulation mismatch: host fingerprint is ${message.fingerprint}, but local fingerprint is ${expectedFingerprint}. Presentation-only differences are allowed, but authoritative simulation must match.`);
          return;
        }
        if (this.options.lock && message.lock) {
          const localModules = new Set((this.options.lock.modules ?? []).map(m => m.id));
          const missing = (message.lock.modules ?? []).filter(m => !localModules.has(m.id));
          if (missing.length) {
            this.fail(`Missing required authoritative module(s): ${missing.map(m => `${m.id}@${m.version}`).join(', ')}`);
            return;
          }
        }
        const world = (this.options.worldFactory ?? this.services.world).create(universe, {
          systemId: message.systemId,
          id: this.worldId,
          createContext: this.options.createContext ?? this.services.motion.createContext,
          vehicles: this.options.vehicles,
          dataAdapters: this.options.dataAdapters,
          rules: this.options.rules,
          forces: this.options.forces,
          commands: this.options.commands,
          lock: message.lock,
          simulationFingerprint: message.fingerprint,
          soloPreview: false,
        });
        this.world = world;
        if (world.data.schemas.length && message.data === undefined) throw new Error('Missing required module-data state');
        if (message.data !== undefined) world.data.apply(message.data);
        if (message.moduleState) {
          world.setModuleState(message.moduleState);
        }
        this.playerId = message.playerId;
        if (message.token) this.options.saveToken?.(this.worldId, message.token, message.playerId);
        this.rules = message.rules;
        this.players = message.players;
        this.paused = message.paused;
        this.pauseReason = message.reason ?? '';
        this.warp = message.warp ?? 1;
        this.apply(message.tick, message.time, message.ships);
        this.reported = message.tick;
        this.hostTick = message.tick;
        if (!message.paused) {
          const effectiveTickMs = TICK_MS / (this.warp || 1);
          this.samples.push({ offset: message.tick - now / effectiveTickMs, at: now });
        }
        this.phase = 'joined';
        this.onjoined?.();
        return;
      }
      case 'snapshot':
        if (this.phase !== 'joined') return;
        // Data has no client prediction: preserve reliable wire order even when display snapshots are coalesced.
        if (message.data !== undefined) this.world!.data.apply(message.data);
        else if (message.full && this.world!.data.schemas.length) throw new Error('Missing required module-data state');
        // A complete world supersedes everything before it.
        if (message.full) this.pending = [];
        this.pending.push({ snapshot: message, at: now });
        if (this.pending.length > MAX_PENDING_SNAPSHOTS) { this.pending = []; this.overflowed = true; }
        return;
      case 'players':
        this.players = message.players;
        this.onplayers?.();
        return;
      case 'pong': {
        const sent = this.pings.get(message.id);
        if (sent === undefined) return;
        this.pings.delete(message.id);
        this.hostTick = Math.max(this.hostTick, message.tick);
        this.rttMs = now - sent;
        this.rtts.push(this.rttMs);
        if (this.rtts.length > 10) this.rtts.shift();
        if (!this.paused) {
          const effectiveTickMs = TICK_MS / (this.warp || 1);
          this.samples.push({ offset: message.tick - now / effectiveTickMs, at: now });
        }
        return;
      }
      case 'notice':
        this.onnotice?.(message.text);
        return;
      case 'chat': {
        const { t: _t, ...line } = message;
        this.onchat?.(line);
        return;
      }
      case 'error':
        this.closeReason = message.message;
        return;
    }
  }

  private send(message: ClientMessage): void {
    if (this.phase !== 'closed') this.connection.send(JSON.stringify(message));
  }

  private fail(reason: string): void {
    this.closeReason = reason;
    this.connection.close(reason);
    this.closed(reason);
  }

  private closed(reason: string): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.closeReason ||= reason;
    try { this.world?.dispose(); } finally { this.onclose?.(this.closeReason); }
  }
}
