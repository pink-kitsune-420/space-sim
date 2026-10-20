import {
  SERVER_UNIVERSE_STORAGE,
  type ModuleInitializationV2,
  type ServerUniverseOptions,
  type ServerUniverseStorage,
  type ServerUniverseStore,
  type ServiceKey,
} from '@space-sim/game-api';

export interface UniverseServerStorageHelper {
  createStore<T>(options: ServerUniverseOptions<T>): ServerUniverseStore<T>;
}

export const UNIVERSE_SERVER_STORAGE_HELPER: ServiceKey<UniverseServerStorageHelper> = Object.freeze({
  slot: 'example.universe-server-storage',
  version: '1.0.0',
});

export function createUniverseServerStorageHelper(storage: ServerUniverseStorage): UniverseServerStorageHelper {
  return Object.freeze({
    createStore<T>(options: ServerUniverseOptions<T>): ServerUniverseStore<T> {
      return storage.create(options);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const storage = context.use(SERVER_UNIVERSE_STORAGE);
  context.provide(UNIVERSE_SERVER_STORAGE_HELPER, createUniverseServerStorageHelper(storage));
}
