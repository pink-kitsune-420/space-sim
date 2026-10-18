import type { Page } from '@playwright/test';

/** Package/UI checks use a consistent renderer; shader quality has its own browser suite. */
export async function useCanvas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(original, { apply(target, receiver, args) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(target, receiver, args);
    } });
  });
}

/** Exercise WebGL geometry and lifecycle without unused procedural effects on software GPUs. */
export async function useLowGraphics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('space-sim.graphics/1', 'low');
      localStorage.setItem('space-sim:theme:v5', JSON.stringify({
        backdropStyle: 'void', starsVisible: false, nebulaVisible: false, galaxiesVisible: false, gridEnabled: false,
      }));
    } catch { /* Pixel harnesses also navigate to opaque about:blank documents. */ }
  });
}
