/** Host-only world save/load codec and validation (`packages/sim-core`). Modules access world persistence through `@space-sim/game-api` `CORE_SAVE` (`SaveCodec`: `save`, `load`, `shipToSaved`, `shipFromSaved`, `playerFromSaved`, `defaultLock`). */
import { captureVehicleCatalog, vehicleId, TRAINER_VEHICLE_ID, VehicleConfigurationError } from '../../game-api/src/index';
import { canonicalJson } from '../../game-runtime/src/authoritative';
import type { AuthoritativeLock, Coast, ModuleLock, ModuleState, State, WorldRuleState, SavedShip, SavedPlayer, WorldSave, WorldRead } from '../../game-api/src/index';
import { validateModuleState } from '../../game-runtime/src/motion';
import { DEFAULT_BUILTIN_LOCK, migrateModuleState } from '../../game-runtime/src/authoritative';
/** Default built-in authoritative module lock re-exported for `CORE_SAVE` (`SaveCodec.defaultLock`). Host-only (`packages/sim-core`). */
export { DEFAULT_BUILTIN_LOCK };
import { IDLE, MODEL, READABLE_MODELS, STEP } from './constants';
import { magnitude } from './context';
import { surfaceIdentity } from './surface';
import { validateUniverse } from './universe';
import { MAX_SHIP_NAME, SHIP_ID_PATTERN, World, cleanName, type Ship, type WorldOptions } from './world';

/** Complete-world save format discriminator (`'space-sim-world'`): every ship at one shared simulation epoch. Host-only (`packages/sim-core`). */
export const SAVE_FORMAT = 'space-sim-world';
/** Baseline authoritative world save schema version (`2`; versions `3` and `4` add module-data records and vehicle catalogues). Host-only (`packages/sim-core`). */
export const SAVE_VERSION = 2;
/** Frozen canonical SI unit descriptor (`length: 'metre'`, `time: 'second'`, `angle: 'radian'`) stored and verified in every `WorldSave`. Host-only (`packages/sim-core`). */
export const SAVE_UNITS = Object.freeze({ length: 'metre', time: 'second', angle: 'radian' });
/** Maximum number of vessels plus passive objects (`65,536`) permitted in a saved world; idle ones on rails cost almost nothing to simulate. Host-only (`packages/sim-core`). */
export const MAX_SAVE_SHIPS = 65_536;
/** Maximum number of pilot records (`512`) permitted in a validated `WorldSave`. Host-only (`packages/sim-core`). */
export const MAX_SAVE_PLAYERS = 512;
/** Maximum printable character length (`24`) for a sanitized pilot display name in saved worlds. Host-only (`packages/sim-core`). */
export const MAX_PLAYER_NAME = 24;
const TOKEN_HASH = /^[0-9a-f]{64}$/;

export type { SavedCoast, SavedShip, SavedPlayer, WorldSave } from '../../game-api/src/index';
/** Validated result of `loadWorld`, bundling the reconstructed `World` instance, sanitized `SavedPlayer` records, optional `hostId`, and `paused` state. Host-only (`packages/sim-core`; `CORE_SAVE.load` wraps `world` in `worldFacade(world).control`). */
export interface LoadedWorld {
  readonly world: World;
  readonly players: readonly SavedPlayer[];
  readonly hostId?: string;
  readonly paused: boolean;
}

type Pair = readonly [number, number];
const pair = (v: { readonly x: number; readonly y: number }): Pair => [v.x, v.y];

/** Serializes a live `Ship` record into a JSON-safe `SavedShip` snapshot in SI units (`position` in `m`, `velocity` in `m/s`, `heading` in `rad`, `epochSeconds` in `s`). Exposed to modules via `CORE_SAVE` (`SaveCodec.shipToSaved`). Host-only (`packages/sim-core`). */
export function shipToSaved(ship: Ship): SavedShip {
  const { state } = ship;
  return {
    ...(ship.vehicleId ? { vehicleId: ship.vehicleId } : {}),
    id: ship.id, name: ship.name, ownerId: ship.ownerId, bodyId: ship.bodyId,
    position: pair(state.position), velocity: pair(state.velocity),
    heading: state.heading, throttle: state.throttle, status: state.status, revision: state.revision,
    ...(state.godMode ? { godMode: true } : {}),
    ...(state.water ? { water: state.water } : {}),
    ...(state.coast ? { coast: { epochSeconds: state.coast.epochSeconds, position: pair(state.coast.position),
      velocity: pair(state.coast.velocity), revision: state.coast.revision,
      ...(state.coast.modelIdentity !== undefined ? { modelIdentity: state.coast.modelIdentity } : {}) } } : {}),
    ...(state.moduleState && Object.keys(state.moduleState).length ? { moduleState: state.moduleState } : {}) as { moduleState?: Readonly<Record<string, ModuleState>> },
    ...(ship.fault ? { fault: ship.fault } : {}),
  };
}

function fail(context: string, message: string): never { throw new Error(`${context}: ${message}`); }
function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(context, 'must be an object');
  return value as Record<string, unknown>;
}
function finite(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(context, 'must be a finite number');
  return value as number;
}
function count(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(context, 'must be a non-negative integer');
  return value as number;
}
function vec(value: unknown, context: string): { x: number; y: number } {
  if (!Array.isArray(value) || value.length !== 2) fail(context, 'must be [x, y]');
  const [x, y] = value as unknown[];
  return { x: finite(x, context), y: finite(y, context) };
}
function id(value: unknown, context: string): string {
  if (typeof value !== 'string' || !SHIP_ID_PATTERN.test(value)) fail(context, 'must be 1–64 letters, digits or _.:-');
  return value as string;
}

/** Rebuild and validate one ship against `world`'s bodies and terrain, at the world's clock
 * or at an earlier `time` (a snapshot's, in `s`). A coast epoch must reproduce the stored position;
 * a trial `0.01` s step must accept the state. Exposed to modules via `CORE_SAVE` (`SaveCodec.shipFromSaved`). Host-only (`packages/sim-core`). */
export function shipFromSaved(world: WorldRead, raw: unknown, context = 'Ship', time = world.time): Ship {
  const s = record(raw, context);
  const shipId = id(s.id, `${context} id`);
  context = `Ship ${shipId}`;
  const selectedVehicle = s.vehicleId === undefined ? (world.vehicles ? TRAINER_VEHICLE_ID : undefined) : vehicleId(s.vehicleId);
  const motion = world.contextFor({ vehicleId: selectedVehicle });
  if (typeof s.name !== 'string' || s.name.length > MAX_SHIP_NAME * 4) fail(context, 'name must be a string');
  const name = cleanName(s.name) || shipId;
  const ownerId = id(s.ownerId, `${context} ownerId`);
  const bodyId = typeof s.bodyId === 'string' && world.hasBody(s.bodyId) ? s.bodyId : fail(context, `unknown body ${String(s.bodyId)}`);
  const status = s.status === 'landed' || s.status === 'flying' || s.status === 'crashed' ? s.status : fail(context, 'invalid status');
  const throttle = finite(s.throttle, `${context} throttle`);
  if (throttle < 0 || throttle > 1) fail(context, 'throttle must be in [0, 1]');
  if (s.godMode !== undefined && typeof s.godMode !== 'boolean') fail(context, 'godMode must be boolean');
  if (s.water !== undefined && s.water !== 'submerged' && s.water !== 'floating') fail(context, 'invalid water state');
  if (s.fault !== undefined && (typeof s.fault !== 'string' || s.fault.length > 500)) fail(context, 'invalid fault');
  let moduleState: Record<string, ModuleState> | undefined;
  if (s.moduleState !== undefined) {
    const ms = record(s.moduleState, `${context} moduleState`);
    moduleState = Object.create(null);
    for (const [modId, rawVal] of Object.entries(ms)) {
      const validated = validateModuleState(rawVal as ModuleState);
      const force = world.forces?.find(f => f.moduleId === modId);
      if (force && validated.version < force.hook.initialState.version) {
        moduleState![modId] = (world.migrateState ?? migrateModuleState)(modId, validated, force.hook.initialState.version);
      } else {
        moduleState![modId] = validated;
      }
    }
  }
  const body = world.body(bodyId), surface = world.surface(bodyId);
  let state: State = {
    time, position: vec(s.position, `${context} position`), velocity: vec(s.velocity, `${context} velocity`),
    heading: finite(s.heading, `${context} heading`), throttle, status, revision: count(s.revision, `${context} revision`),
    ...(s.godMode ? { godMode: true } : {}),
    ...(s.water ? { water: s.water as 'submerged' | 'floating' } : {}),
    ...(moduleState ? { moduleState } : {}),
  };
  if (s.coast !== undefined) {
    const c = record(s.coast, `${context} coast`);
    if (c.modelIdentity !== undefined && (typeof c.modelIdentity !== 'string' || !c.modelIdentity.length || c.modelIdentity.length > 65536))
      fail(context, 'coast model identity must be a nonempty string of at most 65536 characters');
    const coast: Coast = Object.freeze({
      ...(c.modelIdentity !== undefined ? { modelIdentity: c.modelIdentity as string } : {}),
      bodyId, epochSeconds: finite(c.epochSeconds, `${context} coast epoch`),
      position: Object.freeze(vec(c.position, `${context} coast position`)),
      velocity: Object.freeze(vec(c.velocity, `${context} coast velocity`)),
      mu: body.mu, revision: count(c.revision, `${context} coast revision`), surfaceRadius: body.radius,
      surfaceIdentity: surfaceIdentity(body), ...(surface ? { contactSurfaceIdentity: surface.identity } : {}),
    });
    if (status !== 'flying' || s.water !== undefined) fail(context, 'only free flight can coast');
    const check = motion.coastAt(coast, time, body, surface, { cache: false });
    if (!check.ok) fail(context, `coast epoch is unusable (${check.diagnostics.reason ?? 'no solution'})`);
    const scale = Math.max(1, magnitude(state.position));
    if (magnitude({ x: check.state.position.x - state.position.x, y: check.state.position.y - state.position.y }) > 1e-6 * scale
      || magnitude({ x: check.state.velocity.x - state.velocity.x, y: check.state.velocity.y - state.velocity.y })
        > 1e-6 * Math.max(1, magnitude(state.velocity))) {
      fail(context, 'coast epoch disagrees with the stored position and velocity');
    }
    state = { ...state, coast, dynamics: 'kepler' };
  }
  const ship: Ship = { ...(selectedVehicle ? { vehicleId: selectedVehicle } : {}), id: shipId, name, ownerId, bodyId, state, controls: IDLE, ...(s.fault ? { fault: s.fault as string } : {}) };
  // Terrain support is checked by the trial step; the plain circle model needs it here.
  if (!surface && status !== 'flying' && (Math.abs(magnitude(state.position) - body.radius) > 1e-6 * body.radius
    || magnitude(state.velocity) !== 0)) {
    fail(context, 'a landed or crashed ship must rest on the surface with zero velocity');
  }
  if (!ship.fault) {
    try { motion.advance(state, IDLE, STEP, body, surface); }
    catch (error) { fail(context, error instanceof Error ? error.message : String(error)); }
  }
  return ship;
}

/** Validates and sanitizes an untrusted saved pilot record (`id`, `name` up to `MAX_PLAYER_NAME`, optional 64-character lowercase hex `tokenHash`). Exposed to modules via `CORE_SAVE` (`SaveCodec.playerFromSaved`). Host-only (`packages/sim-core`). */
export function playerFromSaved(raw: unknown, context = 'Player'): SavedPlayer {
  const p = record(raw, context);
  const playerId = id(p.id, `${context} id`);
  const name = cleanName(p.name, MAX_PLAYER_NAME) || 'Pilot';
  if (p.tokenHash !== undefined && (typeof p.tokenHash !== 'string' || !TOKEN_HASH.test(p.tokenHash))) {
    fail(`Player ${playerId}`, 'tokenHash must be 64 lowercase hex digits');
  }
  return { id: playerId, name, ...(p.tokenHash ? { tokenHash: p.tokenHash as string } : {}) };
}

/** Serializes a `WorldRead` state at its shared simulation epoch (`tick`, `time` in `s`) into a complete `WorldSave` archive (`space-sim-world` versions 1–4) in SI units. Rejects solo-preview custom authoritative worlds. Exposed to modules via `CORE_SAVE` (`SaveCodec.save`). Host-only (`packages/sim-core`). */
export function saveWorld(world: WorldRead, extra: {
  readonly flightPlans?: import('../../game-api/src/index').FlightPlanArchive;
  readonly players?: readonly SavedPlayer[]; readonly hostId?: string; readonly paused?: boolean; readonly savedAt?: string;
  readonly version?: number; readonly lock?: AuthoritativeLock | ModuleLock; readonly simulationFingerprint?: string;
  readonly moduleState?: Readonly<Record<string, WorldRuleState>>;
} = {}): WorldSave {
  if (world.soloPreview) throw new Error('Custom authoritative module profiles are solo previews; world saves require declared deterministic multiplayer support. Export the module/profile instead.');
  const hasData = world.data.schemas.length > 0;
  const version = extra.version ?? (world.vehicles ? 4 : hasData ? 3 : world.saveVersion === 1 ? 1 : SAVE_VERSION);
  if (![1, 2, 3, 4].includes(version)) throw new Error('Unsupported save version');
  if (world.vehicles && version !== 4) throw new Error('Vehicle definitions require save version 4');
  if (version === 4 && !world.vehicles) throw new Error('Save version 4 requires vehicle definitions');
  if (hasData && version < 3) throw new Error('Module-data adapters require save version 3');
  if (version === 1) {
    return {
      ...(extra.flightPlans?.plans.length ? { flightPlans: structuredClone(extra.flightPlans) } : {}),
      format: SAVE_FORMAT, version: 1, model: MODEL, units: SAVE_UNITS, worldId: world.id,
      ...(extra.savedAt ? { savedAt: extra.savedAt } : {}),
      universe: world.universe, systemId: world.systemId, tick: world.tick, time: world.time,
      ...(extra.paused !== undefined ? { paused: extra.paused } : {}),
      nextShipNumber: world.nextShipNumber,
      ...(extra.hostId ? { hostId: extra.hostId } : {}),
      players: (extra.players ?? []).map(p => ({ id: p.id, name: p.name, ...(p.tokenHash ? { tokenHash: p.tokenHash } : {}) })),
      ships: world.ships().map(ship => {
        const { moduleState: _ms, ...rest } = shipToSaved(ship);
        return rest;
      }),
    };
  }
  const lock = extra.lock ?? world.lock ?? DEFAULT_BUILTIN_LOCK;
  const simulationFingerprint = extra.simulationFingerprint ?? world.simulationFingerprint;
  const ruleState = extra.moduleState ?? (Object.keys(world.moduleState).length ? world.moduleState : undefined);
  return {
    ...(world.configuration ? { configuration: world.configuration } : {}),
    ...(extra.flightPlans?.plans.length ? { flightPlans: structuredClone(extra.flightPlans) } : {}),
    format: SAVE_FORMAT, version, model: MODEL, units: SAVE_UNITS, worldId: world.id,
    ...(extra.savedAt ? { savedAt: extra.savedAt } : {}),
    universe: world.universe, systemId: world.systemId, tick: world.tick, time: world.time,
    ...(extra.paused !== undefined ? { paused: extra.paused } : {}),
    nextShipNumber: world.nextShipNumber,
    ...(extra.hostId ? { hostId: extra.hostId } : {}),
    players: (extra.players ?? []).map(p => ({ id: p.id, name: p.name, ...(p.tokenHash ? { tokenHash: p.tokenHash } : {}) })),
    ships: world.ships().map(ship => {
      const saved = shipToSaved(ship);
      return world.vehicles ? { ...saved, vehicleId: ship.vehicleId ?? TRAINER_VEHICLE_ID } : saved;
    }),
    ...(world.vehicles ? { vehicles: world.vehicles } : {}),
    ...(lock ? { lock } : {}),
    ...(simulationFingerprint ? { simulationFingerprint } : {}),
    ...(ruleState ? { moduleState: ruleState } : {}),
    ...(hasData ? { data: world.data.snapshot() } : {}),
  };
}

/** Upgrade older save versions in place. Version 1 is the first; later versions add steps here. */
export function migrateSave(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.version === 1) {
    return {
      ...raw,
      version: 2,
      lock: DEFAULT_BUILTIN_LOCK,
      moduleState: {},
    };
  }
  if (raw.version === SAVE_VERSION || raw.version === 3 || raw.version === 4) return raw;
  throw new Error(`Unsupported save version ${String(raw.version)}; this game reads version ${SAVE_VERSION}`);
}

/** Validate everything before building a world; a rejected save never touches live state. */
export function loadWorld(raw: unknown, options: Partial<Pick<WorldOptions, 'createContext' | 'rules' | 'forces' | 'commands' | 'soloPreview' | 'migrateState' | 'dataAdapters' | 'vehicles'>> = {}): LoadedWorld {
  const input = record(raw, 'Save');
  if (input.format !== SAVE_FORMAT) fail('Save', `not a ${SAVE_FORMAT} file`);
  const originalVersion = Number(input.version);
  const save = migrateSave(input);
  if (!READABLE_MODELS.includes(save.model as string)) fail('Save', `physics model ${String(save.model)} differs from ${MODEL}`);
  const units = record(save.units, 'Save units');
  if (units.length !== SAVE_UNITS.length || units.time !== SAVE_UNITS.time || units.angle !== SAVE_UNITS.angle) {
    fail('Save', 'units must be metre, second and radian');
  }
  const worldId = id(save.worldId, 'Save worldId');
  const universe = validateUniverse(save.universe);
  if (typeof save.systemId !== 'string' || !universe.systems.some(s => s.id === save.systemId)) {
    fail('Save', `unknown system ${String(save.systemId)}`);
  }
  const tick = count(save.tick, 'Save tick');
  const time = finite(save.time, 'Save time');
  if (time < 0 || Math.abs(time - tick * STEP) > 1e-6 * Math.max(1, time)) fail('Save', 'time and tick disagree');
  if (save.paused !== undefined && typeof save.paused !== 'boolean') fail('Save', 'paused must be boolean');
  if (!Array.isArray(save.players) || save.players.length > MAX_SAVE_PLAYERS) fail('Save', `players must be a list of at most ${MAX_SAVE_PLAYERS}`);
  if (!Array.isArray(save.ships) || save.ships.length > MAX_SAVE_SHIPS) fail('Save', `ships must be a list of at most ${MAX_SAVE_SHIPS}`);
  const players = (save.players as unknown[]).map((p, i) => playerFromSaved(p, `Player ${i + 1}`));
  if (new Set(players.map(p => p.id)).size !== players.length) fail('Save', 'duplicate player id');
  const hostId = save.hostId === undefined ? undefined : id(save.hostId, 'Save hostId');
  if (hostId !== undefined && !players.some(p => p.id === hostId)) fail('Save', 'hostId is not a listed player');

  let lock: AuthoritativeLock | ModuleLock | undefined;
  if (save.lock !== undefined) {
    const l = record(save.lock, 'Save lock');
    if (l.format !== 'space-sim-auth-lock/1' && l.format !== 'space-sim-lock/1') fail('Save lock', 'invalid lock format');
    lock = l as unknown as AuthoritativeLock | ModuleLock;
  }
  let simulationFingerprint: string | undefined;
  if (save.simulationFingerprint !== undefined) {
    if (typeof save.simulationFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(save.simulationFingerprint)) {
      fail('Save', 'simulationFingerprint must be 64 lowercase hex digits');
    }
    simulationFingerprint = save.simulationFingerprint;
  }
  let ruleState: Record<string, WorldRuleState> | undefined;
  if (save.moduleState !== undefined) {
    const ms = record(save.moduleState, 'Save moduleState');
    ruleState = Object.create(null);
    for (const [modId, rawVal] of Object.entries(ms)) {
      const entry = record(rawVal, `Save moduleState ${modId}`);
      let st = validateModuleState(entry.state as any);
      const rule = (options.rules ?? []).find(r => r.moduleId === modId);
      if (rule && st.version < rule.hook.initialState.version) {
        st = (options.migrateState ?? migrateModuleState)(modId, st, rule.hook.initialState.version);
      }
      const randomState = count(entry.randomState, `Save moduleState ${modId} randomState`);
      if (randomState === 0 || randomState > 0xffffffff) fail(`Save moduleState ${modId}`, 'invalid randomState');
      ruleState![modId] = { state: st, randomState };
    }
  }

  if (save.version === 4) {
    if (!options.vehicles) throw new VehicleConfigurationError('Save: Missing required vehicle packages. Enable the exact gameplay packages listed by this save.');
    const expected = captureVehicleCatalog(options.vehicles), saved = captureVehicleCatalog(save.vehicles);
    if (canonicalJson(expected) !== canonicalJson(saved)) throw new VehicleConfigurationError('Save: Required vehicle definitions differ. Enable the exact gameplay packages used by this save.');
    if ((save.ships as Record<string, unknown>[]).some(ship => !ship || typeof ship.vehicleId !== 'string')) fail('Save', 'Version 4 requires an explicit identity for every vehicle');
  } else if (save.vehicles !== undefined || (save.ships as Record<string, unknown>[]).some(ship => ship && ship.vehicleId !== undefined)) {
    fail('Save', 'Vehicle identity requires save version 4');
  }
  const world = new World(universe, {
    ...options,
    systemId: save.systemId as string,
    id: worldId,
    lock,
    simulationFingerprint,
    saveVersion: originalVersion,
  });
  try {
    if ((save.version === 3 || world.data.schemas.length) && save.data === undefined) throw new Error('Save version 3 requires module-data state');
    if (save.data !== undefined) {
      if (save.version !== 3 && save.version !== 4) throw new Error('Module-data state requires save version 3 or 4');
      world.data.restore(save.data);
    }
    world.tick = tick;
    world.time = time;
    if (ruleState) {
      world.setModuleState(ruleState);
    }
    let highest = 0;
    for (const [i, rawShip] of (save.ships as unknown[]).entries()) {
      const ship = shipFromSaved(world, rawShip, `Ship ${i + 1}`);
      if (world.ship(ship.id)) fail('Save', `duplicate ship id ${ship.id}`);
      world.put(ship);
      const n = /^ship-(\d+)$/.exec(ship.id);
      if (n) highest = Math.max(highest, Number(n[1]));
    }
    world.nextShipNumber = Math.max(count(save.nextShipNumber, 'Save nextShipNumber'), highest + 1, 1);
    return { world, players, ...(hostId ? { hostId } : {}), paused: save.paused === true };
  } catch (error) {
    world.dispose();
    throw error;
  }
}
