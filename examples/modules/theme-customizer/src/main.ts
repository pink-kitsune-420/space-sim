import { THEMES, THEME_CUSTOMIZERS, type ModuleInitializationV2, type ServiceKey, type ThemeController, type ThemeCustomizer, type ThemeCustomizerFactory, type ThemeFactory, type ThemePreferences } from '@space-sim/game-api';

export interface MountedCustomizer {
  readonly customizer: ThemeCustomizer;
  readonly theme: ThemeController;
}

export interface CustomizerDialogHelper {
  mount(root: HTMLElement, storage?: ThemePreferences): MountedCustomizer;
}

export const CUSTOMIZER_DIALOG_HELPER: ServiceKey<CustomizerDialogHelper> = Object.freeze({
  slot: 'example.customizer-dialog',
  version: '1.0.0',
});

export function createCustomizerDialogHelper(
  customizerFactory: ThemeCustomizerFactory,
  themeFactory: ThemeFactory
): CustomizerDialogHelper {
  return Object.freeze({
    mount(root: HTMLElement, storage?: ThemePreferences): MountedCustomizer {
      const theme = themeFactory.create({ root, storage });
      const customizer = customizerFactory.create({ root, theme, storage });
      return { customizer, theme };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const customizerFactory = context.use(THEME_CUSTOMIZERS);
  const themeFactory = context.use(THEMES);
  context.provide(CUSTOMIZER_DIALOG_HELPER, createCustomizerDialogHelper(customizerFactory, themeFactory));
}
