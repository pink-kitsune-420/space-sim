import { LOCAL_PILOTS, type LocalPlayerPreferences, type LocalPlayersConfig,
  type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

/** This menu intentionally uses preferences only: removing the gamepad backend keeps it usable.
 * A full ControllerMenu may borrow FlightGamepad.captureId for same-frame diagnostics;
 * that optional hint does not change device assignment or authoritative player ownership. */
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
