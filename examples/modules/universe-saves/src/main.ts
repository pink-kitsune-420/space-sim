import {
  UNIVERSE_SAVES,
  type ModuleInitializationV2,
  type ServiceKey,
  type UniverseSaveCommands,
  type UniverseSaveFactory,
  type UniverseSaveOptions,
} from '@space-sim/game-api';

export interface UniverseSavesHelper {
  createCommands(options: UniverseSaveOptions): UniverseSaveCommands;
}

export const UNIVERSE_SAVES_HELPER: ServiceKey<UniverseSavesHelper> = Object.freeze({
  slot: 'example.universe-saves',
  version: '1.0.0',
});

export function createUniverseSavesHelper(factory: UniverseSaveFactory): UniverseSavesHelper {
  return Object.freeze({
    createCommands(options: UniverseSaveOptions): UniverseSaveCommands {
      return factory.create(options);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(UNIVERSE_SAVES);
  context.provide(UNIVERSE_SAVES_HELPER, createUniverseSavesHelper(factory));
}
