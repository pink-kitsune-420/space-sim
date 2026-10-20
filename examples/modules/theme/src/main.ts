import { THEMES, type ModuleInitializationV2, type ServiceKey, type ThemeController, type ThemeFactory, type ThemePreferences, type ThemeSettings } from '@space-sim/game-api';

export interface ThemeSummary {
  readonly backdropStyle: string;
  readonly gridEnabled: boolean;
  readonly windowOpacity: number;
}

export interface ThemeManagerHelper {
  createController(storage?: ThemePreferences, defaults?: Partial<ThemeSettings>): ThemeController;
  applyPreset(controller: ThemeController, presetId: string): boolean;
  summarize(controller: ThemeController): ThemeSummary;
}

export const THEME_MANAGER_HELPER: ServiceKey<ThemeManagerHelper> = Object.freeze({
  slot: 'example.theme-provider',
  version: '1.0.0',
});

export function createThemeManagerHelper(factory: ThemeFactory): ThemeManagerHelper {
  return Object.freeze({
    createController(storage?: ThemePreferences, defaults?: Partial<ThemeSettings>): ThemeController {
      return factory.create({ storage, defaults });
    },
    applyPreset(controller: ThemeController, presetId: string): boolean {
      const preset = controller.presets.find(p => p.id === presetId);
      if (!preset) return false;
      controller.set(preset.settings);
      return true;
    },
    summarize(controller: ThemeController): ThemeSummary {
      const current = controller.current();
      return {
        backdropStyle: current.backdropStyle,
        gridEnabled: current.gridEnabled,
        windowOpacity: current.windowOpacity,
      };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(THEMES);
  context.provide(THEME_MANAGER_HELPER, createThemeManagerHelper(factory));
}
