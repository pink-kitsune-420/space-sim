import { test, expect, type Page } from '@playwright/test';
import { closePanel, openPanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function setup(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#preset').evaluate(el => {
    (el as HTMLSelectElement).value = 'planet-orbit'; el.dispatchEvent(new Event('change'));
    document.getElementById('pause')!.click(); document.getElementById('camera')!.click();
    document.getElementById('graphics-toggle')!.click();
    // Run interactions in Canvas; switching to WebGL below verifies the same layer there.
    document.getElementById('renderer-toggle')!.click();
  });
  await expect.poll(async () => (await debug(page)).predictionEnd, { timeout: 15000 }).toBe('closed');
  await closePanel(page);
  await expect.poll(async () => (await debug(page)).camera.mode).toBe('free');
}
async function coastPoint(page: Page) {
  const d = await debug(page), box = (await page.locator('#flight-view').boundingBox())!;
  const r = Math.hypot(d.position.x, d.position.y) * d.camera.scale;
  return { x: box.x + box.width/2 + r*Math.cos(2.5), y: box.y + box.height/2 - r*Math.sin(2.5) };
}
async function place(page: Page) {
  const point = await coastPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#maneuver-window')).toBeVisible();
  await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(true);
}

test('clicking, editing, moving and removing a node previews a burn without changing live physics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const before = await debug(page);
  await place(page);
  await page.locator('#maneuver-prograde').fill('10');
  await page.locator('#maneuver-radial').fill('5');
  await expect.poll(async () => (await debug(page)).maneuver?.samples).toBeGreaterThan(20);
  await expect(page.locator('#maneuver-summary')).toContainText('Δv 11.2 m/s');
  await page.screenshot({ path: 'test-results/maneuver-planner.png' });
  const planned = await debug(page);
  await test.info().attach('planner-profile', { contentType: 'application/json', body: JSON.stringify({
    renderer: planned.renderer, samples: planned.maneuver.samples,
    workP95Ms: planned.workP95Ms, predictionP95Ms: planned.predictionP95Ms, renderP95Ms: planned.renderP95Ms,
  }) });
  expect(planned.tick).toBe(before.tick);
  expect(planned.position).toEqual(before.position);
  expect(planned.velocity).toEqual(before.velocity);
  expect(planned.maneuver.time).toBeGreaterThan(planned.time);
  expect(planned.presentation.faults).toEqual([]);
  await page.locator('#maneuver-prograde').fill('10.25');
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBe(10.25);
  await page.locator('#maneuver-time').fill('20');
  await page.locator('#maneuver-time').press('Tab');
  await expect.poll(async () => (await debug(page)).maneuver?.time).toBeCloseTo(before.time + 20, 1);
  // A camera drag on the line must retain the existing plan.
  const point = await coastPoint(page), time = (await debug(page)).maneuver.time;
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 20, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await debug(page)).camera.mode).toBe('free');
  expect((await debug(page)).maneuver.time).toBe(time);
  // The same plan survives replacing the renderer's canvas.
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: WebGL');
  await expect.poll(async () => (await debug(page)).renderer, { timeout: 30000 }).toBe('builtin.webgl');
  expect((await debug(page)).maneuver.valid).toBe(true);
  await page.locator('#renderer-toggle').click();
  await closePanel(page);
  await page.locator('#maneuver-delete').click();
  await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
  expect(errors).toEqual([]);
});

test('warp stops before the burn and a reset marks the old plan stale', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('10');
  await page.locator('#maneuver-time').fill('25'); await page.locator('#maneuver-time').press('Tab');
  await expect.poll(async () => (await debug(page)).maneuver?.samples).toBeGreaterThan(10);
  await page.locator('#pause').click();
  await expect(page.locator('#maneuver-warp')).toBeEnabled();
  await page.locator('#maneuver-warp').click();
  await expect.poll(async () => (await debug(page)).maneuver?.warping).toBe(true);
  await expect.poll(async () => (await debug(page)).maneuver?.warping, { timeout: 15000 }).toBe(false);
  const arrived = await debug(page);
  expect(arrived.maneuver.valid).toBe(true);
  expect(arrived.maneuver.time - arrived.time).toBeGreaterThan(5);
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await page.locator('#pause').click();
  await openPanel(page, 'setup');
  await page.locator('#reset').click();
  await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(false);
  await expect(page.locator('#maneuver-status')).toContainText('replan');
});

test.describe('touch planning', () => {
  test.use({ hasTouch: true });
  test('a tap places a node; a pinch or cancelled gesture does not', async ({ page }) => {
    await setup(page);
    const point = await coastPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(true);
    await page.locator('#maneuver-delete').click();
    await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
    const canvas = page.locator('#flight-view');
    await canvas.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    await canvas.dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: false, button: 0, clientX: point.x+20, clientY: point.y });
    await canvas.dispatchEvent('pointerup', { pointerId: 42, pointerType: 'touch', isPrimary: false, button: 0, clientX: point.x+20, clientY: point.y });
    await canvas.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    expect((await debug(page)).maneuver).toBeNull();
    await canvas.dispatchEvent('pointerdown', { pointerId: 43, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    await canvas.dispatchEvent('pointercancel', { pointerId: 43, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    expect((await debug(page)).maneuver).toBeNull();
  });
});
