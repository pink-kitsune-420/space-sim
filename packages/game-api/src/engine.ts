import type { ModuleDataRead, ModuleDataControl, ModuleDataSnapshot, ModuleDataExtension } from './module-data';
import type { VehicleCatalog } from './vehicles';
import type { ModuleProfile, ModuleEnvironment } from './modules';
import type { ModuleProfileV2 } from './modules-v2';
import type { AuthoritativeLock, ModuleLock, Disposable } from './modules';
import type { Controls, State, Vec, GhostSample, GhostEnd } from './state';
import type { Ship, WorldEvent } from './world';
import type { SimulationContext, SimulationContextFactory } from './context';
import type { UniverseDefinition, LoadedSystem, ResolvedBody, VehicleDefaults } from './universe';
import type { SurfaceProfile } from './surface';
import type { WorldRuleExtension, WorldRuleState } from './rules';
import type { CommandExtension, CommandEffect } from './commands';
import type { ForceExtension, ModuleState, MotionContextOptions } from './motion';
import type { MotionServices } from './services';
import type { ServiceKey } from './modules-v2';

type Pair = readonly [number, number];
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
/** A player identity. Only a SHA-256 hash of the secret reconnect token is stored. */
export interface SavedPlayer {
  readonly id: string;
  readonly name: string;
  readonly tokenHash?: string;
}
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
  readonly predictionFeatures?: { readonly futureSeeds: boolean };
  readonly id: string; readonly tick: number; readonly time: number;
  readonly systemId: string; readonly size: number; readonly awakeCount: number; readonly asleepCount: number;
  readonly universe: UniverseDefinition; readonly system: LoadedSystem; readonly context: SimulationContext;
  readonly simulationFingerprint: string; readonly lock?: AuthoritativeLock | ModuleLock;
  readonly rules: readonly WorldRuleExtension[]; readonly forces: readonly ForceExtension[]; readonly commands: readonly CommandExtension[];
  readonly moduleState: Readonly<Record<string, WorldRuleState>>;
  readonly soloPreview: boolean; readonly paused: boolean; readonly fault?: string;
  readonly rails: boolean; readonly nextWakeTick: number; readonly requiresWorldPrediction: boolean;
  readonly version: number; readonly nextShipNumber: number; readonly saveVersion?: number;
  readonly migrateState?: (id: string, state: ModuleState, target: number) => ModuleState;
  readonly surfaces: ReadonlyMap<string, SurfaceProfile>;
  record(id: string): Ship | undefined; records(): IterableIterator<Ship>;
  ship(id: string): Ship | undefined; ships(): readonly Ship[]; has(id: string): boolean;
  awakeShips(): IterableIterator<Ship>; previous(id: string): Ship | undefined;
  ownedBy(id: string): ReadonlySet<string>; isAsleep(id: string): boolean; settles(id: string): boolean;
  stateAt(id: string, time: number): State | undefined;
  hasBody(id: string): boolean; body(id: string): ResolvedBody; surface(id: string): SurfaceProfile | undefined;
  presetId(id?: string): string; presetState(id?: string): { readonly state: State; readonly bodyId: string };
  /** Optional inert future seed is supported by independent analytic flight only;
   * rule/custom-frame worlds reject it. Never edits a ship or arms controls. */
  predictShip(id: string, coarse?: boolean, seed?: { readonly state: State; readonly bodyId: string }): Generator<GhostSample, GhostEnd>;
  cloneForPrediction(): WorldControl;
}
export interface WorldChanges extends Disposable {
  take(): { readonly changed: readonly string[]; readonly removed: readonly string[] };
}
export interface WorldControl extends WorldRead, Disposable {
  readonly data: ModuleDataControl;
  setControls(id: string, controls: Controls): void; setThrottle(id: string, value: number): void;
  step(): WorldEvent[]; advanceTo(tick: number, maxSteps?: number): WorldEvent[];
  put(ship: Ship): void; remove(id: string): boolean;
  spawn(options: { readonly ownerId: string; readonly presetId?: string; readonly name?: string; readonly godMode?: boolean; readonly vehicleId?: string }): Ship;
  respawn(id: string, preset?: string, godMode?: boolean): Ship;
  teleport(id: string, body: string, position: Vec, velocity: Vec, heading?: number): Ship;
  reset(): void; setGodMode(id: string, enabled: boolean): void; setGodModeAll(enabled: boolean): void;
  rename(id: string, name: string): void; clearFault(id: string): void;
  setModuleState(state: Readonly<Record<string, WorldRuleState>>): void;
  adopt(record: Ship, ticks: number, before?: (ship: Ship, tick: number) => Ship): WorldEvent[];
  /** Reconciliation may rewind. No stepping, rounding or epoch conversion occurs here. */
  restoreClock(tick: number, time: number): void;
  /** One owned delta consumer per world, released before another session can subscribe. */
  subscribeChanges(): WorldChanges;
}
export interface WorldCreationOptions {
  readonly vehicles?: VehicleCatalog;
  readonly dataAdapters?: readonly ModuleDataExtension[];
  readonly configuration?: SavedGameConfiguration;
  readonly soloPreview?: boolean; readonly migrateState?: WorldRead['migrateState']; readonly systemId?: string; readonly id?: string;
  readonly createContext?: SimulationContextFactory; readonly rules?: readonly WorldRuleExtension[]; readonly forces?: readonly ForceExtension[];
  readonly commands?: readonly CommandExtension[]; readonly lock?: AuthoritativeLock | ModuleLock; readonly simulationFingerprint?: string; readonly saveVersion?: number;
}
export interface WorldFactory { create(universe: UniverseDefinition, options?: WorldCreationOptions): WorldControl }
export interface SavedWorldOptions {
  readonly flightPlans?: import('./flight-plans').FlightPlanArchive;
  readonly players?: readonly SavedPlayer[]; readonly hostId?: string; readonly paused?: boolean; readonly savedAt?: string;
  readonly version?: number; readonly lock?: AuthoritativeLock | ModuleLock; readonly simulationFingerprint?: string;
  readonly moduleState?: Readonly<Record<string, WorldRuleState>>;
}
export interface SaveCodec {
  /** Exact legacy authority identity used for worlds predating explicit locks. */
  readonly defaultLock: AuthoritativeLock;
  save(world: WorldRead, extra?: SavedWorldOptions): WorldSave;
  load(raw: unknown, options?: Pick<WorldCreationOptions, 'createContext' | 'rules' | 'forces' | 'commands' | 'soloPreview' | 'migrateState' | 'dataAdapters' | 'vehicles'>): {
    readonly world: WorldControl; readonly players: readonly SavedPlayer[]; readonly hostId?: string; readonly paused: boolean;
  };
  shipToSaved(ship: Ship): SavedShip;
  shipFromSaved(world: WorldRead, raw: unknown, context?: string, time?: number): Ship;
  playerFromSaved(raw: unknown, context?: string): SavedPlayer;
}
export interface FixedClock {
  readonly alpha: number; readonly lastSteps: number; readonly droppedSeconds: number;
  reset(): void; advance(seconds: number, tick: () => void, warp?: number, maxSteps?: number): void;
}
export interface ClockService { readonly stepSeconds: 0.01; readonly idle: Controls; readonly model: string; create(): FixedClock }
export interface WarpSafety { readonly maxGranted: number; readonly reason?: string; readonly railsEligible: boolean }
export interface CoreMotion {
  readonly services: MotionServices;
  createContext(settings?: Partial<VehicleDefaults>, options?: MotionContextOptions): SimulationContext;
  validateUniverse(raw: unknown): UniverseDefinition;
  checkWarpSafety(world: WorldRead): WarpSafety;
  clampWarpFactor(factor: number, maxAllowed?: number): number;
  nextWarpFactor(factor: number, direction: 1 | -1, maxAllowed?: number): number;
  magnitude(value: Vec): number; normalizeAngle(value: number): number;
}
export interface CoreCommands {
  resolve(command: CommandExtension, ship: Ship, args: unknown, tick: number, time: number): CommandEffect;
}
export const CORE_WORLD: ServiceKey<WorldFactory> = Object.freeze({ slot: 'core.world', version: '1.0.0' });
export const CORE_SAVE: ServiceKey<SaveCodec> = Object.freeze({ slot: 'core.save', version: '1.0.0' });
export const CORE_CLOCK: ServiceKey<ClockService> = Object.freeze({ slot: 'core.clock', version: '1.0.0' });
export const CORE_MOTION: ServiceKey<CoreMotion> = Object.freeze({ slot: 'core.motion', version: '1.0.0' });
export const CORE_COMMANDS: ServiceKey<CoreCommands> = Object.freeze({ slot: 'core.commands', version: '1.0.0' });
