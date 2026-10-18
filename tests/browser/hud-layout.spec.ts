import { test, expect } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(original, { apply(target, receiver, args) {
      return String(args[0]).startsWith('webgl') ? null : Reflect.apply(target, receiver, args);
    } });
  });
});

test('default HUD and rendered navball fit the dock, chat and telemetry at desktop and phone sizes', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await closePanel(page);
  for (const size of [{ width: 1366, height: 622 }, { width: 800, height: 600 }, { width: 375, height: 812 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => page.evaluate(() => {
      const d = JSON.parse(document.getElementById('debug')!.textContent || '{}').hud?.navballs[0];
      if (!d || d.width !== innerWidth || d.height !== innerHeight) return false;
      const dial = { left: d.x - 79 * d.scale, right: d.x + 79 * d.scale, top: d.y - 79 * d.scale, bottom: d.y + 70.5 * d.scale + 52 };
      const elements = [...document.querySelectorAll<HTMLElement>('.hud-dock,.hud-top-left,.hud-quickbar,.view-time,.telemetry,#chat-overlay,#flight-message')];
      return elements.every(el => {
        const r = el.getBoundingClientRect();
        return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
          && (dial.right <= r.left || dial.left >= r.right || dial.bottom <= r.top || dial.top >= r.bottom);
      });
    })).toBe(true);
    // The stored geometry is the visible, interactive dial: click its vector pin.
    const d = await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0]);
    const pin = { x: d.x + 67 * d.scale * .72, y: d.y - 67 * d.scale * .72 };
    await expect.poll(() => page.locator('#flight-view').evaluate((el, at) => {
      const canvas = el as HTMLCanvasElement;
      const rgb = canvas.getContext('2d')!.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data;
      return Math.max(...[56, 239, 125].map((value, i) => Math.abs(value - rgb[i]!)));
    }, pin)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: info.outputPath(`hud-${size.width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('HUD move handles save independent positions, survive resize/reload, and reset', async ({ page }, info) => {
  await page.goto('/'); await openPanel(page, 'settings');
  await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
  await expect(page.locator('.hud-layout-toolbar')).toBeVisible();
  const fingerprint = await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).fingerprint);
  const status = page.locator('.hud-top-left'), before = (await status.boundingBox())!;
  const handle = page.getByRole('button', { name: 'Move status', exact: true });
  const at = (await handle.boundingBox())!;
  await page.mouse.move(at.x + 15, at.y + 8); await page.mouse.down();
  await page.mouse.move(at.x + 95, at.y + 88, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await status.boundingBox())!.x).toBeCloseTo(before.x + 80, 0);
  for (const label of ['flight controls', 'clock', 'dock', 'flight readings', 'flight hint']) {
    const move = page.getByRole('button', { name: `Move ${label}`, exact: true });
    await move.focus(); await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('ArrowDown');
  }
  await page.screenshot({ path: info.outputPath('hud-editing.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const moved = (await status.boundingBox())!;
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('space-sim:hud-layout:1')!));
  expect(Object.keys(saved).sort()).toEqual(['clock', 'controls', 'dock', 'message', 'status', 'telemetry']);
  await page.reload();
  await expect.poll(async () => (await status.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  expect((await status.boundingBox())!.y).toBeCloseTo(moved.y, 0);
  await expect(page.locator('.hud-layout-toolbar')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hud-movable')]
    .filter(e => e.getClientRects().length > 0).every(e => {
      const r = e.getBoundingClientRect();
      return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
  const bottomHandle = (await handle.boundingBox())!;
  await page.mouse.move(bottomHandle.x + 10, bottomHandle.y + 5); await page.mouse.down();
  await page.mouse.move(bottomHandle.x + 10, 715, { steps: 5 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hud-movable')]
    .filter(e => e.getClientRects().length > 0).every(e => {
      const r = e.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= innerHeight + 1;
    }))).toBe(true);
  await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Reset HUD layout', exact: true }).click();
  await closePanel(page);
  await expect.poll(async () => (await status.boundingBox())!.x).toBeCloseTo(12, 0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('space-sim:hud-layout:1')!))).toEqual({});
  expect(await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).fingerprint)).toBe(fingerprint);
  await page.screenshot({ path: info.outputPath('hud-reset.png') });
});

test('touch controls leave room for chat, telemetry and a movable navball', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('space-sim:touch-controls:v1', 'always'));
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/'); await closePanel(page);
  await expect(page.locator('#touch-overlay')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const controls = [...document.querySelectorAll('.touch-stick-zone,.touch-actions-zone')].map(el => el.getBoundingClientRect());
    const readouts = [...document.querySelectorAll('#chat-overlay,.telemetry')].map(el => el.getBoundingClientRect());
    return readouts.every(r => controls.every(c => r.bottom + 4 <= c.top || r.right <= c.left || r.left >= c.right));
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('hud-touch.png') });
});
