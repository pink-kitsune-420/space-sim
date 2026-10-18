import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Harness from '../helpers/starfield-harness';

declare global { interface Window { starfieldHarness: typeof Harness } }
let script: string;
test.beforeAll(async () => {
  const output = await build({ configFile: false, logLevel: 'silent', build: { write: false,
    lib: { entry: resolve('tests/helpers/starfield-harness.ts'), name: 'starfieldHarness', formats: ['iife'] },
  } });
  const bundle = Array.isArray(output) ? output[0]! : output;
  if (!('output' in bundle)) throw new Error('Expected test harness bundle');
  const chunk = bundle.output.find(c => c.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing test harness chunk');
  script = chunk.code;
});

for (const renderer of ['canvas', 'webgl'] as const) {
  test(`${renderer} honors star visibility and density, with twinkling independent of nebula animation`, async ({ page }) => {
    test.setTimeout(90000); // Software WebGL also compiles the full scene in the background.
    await page.goto('about:blank');
    await page.addScriptTag({ content: script });
    for (const highQuality of [false, true]) {
      const result = await page.evaluate(options => window.starfieldHarness.audit(options.renderer, options.highQuality), { renderer, highQuality });
      test.skip(result === null, 'WebGL 2 unavailable in this browser environment');
      const { densities, first, repeat, later, hidden, hiddenLater } = result!;
      let previous = 0;
      for (const sample of densities) {
        expect(sample.error).toBe(0);
        expect(sample.bright).toBeGreaterThan(previous);
        previous = sample.bright;
      }
      expect(first).toEqual(repeat);
      expect(hidden.bright).toBe(0);
      expect(hidden).toEqual(hiddenLater);
      if (highQuality) expect(first.hash).not.toBe(later.hash);
    }
  });
}

test('planet designer preserves its default background stars', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('about:blank');
  await page.addScriptTag({ content: script });
  const result = await page.evaluate(() => window.starfieldHarness.previewStars());
  test.skip(result === null, 'WebGL 2 unavailable in this browser environment');
  expect(result!.error).toBe(0);
  expect(result!.bright).toBeGreaterThan(20);
});
