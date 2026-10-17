import type { Coast, CommandExtension, Controls, ForceExtension, Ship, SimulationContext, SimulationContextFactory, State, Vec, WorldEvent, WorldRuleExtension, WorldRuleState, GhostSample, GhostEnd, AuthoritativeLock, ModuleLock, ModuleState } from '../../game-api/src/index';
export type { WorldRuleState } from '../../game-api/src/index';
import { IDLE, STEP } from './constants';
import { createSimulationContext, ghostSample, magnitude, normalizeAngle, setGodMode } from './context';
import { motionCopy as motionRuleStateCopy, validateModuleState } from '../../game-runtime/src/motion';
import { captureWorldRules, initialRuleState, stageWorldRules } from '../../game-runtime/src/rules';
import { captureCommands } from '../../game-runtime/src/commands';
import { DEFAULT_BUILTIN_LOCK, computeAuthoritativeLock, computeSimulationFingerprint } from '../../game-runtime/src/authoritative';
import * as dm from './dmath';
import { BUILTIN_SERVICES } from './services';
import { surfaceIdentity, type SurfaceProfile } from './surface';
import { WakeQueue } from './rails';
import { groundPreset } from './spin';
import { type LoadedSystem, type ResolvedBody, type UniverseDefinition } from './universe';

export type { Ship, WorldEvent } from '../../game-api/src/index';

/** Everything about a body's ground that motion depends on: its surface and how it turns. */
const physicalIdentity = (body: ResolvedBody): string => surfaceIdentity(body)
  + (body.rotation ? `|spin:${body.rotation.period}:${body.rotation.direction}:${body.rotation.phase}` : '');

export const MAX_SHIP_NAME = 32;
export const SHIP_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Printable, trimmed and bounded; an empty result means "use the default". */
export function cleanName(name: unknown, limit = MAX_SHIP_NAME): string {
  if (typeof name !== 'string') return '';
  return name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, limit).trim();
}

const RULE_MATH = Object.freeze({ sin: dm.sin, cos: dm.cos, atan2: dm.atan2, hypot: dm.hypot, exp: dm.exp, sqrt: Math.sqrt });

const defaultName = (n: number): string => `Vessel ${String(n).padStart(2, '0')}`;

/** A ship whose motion is a known function of time ("on rails"): the world skips it until
 * `wake`, and evaluates its state only when someone reads it. */
interface Rail {
  /** World tick of the record held in the fleet map. */
  tick: number;
  /** The step that produces this tick advances the ship normally again. */
  readonly wake: number;
  readonly generation: number;
}

export interface WorldOptions {
  /** Authority without declared deterministic multiplayer support stays in solo preview. */
  readonly soloPreview?: boolean;
  readonly migrateState?: (id: string, state: ModuleState, target: number) => ModuleState;
  readonly systemId?: string;
  readonly id?: string;
  /** Receives the system's immutable settings. The world owns the returned context. */
  readonly createContext?: SimulationContextFactory;
  readonly rules?: readonly WorldRuleExtension[];
  readonly forces?: readonly ForceExtension[];
  /** Pilot commands the authoritative host may apply between steps (never during one). */
  readonly commands?: readonly CommandExtension[];
  readonly lock?: AuthoritativeLock | ModuleLock;
  readonly simulationFingerprint?: string;
  readonly saveVersion?: number;
}

/** Every vessel in one loaded system, advanced together on a single simulation clock.
 * Ships never interact with each other; each one runs the same `advance` as single
 * flight, against the same body ephemerides and terrain profiles.
 *
 * Idle ships cost nothing per step. A coasting ship's state is an exact function of its
 * Kepler epoch, so it sleeps until the earliest time it could change sphere of influence
 * (see `soiHorizon`); landed and wrecked ships at rest sleep until commanded. Reading a
 * sleeping ship evaluates the same expressions the per-step path would have produced, bit
 * for bit, so sleeping never changes results. */
export class World {
  readonly soloPreview: boolean;
  readonly migrateState?: WorldOptions['migrateState'];
  readonly id: string;
  readonly universe: UniverseDefinition;
  readonly system: LoadedSystem;
  readonly context: SimulationContext;
  readonly rules: readonly WorldRuleExtension[];
  readonly forces: readonly ForceExtension[];
  readonly commands: readonly CommandExtension[];
  readonly lock?: AuthoritativeLock | ModuleLock;
  readonly simulationFingerprint: string;
  saveVersion?: number;
  private ruleState: Readonly<Record<string, WorldRuleState>>;
  get requiresWorldPrediction(): boolean { return this.rules.length > 0 || this.customFrames; }
  get moduleState(): Readonly<Record<string, WorldRuleState>> { return this.ruleState; }
  /** A shared hook failure leaves the entire candidate tick uncommitted. */
  paused = false;
  fault: string | undefined;
  private readonly createContext: SimulationContextFactory;
  private readonly customFrames: boolean;
  private readonly selectedSystemId: string | undefined;

  /** Generated once per world; never in a draw or step path. */
  readonly surfaces: ReadonlyMap<string, SurfaceProfile>;
  tick = 0;
  time = 0;
  nextShipNumber = 1;
  /** Increases with every step and every change to a ship (cheap "anything changed?"). */
  version = 0;
  /** Let idle ships sleep between events (disable to compare against plain stepping). */
  rails = true;
  private readonly fleet = new Map<string, Ship>();
  private readonly bodyIds: ReadonlySet<string>;
  /** Ships advanced every step: not asleep and not faulted. */
  private readonly awake = new Set<string>();
  /** Ships woken by a command or inserted since the last step; that step first tries to put
   * each one to sleep without advancing it (see `sleepNow`). */
  private readonly fresh = new Set<string>();
  private readonly asleepRails = new Map<string, Rail>();
  private readonly wakeQueue = new WakeQueue();
  private generation = 0;
  /** Records from before the latest step of the ships it advanced (emptied by each step). */
  private readonly prior = new Map<string, Ship>();
  /** Record which ships commands change (for a host's delta snapshots); see `takeChanges`. */
  trackChanges = false;
  private readonly changedIds = new Set<string>();
  private readonly removedIds = new Set<string>();
  /** Ship ids per owner. */
  private readonly owners = new Map<string, Set<string>>();
  private static readonly NONE: ReadonlySet<string> = new Set();

  constructor(universe: UniverseDefinition, options: WorldOptions = {}) {
    this.id = options.id ?? 'local';
    this.migrateState = options.migrateState;
    this.universe = universe;
    this.rules = captureWorldRules(options.rules ?? []);
    this.forces = options.forces ?? [];
    this.commands = captureCommands(options.commands ?? []);
    this.ruleState = initialRuleState(this.rules);
    this.selectedSystemId = options.systemId;
    this.createContext = options.createContext ?? createSimulationContext;
    this.saveVersion = options.saveVersion;
    // Resolve the selected body service before loading; validated content owns settings.
    const definition = universe.systems.find(s => s.id === (options.systemId ?? universe.defaultSystemId));
    if (!definition) throw new Error('Unknown system');
    this.context = this.createContext({ acceleration: definition.vehicleDefaults?.acceleration ?? 125,
      turnRate: definition.vehicleDefaults?.turnRate ?? 1.227184630308513,
      initialThrottle: definition.vehicleDefaults?.initialThrottle ?? .5 }, {
        worldRules: this.rules.length > 0,
        worldRuleIdentity: this.rules.length ? JSON.stringify(this.rules.map(r => [r.moduleId, r.version, r.hook.modelIdentity, r.hook.initialState, r.hook.seed])) : undefined,
      });
    if (this.rules.length && (this.context.capabilities.analyticCoast || this.context.capabilities.rails)) {
      this.context.dispose();
      throw new Error('World rules require the context factory to forward MotionContextOptions');
    }
    this.customFrames = this.context.services.bodies !== BUILTIN_SERVICES.bodies;
    try { this.system = this.context.services.bodies.load(universe, options.systemId ?? universe.defaultSystemId, this.context.services.surfaces); }
    catch (error) { this.context.dispose(); throw error; }

    const geometries: Record<string, string> = Object.create(null);
    for (const b of this.system.getAllBodies()) geometries[b.id] = physicalIdentity(b);

    if (options.lock && options.lock.format === 'space-sim-auth-lock/1') {
      const lock = options.lock as AuthoritativeLock;
      this.lock = Object.keys(lock.physicalGeometry).length > 0
        ? lock
        : { ...lock, physicalGeometry: geometries };
    } else {
      this.lock = options.lock ?? {
        ...DEFAULT_BUILTIN_LOCK,
        physicalGeometry: geometries,
      };
    }
    this.simulationFingerprint = options.simulationFingerprint ?? (
      this.lock && this.lock.format === 'space-sim-auth-lock/1'
        ? computeSimulationFingerprint(this.lock as AuthoritativeLock)
        : this.computeDefaultFingerprint()
    );

    this.soloPreview = options.soloPreview !== undefined
      ? options.soloPreview
      : (this.rules.length > 0 || !this.context.capabilities.legacyCompatible);
    const settings = this.system.vehicleDefaults;
    if (this.context.stepSeconds !== STEP || this.context.vehicle.acceleration !== settings.acceleration
      || this.context.vehicle.turnRate !== settings.turnRate || this.context.vehicle.initialThrottle !== settings.initialThrottle) {
      this.context.dispose();
      throw new Error('World context must match the system vehicle settings and fixed step');
    }
    try {
      const profiles = new Map<string, SurfaceProfile>();
      const identities = new Map<string, SurfaceProfile>();
      for (const body of this.system.getAllBodies()) if (body.surface && body.surfaceFeatures !== 'star') {
        let profile = identities.get(this.context.services.surfaces.identity(body));
        if (!profile) { profile = this.context.services.surfaces.generate(body); identities.set(this.context.services.surfaces.identity(body), profile); }
        profiles.set(body.id, profile);
      }
      this.surfaces = profiles;
      this.bodyIds = new Set(this.system.getAllBodies().map(b => b.id));
      // Validate every start before the world is used, so a bad universe fails on load.
      for (const p of this.system.presets) this.system.initialState(p.id, profiles.get(p.bodyId));
    } catch (error) {
      this.context.dispose();
      throw error;
    }
  }

  get systemId(): string { return this.system.system.id; }
  get size(): number { return this.fleet.size; }
  /** Every ship at the current time. Sleeping ships are evaluated, so prefer `records()`
   * when only identity, owner or body is needed. */
  ships(): readonly Ship[] {
    for (const id of this.asleepRails.keys()) this.materialize(id);
    return [...this.fleet.values()];
  }
  ship(id: string): Ship | undefined { return this.asleepRails.has(id) ? this.materialize(id) : this.fleet.get(id); }
  has(id: string): boolean { return this.fleet.has(id); }
  /** A stored record without evaluating it (see `records`). */
  record(id: string): Ship | undefined { return this.fleet.get(id); }
  /** Stored records without evaluating sleeping ships: their `state` may be from an earlier
   * tick (see `isAsleep` and `stateAt`). Identity, owner, controls and body are current. */
  records(): IterableIterator<Ship> { return this.fleet.values(); }
  /** Ships advanced by every step (neither asleep nor stopped by a fault). */
  *awakeShips(): IterableIterator<Ship> { for (const id of this.awake) yield this.fleet.get(id)!; }
  isAsleep(id: string): boolean { return this.asleepRails.has(id); }
  /** An awake landed ship or wreck the next step puts to sleep without advancing it: every
   * idle step from it only moves its clock, so time warp may treat it as on rails already. */
  settles(id: string): boolean {
    const ship = this.fleet.get(id);
    return !!ship && this.awake.has(id) && this.rails && !this.rules.length && this.context.capabilities.rails
      && this.restingState(ship) !== undefined;
  }
  /** Ships changed by a command, replacement or fault, and ships removed, since the last
   * call (only while `trackChanges`). Stepping is not a change: every peer that knows a
   * ship's record and controls reproduces its steps exactly. */
  takeChanges(): { readonly changed: readonly string[]; readonly removed: readonly string[] } {
    const changes = { changed: [...this.changedIds], removed: [...this.removedIds] };
    this.changedIds.clear();
    this.removedIds.clear();
    return changes;
  }
  /** Ids of the ships `ownerId` owns. */
  ownedBy(ownerId: string): ReadonlySet<string> { return this.owners.get(ownerId) ?? World.NONE; }
  private own(ship: Ship): void {
    const previous = this.fleet.get(ship.id);
    if (previous && previous.ownerId !== ship.ownerId) this.disown(previous);
    let set = this.owners.get(ship.ownerId);
    if (!set) { set = new Set(); this.owners.set(ship.ownerId, set); }
    set.add(ship.id);
  }
  private disown(ship: Ship): void {
    const set = this.owners.get(ship.ownerId);
    if (!set) return;
    set.delete(ship.id);
    if (!set.size) this.owners.delete(ship.ownerId);
  }
  private touched(id: string): void {
    this.version++;
    if (!this.trackChanges) return;
    this.changedIds.add(id);
    this.removedIds.delete(id);
  }
  /** The record from before the latest step, if that step advanced the ship (for drawing
   * between steps). Sleeping ships have none: draw them from `stateAt`. */
  previous(id: string): Ship | undefined { return this.prior.get(id); }
  get asleepCount(): number { return this.asleepRails.size; }
  /** Ships advanced by every step. */
  get awakeCount(): number { return this.awake.size; }
  /** Position and velocity of a ship at any time near the clock, for drawing: exact for a
   * sleeping coast, otherwise the stored state. */
  stateAt(id: string, time: number): State | undefined {
    const ship = this.fleet.get(id);
    if (!ship) return undefined;
    const { state } = ship;
    if (!this.asleepRails.has(id) || !state.coast || state.dynamics !== 'kepler' || state.time === time) return state;
    const result = this.context.coastAt(state.coast, time, this.body(ship.bodyId), this.surfaces.get(ship.bodyId), { cache: false });
    return result.ok ? { ...state, time, position: result.state.position, velocity: result.state.velocity } : state;
  }
  hasBody(id: string): boolean { return this.bodyIds.has(id); }
  body(id: string): ResolvedBody { return this.system.getResolvedBody(id); }
  surface(bodyId: string): SurfaceProfile | undefined { return this.surfaces.get(bodyId); }
  presetId(id?: string): string {
    return this.system.presets.find(p => p.id === id)?.id ?? this.system.presets[0]!.id;
  }

  /** A preset start on the shared clock. Presets are authored over the ground, so on a
   * rotating body a flying start is turned to where that ground is now. */
  presetState(presetId?: string): { readonly state: State; readonly bodyId: string } {
    const p = this.system.presets.find(p => p.id === presetId) ?? this.system.presets[0]!;
    const start = this.system.initialState(p.id, this.surfaces.get(p.bodyId));
    const state = { ...start.state, time: this.time };
    return { state: groundPreset(state, this.body(start.body.id), p.kind === 'state'), bodyId: start.body.id };
  }

  spawn(options: { readonly ownerId: string; readonly presetId?: string; readonly name?: string; readonly godMode?: boolean }): Ship {
    const n = this.nextShipNumber++;
    const start = this.presetState(options.presetId);
    const ship: Ship = {
      id: `ship-${n}`, name: cleanName(options.name) || defaultName(n), ownerId: options.ownerId,
      bodyId: start.bodyId, controls: IDLE,
      state: options.godMode ? { ...start.state, godMode: true } : start.state,
    };
    this.own(ship);
    this.fleet.set(ship.id, ship);
    this.awake.add(ship.id);
    this.fresh.add(ship.id);
    this.touched(ship.id);
    return ship;
  }

  /** Back to a preset start now. Identity, owner and God mode are kept; the revision keeps
   * increasing so caches keyed by it can never mistake the new flight for the old one. */
  respawn(shipId: string, presetId?: string): Ship {
    const ship = this.require(shipId);
    const start = this.presetState(presetId);
    const next: Ship = { id: ship.id, name: ship.name, ownerId: ship.ownerId, bodyId: start.bodyId, controls: IDLE,
      state: { ...start.state, revision: ship.state.revision + 1, ...(ship.state.godMode ? { godMode: true } : {}) } };
    this.fleet.set(ship.id, next);
    this.prior.delete(ship.id);
    this.wake(ship.id);
    this.touched(ship.id);
    return next;
  }

  /** Teleport/throw a ship into a new position, velocity and parent body frame. */
  teleport(shipId: string, bodyId: string, position: Vec, velocity: Vec, heading?: number): Ship {
    const ship = this.require(shipId);
    const body = this.body(bodyId);
    const rad = Math.hypot(position.x, position.y);
    const speed = Math.hypot(velocity.x, velocity.y);
    const dir = speed > 1e-6 ? Math.atan2(velocity.y, velocity.x) : Math.atan2(position.y, position.x) + Math.PI / 2;
    const h = heading ?? dir;
    const next: Ship = {
      id: ship.id,
      name: ship.name,
      ownerId: ship.ownerId,
      bodyId,
      controls: IDLE,
      state: {
        time: this.time,
        position: { x: position.x, y: position.y },
        velocity: { x: velocity.x, y: velocity.y },
        heading: h,
        throttle: 0,
        status: rad <= body.radius ? 'landed' : 'flying',
        revision: ship.state.revision + 1,
        ...(ship.state.godMode ? { godMode: true } : {}),
      },
    };
    this.fleet.set(ship.id, next);
    this.prior.delete(ship.id);
    this.wake(ship.id);
    this.touched(ship.id);
    return next;
  }

  remove(shipId: string): boolean {
    this.asleepRails.delete(shipId);
    this.awake.delete(shipId);
    this.fresh.delete(shipId);
    this.prior.delete(shipId);
    const ship = this.fleet.get(shipId);
    if (ship) this.disown(ship);
    const removed = this.fleet.delete(shipId);
    if (removed) this.version++;
    if (removed && this.trackChanges) { this.changedIds.delete(shipId); this.removedIds.add(shipId); }
    return removed;
  }

  /** Remove every ship and rewind the clock: a fresh flight in the same system. */
  reset(): void {
    if (this.trackChanges) for (const id of this.fleet.keys()) { this.changedIds.delete(id); this.removedIds.add(id); }
    this.version++;
    this.fleet.clear();
    this.owners.clear();
    this.awake.clear();
    this.fresh.clear();
    this.prior.clear();
    this.asleepRails.clear();
    this.wakeQueue.clear();
    this.context.dispose();
    this.tick = 0; this.time = 0; this.nextShipNumber = 1;
    this.ruleState = initialRuleState(this.rules); this.paused = false; this.fault = undefined;
  }

  setControls(shipId: string, controls: Controls): void {
    const ship = this.require(shipId);
    if (ship.controls.turn === controls.turn && ship.controls.throttle === controls.throttle
      && ship.controls.engine === controls.engine) return;
    this.fleet.set(shipId, { ...ship, controls: {
      turn: Math.max(-1, Math.min(1, controls.turn)),
      throttle: Math.max(-1, Math.min(1, controls.throttle)),
      engine: controls.engine,
    } });
    this.wake(shipId);
    this.touched(shipId);
  }

  setThrottle(shipId: string, throttle: number): void {
    const ship = this.require(shipId);
    if (!Number.isFinite(throttle)) throw new Error('Throttle must be finite');
    this.fleet.set(shipId, { ...ship, state: { ...ship.state,
      throttle: Math.max(0, Math.min(1, throttle)), revision: ship.state.revision + 1 } });
    this.wake(shipId);
    this.touched(shipId);
  }

  setGodMode(shipId: string, enabled: boolean): void {
    const ship = this.require(shipId);
    this.fleet.set(shipId, { ...ship, state: setGodMode(ship.state, enabled) });
    this.wake(shipId);
    this.touched(shipId);
  }

  rename(shipId: string, name: string): void {
    const ship = this.require(shipId);
    this.fleet.set(shipId, { ...ship, name: cleanName(name) || ship.name });
    this.touched(shipId);
  }

  /** Retry a stopped ship from its last verified state, rejoining the shared clock. */
  clearFault(shipId: string): void {
    const ship = this.require(shipId);
    if (!ship.fault) return;
    const { fault: _fault, ...rest } = ship;
    this.fleet.set(shipId, { ...rest, state: { ...rest.state, time: this.time } });
    this.wake(shipId);
    this.touched(shipId);
  }

  /** Insert or replace a complete record (save restore or network snapshot). The caller
   * validates it; the state is placed on the shared clock. */
  put(ship: Ship): void {
    if (!SHIP_ID_PATTERN.test(ship.id)) throw new Error(`Invalid ship id ${ship.id}`);
    if (!this.hasBody(ship.bodyId)) throw new Error(`Ship ${ship.id}: unknown body ${ship.bodyId}`);
    this.own(ship);
    this.fleet.set(ship.id, ship.state.time === this.time ? ship : { ...ship, state: { ...ship.state, time: this.time } });
    this.asleepRails.delete(ship.id);
    this.prior.delete(ship.id);
    this.wake(ship.id);
    this.touched(ship.id);
  }

  /** Advance every ship by one fixed step. A ship whose motion fails keeps its last
   * verified state with a fault instead of stopping the others. */
  step(): WorldEvent[] {
    if (this.paused) return [];
    if (this.rules.length) return this.stepWithRules();
    const events: WorldEvent[] = [];
    const time = this.time + STEP;
    const tick = this.tick + 1;
    this.prior.clear();
    while (this.wakeQueue.peekTick() <= tick) {
      const due = this.wakeQueue.pop()!;
      // Due at a possible event: advance it normally (no early sleep).
      if (this.asleepRails.get(due.id)?.generation === due.generation) { this.wake(due.id); this.fresh.delete(due.id); }
    }
    if (this.rails) for (const id of this.fresh) if (this.awake.has(id)) this.sleepNow(this.fleet.get(id)!, this.tick, 1);
    this.fresh.clear();
    for (const id of this.awake) {
      const ship = this.fleet.get(id)!;
      this.prior.set(id, ship);
      const next = this.stepShip(ship, events);
      this.fleet.set(id, next);
      if (next.fault) { this.awake.delete(id); this.touched(id); } else if (this.rails) this.sleep(next, tick);
    }
    this.tick = tick;
    this.time = time;
    this.version++;
    return events;
  }

  /** World tick of the earliest due wake-up event in the rails min-heap. */
  get nextWakeTick(): number { return this.wakeQueue.peekTick(); }

  /** Advance the world to targetTick (must be >= this.tick).
   * In rails mode with no awake ships and no world rules, this fast-forwards directly to
   * the earliest of targetTick or the next wake event.
   * If an event wakes a ship, it steps that tick normally and returns the events. */
  advanceTo(targetTick: number, maxSteps = 1000): WorldEvent[] {
    if (this.paused || targetTick <= this.tick) return [];
    const events: WorldEvent[] = [];

    if (this.rules.length || !this.rails) {
      let stepsTaken = 0;
      while (this.tick < targetTick && !this.paused && stepsTaken < maxSteps) {
        events.push(...this.step());
        stepsTaken++;
        if (this.paused) break;
      }
      return events;
    }

    for (const id of this.fresh) {
      if (this.awake.has(id)) this.sleepNow(this.fleet.get(id)!, this.tick, 1);
    }
    this.fresh.clear();

    let stepsTaken = 0;
    while (this.tick < targetTick && !this.paused) {
      if (this.awake.size > 0) {
        if (stepsTaken >= maxSteps) break;
        events.push(...this.step());
        stepsTaken++;
        if (this.paused) break;
        continue;
      }

      const nextWake = this.wakeQueue.peekTick();
      if (nextWake > targetTick) {
        const deltaTicks = targetTick - this.tick;
        this.prior.clear();
        this.tick = targetTick;
        this.time = targetTick * STEP;
        this.version += deltaTicks;
        break;
      } else {
        if (nextWake > this.tick + 1) {
          const jumpTicks = (nextWake - 1) - this.tick;
          this.prior.clear();
          this.tick = nextWake - 1;
          this.time = this.tick * STEP;
          this.version += jumpTicks;
        }
        events.push(...this.step());
        stepsTaken++;
        if (events.length > 0 || this.awake.size > 0 || this.paused) {
          break;
        }
      }
    }

    return events;
  }

  /** Shared rules run against a complete candidate; no live fields change until validation. */
  private stepWithRules(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const prior = [...this.fleet.values()];
    const candidates = prior.map(ship => ship.fault ? ship : this.stepShip(ship, events));
    try {
      const staged = stageWorldRules(this.rules, this.ruleState, candidates, events, this.tick,
        this.time + STEP, STEP, RULE_MATH);
      this.prior.clear();
      for (const ship of prior) this.prior.set(ship.id, ship);
      for (const [id, ship] of staged.ships) {
        const prev = this.prior.get(id);
        this.fleet.set(id, ship);
        if (ship.fault) { this.awake.delete(id); this.touched(id); }
        else if (this.trackChanges && prev && (prev.controls.turn !== ship.controls.turn || prev.controls.throttle !== ship.controls.throttle || prev.controls.engine !== ship.controls.engine || prev.state.throttle !== ship.state.throttle)) {
          this.touched(id);
        }
      }
      this.ruleState = staged.state;
      this.tick++; this.time += STEP; this.version++;
      return events;
    } catch (error) {
      this.paused = true; this.fault = (error as Error).message;
      return [{ type: 'world-fault', message: this.fault }];
    }
  }

  setModuleState(state: Readonly<Record<string, WorldRuleState>>): void {
    if (!state || typeof state !== 'object') throw new Error('Invalid module state');
    for (const { moduleId, hook } of this.rules) {
      const entry = state[moduleId];
      if (!entry) throw new Error(`Missing module state for rule ${moduleId}`);
      const validated = validateModuleState(entry.state);
      if (validated.version !== hook.initialState.version) {
        throw new Error(`Module ${moduleId}: state version ${validated.version} differs from expected ${hook.initialState.version}`);
      }
      if (!Number.isInteger(entry.randomState) || entry.randomState <= 0 || entry.randomState > 0xffffffff) {
        throw new Error(`Module ${moduleId}: invalid RNG state`);
      }
    }
    this.ruleState = motionRuleStateCopy(state);
  }

  private computeDefaultFingerprint(): string {
    const geometries: Record<string, string> = Object.create(null);
    for (const b of this.system.getAllBodies()) geometries[b.id] = physicalIdentity(b);
    const manifests = new Map<string, any>([
      ['builtin.content', { id: 'builtin.content', name: 'builtin.content', version: '0.1.0', kind: 'provider', authority: 'authoritative', environments: ['browser', 'offline', 'node'], dependencies: [], provides: ['builtin.content/v1'], requires: [], slots: ['content'], before: [], after: [], settings: {}, license: 'LicenseRef-Project', format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1' }],
      ['builtin.motion', { id: 'builtin.motion', name: 'builtin.motion', version: '0.1.0', kind: 'provider', authority: 'authoritative', environments: ['browser', 'offline', 'node'], dependencies: [], provides: ['builtin.motion/v1'], requires: [], slots: ['motion', 'orbits', 'bodies', 'surfaces', 'rails'], before: [], after: [], settings: {}, license: 'LicenseRef-Project', format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1' }],
    ]);
    const lock = computeAuthoritativeLock({
      profileId: 'builtin.default',
      order: ['builtin.content', 'builtin.motion'],
      manifests,
      providers: DEFAULT_BUILTIN_LOCK.providers,
      settings: {},
      physicalGeometry: geometries,
      rules: this.rules,
      forces: this.forces,
    });
    return computeSimulationFingerprint(lock);
  }

  /** Clones all authoritative rule/RNG/ship state; derived caches belong to the clone. */
  cloneForPrediction(): World {
    const clone = new World(this.universe, { id: this.id, systemId: this.selectedSystemId,
      createContext: this.createContext, rules: this.rules, forces: this.forces, commands: this.commands, soloPreview: this.soloPreview,
      lock: this.lock, simulationFingerprint: this.simulationFingerprint, saveVersion: this.saveVersion });
    clone.tick = this.tick; clone.time = this.time; clone.nextShipNumber = this.nextShipNumber;
    clone.rails = false;
    for (const ship of this.ships()) clone.put(structuredClone(ship));
    clone.ruleState = motionRuleStateCopy(this.ruleState);
    return clone;
  }

  /** Shared-world forecasts step an isolated fleet, preserving rule/command order.
   * Stop at a frame transition because GhostSample coordinates belong to one body. */
  *predictShip(id: string): Generator<GhostSample, GhostEnd> {
    const clone = this.cloneForPrediction();
    try { return yield* clone.predictionSteps(id); }
    finally { clone.dispose(); }
  }

  private *predictionSteps(id: string): Generator<GhostSample, GhostEnd> {
    const initial = this.ship(id);
    if (!initial || initial.state.status !== 'flying') return 'grounded';
    this.setControls(id, IDLE);
    yield { time: initial.state.time, position: initial.state.position, velocity: initial.state.velocity, linear: true };
    for (let n = 0; n < 8192; n++) {
      const events = this.step();
      const ship = this.ship(id)!;
      if (this.paused || ship.fault) return 'failed';
      if (events.some(e => e.type === 'soi' && e.shipId === id)) return 'open';
      const s = ship.state;
      if (s.waterEntry) yield s.waterEntry;
      yield ghostSample(s, this.body(ship.bodyId));
      if (s.contact) return 'impact';
      if (s.status !== 'flying') return s.water === 'floating' ? 'floating' : 'grounded';
    }
    return 'open';
  }

  /** One fixed step of one ship: motion, contact and sphere-of-influence change. A motion
   * failure returns the ship stopped with a fault. */
  private stepShip(ship: Ship, events: WorldEvent[]): Ship {
    try {
      let state = this.context.advance(ship.state, ship.controls, STEP, this.body(ship.bodyId), this.surfaces.get(ship.bodyId));
      let bodyId = ship.bodyId;
      const contact = state.contact, status = state.status;
      const soi = this.system.checkSOI(this.customFrames ? motionRuleStateCopy(state) : state, bodyId, state.time);
      if (this.customFrames) {
        if (!soi || typeof soi.switched !== 'boolean' || !soi.newBody || !this.hasBody(soi.newBody.id)
          || !soi.newState || soi.newState.time !== state.time || !Number.isSafeInteger(soi.newState.revision)
          || soi.newState.revision !== state.revision + (soi.switched ? 1 : 0)) throw new Error('Invalid body/frame transition');
        this.context.validateState(soi.newState, this.body(soi.newBody.id), this.surface(soi.newBody.id));
      }
      if (contact) events.push({ type: 'contact', shipId: ship.id, contact, status });
      if (soi.switched) {
        events.push({ type: 'soi', shipId: ship.id, from: bodyId, to: soi.newBody.id });
        bodyId = soi.newBody.id;
        state = soi.newState;
      }
      return { id: ship.id, name: ship.name, ownerId: ship.ownerId, bodyId, state, controls: ship.controls };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.push({ type: 'fault', shipId: ship.id, message });
      return { ...ship, controls: IDLE, fault: message };
    }
  }

  /** Insert a record that is `ticks` steps behind the clock (an authoritative snapshot of
   * one ship) and advance it to the current tick on its own, exactly as `step` would have,
   * applying `before(ship, tick)` ahead of each step (held controls and throttle changes
   * scheduled at that tick). Other ships are untouched. Returns the steps' events. */
  adopt(record: Ship, ticks: number, before?: (ship: Ship, tick: number) => Ship): WorldEvent[] {
    if (this.rules.length && ticks > 0) throw new Error('Shared-world replay requires module-state synchronization (Phase 4)');
    if (!SHIP_ID_PATTERN.test(record.id)) throw new Error(`Invalid ship id ${record.id}`);
    if (!this.hasBody(record.bodyId)) throw new Error(`Ship ${record.id}: unknown body ${record.bodyId}`);
    const events: WorldEvent[] = [];
    this.own(record);
    // Nothing to replay and every step an idle coast: no steps at all.
    if (!before && ticks > 0 && this.rails && this.sleepNow(record, this.tick - ticks, ticks)) {
      this.prior.delete(record.id);
      this.fresh.delete(record.id);
      this.touched(record.id);
      return events;
    }
    let ship = record, previous: Ship | undefined;
    for (let tick = this.tick - ticks; tick < this.tick; tick++) {
      if (before) ship = before(ship, tick);
      if (ship.fault) break;
      previous = ship;
      ship = this.stepShip(ship, events);
    }
    this.fleet.set(ship.id, ship);
    this.asleepRails.delete(ship.id);
    if (previous && !ship.fault && ticks > 0) this.prior.set(ship.id, previous);
    else this.prior.delete(ship.id);
    this.wake(ship.id);
    this.touched(ship.id);
    return events;
  }

  /** Put a just-stepped ship to sleep when its next steps are known in closed form and no
   * event can interrupt them before a provable horizon. */
  private sleep(ship: Ship, tick: number): void {
    if (this.rules.length || !this.context.capabilities.rails) return;
    const { state, controls } = ship;
    if (state.contact || state.waterEntry) return;
    let horizon: number;
    if (state.status === 'crashed') {
      // A wreck only advances its clock; controls are ignored.
      if (state.dynamics !== 'numerical' || state.coast || state.solver) return;
      horizon = Infinity;
    } else {
      if (controls.turn !== 0 || controls.throttle !== 0 || controls.engine) return;
      // Each idle step re-normalizes the heading; asleep it must already be a fixed point.
      if (normalizeAngle(state.heading) !== state.heading) return;
      if (state.status === 'landed') {
        const sea = this.surfaces.get(ship.bodyId)?.seaRadiusMetres;
        if (state.water !== undefined || state.dynamics !== 'numerical' || state.coast || state.solver
          || (sea !== undefined && magnitude(state.position) < sea)) return;
        horizon = Infinity;
      } else if (state.dynamics === 'kepler' && state.coast && state.water === undefined) {
        const body = this.body(ship.bodyId);
        horizon = this.railsHorizon(this.system, body, state, state.coast, state.time,
          this.surfaces.get(ship.bodyId)?.bounds.maxRadius ?? body.radius);
      } else return;
    }
    // Skipped steps end one step before the horizon, so the step that could first see an
    // event runs normally.
    const skip = Math.floor(horizon / STEP) - 1;
    if (!(skip >= 1)) return;
    const generation = ++this.generation;
    const wake = skip === Infinity ? Infinity : tick + 1 + skip;
    this.asleepRails.set(ship.id, { tick, wake, generation });
    this.awake.delete(ship.id);
    if (wake !== Infinity) this.wakeQueue.push(wake, ship.id, generation);
  }

  private railsHorizon(system: LoadedSystem, body: ResolvedBody, state: State | Coast, epoch: Coast, time: number, top: number): number {
    try {
      const horizon = this.context.services.rails.horizon(system, body, state, epoch, time, top);
      return typeof horizon === 'number' && horizon >= 0 ? horizon : 0;
    } catch { return 0; }
  }

  /** Put a record that is due to be advanced to sleep without advancing it, when every idle
   * step from it is an exact Kepler coast that no event can interrupt for at least `need`
   * steps: what `sleep` decides after a step, decided one step sooner, so fresh records
   * (spawns, saves, snapshots, engine cuts) skip their first step. `tick` is the record's.
   * The stored record gets the coast its steps evaluate (the one `advance` would make). */
  private sleepNow(ship: Ship, tick: number, need: number): boolean {
    if (this.rules.length || !this.context.capabilities.rails) return false;
    const { state, controls } = ship;
    if (state.status !== 'flying') {
      // Resting on the ground: asleep until a command wakes it.
      const rest = this.restingState(ship);
      if (!rest) return false;
      this.asleepRails.set(ship.id, { tick, wake: Infinity, generation: ++this.generation });
      this.awake.delete(ship.id);
      this.fleet.set(ship.id, rest === state ? ship : { ...ship, state: rest });
      return true;
    }
    if (ship.fault || state.water !== undefined || state.contact || state.waterEntry
      || controls.turn !== 0 || controls.throttle !== 0 || controls.engine || !this.idleFixedPoint(state)) return false;
    const body = this.body(ship.bodyId), surface = this.surfaces.get(ship.bodyId);
    let coast: Coast | undefined;
    try {
      if (surface) this.context.services.surfaces.validate(body, surface);
      coast = this.context.keplerCoast(state, body, surface);
    } catch { return false; }
    if (!coast) return false;
    // A new coast is this very state, frozen (its elements are already cached).
    const skip = Math.floor(this.railsHorizon(this.system, body, state.coast === coast ? state : coast, coast, state.time,
      surface?.bounds.maxRadius ?? body.radius) / STEP) - 1;
    if (!(skip >= need)) return false;
    const generation = ++this.generation;
    const wake = skip === Infinity ? Infinity : tick + 1 + skip;
    this.asleepRails.set(ship.id, { tick, wake, generation });
    this.awake.delete(ship.id);
    if (wake !== Infinity) this.wakeQueue.push(wake, ship.id, generation);
    this.fleet.set(ship.id, state.coast === coast && state.dynamics === 'kepler' ? ship
      : { ...ship, state: { ...state, coast, dynamics: 'kepler' } });
    return true;
  }

  /** Sleeping records keep heading and throttle: they must be exact fixed points of the
   * idle step (a step turns a heading of -0 into +0). */
  private idleFixedPoint(state: State): boolean {
    return Number.isFinite(state.time) && Number.isFinite(state.heading) && Number.isFinite(state.throttle)
      && Object.is(normalizeAngle(state.heading + 0), state.heading) && Object.is(Math.max(0, Math.min(1, state.throttle + 0)), state.throttle);
  }

  /** The record a landed ship or wreck keeps asleep when every idle step from it only moves
   * its clock (a supported dry landing with idle controls, or any wreck): the state its next
   * numerical step makes, field for field. Undefined when it must be stepped. */
  private restingState(ship: Ship): State | undefined {
    const { state, controls } = ship;
    if (ship.fault || state.status === 'flying' || state.contact || state.waterEntry) return undefined;
    if (state.status === 'landed') {
      if (controls.turn !== 0 || controls.throttle !== 0 || controls.engine || state.water !== undefined
        || !this.idleFixedPoint(state)) return undefined;
      // Below sea level a seabed landing can start to float.
      const sea = this.surfaces.get(ship.bodyId)?.seaRadiusMetres;
      if (sea !== undefined && magnitude(state.position) < sea) return undefined;
    }
    try { this.context.validateState(state, this.body(ship.bodyId), this.surfaces.get(ship.bodyId)); } catch { return undefined; }
    if (state.dynamics === 'numerical' && !state.coast && !state.solver && !state.moduleState) return state;
    const rest: { -readonly [K in keyof State]: State[K] } = { time: state.time, position: state.position,
      velocity: state.velocity, heading: state.heading, throttle: state.throttle, status: state.status,
      revision: state.revision, dynamics: 'numerical' };
    if (state.godMode !== undefined) rest.godMode = state.godMode;
    if (state.water !== undefined) rest.water = state.water;
    return rest;
  }

  /** Bring a sleeping record up to the current tick without waking it. Mirrors what the
   * skipped idle steps compute: the coast evaluated at the clock time, the revision counting
   * every step (wrecks keep theirs), heading and throttle unchanged. */
  private materialize(id: string): Ship {
    const ship = this.fleet.get(id)!;
    const rail = this.asleepRails.get(id);
    if (!rail || rail.tick === this.tick) return ship;
    const { state } = ship;
    const steps = this.tick - rail.tick;
    let next: State;
    if (state.status === 'crashed') next = { ...state, time: this.time };
    else if (state.status === 'landed') next = { ...state, time: this.time, revision: state.revision + steps };
    else {
      const result = this.context.coastAt(state.coast!, this.time, this.body(ship.bodyId), this.surfaces.get(ship.bodyId), { cache: false });
      if (!result.ok) {
        // Never expected for a coast that was valid when it fell asleep; stop it like any
        // other motion failure rather than guess.
        const record: Ship = { ...ship, controls: IDLE, fault: `Coast evaluation failed: ${result.diagnostics.reason}` };
        this.asleepRails.delete(id);
        this.fleet.set(id, record);
        return record;
      }
      const coasting: { -readonly [K in keyof State]: State[K] } = { time: this.time, position: result.state.position,
        velocity: result.state.velocity, heading: state.heading, throttle: state.throttle, status: state.status,
        revision: state.revision + steps, coast: state.coast, dynamics: 'kepler', solver: result.diagnostics };
      if (state.godMode !== undefined) coasting.godMode = state.godMode;
      next = coasting;
    }
    rail.tick = this.tick;
    const record: Ship = { id: ship.id, name: ship.name, ownerId: ship.ownerId, bodyId: ship.bodyId, state: next,
      controls: ship.controls, ...(ship.fault ? { fault: ship.fault } : {}) };
    this.fleet.set(id, record);
    return record;
  }

  /** Release the owned motion caches when this world is retired. */
  dispose(): void { this.context.dispose(); }

  /** Return a ship to per-step advancing (after any command or replacement). */
  private wake(id: string): void {
    if (this.asleepRails.has(id)) {
      this.materialize(id);
      this.asleepRails.delete(id);
    }
    const ship = this.fleet.get(id);
    if (ship && !ship.fault) { this.awake.add(id); this.fresh.add(id); } else this.awake.delete(id);
  }

  private require(shipId: string): Ship {
    const ship = this.asleepRails.has(shipId) ? this.materialize(shipId) : this.fleet.get(shipId);
    if (!ship) throw new Error(`Unknown ship ${shipId}`);
    return ship;
  }
}
