import { useLowGraphics } from '../helpers/canvas';
import { test, expect, type Page } from '@playwright/test';
import { closePanel, openPanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
test.beforeEach(async ({ page }) => useLowGraphics(page));

async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function setup(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#preset').evaluate(el => {
    (el as HTMLSelectElement).value = 'planet-orbit'; el.dispatchEvent(new Event('change'));
    document.getElementById('pause')!.click(); document.getElementById('camera')!.click();
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

test('an empty node can warp without arming a burn or changing throttle', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-time').fill('25'); await page.locator('#maneuver-time').press('Tab');
  const before = await debug(page);
  await expect(page.locator('#maneuver-execute')).toBeDisabled();
  await page.locator('#pause').click();
  await expect(page.locator('#maneuver-warp')).toBeEnabled();
  await page.locator('#maneuver-warp').click();
  await expect.poll(async () => (await debug(page)).maneuver?.warping).toBe(true);
  await expect.poll(async () => (await debug(page)).maneuver?.warping, { timeout: 15000 }).toBe(false);
  await page.locator('#pause').click();
  const after = await debug(page);
  expect(after.time).toBeGreaterThan(before.time + 5);
  expect(after.maneuver).toMatchObject({ valid: true, prograde: 0, radial: 0, execution: null });
  expect(after.engine).toBe(false); expect(after.throttle).toBe(before.throttle);
  expect(after.maneuver.time - after.time).toBeGreaterThan(5);
  expect(after.maneuver.time - after.time).toBeLessThan(11);
  await expect(page.locator('#warp-factor')).toHaveText('1×');
});

test('map handles shape and move the local plan, with fine controls and drag cancellation', async ({ page }) => {
  await setup(page); await place(page);
  const before = await debug(page);
  const handle = page.getByRole('button', { name: 'Increase prograde velocity', exact: true });
  const node = page.getByRole('button', { name: 'Move maneuver node along the coast; click to open editor', exact: true });
  const center = (box: {x: number; y: number; width: number; height: number}) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const p = center((await handle.boundingBox())!), n = center((await node.boundingBox())!);
  const length = Math.hypot(p.x - n.x, p.y - n.y), dx = (p.x - n.x) / length, dy = (p.y - n.y) / length;
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + dx * 32, p.y + dy * 32, { steps: 8 }); await page.mouse.up();
  // Firefox rounds pointer positions to CSS pixels; a drag can differ by a fraction of a step.
  await expect.poll(async () => Math.abs((await debug(page)).maneuver?.prograde - 8)).toBeLessThan(.5);
  const dragged = (await debug(page)).maneuver.prograde;
  await page.locator('#maneuver-increment').selectOption('0.1');
  await handle.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBeCloseTo(dragged + .1, 6);
  const latest = center((await handle.boundingBox())!);
  await page.mouse.move(latest.x, latest.y); await page.mouse.down();
  await page.mouse.move(latest.x + dx * 40, latest.y + dy * 40, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBeCloseTo(dragged + .1, 6);
  const box = (await page.locator('#flight-view').boundingBox())!, radius = Math.hypot(n.x - box.x - box.width / 2, n.y - box.y - box.height / 2);
  const time = (await debug(page)).maneuver.time;
  await page.mouse.move(n.x, n.y); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + radius * Math.cos(2.2), box.y + box.height / 2 - radius * Math.sin(2.2), { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await debug(page)).maneuver?.time).not.toBe(time);
  const after = await debug(page);
  expect(after.tick).toBe(before.tick); expect(after.velocity).toEqual(before.velocity); expect(after.position).toEqual(before.position);
  expect(after.camera).toEqual(before.camera); expect(after.engine).toBe(false);
  await page.screenshot({ path: 'test-results/maneuver-map-handles.png' });
  await page.locator('#maneuver-clear').click();
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBe(0);
  await page.locator('#maneuver-delete').click();
  await expect(page.getByRole('group', { name: 'Maneuver map controls' })).toBeHidden();
});

test('Execute burn warps, aligns, fires and cuts off autonomously', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('-10');
  await page.locator('#maneuver-radial').fill('5');
  await page.locator('#maneuver-time').fill('30'); await page.locator('#maneuver-time').press('Tab');
  await page.locator('#pause').click();
  await expect(page.locator('#maneuver-execute')).toBeEnabled();
  await page.locator('#maneuver-execute').click();
  await expect(page.locator('#maneuver-abort')).toBeVisible();
  await expect.poll(async () => (await debug(page)).maneuver?.execution).not.toBeNull();
  await expect(page.locator('#maneuver-status')).toContainText('Burn complete', { timeout: 25000 });
  // The editor status refreshes independently of the 4-Hz diagnostic snapshot.
  await expect.poll(async () => { const done = await debug(page); return { execution: done.maneuver?.execution, engine: done.engine, valid: done.maneuver?.valid }; }).toEqual({ execution: null, engine: false, valid: false });
  const done = await debug(page);
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await expect(page.locator('#throttle-value')).toHaveText('0%');
  await expect(page.locator('#maneuver-abort')).toBeHidden();
  expect(errors).toEqual([]);
  await test.info().attach('autonomous-burn-profile', { contentType: 'application/json', body: JSON.stringify({
    workP95Ms: done.workP95Ms, simulationP95Ms: done.simulationP95Ms,
    predictionP95Ms: done.predictionP95Ms, renderP95Ms: done.renderP95Ms,
  }) });
});

test('Abort burn releases thrust during a finite burn and requires replanning', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('400');
  await page.locator('#maneuver-time').fill('8'); await page.locator('#maneuver-time').press('Tab');
  await page.locator('#pause').click();
  await page.locator('#maneuver-execute').click();
  await expect.poll(async () => (await debug(page)).maneuver?.execution, { timeout: 15000 }).toBe('burning');
  const burning = await debug(page);
  await test.info().attach('finite-burn-profile', { contentType: 'application/json', body: JSON.stringify({
    workP95Ms: burning.workP95Ms, simulationP95Ms: burning.simulationP95Ms,
    predictionP95Ms: burning.predictionP95Ms, renderP95Ms: burning.renderP95Ms,
  }) });
  await page.locator('#maneuver-abort').click();
  await expect.poll(async () => (await debug(page)).maneuver?.execution).toBeNull();
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
  await expect(page.locator('#maneuver-status')).toContainText('aborted');
  expect((await debug(page)).maneuver.valid).toBe(false);
});

for (const cancellation of ['manual steering', 'pause', 'reset'] as const) {
  test(`${cancellation} cancels armed execution`, async ({ page }) => {
    // Each cancellation starts with a fresh future node: steering can leave the
    // previous node too close for another safe automatic alignment.
    await setup(page); await place(page);
    await page.locator('#maneuver-prograde').fill('10');
    await page.locator('#maneuver-time').fill('10'); await page.locator('#maneuver-time').press('Tab');
    await page.locator('#pause').click();
    await page.locator('#maneuver-execute').click();
    if (cancellation === 'manual steering') {
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.keyboard.down('ArrowLeft');
    } else if (cancellation === 'pause') await page.locator('#pause').click();
    else {
      await openPanel(page, 'setup');
      await page.locator('#reset').click();
    }
    await expect.poll(async () => (await debug(page)).maneuver?.execution).toBeNull();
    if (cancellation === 'manual steering') await page.keyboard.up('ArrowLeft');
    if (cancellation === 'reset') await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(false);
  });
}

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
