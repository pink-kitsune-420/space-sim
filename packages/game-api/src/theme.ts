import type { ThemeService } from './platform';
import type { ThemeArtwork } from './rendering';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { RenderThemeOptions, ThemeBackdropStyle, ThemeCounterStyle, ThemeGridStyle, ThemeWindowStyle } from './presentation';
/** Presentation theme settings specifying backdrop, celestial grid, HUD and window styling. */
export interface ThemeSettings extends RenderThemeOptions {
  /** Visual style for the procedural backdrop (e.g. 'spacelab', 'nebula', 'carina', 'void'). */
  backdropStyle: ThemeBackdropStyle;
  /** Whether procedural nebulae are rendered in the background. */
  nebulaVisible: boolean;
  /** Relative brightness and opacity of procedural nebulae (0.0 to 2.0). */
  nebulaIntensity: number;
  /** Whether background star layers are rendered. */
  starsVisible: boolean;
  /** Multiplier for procedural background star count (0.5 to 2.0). */
  starDensity: number;
  /** Whether interstellar dust clouds are visible. */
  dustVisible: boolean;
  /** Whether distant deep-space galaxies are visible. */
  galaxiesVisible: boolean;
  /** Whether procedural nebulae animate slowly over presentation time. */
  animatedNebula: boolean;
  /** Randomization seed for background generation; 0 uses the universe seed. */
  shaderSeed: number;

  /** Whether the coordinate / navigation grid is displayed. */
  gridEnabled: boolean;
  /** Grid projection style ('cartesian', 'polar', 'dots', 'hex', 'off'). */
  gridStyle: ThemeGridStyle;
  /** Grid spacing in CSS pixels (e.g. 80). */
  gridSpacing: number;
  /** Visual opacity of grid lines and markers (0.1 to 1.0). */
  gridOpacity: number;
  /** Whether coordinate values and distance labels are displayed on grid lines. */
  gridLabels: boolean;
  /** Optional custom hex color string for the grid (e.g. '#38bdf8'). */
  gridColor?: string;

  /** Visual style for digital counters and telemetry ('spacelab', 'cyber', 'apollo', etc.). */
  counterTheme: ThemeCounterStyle;
  /** Custom phosphor / telemetry accent color (e.g. '#00f0ff'). */
  hudColor?: string;
  /** Window framing style ('classic', 'cyber', 'apollo', 'tactical', etc.). */
  windowStyle?: ThemeWindowStyle;
  /** Opacity for translucent UI windows and panels (0.4 to 1.0). */
  windowOpacity: number;
  /** Custom window header and border accent color. */
  windowColor?: string;
  /** Whether retro CRT scanlines overlay the flight display. */
  hudScanlines: boolean;
  /** Whether phosphor HUD elements display a diffuse glow. */
  hudGlow: boolean;
  /** Whether HUD instruments and telemetry panels have chamfered corners. */
  hudChamfer: boolean;
  /** Whether HUD widgets collapse into a compact layout for small viewports. */
  compactHud: boolean;
  /** Whether full-resolution procedural textures and anti-aliasing are enabled. */
  highQuality: boolean;
}

/** Predefined curated theme preset bundling backdrop, HUD and window styling. */
export interface ThemePreset {
  /** Unique preset identifier (e.g. 'spacelab', 'cyber', 'apollo'). */
  id: string;
  /** Human-readable display label. */
  name: string;
  /** Short description explaining the preset's aesthetic. */
  description: string;
  /** Representative hex color for preview swatches. */
  previewColor: string;
  /** Partial theme settings applied when this preset is selected. */
  settings: Partial<ThemeSettings>;
}

/** Persistent storage abstraction for theme preferences (e.g. window.localStorage or mock). */
export interface ThemePreferences {
  /** Retrieve a stored JSON preference string by key, or null if unset. */
  getItem(key: string): string | null;
  /** Store a preference string under the specified key. */
  setItem(key: string, value: string): void;
}

/** Options for instantiating an isolated theme controller. */
export interface ThemeOptions {
  /** Optional persistent storage backend; defaults to in-memory preferences when omitted. */
  readonly storage?: ThemePreferences;
  /** Optional DOM element whose CSS custom properties are updated on theme change. */
  readonly root?: HTMLElement;
  /** Initial fallback defaults overriding built-in settings. */
  readonly defaults?: Partial<ThemeSettings>;
}

/** Controller managing active theme settings, CSS variables, procedural backdrop drawing and observer subscriptions. */
export interface ThemeController extends ThemeService, ThemeArtwork, Disposable {
  /** Immutable default settings configured on controller instantiation. */
  readonly defaults: Readonly<ThemeSettings>;
  /** Built-in curated presets available for user selection. */
  readonly presets: readonly ThemePreset[];
  /** Retrieve the currently active theme settings. */
  current(): Readonly<ThemeSettings>;
  /** Reload theme settings from persistent storage and apply styling to the DOM root. */
  load(): Readonly<ThemeSettings>;
  /** Apply current styling to newly mounted children without changing settings. */
  refresh(): void;
}

/** Factory providing isolated ThemeController instances. Disposing cleans up shared stylesheets. */
export interface ThemeFactory extends Disposable {
  /** Create a theme controller configured with optional storage and DOM root. */
  create(options?: ThemeOptions): ThemeController;
}

/** Service key for the presentation theme factory (`presentation.themes@1.0.0`). */
export const THEMES: ServiceKey<ThemeFactory> = Object.freeze({ slot: 'presentation.themes', version: '1.0.0' });
