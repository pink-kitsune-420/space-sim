import {
  UNIVERSE_SAVE_CONTROLS,
  type ModuleInitializationV2,
  type ServiceKey,
  type UniverseSaveControlFactory,
  type UniverseSaveControlOptions,
  type UniverseSaveControls,
} from '@space-sim/game-api';

export interface UniverseSaveControlsHelper {
  mountControls(options: UniverseSaveControlOptions): UniverseSaveControls;
}

export const UNIVERSE_SAVE_CONTROLS_HELPER: ServiceKey<UniverseSaveControlsHelper> = Object.freeze({
  slot: 'example.universe-save-controls',
  version: '1.0.0',
});

export function createUniverseSaveControlsHelper(factory: UniverseSaveControlFactory): UniverseSaveControlsHelper {
  return Object.freeze({
    mountControls(options: UniverseSaveControlOptions): UniverseSaveControls {
      return factory.mount(options);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(UNIVERSE_SAVE_CONTROLS);
  context.provide(UNIVERSE_SAVE_CONTROLS_HELPER, createUniverseSaveControlsHelper(factory));
}
