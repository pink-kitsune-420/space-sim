/** Legacy singleton adapter; portable themes are isolated controllers. */
import type { ThemeSettings } from '../../game-api/src/index';
import { createTheme } from '../../../modules/theme/src/index';
export * from '../../../modules/theme/src/appearance';
export const legacyTheme = createTheme({ storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  root: typeof document === 'undefined' ? undefined : document.documentElement });
export const getActiveTheme = (): ThemeSettings => ({ ...legacyTheme.current() });
export const loadThemeSettings = (): ThemeSettings => ({ ...legacyTheme.load() });
export function saveThemeSettings(value: Partial<ThemeSettings>): ThemeSettings { legacyTheme.set(value); return getActiveTheme(); }
export function onThemeChange(listener: (settings: ThemeSettings) => void): () => void { const lease = legacyTheme.subscribe(value => listener({ ...legacyTheme.defaults, ...value })); return () => lease.dispose(); }
