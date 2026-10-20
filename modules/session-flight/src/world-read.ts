import type { WorldControl, WorldRead } from '@space-sim/game-api';
/** A read-only session projection, bound once outside update loops. */
export function readWorld(world: WorldControl): WorldRead {
  const data = Object.freeze({ get schemas() { return world.data.schemas; }, get revision() { return world.data.revision; },
    get: world.data.get.bind(world.data), snapshot: world.data.snapshot.bind(world.data), delta: world.data.delta.bind(world.data) });
  const read: WorldRead = Object.freeze({
    get predictionFeatures() { return world.predictionFeatures; },
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
    avatar: world.avatar.bind(world), avatars: world.avatars.bind(world),
    has: world.has.bind(world), awakeShips: world.awakeShips.bind(world), previous: world.previous.bind(world), ownedBy: world.ownedBy.bind(world),
    isAsleep: world.isAsleep.bind(world), settles: world.settles.bind(world), stateAt: world.stateAt.bind(world), hasBody: world.hasBody.bind(world),
    body: world.body.bind(world), surface: world.surface.bind(world), presetId: world.presetId.bind(world), presetState: world.presetState.bind(world),
    predictShip: world.predictShip.bind(world), cloneForPrediction: () => world.cloneForPrediction(),
  });
  return read;
}
