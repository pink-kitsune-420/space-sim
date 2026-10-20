import { TOUCH_INPUT, type ActionDefinitionV2, type InputSource, type ModuleInitializationV2,
  type ServiceKey, type TouchInputFactory } from '@space-sim/game-api';

export const TOUCH_PAD_ACTIONS: readonly ActionDefinitionV2[] = Object.freeze([
  { id: 'example.touch/fire', label: 'Fire', category: 'flight', mode: 'held', defaultKeys: [] },
  { id: 'example.touch/pitch', label: 'Pitch', category: 'flight', mode: 'axis', defaultKeys: [] },
]);

export interface TouchVirtualPadHelper {
  bindControls(pilot: number, buttonElement: HTMLElement, sliderElement: HTMLElement): InputSource;
}

export const TOUCH_VIRTUAL_PAD: ServiceKey<TouchVirtualPadHelper> = Object.freeze({
  slot: 'example.touch-virtual-pad',
  version: '1.0.0',
});

export function createTouchVirtualPadHelper(factory: TouchInputFactory): TouchVirtualPadHelper {
  return Object.freeze({
    bindControls(pilot: number, buttonElement: HTMLElement, sliderElement: HTMLElement) {
      return factory.create({
        actions: TOUCH_PAD_ACTIONS,
        pilot: () => pilot,
        bindings: [
          { action: 'example.touch/fire', element: buttonElement, gesture: 'hold' },
          { action: 'example.touch/pitch', element: sliderElement, gesture: 'axis-y' },
        ],
      });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(TOUCH_INPUT);
  context.provide(TOUCH_VIRTUAL_PAD, createTouchVirtualPadHelper(factory));
}
