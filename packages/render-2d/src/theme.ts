/** Host-only legacy singleton theme adapter (`packages/render-2d`); portable themes are isolated controllers. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `THEMES` (`presentation.themes@1.0.0`) or `CORE_THEME`. */
import type { ThemeSettings } from '../../game-api/src/index';
import { createTheme } from '../../../modules/theme/src/index';
export * from '../../../modules/theme/src/appearance';
/** Shared host singleton `ThemeController` backed by `localStorage` and `document.documentElement`. Modules use `THEMES` (`presentation.themes@1.0.0`) or `CORE_THEME`. Host-only (`packages/render-2d`). */
export const legacyTheme = createTheme({ storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  root: typeof document === 'undefined' ? undefined : document.documentElement });
/** Returns a copy of the active theme settings from the host singleton controller. Modules access themes via `THEMES` (`presentation.themes@1.0.0`) or `CORE_THEME`. Host-only (`packages/render-2d`). */
export const getActiveTheme = (): ThemeSettings => ({ ...legacyTheme.current() });
/** Loads theme settings from persistence for the host singleton controller. Modules use `THEMES` (`presentation.themes@1.0.0`) or `CORE_THEME`. Host-only (`packages/render-2d`). */
export const loadThemeSettings = (): ThemeSettings => ({ ...legacyTheme.load() });
/** Saves partial theme settings to the host singleton controller. Modules use `THEMES` (`presentation.themes@1.0.0`) or `CORE_THEME`. Host-only (`packages/render-2d`). */
export function saveThemeSettings(value: Partial<ThemeSettings>): ThemeSettings { legacyTheme.set(value); return getActiveTheme(); }
/** Subscribes to host singleton theme changes. Modules observe theme changes through `CORE_THEME` or `THEMES`. Host-only (`packages/render-2d`). */
export function onThemeChange(listener: (settings: ThemeSettings) => void): () => void { const lease = legacyTheme.subscribe(value => listener({ ...legacyTheme.defaults, ...value })); return () => lease.dispose(); }
