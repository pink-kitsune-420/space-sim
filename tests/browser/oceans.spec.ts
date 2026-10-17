import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import ocean from '../../games/space-sim/universes/sandbox/ocean/universe.json' with { type: 'json' };

let script: string;
test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'silent', build: { write: false,
    lib: { entry: resolve('tests/helpers/terrain-harness.ts'), name: 'terrainHarness', formats: ['iife'] },
  } });
  const bundle = Array.isArray(output) ? output[0]! : output;
  if (!('output' in bundle)) throw new Error('Expected harness bundle');
  const chunk = bundle.output.find(c => c.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing harness chunk');
  script = chunk.code;
});

test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
for (const renderer of ['canvas', 'webgl'] as const) {
  test(`${renderer}: ocean silhouettes at orbit, water horizon, coast, seam and large scales`, async ({ page }, info) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: script });
    const views = [
      { world: 'ocean', angle: 0, scale: 2, rotation: .4, orbit: true },
      { world: 'ocean', angle: 0, scale: 30, rotation: Math.PI / 2 },
      { world: 'ocean', angle: Math.PI / 10, scale: 30, rotation: Math.PI / 2 - Math.PI / 10 },
      { world: 'ocean', angle: 2 * Math.PI - .001, scale: 1000, rotation: Math.PI / 2 + .001 },
      { world: 'large-ocean', angle: 0, scale: 20, rotation: .4, offset: 1e12 },
    ] as const;
    for (let i = 0; i < views.length; i++) {
      const result = await page.evaluate(options => window.terrainHarness.draw(options), { renderer, ...views[i]! });
      expect(result.error).toBe(0);
      expect(result.pixels).toEqual([1600, 1200]);
      expect(result.probes.length).toBeGreaterThan(0);
      for (const p of result.probes) {
        expect(Math.hypot(...p.inside.slice(0, 3).map((v, j) => v - p.outside[j]!))).toBeGreaterThan(25);
      }
      if (i === 1) { // blue ocean at the sampled water horizon
        expect(result.probes[0]!.inside[2]).toBeGreaterThan(result.probes[0]!.inside[0]! + 20);
      }
      await page.screenshot({ path: `test-results/ocean-${renderer}-${i}-${info.project.name}.png` });
    }
    const custom = await page.evaluate(options => window.terrainHarness.draw(options), {
      renderer, world: 'ocean' as const, angle: 0, scale: 30, rotation: Math.PI / 2, custom: true,
    });
    expect(custom.error).toBe(0);
    expect(custom.probes[0]!.inside[2]).toBeGreaterThan(custom.probes[0]!.inside[0]! + 20);
  });
}

async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }

test('surface worlds are one click away with a visible planet overview and close flight scenarios', async ({ page }, info) => {
  const { openPanel, closePanel } = await import('../helpers/workspace');
  await page.goto('/');
  await expect(page.locator('#terrain-notice')).toBeHidden();
  await openPanel(page, 'library');
  await page.getByRole('button', { name: 'Terrain worlds', exact: true }).click();
  await expect(page.locator('#active-body')).toHaveText('DRY PLANET');
  await expect(page.locator('#terrain-notice')).toBeVisible();
  await expect(page.locator('#camera')).toHaveText('Follow ship');
  await expect.poll(async () => (await debug(page)).physicalTerrain).toBe(true);
  await closePanel(page);
  await page.screenshot({ path: `test-results/terrain-world-overview-${info.project.name}.png` });
  await openPanel(page, 'setup');
  await page.locator('#system-select').selectOption('cratered');
  await expect(page.locator('#active-body')).toHaveText('CRATER MOON');
  await expect(page.locator('#camera')).toHaveText('Follow ship');
  await openPanel(page, 'library');
  await page.getByRole('button', { name: 'Ocean world', exact: true }).click();
  await expect(page.locator('#active-body')).toHaveText('OCEAN PLANET');
  await expect(page.locator('#camera')).toHaveText('Follow ship');
  await expect(page.locator('#universe-select')).toHaveValue('ocean-example');
  await closePanel(page);
  await page.screenshot({ path: `test-results/ocean-world-overview-${info.project.name}.png` });
  await openPanel(page, 'setup');
  await page.locator('#preset').evaluate(el => {
    (el as HTMLSelectElement).value = 'submerged'; el.dispatchEvent(new Event('change'));
    document.getElementById('pause')!.click();
  });
  await expect(page.locator('#camera')).toHaveText('Follow ship');
  await expect(page.locator('#orientation')).toHaveText('Horizon up');
  await expect.poll(async () => (await debug(page)).waterDepth).toBeGreaterThan(1);
  await page.locator('#universe-select').selectOption('default-universe');
  await expect(page.locator('#terrain-notice')).toBeHidden();
});

test('offline ocean flight predicts splashes, floats, dives, crashes and resets', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/space-sim-offline.html')).href);
  await page.locator('#universe-file').setInputFiles({ name: 'ocean.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ocean)) });
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect.poll(async () => (await debug(page)).position?.y).toBe(520);
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#export-universe').click();
  const exported = JSON.parse(await readFile(await (await pendingDownload).path(), 'utf8'));
  expect(exported.systems[0].bodies[0].surface).toEqual(ocean.systems[0]!.bodies[0]!.surface);
  await page.locator('#preset').evaluate(el => {
    (el as HTMLSelectElement).value = 'heavy'; el.dispatchEvent(new Event('change'));
    document.getElementById('pause')!.click();
  });
  await expect.poll(async () => (await debug(page)).predictionEnd).toBe('impact');
  const predicted = (await debug(page)).predictionLast;
  expect(predicted.position.x).toBeCloseTo(514, 6);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('CRASHED');
  await expect(page.locator('#flight-message')).toContainText('Heavy water impact');
  await expect.poll(async () => (await debug(page)).contact?.material).toBe('water');
  expect((await debug(page)).contact.time).toBeCloseTo(predicted.time, 8);
  await page.locator('#god-mode').check();
  await expect(page.locator('#status')).toHaveText('FLOATING', { timeout: 20000 });
  await page.locator('#god-mode').uncheck();
  await page.locator('#preset').selectOption('splash');
  await expect(page.locator('#status')).toHaveText('SUBMERGED');
  await expect(page.locator('#flight-message')).toContainText('depth');
  await expect(page.locator('#status')).toHaveText('FLOATING', { timeout: 20000 });
  await page.locator('#renderer-toggle').click();
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: 2D');
  // Turn inward and burn from rest to demonstrate powered sinking.
  await page.locator('#flight-view').focus();
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => {
    const d = await debug(page); return Math.cos(d.heading ?? 0);
  }).toBeLessThan(-.8);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('SUBMERGED');
  await page.keyboard.up('Space');
  await expect.poll(async () => (await debug(page)).waterDepth).toBeGreaterThan(.25);
  await page.getByRole('button', { name: 'Reset flight' }).click();
  await page.locator('#preset').selectOption('pad');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#universe-select').selectOption('default-universe');
  await expect(page.locator('#terrain-notice')).toBeHidden();
  expect(errors).toEqual([]);
});
