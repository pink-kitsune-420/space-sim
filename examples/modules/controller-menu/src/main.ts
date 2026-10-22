import { LOCAL_PILOTS, type LocalPlayerPreferences, type LocalPlayersConfig,
  type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export interface MinimalMenuHelper {
  setPlayerCount(config: LocalPlayersConfig, count: number): LocalPlayersConfig;
  assignDevice(config: LocalPlayersConfig, slot: number, device: 'keyboard' | 'none'): LocalPlayersConfig;
}

export const MINIMAL_MENU: ServiceKey<MinimalMenuHelper> = Object.freeze({
  slot: 'example.minimal-controller-menu',
  version: '1.0.0',
});

export function createMinimalMenuHelper(preferences: LocalPlayerPreferences): MinimalMenuHelper {
  return Object.freeze({
    // A mounted menu should honor split.singleView; keep saved preferences while restricted.
    setPlayerCount(config: LocalPlayersConfig, count: number) {
      return preferences.setPlayerCount(config, count);
    },
    assignDevice(config: LocalPlayersConfig, slot: number, device: 'keyboard' | 'none') {
      return preferences.assignDevice(config, slot, device);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const preferences = context.use(LOCAL_PILOTS).preferences();
  context.provide(MINIMAL_MENU, createMinimalMenuHelper(preferences));
}
