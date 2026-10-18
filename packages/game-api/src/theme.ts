import type { ThemeService } from './platform';
import type { ThemeArtwork } from './rendering';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { RenderThemeOptions, ThemeBackdropStyle, ThemeCounterStyle, ThemeGridStyle, ThemeWindowStyle } from './presentation';
export interface ThemeSettings extends RenderThemeOptions {
  backdropStyle: ThemeBackdropStyle;
  nebulaVisible: boolean;
  nebulaIntensity: number; // 0.0 to 2.0
  starsVisible: boolean;
  starDensity: number; // 0.5 to 2.0
  dustVisible: boolean;
  galaxiesVisible: boolean;
  animatedNebula: boolean;
  shaderSeed: number; // 0 = default universe seed, > 0 = custom seed

  gridEnabled: boolean;
  gridStyle: ThemeGridStyle;
  gridSpacing: number; // in pixels, e.g. 80
  gridOpacity: number; // 0.1 to 1.0
  gridLabels: boolean;
  gridColor?: string; // Hex color string, e.g. '#38bdf8'

  counterTheme: ThemeCounterStyle;
  hudColor?: string; // Optional custom HUD phosphor/telemetry color, e.g. '#00f0ff'
  windowStyle?: ThemeWindowStyle;
  windowOpacity: number;
  windowColor?: string; // Optional custom window accent hex color, e.g. '#00f0ff'
  hudScanlines: boolean;
  hudGlow: boolean;
  hudChamfer: boolean;
  compactHud: boolean;
  highQuality: boolean;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  previewColor: string;
  settings: Partial<ThemeSettings>;
}

export interface ThemePreferences { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ThemeOptions { readonly storage?: ThemePreferences; readonly root?: HTMLElement; readonly defaults?: Partial<ThemeSettings> }
export interface ThemeController extends ThemeService, ThemeArtwork, Disposable {
  readonly defaults: Readonly<ThemeSettings>; readonly presets: readonly ThemePreset[];
  current(): Readonly<ThemeSettings>;
  load(): Readonly<ThemeSettings>;
  /** Apply current styling to newly mounted children without changing settings. */
  refresh(): void;
}
export interface ThemeFactory extends Disposable { create(options?: ThemeOptions): ThemeController }
export const THEMES: ServiceKey<ThemeFactory> = Object.freeze({ slot: 'presentation.themes', version: '1.0.0' });
