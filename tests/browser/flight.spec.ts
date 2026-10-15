import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function diagnostics(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(await page.locator('#debug').textContent() || '{}') as Record<string, unknown>;
}
async function flightFocus(page: Page): Promise<void> {
  await page.locator('canvas').click({ position: { x: 20, y: 120 } });
}

test('standalone download plays directly from disk with networking disabled', async ({ page, context }) => {
  const network: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/space-sim-offline.html')).href);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect(page.locator('.connection')).toContainText('OFFLINE FLIGHT');
  await flightFocus(page);
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await diagnostics(page)).samples as number).toBeGreaterThan(5000);
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});

test('launch, input release, pause and reset work in the production build', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await flightFocus(page);
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect.poll(async () => Number(await page.locator('#altitude').textContent())).toBeGreaterThan(1);
  await page.keyboard.up('Space');
  await expect(page.locator('#flight-message')).toContainText('COASTING');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const time = await page.locator('#time').textContent();
  await page.waitForTimeout(250);
  expect(await page.locator('#time').textContent()).toBe(time);
  await page.getByRole('button', { name: 'Reset flight' }).click();
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect(page.locator('#altitude')).toHaveText('0.0');
  expect(errors).toEqual([]);
});

test('orbit, camera, zoom, heading and sampled prediction stay coherent', async ({ page }) => {
  await page.goto('/');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect.poll(async () => (await diagnostics(page)).samples as number).toBeGreaterThan(5000);
  await expect(page.locator('#altitude')).toHaveText('128.0');
  await flightFocus(page);
  await page.keyboard.down('ArrowLeft');
  await expect.poll(async () => Number(await page.locator('#heading').textContent())).toBeGreaterThan(10);
  await page.keyboard.up('ArrowLeft');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const before = await diagnostics(page);
  await page.getByRole('button', { name: 'Follow ship' }).click();
  await page.getByRole('button', { name: 'North up' }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Planet view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Horizon up' })).toBeVisible();
  const after = await diagnostics(page);
  expect(after.position).toEqual(before.position);
  expect(after.velocity).toEqual(before.velocity);
  await page.screenshot({ path: `test-results/orbit-${test.info().project.name}.png`, fullPage: true });
});

test('pointer cancellation and focus loss release the engine and pause without catch-up', async ({ page }) => {
  await page.goto('/');
  await page.locator('#preset').selectOption('planet-orbit');
  const burn = page.locator('#burn');
  await burn.scrollIntoViewIfNeeded();
  await burn.evaluate(el => el.addEventListener('pointerdown', event => {
    (el as HTMLElement).dataset.testPointer = String((event as PointerEvent).pointerId);
  }, { once: true }));
  const box = await burn.boundingBox();
  if (!box) throw new Error('Burn button has no bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('#flight-message')).toContainText('ENGINE ACTIVE');
  const pointerId = Number(await burn.getAttribute('data-test-pointer'));
  await burn.dispatchEvent('pointercancel', { pointerId });
  await page.mouse.up();
  await expect(page.locator('#flight-message')).toContainText('COASTING');
  await flightFocus(page);
  await page.keyboard.down('Space');
  await expect(page.locator('#flight-message')).toContainText('ENGINE ACTIVE');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect.poll(async () => (await diagnostics(page)).engine).toBe(false);
  const time = await page.locator('#time').textContent();
  await page.waitForTimeout(300);
  expect(await page.locator('#time').textContent()).toBe(time);
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#flight-message')).not.toContainText('ENGINE ACTIVE');
});

test('mobile viewport fits and pointer controls can launch', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('slider', { name: 'Throttle' }).fill('100');
  await expect(page.locator('#throttle-value')).toHaveText('100%');
  const burn = page.locator('#burn');
  await burn.scrollIntoViewIfNeeded();
  const box = await burn.boundingBox();
  if (!box) throw new Error('Burn button has no bounds');
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    await expect(page.locator('#status')).toHaveText('FLYING');
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('#status')).toHaveText('FLYING');
    await page.mouse.up();
  }
  await expect.poll(async () => (await diagnostics(page)).engine).toBe(false);
  await page.screenshot({ path: `test-results/mobile-${test.info().project.name}.png`, fullPage: true });
});
