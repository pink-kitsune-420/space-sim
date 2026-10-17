import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function diagnostics(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(await page.locator('#debug').textContent() || '{}') as Record<string, unknown>;
}
async function tracedOrbit(page: Page): Promise<void> {
  await expect.poll(async () => (await diagnostics(page)).predictionEnd, { timeout: 15000 }).toBe('closed');
  expect((await diagnostics(page)).samples as number).toBeGreaterThan(40);
}
async function flightFocus(page: Page): Promise<void> {
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
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
  await tracedOrbit(page);
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
  await tracedOrbit(page);
  await expect(page.locator('#altitude')).toHaveText('128.0');
  await expect(page.locator('#periapsis')).toHaveText('128.0 m');
  await expect(page.locator('#apoapsis')).toHaveText('128.0 m');
  const orbit = await diagnostics(page);
  expect(orbit.dynamics).toBe('kepler');
  expect(orbit.coastEpochSeconds).toBe(0);
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

test('mouse drag pans a rotated view and follow restores without changing flight state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await diagnostics(page)).dynamics).toBe('kepler');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await page.getByRole('button', { name: 'North up' }).click();
  const before = await diagnostics(page);
  const canvas = page.locator('#flight-view');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Free camera', exact: true })).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).camera).not.toEqual(before.camera);
  const after = await diagnostics(page);
  expect(after.position).toEqual(before.position);
  expect(after.velocity).toEqual(before.velocity);
  await page.getByRole('button', { name: 'Free camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Follow ship', exact: true })).toBeVisible();
  await expect.poll(async () => ((await diagnostics(page)).camera as { follow: boolean }).follow).toBe(true);
  expect((await diagnostics(page)).position).toEqual(before.position);
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

test('the coast preview traces progressively, then stays as a full orbit', async ({ page }) => {
  await page.goto('/');
  // Record every prediction readout change in the page, independent of polling speed.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => seen.push(document.querySelector('#prediction')!.textContent!))
      .observe(document.querySelector('#prediction')!, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#preset').selectOption('planet-orbit');
  await tracedOrbit(page);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  const counts = seen.map(text => /^Tracing · (\d+) points$/.exec(text)?.[1]).filter(Boolean).map(Number);
  expect(counts.length).toBeGreaterThanOrEqual(3);
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  await expect(page.locator('#prediction')).toHaveText(/^Full orbit · period 28\.1 s$/);
  const before = await diagnostics(page);
  await page.waitForTimeout(600);
  const after = await diagnostics(page);
  expect(after.predictionPasses).toBe(before.predictionPasses); // a coast keeps its exact path
});

test('the profiler overlay opens from the keyboard and exports a local JSON log', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#preset').selectOption('planet-orbit');
  await tracedOrbit(page);
  await flightFocus(page);
  await expect(page.locator('#profiler')).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(page.locator('#profiler')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profiler' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#profiler-fps')).toContainText('FPS');
  await expect(page.locator('#profiler-rows tr')).toHaveCount(10);
  const pending = page.waitForEvent('download');
  await page.locator('#export-log').click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^space-sim-log-.+\.json$/);
  const log = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    format: string; frames: unknown[]; events: Array<{ type: string }>; diagnostics: { model: string };
  };
  expect(log.format).toBe('space-sim-log/1');
  expect(log.frames.length).toBeGreaterThan(10);
  expect(log.events.map(event => event.type)).toEqual(expect.arrayContaining(['session', 'reset', 'prediction']));
  expect(log.diagnostics.model).toBeTruthy();
  await flightFocus(page); // shortcuts never fire inside native controls such as the Export button
  await page.keyboard.press('Backquote');
  await expect(page.locator('#profiler')).toBeHidden();
  expect(errors).toEqual([]);
});

test('zooming in on Earth renders a clean smooth horizon without triangle tessellation bugs', async ({ page }) => {
  await page.goto('/');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  await expect(page.locator('#active-body')).toHaveText('EARTH');
  await expect(page.locator('#status')).toHaveText('LANDED');
  // Reach the same physical pixel scale in both compact and taller flight views.
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    if (i >= 5 && ((await diagnostics(page)).camera as { scale: number }).scale > 1) break;
  }
  await page.waitForTimeout(200);
  const diag = await diagnostics(page);
  expect((diag.camera as { scale: number }).scale).toBeGreaterThan(1);
  await page.screenshot({ path: `test-results/earth-horizon-${test.info().project.name}.png` });
});

test('Earth horizon at intermediate scale renders a smooth curved atmosphere without cutoff step', async ({ page }) => {
  await page.goto('/');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  await expect(page.locator('#active-body')).toHaveText('EARTH');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/earth-horizon-intermediate-${test.info().project.name}.png` });
});

test('zooming out from Earth pad transitions smoothly between horizon and planet disc', async ({ page }) => {
  await page.goto('/');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/earth-horizon-zoomout-${test.info().project.name}.png` });
});

test('starts with WebGL 2 renderer by default and toggles cleanly to 2D and back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Renderer: WebGL' })).toBeVisible();
  await page.getByRole('button', { name: 'Renderer: WebGL' }).click();
  await expect(page.getByRole('button', { name: 'Renderer: 2D' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Renderer: 2D' }).click();
  await expect(page.getByRole('button', { name: 'Renderer: WebGL' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('suborbital coast on Earth finishes tracing to impact without restarting every frame', async ({ page }) => {
  await page.goto('/');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  await flightFocus(page);
  await page.keyboard.down('Space');
  await page.keyboard.down('ArrowRight');
  await expect(page.locator('#status')).toHaveText('FLYING');
  // Tilt off vertical (a radial path never coasts), then climb for a few seconds of coast:
  // the arc coasts on its conic and only its last metre is a new numerical pass.
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(1200);
  await page.keyboard.up('Space');
  // Diagnostics refresh at 4 Hz. A burning preview can already say "impact";
  // wait for the completed coast result before checking that its pass stays cached.
  await expect.poll(async () => {
    const diag = await diagnostics(page);
    return { engine: diag.engine, coarse: diag.predictionCoarse, end: diag.predictionEnd };
  }).toEqual({ engine: false, coarse: false, end: 'impact' });
  const before = await diagnostics(page);
  await page.waitForTimeout(400);
  const after = await diagnostics(page);
  expect(after.predictionPasses).toBe(before.predictionPasses);
  expect(after.samples).toBe(before.samples);
});
