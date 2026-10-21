import { GAMEPAD_INPUT, type ActionDefinitionV2, type ControllerFamily, type GamepadInputFactory,
  type InputSource, type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export const CUSTOM_ACTIONS: readonly ActionDefinitionV2[] = Object.freeze([
  { id: 'example.vehicle/steer', label: 'Steer', category: 'flight', mode: 'axis', defaultKeys: [] },
  { id: 'example.vehicle/boost', label: 'Boost', category: 'flight', mode: 'held', defaultKeys: [] },
  { id: 'example.vehicle/horn', label: 'Horn', category: 'system', mode: 'press', defaultKeys: [] },
]);

export interface CustomGamepadHelper {
  /** Sample returned sources with the same InputFrame.captureId across one host input frame.
   * Change that non-negative safe integer next frame; omit it for fresh sampling.
   * Flight cursor hosts can borrow manager.readDevices?.(captureId) during this frame,
   * falling back to manager.getDiagnostics(captureId) for an older provider. */
  createSource(pilot: number, axisIndex?: number, buttonIndex?: number): InputSource;
  format(button: number, family: ControllerFamily): string;
}

export const CUSTOM_GAMEPAD: ServiceKey<CustomGamepadHelper> = Object.freeze({
  slot: 'example.gamepad-custom-source',
  version: '1.0.0',
});

export function createCustomGamepadHelper(factory: GamepadInputFactory): CustomGamepadHelper {
  return Object.freeze({
    createSource(pilot: number, axisIndex = 0, buttonIndex = 0) {
      return factory.create({
        actions: CUSTOM_ACTIONS,
        deadzone: 0.15,
        pad: seat => (seat === pilot ? 0 : undefined),
        bindings: [
          { action: 'example.vehicle/steer', axis: axisIndex },
          { action: 'example.vehicle/boost', button: buttonIndex },
          { action: 'example.vehicle/horn', button: buttonIndex + 1 },
        ],
      });
    },
    format(button: number, family: ControllerFamily) {
      return factory.formatButton(button, family);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(GAMEPAD_INPUT);
  context.provide(CUSTOM_GAMEPAD, createCustomGamepadHelper(factory));
}
