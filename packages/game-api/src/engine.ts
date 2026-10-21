import type { ModuleDataRead, ModuleDataControl, ModuleDataSnapshot, ModuleDataExtension } from './module-data';
import type { VehicleCatalog } from './vehicles';
import type { ModuleProfile, ModuleEnvironment } from './modules';
import type { ModuleProfileV2 } from './modules-v2';
import type { AuthoritativeLock, ModuleLock, Disposable } from './modules';
import type { Controls, State, Vec, GhostSample, GhostEnd } from './state';
import type { AvatarControls, AvatarMode, AvatarState, Ship, WorldEvent } from './world';
import type { SimulationContext, SimulationContextFactory } from './context';
import type { UniverseDefinition, LoadedSystem, ResolvedBody, VehicleDefaults } from './universe';
import type { SurfaceProfile } from './surface';
import type { WorldRuleExtension, WorldRuleState } from './rules';
import type { CommandExtension, CommandEffect } from './commands';
import type { ForceExtension, ModuleState, MotionContextOptions, ModuleValue } from './motion';
import type { MotionServices } from './services';
import type { ServiceKey } from './modules-v2';

type Pair = readonly [number, number];
/** Serialized Keplerian coast epoch (`epochSeconds` in `s`, body-centered inertial `position` in `m` and `velocity` in `m/s`) stored in a `SavedShip`. */
export interface SavedCoast {
  /** Present for selected custom services; checked against the installed context on load. */
  readonly modelIdentity?: string;
  readonly epochSeconds: number;
  readonly position: Pair;
  readonly velocity: Pair;
  readonly revision: number;
}
/** Body-relative Float64 state. Derived caches and per-step diagnostics are rebuilt. */
export interface SavedShip {
  readonly vehicleId?: string;
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly bodyId: string;
  readonly position: Pair;
  readonly velocity: Pair;
  readonly heading: number;
  /** Rotation rate in rad/s; omitted when 0. */
  readonly angularVelocity?: number;
  readonly throttle: number;
  readonly status: State['status'];
  readonly revision: number;
  readonly godMode?: boolean;
  readonly water?: 'submerged' | 'floating';
  /** Present while coasting: the epoch this ship's exact Kepler motion is evaluated from. */
  readonly coast?: SavedCoast;
  readonly fault?: string;
  readonly moduleState?: Readonly<Record<string, ModuleState>>;
}
/** Lightweight body-relative avatar snapshot for world saves. */
export interface SavedAvatar {
  readonly id: string;
  readonly ownerId: string;
  readonly parentBodyId: string;
  readonly position: Pair;
  readonly velocity: Pair;
  readonly heading: number;
  readonly mode: AvatarMode;
  readonly mountedShipId?: string;
  readonly revision: number;
}
/** A player identity. Only a SHA-256 hash of the secret reconnect token is stored. */
export interface SavedPlayer {
  readonly id: string;
  readonly name: string;
  readonly tokenHash?: string;
}
/** Dynamic celestial body snapshot for simulated (non-`'rails'`) universes: system-inertial
 * `position` (`m`) and `velocity` (`m/s`) at the save's `time`, independent of the authored parent. */
export interface SavedBodyState {
  readonly id: string;
  readonly position: Pair;
  readonly velocity: Pair;
}
/** Saved module profile and per-environment v2 runtime package selections (`spacelab-progress-configuration/2`) embedded in a world save. */
export interface SavedGameConfiguration {
  readonly format: 'spacelab-progress-configuration/2';
  readonly profile: ModuleProfile;
  readonly runtime: { readonly format: 'spacelab-runtime-selection/2'; readonly plans: Readonly<Partial<Record<ModuleEnvironment, {
    readonly profile: ModuleProfileV2;
    readonly packages: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
    readonly requiredSlots: readonly string[];
  }>>> };
  readonly data: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
  readonly code: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
}
/** Portable `space-sim-world` save document containing the full `UniverseDefinition`, SI state (`m`, `s`, `rad`) at `tick`/`time`, ships, players, and optional locks/plans. */
export interface WorldSave {
  readonly vehicles?: VehicleCatalog;
  readonly data?: ModuleDataSnapshot;
  readonly format: 'space-sim-world';
  /** Optional inert local planning intent. Older saves omit it; loading never arms execution. */
  readonly flightPlans?: import('./flight-plans').FlightPlanArchive;
  readonly configuration?: SavedGameConfiguration;
  readonly version: number;
  readonly model: string;
  readonly units: { readonly length: 'metre'; readonly time: 'second'; readonly angle: 'radian' };
  readonly worldId: string;
  readonly savedAt?: string;
  /** The full universe, so a save is portable between browsers and servers. */
  readonly universe: UniverseDefinition;
  readonly systemId: string;
  readonly tick: number;
  readonly time: number;
  readonly paused?: boolean;
  readonly nextShipNumber: number;
  /** The player who hosted this world in a browser; whoever loads it there takes that seat. */
  readonly hostId?: string;
  readonly players: readonly SavedPlayer[];
  readonly ships: readonly SavedShip[];
  readonly avatars?: readonly SavedAvatar[];
  /** Dynamic celestial body states; only for universes whose `physics.mode` is not `'rails'`.
   * Absent means bodies start from their authored ephemerides at `time`. */
  readonly bodies?: readonly SavedBodyState[];
  readonly lock?: AuthoritativeLock | ModuleLock;
  readonly simulationFingerprint?: string;
  readonly moduleState?: Readonly<Record<string, WorldRuleState>>;
}

/** Body-relative SI state. Read operations retain the world's established rails semantics. */
export interface WorldRead {
  readonly vehicles?: VehicleCatalog;
  contextFor(ship: Pick<Ship, 'vehicleId'>): SimulationContext;
  readonly data: ModuleDataRead;
  readonly dataAdapters: readonly ModuleDataExtension[];
  readonly configuration?: SavedGameConfiguration;
  /** Absent on older hosts; planners must not assume optional seed arguments are understood. */
  readonly predictionFeatures?: { readonly futureSeeds: boolean; readonly endTime?: boolean };
  readonly id: string; readonly tick: number; readonly time: number;
  readonly systemId: string; readonly size: number; readonly awakeCount: number; readonly asleepCount: number;
  readonly universe: UniverseDefinition; readonly system: LoadedSystem; readonly context: SimulationContext;
  readonly simulationFingerprint: string; readonly lock?: AuthoritativeLock | ModuleLock;
  readonly rules: readonly WorldRuleExtension[]; readonly forces: readonly ForceExtension[]; readonly commands: readonly CommandExtension[];
  readonly moduleState: Readonly<Record<string, WorldRuleState>>;
  readonly soloPreview: boolean; readonly paused: boolean; readonly fault?: string;
  readonly rails: boolean; readonly nextWakeTick: number; readonly requiresWorldPrediction: boolean;
  readonly version: number; readonly nextShipNumber: number; readonly saveVersion?: number;
  readonly bodyStates?: readonly SavedBodyState[];
  readonly migrateState?: (id: string, state: ModuleState, target: number) => ModuleState;
  readonly surfaces: ReadonlyMap<string, SurfaceProfile>;
  record(id: string): Ship | undefined; records(): IterableIterator<Ship>;
  ship(id: string): Ship | undefined; ships(): readonly Ship[]; has(id: string): boolean;
  avatar(id: string): AvatarState | undefined; avatars(): readonly AvatarState[];
  awakeShips(): IterableIterator<Ship>; previous(id: string): Ship | undefined;
  ownedBy(id: string): ReadonlySet<string>; isAsleep(id: string): boolean; settles(id: string): boolean;
  stateAt(id: string, time: number): State | undefined;
  hasBody(id: string): boolean; body(id: string): ResolvedBody; surface(id: string): SurfaceProfile | undefined;
  presetId(id?: string): string; presetState(id?: string): { readonly state: State; readonly bodyId: string };
  /** Optional inert future seed is supported by independent analytic flight only;
   * rule/custom-frame worlds reject it. Never edits a ship or arms controls. until requests an exact endpoint (at most
   * 100 Julian years after the seed), disabling orbit closure; requires predictionFeatures.endTime. */
  predictShip(id: string, coarse?: boolean, seed?: { readonly state: State; readonly bodyId: string; readonly until?: number }): Generator<GhostSample, GhostEnd>;
  cloneForPrediction(): WorldControl;
}
/** Disposable change-tracking subscription reporting ship IDs modified or removed since the previous `take()`. */
export interface WorldChanges extends Disposable {
  take(): { readonly changed: readonly string[]; readonly removed: readonly string[] };
}
/** Authoritative mutable world handle extending `WorldRead` with fixed-step advancement (`0.01 s`), ship spawning/teleportation, and control mutations. */
export interface WorldControl extends WorldRead, Disposable {
  readonly data: ModuleDataControl;
  setControls(id: string, controls: Controls): void; setThrottle(id: string, value: number): void;
  queueModuleEvent(shipId: string, event: { readonly type: string; readonly payload: ModuleValue }): void;
  step(): WorldEvent[]; advanceTo(tick: number, maxSteps?: number): WorldEvent[];
  put(ship: Ship): void; remove(id: string): boolean;
  spawn(options: { readonly ownerId: string; readonly presetId?: string; readonly name?: string; readonly godMode?: boolean; readonly vehicleId?: string }): Ship;
  respawn(id: string, preset?: string, godMode?: boolean): Ship;
  teleport(id: string, body: string, position: Vec, velocity: Vec, heading?: number): Ship;
  spawnAvatar(options: { readonly id?: string; readonly ownerId: string; readonly bodyId: string; readonly position: Vec; readonly velocity?: Vec }): AvatarState;
  removeAvatar(id: string): boolean;
  boardShip(avatarId: string, shipId: string): void;
  disembarkShip(avatarId: string): AvatarState;
  setAvatarControls?(id: string, controls: AvatarControls): void;
  reset(): void; setGodMode(id: string, enabled: boolean): void; setGodModeAll(enabled: boolean): void;
  rename(id: string, name: string): void; clearFault(id: string): void;
  setModuleState(state: Readonly<Record<string, WorldRuleState>>): void;
  adopt(record: Ship, ticks: number, before?: (ship: Ship, tick: number) => Ship): WorldEvent[];
  /** Reconciliation may rewind. No stepping, rounding or epoch conversion occurs here. */
  restoreClock(tick: number, time: number): void;
  /** One owned delta consumer per world, released before another session can subscribe. */
  subscribeChanges(): WorldChanges;
}
/** Options for constructing an authoritative `WorldControl` instance: vehicle catalog, module extensions, lock/fingerprint, and context factory. */
export interface WorldCreationOptions {
  readonly vehicles?: VehicleCatalog;
  readonly dataAdapters?: readonly ModuleDataExtension[];
  readonly configuration?: SavedGameConfiguration;
  readonly soloPreview?: boolean; readonly migrateState?: WorldRead['migrateState']; readonly systemId?: string; readonly id?: string;
  readonly createContext?: SimulationContextFactory; readonly rules?: readonly WorldRuleExtension[]; readonly forces?: readonly ForceExtension[];
  readonly commands?: readonly CommandExtension[]; readonly lock?: AuthoritativeLock | ModuleLock; readonly simulationFingerprint?: string; readonly saveVersion?: number;
}
/** Factory service creating authoritative `WorldControl` simulation instances (`core.world@1.0.0`). */
export interface WorldFactory { create(universe: UniverseDefinition, options?: WorldCreationOptions): WorldControl }
/** Optional metadata and session state included when serializing a `WorldRead` into a `WorldSave`. */
export interface SavedWorldOptions {
  readonly flightPlans?: import('./flight-plans').FlightPlanArchive;
  readonly players?: readonly SavedPlayer[]; readonly hostId?: string; readonly paused?: boolean; readonly savedAt?: string;
  readonly version?: number; readonly lock?: AuthoritativeLock | ModuleLock; readonly simulationFingerprint?: string;
  readonly moduleState?: Readonly<Record<string, WorldRuleState>>;
}
/** Authoritative world and entity save/load codec (`core.save@1.0.0`) validating `space-sim-world` JSON archives. */
export interface SaveCodec {
  /** Exact legacy authority identity used for worlds predating explicit locks. */
  readonly defaultLock: AuthoritativeLock;
  save(world: WorldRead, extra?: SavedWorldOptions): WorldSave;
  load(raw: unknown, options?: Pick<WorldCreationOptions, 'createContext' | 'rules' | 'forces' | 'commands' | 'soloPreview' | 'migrateState' | 'dataAdapters' | 'vehicles'>): {
    readonly world: WorldControl; readonly players: readonly SavedPlayer[]; readonly hostId?: string; readonly paused: boolean;
  };
  shipToSaved(ship: Ship): SavedShip;
  shipFromSaved(world: WorldRead, raw: unknown, context?: string, time?: number): Ship;
  avatarToSaved?(avatar: AvatarState): SavedAvatar;
  avatarFromSaved?(raw: unknown, context?: string): AvatarState;
  playerFromSaved(raw: unknown, context?: string): SavedPlayer;
}
/** Fixed-timestep accumulator converting elapsed wall-clock seconds into discrete `0.01 s` simulation ticks and an interpolation fraction `alpha` in `[0, 1)`. */
export interface FixedClock {
  readonly alpha: number; readonly lastSteps: number; readonly droppedSeconds: number;
  reset(): void; advance(seconds: number, tick: () => void, warp?: number, maxSteps?: number): void;
}
/** Service providing the fixed simulation timestep (`0.01 s`), neutral `idle` controls, physics model ID, and `FixedClock` instances (`core.clock@1.0.0`). */
export interface ClockService { readonly stepSeconds: 0.01; readonly idle: Controls; readonly model: string; create(): FixedClock }
/** Warp safety evaluation for a world: maximum granted time-warp factor, optional limiting reason, and analytic rails eligibility. */
export interface WarpSafety { readonly maxGranted: number; readonly reason?: string; readonly railsEligible: boolean }
/** Authoritative simulation kernel providing context creation, motion services, warp limits, and vector utilities. */
export interface CoreMotion {
  readonly services: MotionServices;
  createContext(settings?: Partial<VehicleDefaults>, options?: MotionContextOptions): SimulationContext;
  validateUniverse(raw: unknown): UniverseDefinition;
  checkWarpSafety(world: WorldRead): WarpSafety;
  clampWarpFactor(factor: number, maxAllowed?: number): number;
  nextWarpFactor(factor: number, direction: 1 | -1, maxAllowed?: number): number;
  magnitude(value: Vec): number; normalizeAngle(value: number): number;
}
/** Service validating and resolving an authoritative `CommandExtension` against a detached ship snapshot at `(tick, time)` (`core.commands@1.0.0`). */
export interface CoreCommands {
  resolve(command: CommandExtension, ship: Ship, args: unknown, tick: number, time: number): CommandEffect;
}
/** Service key for the authoritative world factory (`core.world@1.0.0`). */
export const CORE_WORLD: ServiceKey<WorldFactory> = Object.freeze({ slot: 'core.world', version: '1.0.0' });
/** Service key for the authoritative world save/load codec (`core.save@1.0.0`). */
export const CORE_SAVE: ServiceKey<SaveCodec> = Object.freeze({ slot: 'core.save', version: '1.0.0' });
/** Service key for the fixed-timestep simulation clock service (`core.clock@1.0.0`). */
export const CORE_CLOCK: ServiceKey<ClockService> = Object.freeze({ slot: 'core.clock', version: '1.0.0' });
/** Service key for the core motion kernel (`core.motion@1.0.0`). */
export const CORE_MOTION: ServiceKey<CoreMotion> = Object.freeze({ slot: 'core.motion', version: '1.0.0' });
/** Service key for the authoritative module command resolver (`core.commands@1.0.0`). */
export const CORE_COMMANDS: ServiceKey<CoreCommands> = Object.freeze({ slot: 'core.commands', version: '1.0.0' });
