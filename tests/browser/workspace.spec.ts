import { test, expect } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });

for (const size of [{ width: 1350, height: 568 }, { width: 1280, height: 720 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
  test(`flight fits one window at ${size.width} × ${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('LANDED');
    const report = await page.evaluate(() => {
      const scene = document.querySelector('#flight-view')!.getBoundingClientRect().toJSON();
      const telemetry = document.querySelector('.telemetry')!.getBoundingClientRect().toJSON();
      const dock = document.querySelector('.hud-dock')!.getBoundingClientRect().toJSON();
      const nothingOpenInitially = [...document.querySelectorAll<HTMLElement>('.panel-window')].every(window => window.hidden);
      const panels = ['setup', 'ship', 'fleet', 'multiplayer', 'data', 'settings', 'tools', 'manual', 'library'].map(panel => {
        document.querySelector<HTMLButtonElement>(`[data-workspace="${panel}"]`)!.click();
        const window = document.getElementById(`${panel}-window`)!;
        return {
          panel,
          hidden: window.hidden,
          // Unpinned section windows behave like tabs: only the newest stays open.
          open: [...document.querySelectorAll<HTMLElement>('.panel-window')].filter(other => !other.hidden).map(other => other.id),
          expanded: document.querySelector(`[data-workspace="${panel}"]`)!.getAttribute('aria-expanded'),
          scene: document.querySelector('#flight-view')!.getBoundingClientRect().toJSON(),
          bounds: window.getBoundingClientRect().toJSON(),
        };
      });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        scene,
        telemetry,
        dock,
        nothingOpenInitially,
        camera: document.getElementById('camera')?.textContent,
        orientation: document.getElementById('orientation')?.textContent,
        panels,
      };
    });
    expect(report.nothingOpenInitially).toBe(true);
    expect(report.dock.width).toBeGreaterThan(0);
    expect(report.dock.x + report.dock.width).toBeLessThanOrEqual(size.width);
    expect(report.dock.y + report.dock.height).toBeLessThanOrEqual(size.height);
    expect(report.scrollWidth).toBeLessThanOrEqual(size.width);
    expect(report.scrollHeight).toBeLessThanOrEqual(size.height);
    expect(report.scene.width).toBe(size.width);
    expect(report.scene.height).toBe(size.height);
    expect(report.telemetry.bottom).toBeLessThanOrEqual(size.height);
    expect(report.camera).toBe('Follow ship');
    expect(report.orientation).toBe('Horizon up');
    for (const item of report.panels) {
      expect(item.hidden).toBe(false);
      expect(item.open).toEqual([`${item.panel}-window`]);
      expect(item.expanded).toBe('true');
      expect(item.scene).toEqual(report.scene);
      expect(item.bounds.x).toBeGreaterThanOrEqual(0);
      expect(item.bounds.x + item.bounds.width).toBeLessThanOrEqual(size.width);
      expect(item.bounds.y).toBeGreaterThan(0);
      expect(item.bounds.y + item.bounds.height).toBeLessThan(size.height);
    }
    // Pressing Escape closes the open window and returns focus to flight view
    await page.keyboard.press('Escape');
    await expect(page.locator('#library-window')).toBeHidden();
    await page.screenshot({ path: info.outputPath('flight.png') });
    await page.keyboard.down('Space');
    await expect(page.locator('#status')).toHaveText('FLYING');
    await page.keyboard.up('Space');
    await openPanel(page, 'fleet');
    await page.getByRole('button', { name: 'Launch another' }).click();
    await expect(page.locator('#ship-list button')).toHaveCount(2);
    await closePanel(page);
    await expect(page.locator('#flight-view')).toBeFocused();
  });
}

test('fullscreen button and F shortcut toggle fullscreen controls, lock Escape, and toggle the last window with Escape', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  const btn = page.locator('#fullscreen');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveText('Fullscreen');

  // Install fullscreen + keyboard lock spies before clicking Fullscreen
  await page.evaluate(() => {
    const calls: string[] = [];
    let fsEl: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fsEl,
    });
    document.documentElement.requestFullscreen = ((options?: FullscreenOptions & { keyboardLock?: string }) => {
      calls.push(`request:${options?.keyboardLock ?? 'none'}`);
      fsEl = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    }) as typeof document.documentElement.requestFullscreen;
    document.exitFullscreen = (() => {
      calls.push('exit');
      fsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    }) as typeof document.exitFullscreen;
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: {
        lock: (keys?: readonly string[]) => {
          calls.push(`lock:${(keys ?? []).join(',')}`);
          return Promise.resolve();
        },
        unlock: () => {
          calls.push('unlock');
        },
      },
    });
    (window as unknown as { __fsCalls: string[]; __dropFsViaBrowserEscape: () => void }).__fsCalls = calls;
    (window as unknown as { __dropFsViaBrowserEscape: () => void }).__dropFsViaBrowserEscape = () => {
      fsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });

  // Trigger fullscreen via button click
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Exit fullscreen');
  const enterCalls = await page.evaluate(() => (window as unknown as { __fsCalls: string[] }).__fsCalls.splice(0));
  expect(enterCalls).toContain('request:browser');
  expect(enterCalls).toContain('lock:Escape');

  // Pressing Escape while in fullscreen with keyboard lock active toggles the last window closed and open
  const setup = page.locator('#setup-window');
  await page.keyboard.press('Escape');
  await expect(setup).toBeHidden();
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await expect(setup).toBeVisible();
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await expect(setup).toBeHidden();

  // Simulate Firefox default behavior where pressing Escape in fullscreen is intercepted by the browser
  // (exits DOM fullscreen without firing keydown): Spacelab still opens the window and restores
  // fullscreen automatically when closing it.
  await page.waitForTimeout(350);
  await page.evaluate(() => (window as unknown as { __dropFsViaBrowserEscape: () => void }).__dropFsViaBrowserEscape());
  await expect(setup).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Exit fullscreen');

  // Closing the window via × re-requests fullscreen automatically
  await page.locator('#setup-close').click();
  await expect(setup).toBeHidden();
  const restoreCalls = await page.evaluate(() => (window as unknown as { __fsCalls: string[] }).__fsCalls.splice(0));
  expect(restoreCalls).toContain('request:browser');

  // Intentional fullscreen exit via the F shortcut exits cleanly without opening a window
  await page.keyboard.press('KeyF');
  await expect(setup).toBeHidden();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveText('Fullscreen');

  // Switching to a new universe after changing camera/orientation focuses and zooms in on the ship
  await openPanel(page, 'setup');
  await page.locator('#camera').click();
  await page.locator('#orientation').click();
  await expect(page.locator('#camera')).toHaveText('Planet view');
  await expect(page.locator('#orientation')).toHaveText('North up');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await expect(page.locator('#camera')).toHaveText('Follow ship');
  await expect(page.locator('#orientation')).toHaveText('Horizon up');
  await expect.poll(async () => JSON.parse(await page.locator('#debug').textContent() || '{}').camera?.scale ?? 0).toBeGreaterThan(2);
});
