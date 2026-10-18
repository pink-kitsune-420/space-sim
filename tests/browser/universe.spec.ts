import { disableNetwork } from '../helpers/offline';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { packageContracts } from '../../packages/module-tools/package.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import defaultUniverse from '../../games/space-sim/universes/sandbox/default/universe.json' with { type: 'json' };
import { gzipSync } from 'node:zlib';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const surface = {
  kind: 'radial', generatorVersion: 1, seed: 12345, sampleCount: 2048,
  maxReliefMetres: 24, minFeatureWidthMetres: 16, orientationRadians: 0,
  mountainRangeCount: 3, craterCount: 12,
  pads: [{ id: 'import-pad', angleRadians: 1.57, widthMetres: 32, elevationMetres: 7 }],
};

/** Primus, the home planet of the first system (its star comes first in the list). */
const primus = (universe: { systems: readonly { bodies: readonly { id: string }[] }[] }): Record<string, unknown> =>
  universe.systems[0]!.bodies.find(body => body.id === 'planet') as Record<string, unknown>;

function terrainUniverse() {
  const universe = structuredClone(defaultUniverse);
  universe.id = 'terrain-import';
  universe.name = 'Terrain import';
  return { ...universe, systems: universe.systems.map((system, i) => ({ ...system,
    bodies: system.bodies.map(body => i === 0 && body.id === 'planet' ? { ...body, surface } : body),
  })) };
}

test.beforeEach(async ({ page }) => { await useCanvas(page); });

test('custom surface settings survive universe loading and JSON export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openPanel(page, 'setup');
  await page.locator('#universe-file').setInputFiles({ name: 'terrain.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(terrainUniverse())) });
  await expect(page.locator('#universe-select')).toHaveValue('terrain-import');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await expect(page.locator('#altitude')).toHaveText('0.0');
  const pending = page.waitForEvent('download');
  await page.locator('#export-universe-json').click();
  const download = await pending;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(primus(exported).surface).toEqual(surface);
  expect(exported.systems[0].bodies[1].surface).toBeUndefined();
  expect(primus(exported).surfaceIdentity).toBeUndefined();
  await page.locator('#universe-select').selectOption('default-universe');
  await page.locator('#universe-file').setInputFiles({ name: 'exported.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.locator('#universe-select')).toHaveValue('terrain-import');
  expect(errors).toEqual([]);
});

test('oversized terrain import reports a clear error and keeps the active universe', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'setup');
  const invalid = terrainUniverse();
  Object.assign(primus(invalid), { surface: { ...surface, sampleCount: 65537 } });
  const dialogMessage = new Promise<string>(resolve => page.once('dialog', async dialog => {
    resolve(dialog.message());
    await dialog.accept();
  }));
  await page.locator('#universe-file').setInputFiles({ name: 'oversized.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalid)) });
  expect(await dialogMessage).toContain('Body planet surface: sampleCount must be an integer in [32, 65536]');
  await expect(page.locator('#universe-select')).toHaveValue('default-universe');
  await expect(page.locator('#status')).toHaveText('LANDED');
});

test('compressed universe export preserves every planet and can be imported through either picker', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'setup');
  const universe = terrainUniverse();
  await page.locator('#universe-file').setInputFiles({ name: 'planets.json.gz', mimeType: 'application/gzip', buffer: gzipSync(JSON.stringify(universe)) });
  await expect(page.locator('#universe-select')).toHaveValue('terrain-import');
  await expect(page.locator('#universe-status')).toContainText('Loaded Terrain import');
  const pending = page.waitForEvent('download'); await page.locator('#export-universe').click();
  const download = await pending; expect(download.suggestedFilename()).toBe('terrain-import.spacedata');
  const bytes = await readFile(await download.path());
  const restored = await (await packageContracts()).decodeDataFile(new Uint8Array(bytes), 'universe') as any;
  expect(primus(restored).surface).toEqual(surface);
  expect(restored.systems.map((s: { bodies: unknown[] }) => s.bodies.length)).toEqual(universe.systems.map(s => s.bodies.length));
  expect(bytes.length).toBeLessThan(32 * 1024 * 1024);
  await expect(page.locator('#universe-status')).toContainText('reusable universe definitions');
  await page.locator('#universe-select').selectOption('default-universe');
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'shared.spaceuniverse', mimeType: 'application/gzip', buffer: bytes });
  await expect(page.locator('#lab-status')).toContainText('Loaded universe Terrain import');
  await expect(page.locator('#universe-select')).toHaveValue('terrain-import');
  await page.locator('#game-name').fill('Planet pack'); await page.locator('#lab-save').click();
  await expect(page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Planet pack', exact: true }) })).toBeVisible();
});

test('invalid compressed universe data keeps the old world and names the problem', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'setup');
  const before = JSON.parse(await page.locator('#debug').textContent() || '{}').world;
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'broken.spaceuniverse', mimeType: 'application/gzip', buffer: gzipSync(JSON.stringify({ ...terrainUniverse(), schemaVersion: 999 })) });
  await expect(page.locator('#lab-status')).toContainText('Unsupported universe schemaVersion');
  await expect(page.locator('#universe-select')).toHaveValue('default-universe');
  expect(JSON.parse(await page.locator('#debug').textContent() || '{}').world).toBe(before);
});

test('standalone Spacelab imports and exports compressed planets without a network', async ({ page, context }, testInfo) => {
  const file = testInfo.outputPath('universe-workshop.html'); await copyFile(resolve('dist/space-lab-offline.html'), file);
  await disableNetwork(context); await page.goto(pathToFileURL(file).href); await openPanel(page, 'setup');
  await page.locator('#universe-file').setInputFiles({ name: 'offline.spaceuniverse', mimeType: 'application/gzip', buffer: gzipSync(JSON.stringify(terrainUniverse())) });
  await expect(page.locator('#universe-select')).toHaveValue('terrain-import');
  const pending = page.waitForEvent('download'); await page.locator('#export-universe').click();
  const restored = await (await packageContracts()).decodeDataFile(new Uint8Array(await readFile(await (await pending).path())), 'universe') as any;
  expect(primus(restored).surface).toEqual(surface);
});
