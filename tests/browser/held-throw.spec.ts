import { expect, test, type Page } from '@playwright/test';
import { useCanvas } from '../helpers/canvas';
import { closePanel, openPanel } from '../helpers/workspace';
import { project } from '../../packages/game-api/src/render-math';

async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
for (const guest of [false, true]) test(`stationary ${guest ? 'guest touch' : 'primary pointer'} throw endpoints stay on screen while time advances and release agrees`, async ({ page }) => {
  await useCanvas(page); await page.goto('/');
  await openPanel(page, 'settings');
  await page.locator('#throw-cheat-toggle').check();
  if (guest) {
    await page.locator('#players-toggle').click();
    await page.locator('.split-count [data-count="2"]').click();
    await page.locator('#split-screen-mode').selectOption('split');
    await page.locator('#controls-close').click();
  }
  await closePanel(page);
  const canvas = page.locator(guest ? '.split-pane canvas' : '#flight-view');
  await expect(canvas).toBeVisible();
  await canvas.hover();
  const box = (await canvas.boundingBox())!;
  await page.locator('#flight-view').focus(); await page.keyboard.press('KeyT');
  const start = { x: Math.round(box.x + box.width * .55) - box.x, y: Math.round(box.y + box.height * .35) - box.y }, end = { x: start.x + 85, y: start.y + 25 };
  const pointer = { pointerId: 73, pointerType: guest ? 'touch' : 'mouse', button: 0, buttons: 1 };
  await canvas.dispatchEvent('pointerdown', { ...pointer, clientX: box.x + start.x, clientY: box.y + start.y });
  await canvas.dispatchEvent('pointermove', { ...pointer, clientX: box.x + end.x, clientY: box.y + end.y });
  await expect.poll(async () => Math.hypot((await debug(page)).throwPreview?.velocity.x ?? 0, (await debug(page)).throwPreview?.velocity.y ?? 0)).toBeGreaterThan(1);
  const before = await debug(page);
  await expect.poll(async () => (await debug(page)).time, { timeout: 10000 }).toBeGreaterThan(before.time + 2);
  const held = (await debug(page)).throwPreview;
  const origin = project(held.origin, held.camera, held.width, held.height), pointerEnd = project(held.pointer, held.camera, held.width, held.height);
  expect(Math.hypot(origin.x - start.x, origin.y - start.y)).toBeLessThan(.5);
  expect(Math.hypot(pointerEnd.x - end.x, pointerEnd.y - end.y)).toBeLessThan(.5);
  expect(held.velocity.x).toBeCloseTo(before.throwPreview.velocity.x, 5);
  expect(held.velocity.y).toBeCloseTo(before.throwPreview.velocity.y, 5);
  // Freeze the shared world immediately before release to compare the actual placed state.
  await page.locator('#pause').evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await debug(page)).paused ?? (await page.locator('#status').textContent()) === 'PAUSED').toBeTruthy();
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
  const preview = (await debug(page)).throwPreview;
  await canvas.dispatchEvent('pointerup', { ...pointer, buttons: 0, clientX: box.x + end.x, clientY: box.y + end.y });
  await expect.poll(async () => (await debug(page)).throwPreview).toBeNull();
  if (!guest) {
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
    const released = await debug(page);
    expect(released.body).toBe(preview.body);
    expect(released.position.x).toBeCloseTo(preview.position.x, 4);
    expect(released.position.y).toBeCloseTo(preview.position.y, 4);
    expect(released.velocity.x).toBeCloseTo(preview.velocity.x, 4);
    expect(released.velocity.y).toBeCloseTo(preview.velocity.y, 4);
  }
});
