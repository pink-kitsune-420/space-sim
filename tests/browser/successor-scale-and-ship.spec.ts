import { waitForWorldReady } from '../helpers/loading';
import { test, expect, type Page } from '@playwright/test';
import { useCanvas, useLowGraphics } from '../helpers/canvas';
import successor from '../../games/space-sim-successor/game.json' with { type: 'json' };
import { openPanel, closePanel } from '../helpers/workspace';

async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function flightFocus(page: Page) { await page.locator('#flight-view').click({ position: { x: 20, y: 120 } }); }
async function scenario(page: Page, id: string) { await openPanel(page, 'setup'); await page.locator('#preset').selectOption(id); }

for (const renderer of ['Canvas', 'WebGL']) {
  test(`${renderer} successor 2/4/8 worlds, physical views, launch, landing and coast`, async ({ page }, info) => {
    test.setTimeout(180000);
    if (renderer === 'Canvas') await useCanvas(page); else await useLowGraphics(page);
    await page.setViewportSize(renderer === 'Canvas' ? { width: 1100, height: 800 } : { width: 640, height: 480 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page);
    await expect(page.locator('#status')).toHaveText('LANDED');
    await expect.poll(async () => (await debug(page)).renderer).toBe(renderer === 'Canvas' ? 'builtin.canvas' : 'builtin.webgl');
    await expect.poll(async () => (await debug(page)).vehicleArtwork?.metresPerUnit).toBe(1);
    await openPanel(page, 'setup');
    await expect(page.locator('#successor-trial-help')).toContainText('4× is provisional');
    for (const scale of [2, 4, 8]) {
      await page.locator('#system-select').selectOption(scale === 4 ? 'primus-system' : `primus-system-${scale}x`);
      await page.locator('#preset').selectOption('pad');
      await expect(page.locator('#status')).toHaveText('LANDED');
      await expect.poll(async () => Math.hypot((await debug(page)).position?.x ?? 0, (await debug(page)).position?.y ?? 0)).toBeCloseTo(512 * scale + 2.5, 5);
      await expect(page.locator('#altitude')).toHaveText('0.0');
      await expect.poll(async () => (await debug(page)).camera?.scale).toBeGreaterThan(5);
      await closePanel(page);
      await page.screenshot({ path: `test-results/successor-${renderer}-${scale}x-${info.project.name}.png` });
      await flightFocus(page); await page.keyboard.down('Space');
      await expect(page.locator('#status')).toHaveText('FLYING');
      await page.keyboard.up('Space');
      await expect.poll(async () => (await debug(page)).engine).toBe(false);
      // Both bodies have a human-scale grounded start; finite contact survives reset.
      await scenario(page, 'parvus-pad');
      await expect(page.locator('#status')).toHaveText('LANDED');
      await expect.poll(async () => (await debug(page)).body).toBe('moon');
      await expect(page.locator('#altitude')).toHaveText('0.0');
      await scenario(page, 'planet-orbit');
      await expect.poll(async () => (await debug(page)).predictionEnd, { timeout: 15000 }).toBe('closed');
      await expect.poll(async () => (await debug(page)).dynamics).toBe('kepler');
      await flightFocus(page); await page.keyboard.press('KeyC');
      await expect.poll(async () => (await debug(page)).camera?.mode).toBe('free');
      const overview = await debug(page);
      expect(512 * scale * 2 * overview.camera.scale).toBeGreaterThan(150);
      expect(512 * scale * 2 * overview.camera.scale).toBeLessThan(800);
      await openPanel(page, 'setup');
    }
    // Canvas exercises precise prediction/live contact; WebGL above qualifies
    // the same shared ship/terrain paths at all three scales on a software GPU.
    if (renderer === 'WebGL') { expect(errors).toEqual([]); return; }
    // Import only extra authored test starts, preserving the trial geometry and
    // handling. Reset + pause in one DOM turn captures the same epoch for prediction.
    const definition = successor.bundle.modules[0]!.data.universes[0]!.definition;
    const contactTrials = { ...definition, id: 'successor-contact-check', systems: definition.systems.map(system => ({ ...system,
      presets: [...system.presets, ...['planet', 'moon'].filter(id => system.bodies.some(b => b.id === id)).map(id => ({
        id: `${id}-touchdown`, name: `${id} contact check`, bodyId: id, kind: 'state',
        position: [0, system.bodies.find(b => b.id === id)!.radius + 2.6], velocity: [0, -1], headingRadians: Math.PI / 2, zoom: 30,
      }))] })) };
    await page.locator('#universe-file').setInputFiles({ name: 'contact-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(contactTrials)) });
    for (const scale of [2, 4, 8]) {
      await page.locator('#system-select').selectOption(scale === 4 ? 'primus-system' : `primus-system-${scale}x`);
      for (const [id, radius] of [['planet', 512 * scale], ['moon', 128 * scale]] as const) {
        await page.locator('#preset').evaluate((el, preset) => {
          (el as HTMLSelectElement).value = preset; el.dispatchEvent(new Event('change')); document.getElementById('pause')!.click();
        }, `${id}-touchdown`);
        await expect(page.locator('#status')).toHaveText('PAUSED');
        await expect.poll(async () => (await debug(page)).predictionEnd).toBe('impact');
        const prediction = (await debug(page)).predictionLast;
        // Small spin moves the inertial point during descent; radius is invariant.
        expect(Math.hypot(prediction.position.x, prediction.position.y)).toBeCloseTo(radius + 2.5, 5);
        await page.getByRole('button', { name: 'Resume', exact: true }).click();
        await expect(page.locator('#status')).toHaveText('LANDED');
        await expect.poll(async () => (await debug(page)).contact?.time).toBeCloseTo(prediction.time, 7);
        await expect(page.locator('#altitude')).toHaveText('0.0');
      }
    }
    expect(errors).toEqual([]);
  });
}

test('successor hold-to-adjust throttle keeps thrust on release and X cuts it', async ({ page }, info) => {
  if (info.project.name === 'webkit') test.slow();
  await useCanvas(page);
  await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await flightFocus(page);
  await page.keyboard.press('KeyX');
  await expect(page.locator('#throttle-value')).toHaveText('0%');
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#status')).toHaveText('FLYING', { timeout: 15000 });
  await page.keyboard.up('ArrowUp');
  await expect.poll(async () => (await debug(page)).engine).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const held = await page.locator('#throttle-value').textContent();
  await page.waitForTimeout(250);
  await expect(page.locator('#throttle-value')).toHaveText(held!);
  await expect(page.locator('#status')).toHaveText('FLYING');
  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
  await expect(page.locator('#throttle-value')).toHaveText('0%');
});
