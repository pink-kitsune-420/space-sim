/** Graphics quality: a per-browser convenience, never shared or saved with worlds.
 * High draws day and night from the system's star; Low skips lighting for slower devices. */
export type GraphicsQuality = 'high' | 'low';

const STORAGE_KEY = 'space-sim.graphics/1';

export function loadGraphicsQuality(): GraphicsQuality {
  try { return localStorage.getItem(STORAGE_KEY) === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}

export function saveGraphicsQuality(quality: GraphicsQuality): void {
  try { localStorage.setItem(STORAGE_KEY, quality); } catch { /* storage unavailable: the choice lasts for this page */ }
}
