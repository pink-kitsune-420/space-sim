// Compatibility composition for the existing controls dialog.
import { ControllerMenu as PortableControllerMenu } from '../../../modules/controller-menu/src/index';
import { createLocalPlayerPreferences } from '../../../modules/local-pilots/src/preferences';
import { FLIGHT_PROFILE_CODEC } from '../../../modules/input-profiles/src/index';
import { ACTION_DEFINITIONS } from '../../../modules/input-actions/src/bindings';
import type { FlightGamepad, FlightSplitScreen } from '../../../packages/game-api/src/index';
import { formatControllerButton } from './gamepad';
export class ControllerMenu extends PortableControllerMenu {
  constructor(split: FlightSplitScreen, pads: FlightGamepad, pilotName: () => string, isOpen: () => boolean) {
    super({ root: document.getElementById('controls-dialog')!, split, gamepads: pads, pilotName, isOpen }, {
      preferences: createLocalPlayerPreferences(FLIGHT_PROFILE_CODEC), profiles: FLIGHT_PROFILE_CODEC,
      actions: { label: id => ACTION_DEFINITIONS.find(action => action.id === id)?.name ?? id },
      formatButton: formatControllerButton,
    });
  }
}
