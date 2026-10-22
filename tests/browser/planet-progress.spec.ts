import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZip } from '../../packages/game-library/src/zip';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

const debug = async (page: Page) => JSON.parse(await page.locator('#debug').textContent() || '{}');
async function saveProgress(page: Page) {
  await openPanel(page, 'fleet');
  const pending = page.waitForEvent('download');
  await page.locator('#save-world').click();
  const download = await pending, bytes = await readFile((await download.path())!);
  const files = await readZip(new Uint8Array(bytes));
  const json = (path: string) => JSON.parse(new TextDecoder().decode(files.get(path)!));
  const descriptor = json('save.json');
  const { savedAt, ...state } = json('state/universe.json');
  expect(savedAt).toEqual(expect.any(String)); // Export timestamps advance; physical state must not.
  return { bytes, state: { ...state, players: json(descriptor.pilots), modules: json(descriptor.modules), universe: json('data/universe.json'),
    ships: descriptor.ships.flatMap((path: string) => json(path)) } };
}
async function loadProgress(page: Page, bytes: Buffer) {
  await openPanel(page, 'fleet');
  await page.locator('#world-file').setInputFiles({ name: 'generated.spaceuniverse', mimeType: 'application/zip', buffer: bytes });
}

for (const offline of [false, true]) test(`generated and legacy progress restore exact worlds through actual controls (${offline ? 'offline Canvas' : 'hosted WebGL'})`, async ({ page, context }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [], dialogs: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  if (offline) { await useCanvas(page); await context.route(/^https?:/, route => route.abort()); }
  const base = offline ? pathToFileURL(resolve('dist/space-lab-offline.html')).href : '/';
  await page.goto(base + '?game=space-sim-successor&planetPreview=1&planetPreset=already-floating');
  // Water classification is physical state established by the first simulation
  // step. Let it settle before pausing and exercising exact save restoration.
  await expect(page.locator('#status')).toHaveText('FLOATING');
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect.poll(async () => (await debug(page)).successorOverview?.mapPixels).toBeGreaterThan(100000);
  const generatedDebug = await debug(page), generated = await saveProgress(page);
  expect(generatedDebug.water).toBe('floating');
  expect(generated.state.universe.id).toBe('successor-field-v2');
  expect(generated.state.gameId).toBe('builtin.space-sim-successor');

  await page.goto(base + '?game=space-sim-successor');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const legacy = await saveProgress(page);
  expect(legacy.state.universe.id).toBe('successor-universe');
  await loadProgress(page, generated.bytes);
  await expect.poll(async () => ({ world: (await debug(page)).world, dialogs })).toEqual({ world: generated.state.worldId, dialogs: [] });
  await expect.poll(async () => (await debug(page)).successorOverview?.mapPixels).toBe(generatedDebug.successorOverview.mapPixels);
  expect((await debug(page)).fingerprint).toBe(generatedDebug.fingerprint);
  expect((await debug(page)).water).toBe('floating');
  const resumed = await saveProgress(page);
  expect(resumed.state).toEqual(generated.state);

  await loadProgress(page, legacy.bytes);
  await expect.poll(async () => (await debug(page)).world).toBe(legacy.state.worldId);
  await expect.poll(async () => (await debug(page)).successorOverview?.mapPixels).toBe(0);
  expect((await saveProgress(page)).state).toEqual(legacy.state);
  expect(dialogs).toEqual([]);

  await page.goto(base + '?game=space-sim');
  await expect(page.locator('#active-game')).toHaveText('Space Sim Classic');
  const classicWorld = (await debug(page)).world;
  await loadProgress(page, generated.bytes);
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('builtin.space-sim-successor');
  expect((await debug(page)).world).toBe(classicWorld);
  expect(errors).toEqual([]);
  await writeFile(info.outputPath('generated-progress.json'), JSON.stringify({ generated: generated.state, resumed: resumed.state,
    legacy: legacy.state, dialogs, errors }, null, 2));
});
