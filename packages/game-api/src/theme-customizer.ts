import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { ThemeController, ThemePreferences, ThemeSettings } from './theme';
export interface ThemeCustomizer extends Disposable {
  open(): void; close(): void; toggle(): void; toggleGrid(): boolean; getSettings(): ThemeSettings;
}
export interface ThemeCustomizerOptions {
  readonly root: HTMLElement; readonly theme: ThemeController; readonly storage?: ThemePreferences;
  readonly active?: () => boolean;
}
export interface ThemeCustomizerFactory extends Disposable { create(options: ThemeCustomizerOptions): ThemeCustomizer }
export const THEME_CUSTOMIZERS: ServiceKey<ThemeCustomizerFactory> = Object.freeze({slot: 'ui.theme-customizer', version: '1.0.0'});
