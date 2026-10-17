import { test, expect } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });

for (const size of [{ width: 1350, height: 568 }, { width: 1280, height: 720 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
  test(`flight fits one window at ${size.width} × ${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#status')).toHaveText('LANDED');
    await expect(page.locator('#menu-toggle')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const layout = () => page.evaluate(() => ({
      width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scene: document.querySelector('#flight-view')!.getBoundingClientRect().toJSON(),
      telemetry: document.querySelector('.telemetry')!.getBoundingClientRect().toJSON(),
    }));
    const before = await layout();
    expect(before.scrollWidth).toBeLessThanOrEqual(size.width);
    expect(before.scrollHeight).toBeLessThanOrEqual(size.height);
    expect(before.scene.width).toBe(size.width);
    expect(before.scene.height).toBe(size.height);
    expect(before.telemetry.bottom).toBeLessThanOrEqual(size.height);
    for (const panel of ['setup', 'data', 'fleet', 'multiplayer', 'library', 'tools'] as const) {
      await openPanel(page, panel);
      await expect(page.locator('#workspace-drawer')).toBeVisible();
      if (panel === 'setup') {
        await expect(page.locator('#camera')).toHaveText('Follow ship');
        await expect(page.locator('#orientation')).toHaveText('Horizon up');
      }
      const current = await page.evaluate(() => ({
        scene: document.querySelector('#flight-view')!.getBoundingClientRect().toJSON(),
        bounds: document.getElementById('workspace-drawer')!.getBoundingClientRect().toJSON(),
      }));
      expect(current.scene).toEqual(before.scene);
      expect(current.bounds.y).toBeGreaterThan(0);
      expect(current.bounds.y + current.bounds.height).toBeLessThan(size.height);
      await page.keyboard.press('Escape');
      await expect(page.locator('#workspace-drawer')).toBeHidden();
    }
    // Pressing Escape while in flight brings up the menu; pressing Escape again closes it
    await page.keyboard.press('Escape');
    await expect(page.locator('#workspace-drawer')).toBeVisible();
    await closePanel(page);
    await expect(page.locator('#workspace-drawer')).toBeHidden();
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

test('fullscreen button and F shortcut toggle fullscreen controls and state', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  const btn = page.locator('#fullscreen');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveText('Fullscreen');

  // Trigger fullscreen via button click
  await btn.click();
  // Trigger fullscreen via F shortcut
  await page.keyboard.press('KeyF');

  // Simulate fullscreen change event to verify UI update
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.documentElement,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveText('Exit fullscreen');

  // Simulate exit fullscreen
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveText('Fullscreen');
});
