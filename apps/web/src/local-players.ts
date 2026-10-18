import type { LocalPlayersConfig, InputDevice } from '../../../packages/game-api/src/index';
export type { LocalPlayersConfig, InputDevice, NavballAnchor, NavballPlacement, PlayerCount, PlayerSlot, ScreenMode, TwoPlayerLayout, PaneRect } from '../../../packages/game-api/src/index';
import { LocalPilotRegistry as PortableLocalPilotRegistry } from '../../../modules/local-pilots/src/index';
import { createLocalPlayerPreferences } from '../../../modules/local-pilots/src/preferences';
import { FLIGHT_PROFILE_CODEC } from '../../../modules/input-profiles/src/index';
export { MAX_LOCAL_PLAYERS, PLAYER_COLORS } from '../../../modules/local-pilots/src/preferences';
export { paneRects, dynamicPaneRects } from '../../../modules/local-views/src/layout';
export const { defaultNavballPlacement, normalizeNavballPlacement, padDevice, deviceIndex, defaultLocalPlayers, normalizeLocalPlayers, loadLocalPlayers, saveLocalPlayers, assignDevice, updateSlot, setPlayerCount, padOwner, keyboardOwner, computeNavballCenter, setSlotNavball, setAllNavballsPinned } = createLocalPlayerPreferences(FLIGHT_PROFILE_CODEC);

/** Compatibility adapter between persisted flight device preferences and portable seats. */
export class LocalPilotRegistry extends PortableLocalPilotRegistry {
  constructor(host: {
    config(): LocalPlayersConfig; count(): number; playerId(pilot: number): string | undefined;
    change(config: LocalPlayersConfig): void; release(pilot?: number): void;
  }) {
    super({ count: () => host.count(), playerId: pilot => host.playerId(pilot),
      assign: (pilot, device) => host.change(assignDevice(host.config(), pilot, device as InputDevice)),
      release: pilot => host.release(pilot) });
  }
}
