import { test, expect, type Page } from '@playwright/test';
import { openPanel } from '../helpers/workspace';

// Two authored level cores give independently known elevated and below-reference
// contact radii without consulting the procedural generator in the browser.
const universe = {
  schemaVersion: 1, id: 'terrain-flight', name: 'Terrain flight fixtures', defaultSystemId: 'test',
  systems: [{ id: 'test', name: 'Test', bodies: [{ id: 'rock', name: 'Rock', radius: 10, mu: 100,
    surface: { kind: 'radial', generatorVersion: 1, seed: 0, sampleCount: 64, maxReliefMetres: 2,
      minFeatureWidthMetres: 4, orientationRadians: 0, mountainRangeCount: 0, craterCount: 0,
      pads: [
        { id: 'peak', angleRadians: Math.PI / 2, widthMetres: 4, elevationMetres: 2 },
        { id: 'crater', angleRadians: 3 * Math.PI / 2, widthMetres: 4, elevationMetres: -2 },
      ] },
  }], presets: [
    { id: 'pad', name: 'Peak pad', bodyId: 'rock', kind: 'landed' },
    { id: 'crater', name: 'Crater descent', bodyId: 'rock', kind: 'state', position: [0, -9], velocity: [0, 0], headingRadians: -Math.PI / 2 },
    { id: 'crash', name: 'Unsafe descent', bodyId: 'rock', kind: 'state', position: [0, -9], velocity: [0, 15], headingRadians: -Math.PI / 2 },
    { id: 'orbit', name: 'Safe survey', bodyId: 'rock', kind: 'circular-orbit', radius: 20 },
  ] }],
};
async function diagnostics(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function load(page: Page, value = universe) {
  await page.locator('#universe-file').setInputFiles({ name: 'flight.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

for (const canvas of [false, true]) {
  test(`${canvas ? 'Canvas' : 'WebGL'} physical pads, crater prediction/landing, crash, God mode and safe coast`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await load(page);
    if (canvas) {
      await openPanel(page, 'settings');
      await page.locator('#renderer-toggle').click();
      await openPanel(page, 'setup');
    }
    await expect(page.locator('#status')).toHaveText('LANDED');
    await expect(page.locator('#altitude')).toHaveText('0.0');
    await expect.poll(async () => (await diagnostics(page)).position?.y).toBe(12);
    // Reset and pause in one DOM turn so prediction and its recorded epoch can
    // be inspected even when a busy browser delivers commands slowly.
    await page.locator('#preset').evaluate(el => {
      (el as HTMLSelectElement).value = 'crater';
      el.dispatchEvent(new Event('change'));
      document.getElementById('pause')!.click();
    });
    await expect(page.locator('#status')).toHaveText('PAUSED');
    await expect.poll(async () => (await diagnostics(page)).predictionEnd).toBe('impact');
    const predicted = (await diagnostics(page)).predictionLast;
    expect(predicted.position.x).toBeCloseTo(0, 7);
    expect(predicted.position.y).toBeCloseTo(-8, 7);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('LANDED');
    await expect.poll(async () => typeof (await diagnostics(page)).contact?.time).toBe('number');
    const landed = await diagnostics(page);
    expect(landed.position.y).toBeCloseTo(-8, 7);
    expect(landed.contact.time).toBeCloseTo(predicted.time, 8);
    await expect(page.locator('#altitude')).toHaveText('0.0');
    await expect(page.locator('#prediction')).toHaveText('—');
    await page.locator('#preset').selectOption('crash');
    await expect(page.locator('#status')).toHaveText('CRASHED');
    await openPanel(page, 'settings');
    await page.locator('#god-mode').check();
    await expect(page.locator('#status')).toHaveText('LANDED');
    await openPanel(page, 'setup');
    await page.getByRole('button', { name: 'Reset flight' }).click();
    await expect(page.locator('#status')).toHaveText('LANDED');
    await page.locator('#preset').selectOption('orbit');
    await expect.poll(async () => (await diagnostics(page)).predictionEnd).toBe('closed');
    expect((await diagnostics(page)).dynamics).toBe('kepler');
    await openPanel(page, 'settings');
    await page.locator('#god-mode').uncheck();
    expect(errors).toEqual([]);
  });
}

test('buried terrain state import is rejected atomically', async ({ page }) => {
  await page.goto('/');
  const invalid = structuredClone(universe);
  invalid.systems[0]!.presets[1]!.position = [0, -7];
  const message = new Promise<string>(resolve => page.once('dialog', async dialog => {
    resolve(dialog.message()); await dialog.accept();
  }));
  await load(page, invalid);
  expect(await message).toContain('Preset crater: flying start is inside terrain');
  await expect(page.locator('#universe-select')).toHaveValue('default-universe');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect(page.locator('#terrain-notice')).toBeHidden();
});

test('a terrain precision failure pauses at the last verified snapshot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const extreme = structuredClone(universe);
  extreme.systems[0]!.presets = [{ id: 'extreme', name: 'Precision boundary', bodyId: 'rock',
    kind: 'state', position: [-1e16, 1], velocity: [2e18, 0], headingRadians: 0 }];
  await load(page, extreme);
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect(page.locator('#flight-message')).toContainText('Terrain contact failed: precision');
  const state = await diagnostics(page);
  expect(state.time).toBe(0);
  expect(state.position).toEqual({ x: -1e16, y: 1 });
  expect(state.contact).toBeNull();
  expect(errors).toEqual([]);
});
