import { KEYBOARD_INPUT, type ActionDefinitionV2, type InputSource, type KeyboardInputFactory,
  type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export const SHORTCUT_ACTIONS: readonly ActionDefinitionV2[] = Object.freeze([
  { id: 'example.menu/select', label: 'Select Item', category: 'system', mode: 'press', defaultKeys: ['Enter', 'Space'] },
  { id: 'example.menu/back', label: 'Go Back', category: 'system', mode: 'press', defaultKeys: ['Escape', 'Backspace'] },
]);

export interface CustomKeyboardHelper {
  createSource(pilot: number, bindings?: Readonly<Record<string, readonly string[]>>): InputSource;
  readonly reserved: ReadonlySet<string>;
}

export const CUSTOM_KEYBOARD: ServiceKey<CustomKeyboardHelper> = Object.freeze({
  slot: 'example.keyboard-custom-source',
  version: '1.0.0',
});

export function createCustomKeyboardHelper(factory: KeyboardInputFactory): CustomKeyboardHelper {
  return Object.freeze({
    createSource(pilot: number, bindings?: Readonly<Record<string, readonly string[]>>) {
      return factory.create({
        actions: SHORTCUT_ACTIONS,
        bindings,
        pilot: () => pilot,
      });
    },
    get reserved() {
      return factory.reservedKeys;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(KEYBOARD_INPUT);
  context.provide(CUSTOM_KEYBOARD, createCustomKeyboardHelper(factory));
}
