import { test, expect } from '@playwright/test';
import { waitForWorldReady } from '../helpers/loading';
import { useCanvas } from '../helpers/canvas';

for (const renderer of ['WebGL', 'Canvas']) test(`${renderer} fresh Tiles Demo mornings repeat and launch`, async ({ browser }, info) => {
  test.setTimeout(180000);
  const starts: { time: number; position: { x: number; y: number }; heading: number }[] = [];
  for (let repeat = 0; repeat < 2; repeat++) {
    const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
    try {
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      if (renderer === 'Canvas') await useCanvas(page);
      await page.goto('/?game=space-sim-successor&planetPaused=1');
      await waitForWorldReady(page);
      const debug = async () => JSON.parse(await page.locator('#debug').textContent() || '{}');
      await expect.poll(async () => (await debug()).body, { timeout: 30000 }).toBe('planet');
      const start = await debug();
      expect(start.renderer).toBe(renderer === 'WebGL' ? 'builtin.webgl' : 'builtin.canvas');
      expect(start.system).toBe('primus-field-system');
      expect(start.time).toBeGreaterThan(0);
      expect(Math.abs(start.groundClearance)).toBeLessThan(1e-6);
      starts.push({ time: start.time, position: start.position, heading: start.heading });
      await page.screenshot({ path: info.outputPath(`morning-${repeat}.png`) });
      await page.locator('#pause').evaluate(el => (el as HTMLButtonElement).click());
      await expect(page.locator('#status')).toHaveText('LANDED', { timeout: 30000 });
      await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
      await page.keyboard.press('Space');
      await expect(page.locator('#status')).toHaveText('FLYING', { timeout: 30000 });
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
  expect(starts[1]).toEqual(starts[0]);
  await info.attach('fresh-starts', { body: JSON.stringify(starts, null, 2), contentType: 'application/json' });
});

test('explicit preview scenario keeps its original epoch', async ({ page }) => {
  await useCanvas(page);
  await page.goto('/?game=space-sim-successor&planetPreset=coast&planetPaused=1');
  await waitForWorldReady(page);
  await expect(page.locator('#preset')).toHaveValue('coast');
  await expect.poll(async () => JSON.parse(await page.locator('#debug').textContent() || '{}').time).toBe(0);
});
