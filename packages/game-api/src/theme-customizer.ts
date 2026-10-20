import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { ThemeController, ThemePreferences, ThemeSettings } from './theme';
/** UI controller for the theme customizer dialog, managing modal state, presets and export controls. */
export interface ThemeCustomizer extends Disposable {
  /** Open the theme customization dialog. */
  open(): void;
  /** Close the theme customization dialog. */
  close(): void;
  /** Toggle the theme customization dialog open or closed. */
  toggle(): void;
  /** Toggle celestial grid visibility, returning the new grid enabled state. */
  toggleGrid(): boolean;
  /** Retrieve a snapshot of the current theme settings. */
  getSettings(): ThemeSettings;
}

/** Options for instantiating a ThemeCustomizer dialog attached to a DOM root and theme controller. */
export interface ThemeCustomizerOptions {
  /** Host DOM element into which the customizer dialog and controls are mounted. */
  readonly root: HTMLElement;
  /** Bound theme controller providing settings mutation and presets. */
  readonly theme: ThemeController;
  /** Optional storage backend for saving exported custom presets or choices. */
  readonly storage?: ThemePreferences;
  /** Optional predicate indicating whether the customizer's view is currently focused. */
  readonly active?: () => boolean;
}

/** Factory providing ThemeCustomizer dialog instances. Disposing cleans up all open dialogs. */
export interface ThemeCustomizerFactory extends Disposable {
  /** Create a theme customizer instance attached to the specified DOM root and theme controller. */
  create(options: ThemeCustomizerOptions): ThemeCustomizer;
}

/** Service key for the public theme customizer factory (`ui.theme-customizer@1.0.0`). */
export const THEME_CUSTOMIZERS: ServiceKey<ThemeCustomizerFactory> = Object.freeze({slot: 'ui.theme-customizer', version: '1.0.0'});
