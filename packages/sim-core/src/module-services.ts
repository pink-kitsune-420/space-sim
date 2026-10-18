import { ModuleDataStore } from '../../game-runtime/src/module-data';
import { CORE_MODULE_DATA } from '../../game-api/src/index';
import { CORE_ROTATION, CORE_CLOCK, CORE_COMMANDS, CORE_MOTION, CORE_SAVE, CORE_WORLD,
  type CoreMotion, type HostServiceAccess, type SaveCodec, type WorldControl, type WorldRead } from '../../game-api/src/index';
import { Clock } from './clock';
import { spinRate, spinAngle, rotate, groundVelocity, bodyFixed } from './spin';
import { IDLE, MODEL, STEP } from './constants';
import { createSimulationContext, magnitude, normalizeAngle } from './context';
import { World } from './world';
import { DEFAULT_BUILTIN_LOCK, loadWorld, playerFromSaved, saveWorld, shipFromSaved, shipToSaved } from './save';
import { BUILTIN_SERVICES } from './services';
import { validateUniverse } from './universe';
import { checkWarpSafety, clampWarpFactor, nextWarpFactor } from './warp';
import { resolveCommand } from '../../game-runtime/src/commands';

/** Fixed public projection: no implementation class, mutable clock fields or hidden lookup.
 * All binding occurs once at construction, outside physics/render loops. */
export function worldFacade(world: WorldControl): { readonly read: WorldRead; readonly control: WorldControl } {
  const data = Object.freeze({ get schemas() { return world.data.schemas; }, get revision() { return world.data.revision; },
    get: world.data.get.bind(world.data), snapshot: world.data.snapshot.bind(world.data), delta: world.data.delta.bind(world.data) });
  const read: WorldRead = Object.freeze({
    get vehicles() { return world.vehicles; }, contextFor: world.contextFor.bind(world),
    get configuration() { return world.configuration; },
    get id() { return world.id; }, get tick() { return world.tick; }, get time() { return world.time; },
    get systemId() { return world.systemId; }, get size() { return world.size; },
    get awakeCount() { return world.awakeCount; }, get asleepCount() { return world.asleepCount; },
    get universe() { return world.universe; }, get system() { return world.system; }, get context() { return world.context; },
    get simulationFingerprint() { return world.simulationFingerprint; }, get lock() { return world.lock; },
    get rules() { return world.rules; }, get forces() { return world.forces; }, get commands() { return world.commands; },
    get data() { return data; }, get dataAdapters() { return world.dataAdapters; },
    get moduleState() { return world.moduleState; }, get soloPreview() { return world.soloPreview; },
    get paused() { return world.paused; }, get fault() { return world.fault; }, get rails() { return world.rails; },
    get nextWakeTick() { return world.nextWakeTick; }, get requiresWorldPrediction() { return world.requiresWorldPrediction; },
    get version() { return world.version; }, get nextShipNumber() { return world.nextShipNumber; }, get saveVersion() { return world.saveVersion; },
    get migrateState() { return world.migrateState; }, get surfaces() { return world.surfaces; },
    record: world.record.bind(world), records: world.records.bind(world), ship: world.ship.bind(world), ships: world.ships.bind(world),
    has: world.has.bind(world), awakeShips: world.awakeShips.bind(world), previous: world.previous.bind(world), ownedBy: world.ownedBy.bind(world),
    isAsleep: world.isAsleep.bind(world), settles: world.settles.bind(world), stateAt: world.stateAt.bind(world), hasBody: world.hasBody.bind(world),
    body: world.body.bind(world), surface: world.surface.bind(world), presetId: world.presetId.bind(world), presetState: world.presetState.bind(world),
    predictShip: world.predictShip.bind(world), cloneForPrediction: () => worldFacade(world.cloneForPrediction()).control,
  });
  const control: WorldControl = Object.freeze(Object.assign(Object.create(read, { data: { value: world.data, enumerable: true } }) as WorldControl, {
    setControls: world.setControls.bind(world), setThrottle: world.setThrottle.bind(world), step: world.step.bind(world), advanceTo: world.advanceTo.bind(world),
    put: world.put.bind(world), remove: world.remove.bind(world), spawn: world.spawn.bind(world), respawn: world.respawn.bind(world),
    teleport: world.teleport.bind(world), reset: world.reset.bind(world), setGodMode: world.setGodMode.bind(world), setGodModeAll: world.setGodModeAll.bind(world),
    rename: world.rename.bind(world), clearFault: world.clearFault.bind(world), setModuleState: world.setModuleState.bind(world), adopt: world.adopt.bind(world),
    restoreClock: world.restoreClock.bind(world), subscribeChanges: world.subscribeChanges.bind(world), dispose: world.dispose.bind(world),
  }));
  return Object.freeze({ read, control });
}
const saveCodec: SaveCodec = Object.freeze({ defaultLock: DEFAULT_BUILTIN_LOCK, save: saveWorld, shipFromSaved, shipToSaved, playerFromSaved,
  load: (raw: unknown, options?: Parameters<SaveCodec['load']>[1]) => { const loaded = loadWorld(raw, options); return { ...loaded, world: worldFacade(loaded.world).control }; } });
/** The single fixed motion kernel exposed through public core.motion, also borrowed by
 * the explicit v1 compatibility adapter without changing legacy service identity. */
export const coreMotionService: CoreMotion = Object.freeze({ services: BUILTIN_SERVICES, createContext: createSimulationContext, validateUniverse,
 checkWarpSafety, clampWarpFactor, nextWarpFactor, magnitude, normalizeAngle });
export const coreRotationService: import('../../game-api/src/index').RotationMath = Object.freeze({ spinRate, spinAngle, rotate, groundVelocity, bodyFixed });
/** Concrete host service implementations shared by browser and headless composition. */
export function engineModuleServices(): readonly HostServiceAccess[] {
  const all = ['authoritative', 'presentation', 'platform', 'network'] as const;
  const local = ['platform', 'network'] as const;
  const environments = ['browser', 'offline', 'node'] as const;
  return Object.freeze([
    { key: CORE_WORLD, service: { create: (universe, options) => worldFacade(new World(validateUniverse(universe), options)).control } satisfies import('../../game-api/src/index').WorldFactory, tiers: local, environments },
    { key: CORE_MODULE_DATA, service: {create: (adapters: readonly import('../../game-api/src/index').ModuleDataExtension[]) => new ModuleDataStore(adapters)}, tiers: local, environments },
    { key: CORE_SAVE, service: saveCodec, tiers: local, environments },
    { key: CORE_CLOCK, service: { stepSeconds: STEP, idle: IDLE, model: MODEL, create: () => new Clock() }, tiers: local, environments },
    { key: CORE_MOTION, service: coreMotionService, tiers: all, environments },
    { key: CORE_ROTATION, service: coreRotationService, tiers: all, environments },
    { key: CORE_COMMANDS, service: { resolve: resolveCommand }, tiers: ['authoritative', ...local] as const, environments },
  ].map(entry => Object.freeze({ ...entry, service: Object.freeze(entry.service) })));
}
