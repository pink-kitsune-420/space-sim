// Compatibility composition for the original flight console.
export * from '../../../modules/input-gamepad/src/flight';
export { DEFAULT_CONTROLLER_PROFILE, DEFAULT_PAD_BUTTONS, DEFAULT_GAMEPAD_SETTINGS, normalizeProfile } from '../../../modules/input-profiles/src/index';
import { GamepadManager as PortableGamepadManager } from '../../../modules/input-gamepad/src/flight';
import { FLIGHT_PROFILE_CODEC } from '../../../modules/input-profiles/src/index';
export class GamepadManager extends PortableGamepadManager {
  constructor() { super(FLIGHT_PROFILE_CODEC); }
  static legacyProfile() { return FLIGHT_PROFILE_CODEC.legacy(); }
}

/** Use the selected provider capture for host cursors. Older providers keep their detached
 * diagnostic fallback; callers use either result synchronously and never mutate/retain it. */
export function readFlightDevices(provider: Pick<import('../../../packages/game-api/src/index').FlightGamepad, 'readDevices' | 'getDiagnostics'>,
  captureId?: number): readonly import('../../../packages/game-api/src/index').GamepadDeviceState[] {
  return provider.readDevices?.(captureId) ?? provider.getDiagnostics(captureId);
}
