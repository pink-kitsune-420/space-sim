import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZip } from '../../packages/game-library/src/zip';
import { gunzipSync } from 'node:zlib';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { disableNetwork } from '../helpers/offline';
import fixture from '../fixtures/world-save-v1.json' with { type: 'json' };

test.beforeEach(async ({ page }) => { await useCanvas(page); });

async function exportProgress(page: Page) {
  await openPanel(page, 'fleet');
  const pending = page.waitForEvent('download');
  await page.locator('#save-world').click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const files = await readZip(new Uint8Array(bytes));
  const json = (path: string) => JSON.parse(new TextDecoder().decode(files.get(path)!));
  const descriptor = json('save.json');
  const saved = { ...json('state/universe.json'), universe: json('data/universe.json'),
    ships: descriptor.ships.flatMap((path: string) => json(path)) } as typeof fixture & { gameId: string };
  return { bytes, saved };
}
async function loadProgress(page: Page, bytes: Buffer) {
  await openPanel(page, 'fleet');
  await page.locator('#world-file').setInputFiles({ name: 'progress.spaceuniverse', mimeType: 'application/zip', buffer: bytes });
}
async function switchGame(page: Page, id: string, name: string) {
  await openPanel(page, 'library');
  const libraryId = id === 'builtin.space-sim' ? 'builtin' : id;
  await page.locator(`.game-card[data-game="${libraryId}"]`).getByRole('button', { name: 'Play · new world' }).click();
  await expect(page.locator('#active-game')).toHaveText(name);
  await expect(page.locator('#status')).toHaveText('LANDED');
}
async function rejectProgress(page: Page, bytes: Buffer, owner: string) {
  const alert = page.waitForEvent('dialog');
  await loadProgress(page, bytes);
  const dialog = await alert;
  expect(dialog.message()).toContain(owner);
  await dialog.accept();
}

test('Classic legacy progress and successor progress stay separate through Library switching', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#active-game')).toHaveText('Space Sim Classic');
  await loadProgress(page, Buffer.from(JSON.stringify(fixture)));
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const classic = await exportProgress(page);
  expect(classic.saved.gameId).toBe('builtin.space-sim');
  expect(classic.saved.worldId).toBe(fixture.worldId);
  expect(classic.saved.tick).toBe(fixture.tick);
  expect(classic.saved.ships.map(ship => ship.id)).toEqual(fixture.ships.map(ship => ship.id));
  await openPanel(page, 'tools');
  await page.locator('.planet-designer summary').click();
  await page.locator('#planet-designer .designer-presets button').filter({ hasText: 'Ocean world' }).click();
  await page.locator('#planet-designer button.primary').click();
  await page.locator('#designer-name').fill('Shared design');
  await page.locator('#planet-designer').getByRole('button', { name: 'Save design', exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem('space-sim:throw-cheat:v1', 'true');
    localStorage.setItem('space-sim:activation-throttle:v1', '[0.8]');
    localStorage.setItem('space-sim:run-in-background:v1', 'true');
  });
  await switchGame(page, 'builtin.space-sim-successor', 'Space Sim Tiles Demo');
  await expect(page).toHaveURL(/game=builtin.space-sim-successor/);
  expect(await page.locator('#throw-cheat-toggle').isChecked()).toBe(false);
  expect(await page.locator('#run-in-background').isChecked()).toBe(true);
  await openPanel(page, 'tools');
  await page.locator('.planet-designer summary').click();
  await expect(page.locator('#planet-designer .designer-library')).toContainText('Shared design');
  await expect(page.locator('#planet-designer .designer-status')).toContainText('shows its own look');
  const successor = await exportProgress(page);
  expect(successor.saved.gameId).toBe('builtin.space-sim-successor');
  expect(successor.saved.universe.id).toBe('successor-field-v2');
  expect(successor.saved.worldId).not.toBe(classic.saved.worldId);
  await rejectProgress(page, classic.bytes, 'builtin.space-sim');
  await rejectProgress(page, Buffer.from(JSON.stringify(fixture)), 'Space Sim Classic');
  expect((await exportProgress(page)).saved.worldId).toBe(successor.saved.worldId);
  await switchGame(page, 'builtin.space-sim', 'Space Sim Classic');
  expect(await page.locator('#throw-cheat-toggle').isChecked()).toBe(true);
  await openPanel(page, 'tools');
  await page.locator('.planet-designer summary').click();
  await expect(page.locator('#planet-designer .designer-status')).toContainText('shows your design');
  await rejectProgress(page, successor.bytes, 'builtin.space-sim-successor');
  await loadProgress(page, classic.bytes);
  await expect(page.locator('#status')).toHaveText('PAUSED');
  expect((await exportProgress(page)).saved.worldId).toBe(classic.saved.worldId);
  await switchGame(page, 'builtin.space-sim-successor', 'Space Sim Tiles Demo');
  await loadProgress(page, successor.bytes);
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const resumed = await exportProgress(page);
  expect(resumed.saved.worldId).toBe(successor.saved.worldId);
  expect(resumed.saved.tick).toBe(successor.saved.tick);
  expect(resumed.saved.ships).toEqual(successor.saved.ships);
  expect(errors).toEqual([]);
});

for (const [alias, name] of [['space-sim', 'Space Sim Classic'], ['space-sim-successor', 'Space Sim Tiles Demo']]) {
  test(`${name} launches and flies from the offline file with networking disabled`, async ({ page, context }) => {
    const network: string[] = [], errors: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await disableNetwork(context);
    await page.goto(`${pathToFileURL(resolve('dist/space-lab-offline.html')).href}?game=${alias}`);
    await expect(page.locator('#active-game')).toHaveText(name!);
    await expect(page.locator('#status')).toHaveText('LANDED');
    await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
    await page.keyboard.down('Space');
    await expect(page.locator('#status')).toHaveText('FLYING');
    await page.keyboard.up('Space');
    const archive = JSON.parse(gunzipSync(await readFile(resolve(`dist/${alias}.spacegame`))).toString());
    expect(archive.info.id).toBe(`builtin.${alias}`);
    expect(network).toEqual([]);
    expect(errors).toEqual([]);
  });
}
