import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { trainerGameArchives } from '../helpers/trainer-game';
import { TRAINER_VEHICLE_ID } from '../../packages/game-api/src/vehicles';
import { useCanvas } from '../helpers/canvas';
import { closePanel, openPanel } from '../helpers/workspace';

let directory: string, games: Awaited<ReturnType<typeof trainerGameArchives>>;
test.beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'trainer-game-')); games = await trainerGameArchives(directory); });
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { await useCanvas(page); });
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function play(page: Page, game: (typeof games)[number]) {
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'trainer.spacegame', mimeType: 'application/zip', buffer: game.bytes });
  await expect(page.locator('#lab-status')).toContainText(`Added ${game.name}`);
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: game.name, exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(page.locator('#lab-status')).toContainText(`Playing ${game.name}`);
  await expect.poll(async () => (await debug(page)).vehicleId).toBe(TRAINER_VEHICLE_ID);
}

test('installed trainer game selects real artwork, supports omission and a source-edited creator fork without changing authority', async ({ page }) => {
  await page.goto('/');
  let fingerprint: string | undefined;
  for (const game of games) {
    await play(page, game);
    await expect.poll(async () => !!(await debug(page)).vehicleArtwork).toBe(game.artwork);
    const state = await debug(page);
    if (!fingerprint) fingerprint = state.fingerprint;
    expect(state.fingerprint).toBe(fingerprint);
    if (game.fork) expect(state.vehicleArtwork.hull[0]).toEqual({ x: 12, y: 5 });
    else if (game.artwork) expect(state.vehicleArtwork.hull[0]).toEqual({ x: 11, y: 0 });
    await closePanel(page); await page.locator('#flight-view').focus();
    await page.keyboard.down('Space'); await expect(page.locator('#status')).toHaveText('FLYING'); await page.keyboard.up('Space');
  }
  await page.screenshot({ path: `test-results/creator-trainer-${test.info().project.name}.png` });
});

test('trainer package identity and selected artwork survive universe save/load', async ({ page }) => {
  await page.goto('/'); await play(page, games[2]!);
  await openPanel(page, 'fleet');
  const pending = page.waitForEvent('download'); await page.locator('#save-world').click();
  const saved = await readFile(await (await pending).path());
  const fingerprint = (await debug(page)).fingerprint;
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name: 'trainer.spaceuniverse', mimeType: 'application/zip', buffer: saved });
  await expect(page.locator('#flight-message')).toContainText('Universe loaded');
  const loaded = await debug(page);
  expect(loaded.fingerprint).toBe(fingerprint);
  expect(loaded.vehicleId).toBe(TRAINER_VEHICLE_ID);
  expect(loaded.vehicleArtwork.hull[0]).toEqual({ x: 12, y: 5 });
});
