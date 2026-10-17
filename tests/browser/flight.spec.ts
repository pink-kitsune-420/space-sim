import { test, expect, type Page } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';
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
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const before = await diagnostics(page);
  await page.getByRole('button', { name: 'Follow ship' }).click();
  await page.getByRole('button', { name: 'Horizon up' }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Planet view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'North up' })).toBeVisible();
  const after = await diagnostics(page);
  expect(after.position).toEqual(before.position);
  expect(after.velocity).toEqual(before.velocity);
  await closePanel(page);
  await page.screenshot({ path: `test-results/orbit-${test.info().project.name}.png`, fullPage: true });
});

test('mouse drag pans a rotated view and follow restores without changing flight state', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await diagnostics(page)).dynamics).toBe('kepler');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect(page.getByRole('button', { name: 'Horizon up' })).toBeVisible();
  await closePanel(page);
  const before = await diagnostics(page);
  const canvas = page.locator('#flight-view');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#flight-message')).not.toContainText('ENGINE ACTIVE');
});

test('mobile viewport fits and pointer controls can launch', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await openPanel(page, 'setup');
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
  await closePanel(page);
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
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await tracedOrbit(page);
  await flightFocus(page);
  await expect(page.locator('#profiler')).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(page.locator('#profiler')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profiler', includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
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
  await openPanel(page, 'setup');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  await expect(page.locator('#active-body')).toHaveText('EARTH');
  await expect(page.locator('#status')).toHaveText('LANDED');
  // Reach the same physical pixel scale in both compact and taller flight views.
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    if (i >= 5 && ((await diagnostics(page)).camera as { scale: number }).scale > 1) break;
  }
  await closePanel(page);
  await page.waitForTimeout(200);
  const diag = await diagnostics(page);
  expect((diag.camera as { scale: number }).scale).toBeGreaterThan(1);
  await page.screenshot({ path: `test-results/earth-horizon-${test.info().project.name}.png` });
});

test('Earth horizon at intermediate scale renders a smooth curved atmosphere without cutoff step', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  await closePanel(page);
  await expect(page.locator('#active-body')).toHaveText('EARTH');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/earth-horizon-intermediate-${test.info().project.name}.png` });
});

test('zooming out from Earth pad transitions smoothly between horizon and planet disc', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#universe-select').selectOption('solar-system-universe');
  await page.locator('#preset').selectOption('earth-pad');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  }
  await closePanel(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/earth-horizon-zoomout-${test.info().project.name}.png` });
});

test('starts with WebGL 2 renderer by default and toggles cleanly to 2D and back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openPanel(page, 'setup');
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
  await openPanel(page, 'setup');
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

test('auto-resume restores flight when window regains focus or visibility', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await closePanel(page);

  // Trigger blur -> should auto-pause
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#status')).toHaveText('PAUSED');

  // Trigger focus -> should auto-resume
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#status')).toHaveText('FLYING');

  // Tab hidden -> should auto-pause
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#status')).toHaveText('PAUSED');

  // Tab shown -> should auto-resume
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#status')).toHaveText('FLYING');
});

test('run in background option prevents auto-pausing on blur and persists in localStorage', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'setup');
  const bgCheck = page.locator('#run-in-background');
  await expect(bgCheck).toBeVisible();
  await expect(bgCheck).not.toBeChecked();

  // Check the option
  await bgCheck.check();
  await expect(bgCheck).toBeChecked();

  await page.locator('#preset').selectOption('planet-orbit');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await closePanel(page);

  // Trigger blur -> should NOT pause because run in background is active
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#status')).toHaveText('FLYING');

  // Reload page and verify setting persisted
  await page.reload();
  await openPanel(page, 'setup');
  await expect(page.locator('#run-in-background')).toBeChecked();
});

test('touch controls provide zoom in/out strip, vertical drag to zoom/unzoom, and canvas touch zoom', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem('space-sim:touch-controls:v1', 'always');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await closePanel(page);

  const zoomStrip = page.locator('#touch-zoom-strip');
  await expect(zoomStrip).toBeVisible();
  const zoomIn = page.locator('#touch-zoom-in');
  const zoomOut = page.locator('#touch-zoom-out');
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();

  const scaleBefore = ((await diagnostics(page)).camera as { scale: number }).scale;

  // Tap zoom in button
  await zoomIn.dispatchEvent('pointerdown', { pointerId: 1 });
  await zoomIn.dispatchEvent('pointerup', { pointerId: 1 });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeGreaterThan(scaleBefore);

  const scaleAfterIn = ((await diagnostics(page)).camera as { scale: number }).scale;

  // Tap zoom out button
  await zoomOut.dispatchEvent('pointerdown', { pointerId: 2 });
  await zoomOut.dispatchEvent('pointerup', { pointerId: 2 });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeLessThan(scaleAfterIn);

  // Drag on zoom strip: drag up (dy < 0) zooms in
  const currentScale = ((await diagnostics(page)).camera as { scale: number }).scale;
  await page.evaluate(() => {
    const strip = document.querySelector('#touch-zoom-strip')!;
    strip.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, clientY: 200, bubbles: true }));
    strip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientY: 150, bubbles: true }));
    strip.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientY: 150, bubbles: true }));
  });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeGreaterThan(currentScale);

  // Drag on zoom strip: drag down (dy > 0) zooms out / unzooms
  const scaleZoomed = ((await diagnostics(page)).camera as { scale: number }).scale;
  await page.evaluate(() => {
    const strip = document.querySelector('#touch-zoom-strip')!;
    strip.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, clientY: 200, bubbles: true }));
    strip.dispatchEvent(new PointerEvent('pointermove', { pointerId: 4, clientY: 270, bubbles: true }));
    strip.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, clientY: 270, bubbles: true }));
  });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeLessThan(scaleZoomed);

  // Canvas 1-finger touch drag moves the camera and throws it with inertia
  const camBefore = ((await diagnostics(page)).camera as { center: { x: number; y: number } }).center;
  await page.evaluate(() => {
    const canvas = document.querySelector('#flight-view')!;
    if (typeof Touch !== 'undefined') {
      const t0 = new Touch({ identifier: 5, target: canvas, clientX: 200, clientY: 300 });
      canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], targetTouches: [t0], changedTouches: [t0], bubbles: true }));
      const t1 = new Touch({ identifier: 5, target: canvas, clientX: 260, clientY: 340 });
      canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true }));
      canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t1], bubbles: true }));
    } else {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 200, clientY: 300, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 10, pointerType: 'touch', clientX: 260, clientY: 340, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, pointerType: 'touch', clientX: 260, clientY: 340, bubbles: true }));
    }
  });
  // Camera moved away from its original center
  await expect.poll(async () => ((await diagnostics(page)).camera as { center: { x: number; y: number } }).center).not.toEqual(camBefore);

  // 2-finger multi-touch pinch to zoom in (spread fingers) and zoom out (pinch fingers)
  const pinchStartScale = ((await diagnostics(page)).camera as { scale: number }).scale;
  // Spread fingers apart: initial distance 100px (150 to 250), moving apart to 180px (110 to 290) -> zooms in
  await page.evaluate(() => {
    const canvas = document.querySelector('#flight-view')!;
    if (typeof Touch !== 'undefined') {
      const t0 = new Touch({ identifier: 1, target: canvas, clientX: 150, clientY: 400 });
      const t1 = new Touch({ identifier: 2, target: canvas, clientX: 250, clientY: 400 });
      canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [t0, t1], targetTouches: [t0, t1], changedTouches: [t0, t1], bubbles: true }));

      const t0Spread = new Touch({ identifier: 1, target: canvas, clientX: 110, clientY: 400 });
      const t1Spread = new Touch({ identifier: 2, target: canvas, clientX: 290, clientY: 400 });
      canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [t0Spread, t1Spread], targetTouches: [t0Spread, t1Spread], changedTouches: [t0Spread, t1Spread], bubbles: true }));
      canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t0Spread, t1Spread], bubbles: true }));
    } else {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, pointerType: 'touch', clientX: 150, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 22, pointerType: 'touch', clientX: 250, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, pointerType: 'touch', clientX: 110, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 22, pointerType: 'touch', clientX: 290, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, pointerType: 'touch', clientX: 110, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 22, pointerType: 'touch', clientX: 290, clientY: 400, bubbles: true }));
    }
  });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeGreaterThan(pinchStartScale);

  // Pinch fingers together: initial distance 200px (100 to 300), moving to 100px (150 to 250) -> unzooms (zooms out)
  const pinchZoomedScale = ((await diagnostics(page)).camera as { scale: number }).scale;
  await page.evaluate(() => {
    const canvas = document.querySelector('#flight-view')!;
    if (typeof Touch !== 'undefined') {
      const t0 = new Touch({ identifier: 1, target: canvas, clientX: 100, clientY: 400 });
      const t1 = new Touch({ identifier: 2, target: canvas, clientX: 300, clientY: 400 });
      canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [t0, t1], targetTouches: [t0, t1], changedTouches: [t0, t1], bubbles: true }));

      const t0Pinch = new Touch({ identifier: 1, target: canvas, clientX: 150, clientY: 400 });
      const t1Pinch = new Touch({ identifier: 2, target: canvas, clientX: 250, clientY: 400 });
      canvas.dispatchEvent(new TouchEvent('touchmove', { touches: [t0Pinch, t1Pinch], targetTouches: [t0Pinch, t1Pinch], changedTouches: [t0Pinch, t1Pinch], bubbles: true }));
      canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t0Pinch, t1Pinch], bubbles: true }));
    } else {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, pointerType: 'touch', clientX: 100, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 32, pointerType: 'touch', clientX: 300, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 31, pointerType: 'touch', clientX: 150, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 32, pointerType: 'touch', clientX: 250, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', clientX: 150, clientY: 400, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 32, pointerType: 'touch', clientX: 250, clientY: 400, bubbles: true }));
    }
  });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeLessThan(pinchZoomedScale);

  // Laptop/Trackpad pinch zoom via wheel event with ctrlKey
  const trackpadStartScale = ((await diagnostics(page)).camera as { scale: number }).scale;
  // deltaY < 0 with ctrlKey is trackpad pinch-to-zoom in
  await page.evaluate(() => {
    const canvas = document.querySelector('#flight-view')!;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeGreaterThan(trackpadStartScale);

  // deltaY > 0 with ctrlKey is trackpad pinch-to-zoom out
  const trackpadZoomedScale = ((await diagnostics(page)).camera as { scale: number }).scale;
  await page.evaluate(() => {
    const canvas = document.querySelector('#flight-view')!;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => ((await diagnostics(page)).camera as { scale: number }).scale).toBeLessThan(trackpadZoomedScale);
});
