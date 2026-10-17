import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import examples from '../../games/space-sim/universes/sandbox/terrain/universe.json' with { type: 'json' };
import type * as Harness from '../helpers/terrain-harness';

declare global { interface Window { terrainHarness: typeof Harness } }
let script: string;
test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'silent', build: { write: false,
    lib: { entry: resolve('tests/helpers/terrain-harness.ts'), name: 'terrainHarness', formats: ['iife'] },
  } });
  const bundle = Array.isArray(output) ? output[0]! : output;
  if (!('output' in bundle)) throw new Error('Expected test harness bundle');
  const chunk = bundle.output.find(c => c.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing test harness chunk');
  script = chunk.code;
});

test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
for (const renderer of ['canvas', 'webgl'] as const) {
  test(`${renderer} terrain silhouettes and landmarks at orbit, seam, landing and extreme scales`, async ({ page }, info) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: script });
    const views = [
      { world: 'planet', angle: .3, scale: .45, rotation: 0, orbit: true },
      { world: 'moon', angle: 0, scale: 1.3, rotation: .6, orbit: true },
      { world: 'planet', angle: .3, scale: 12, rotation: Math.PI / 2 - .3 },
      { world: 'moon', angle: 2 * Math.PI - .001, scale: 20, rotation: Math.PI / 2 + .001 },
      { world: 'large', angle: Math.PI / 2, scale: 20, rotation: .4, offset: 1e12 },
    ] as const;
    for (let i = 0; i < views.length; i++) {
      const result = await page.evaluate(options => window.terrainHarness.draw(options), { renderer, ...views[i]! });
      expect(result.error).toBe(0);
      expect(result.pixels).toEqual([1600, 1200]);
      expect(result.probes.length).toBeGreaterThan(0);
      for (const p of result.probes) {
        // Zero atmosphere in this fixture: the lit brown surface differs from blue space.
        expect(p.inside[0]).toBeGreaterThan(p.outside[0]! + 20);
      }
      await page.screenshot({ path: `test-results/terrain-${renderer}-${i}-${info.project.name}.png` });
    }
    if (renderer === 'webgl') {
      const normal = await page.evaluate(() => window.terrainHarness.draw({ renderer: 'webgl', world: 'moon', angle: 0, scale: 1.3, rotation: .6, orbit: true }));
      const custom = await page.evaluate(() => window.terrainHarness.draw({ renderer: 'webgl', world: 'moon', angle: 0, scale: 1.3, rotation: .6, orbit: true, custom: true }));
      expect(custom.error).toBe(0);
      for (let i = 0; i < normal.probes.length; i++) {
        expect(custom.probes[i]!.inside).toEqual(normal.probes[i]!.inside);
        expect(custom.probes[i]!.outside).toEqual([51, 102, 153, 255]);
      }
    }
  });
}

test('physical terrain imports offline and survives launch, renderer/system switches and reset', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('dist/space-sim-offline.html')).href);
  await expect(page.locator('#terrain-notice')).toBeHidden();
  await page.locator('#universe-file').setInputFiles({ name: 'terrain.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(examples)) });
  await expect(page.locator('#terrain-notice')).toContainText('Physical terrain');
  await expect(page.locator('#active-body')).toHaveText('DRY PLANET');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect(page.locator('#altitude')).toHaveText('0.0');
  await expect.poll(async () => JSON.parse(await page.locator('#debug').textContent() || '{}').position?.y).toBe(520);
  await page.locator('#renderer-toggle').click();
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: 2D');
  await page.locator('#flight-view').focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await page.keyboard.up('Space');
  await page.locator('#system-select').selectOption('cratered');
  await expect(page.locator('#active-body')).toHaveText('CRATER MOON');
  await page.getByRole('button', { name: 'Reset flight' }).click();
  await expect(page.locator('#terrain-notice')).toBeVisible();
  await page.locator('#universe-select').selectOption('default-universe');
  await expect(page.locator('#terrain-notice')).toBeHidden();
  expect(errors).toEqual([]);
});
