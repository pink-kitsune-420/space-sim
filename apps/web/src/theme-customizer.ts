import { createThemeCustomizer } from '../../../modules/theme-customizer/src/customizer';
import { legacyTheme } from '../../../packages/render-2d/src/theme';
export type { ThemeCustomizer as ThemeCustomizerInstance } from '../../../packages/game-api/src/index';
export function initThemeCustomizer() { return createThemeCustomizer({ root: document.body, theme: legacyTheme,
  storage: {getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value)} }); }
