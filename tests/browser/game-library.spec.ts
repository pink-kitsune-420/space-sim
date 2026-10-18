import { useCanvas } from '../helpers/canvas';
import { openPanel, closePanel } from '../helpers/workspace';
import { test, expect, type Page } from '@playwright/test';
import { copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildModule } from '../../packages/module-tools/author.mjs';
import { artifactDigest, type CodeArtifact } from '../../packages/game-runtime/src/artifact';
import type { GamePackage, LabPackage } from '../../packages/game-library/src/archive';
import builtin from '../../games/space-sim/game.json' with { type: 'json' };
import gentle from '../../examples/modules/gentle-flight.json' with { type: 'json' };
import type { DataModule } from '../../packages/game-api/src/index';
import { packageContracts } from '../../packages/module-tools/package.mjs';
import { gzipSync } from 'node:zlib';
const encodePackage = async (value: LabPackage) => gzipSync(JSON.stringify(value));
const decodePackage = async (value: Uint8Array): Promise<LabPackage> => (await packageContracts()).decodePackage(new Uint8Array(value));

test.describe.configure({ timeout: 90000 });
let force: CodeArtifact, telemetry: CodeArtifact;
test.beforeAll(async () => {
  const built = await Promise.all(['force', 'telemetry'].map(name => buildModule(resolve(`examples/modules/${name}/module.json`), undefined, { typecheck: false })));
  force = built[0]!; telemetry = built[1]!;
});
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function importPackage(page: Page, value: LabPackage) {
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'test.spacegame', mimeType: 'application/gzip', buffer: Buffer.from(await encodePackage(value)) });
}
function codeGame(name = 'Code flight', artifact = force): GamePackage {
  const profile = builtin.bundle.profile, display = builtin.bundle.presentation;
  return { ...builtin, info: { ...builtin.info, id: 'local.code-game', name }, plugins: [artifact, telemetry], bundle: {
    ...builtin.bundle,
    profile: { ...profile, id: 'local.pack', modules: [...profile.modules, { id: artifact.manifest.id, version: artifact.manifest.version }] },
    presentation: { ...display, modules: [...display.modules, { id: telemetry.manifest.id, version: telemetry.manifest.version }] },
    code: [artifact, telemetry].map(a => ({ id: a.manifest.id, version: a.manifest.version, digest: a.digest })),
  } } as GamePackage;
}
const card = (page: Page, name: string) => page.locator('.game-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
async function play(page: Page, name: string) {
  await openPanel(page, 'library');
  await card(page, name).getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('#lab-status')).toContainText(`Playing ${name}`);
}

test.beforeEach(async ({ page }) => { await useCanvas(page); });

test('a data plugin installs inertly, applies with code controls, and saves/exports an organized persistent game', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await openPanel(page, 'library');
  await expect(card(page, 'Space Sim')).toBeVisible();
  const before = await debug(page);
  await importPackage(page, { format: 'space-lab-plugin/1', info: { id: 'local.gentle-pack', name: 'Gentle pack', description: '' }, data: [gentle as DataModule], code: [] });
  await expect(page.locator('#lab-status')).toContainText('Installed Gentle pack');
  expect((await debug(page)).world).toBe(before.world);
  await page.locator('.code-module-settings > details > summary').click();
  await page.locator('#authoritative-module-list input[data-enable="example.gentle-flight"]').check();
  await page.locator('#apply-code-modules').click();
  await expect.poll(async () => (await debug(page)).vehicle?.acceleration).toBe(75);
  await page.locator('#game-name').fill('Gentle explorer'); await page.locator('#game-folder').fill('Experiments');
  await page.locator('#lab-save').click();
  await expect(card(page, 'Gentle explorer')).toContainText('Experiments');
  await page.locator('#library-window').screenshot({ path: testInfo.outputPath('space-lab-library.png') });
  await closePanel(page);
  await page.screenshot({ path: testInfo.outputPath('space-lab-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('space-lab-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPanel(page, 'library');
  const download = page.waitForEvent('download'); await card(page, 'Gentle explorer').getByRole('button', { name: 'Export game', exact: true }).click();
  const exported = await decodePackage(new Uint8Array(await readFile(await (await download).path())));
  expect(exported.format).toBe('space-lab-game/1');
  if (exported.format === 'space-lab-game/1') expect(exported.bundle.modules).toEqual([gentle]);
  await card(page, 'Gentle explorer').getByRole('button', { name: '☆ Favorite', exact: true }).click();
  await page.locator('#game-favorites').check(); await expect(page.locator('.game-card')).toHaveCount(1);
  await page.locator('#game-search').fill('missing'); await expect(page.locator('#game-empty')).toBeVisible();
  await page.reload();
  await openPanel(page, 'library');
  // Firefox restores form values across reloads, including the search filter.
  await page.locator('#game-search').fill('');
  await expect(card(page, 'Gentle explorer')).toContainText('Experiments');
  await expect(card(page, 'Gentle explorer').getByRole('button', { name: '★ Favorite', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card(page, 'Gentle explorer').getByText('Organize', { exact: true }).click();
  await card(page, 'Gentle explorer').getByLabel('Game name').fill('Gentle remix');
  await card(page, 'Gentle explorer').getByLabel('Collection').fill('Shared');
  await card(page, 'Gentle explorer').getByRole('button', { name: 'Save details', exact: true }).click();
  await expect(card(page, 'Gentle remix')).toContainText('Shared');
  await page.reload();
  await openPanel(page, 'library');
  await expect(card(page, 'Gentle remix')).toContainText('Shared');
  await expect.poll(async () => (await debug(page)).vehicle?.acceleration).toBe(125);
  await play(page, 'Gentle remix');
  await expect.poll(async () => (await debug(page)).vehicle?.acceleration).toBe(75);
  const world = (await debug(page)).world;
  await card(page, 'Gentle remix').getByText('Organize', { exact: true }).click();
  await card(page, 'Gentle remix').getByRole('button', { name: 'Remove from library', exact: true }).click();
  await expect(card(page, 'Gentle remix')).toHaveCount(0);
  expect((await debug(page)).world).toBe(world);
  expect(errors).toEqual([]);
});

test('self-contained code games switch versions, keep presentation settings, and reject broken candidates without replacing the world', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const original = await debug(page);
  const first = codeGame();
  await importPackage(page, first);
  await expect(page.locator('#lab-status')).toContainText('Added Code flight');
  expect((await debug(page)).world).toBe(original.world);
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toHaveCount(0);
  await play(page, 'Code flight');
  await expect.poll(async () => (await debug(page)).fingerprint).not.toBe(original.fingerprint);
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toContainText('Time');
  const active = await debug(page);
  const body = { ...force, manifest: { ...force.manifest, version: '0.2.0' } };
  const replacement = { ...body, digest: artifactDigest((({ digest: _, ...rest }) => rest)(body)) };
  await importPackage(page, codeGame('Version two', replacement)); await play(page, 'Version two');
  await expect.poll(async () => (await debug(page)).fingerprint).not.toBe(active.fingerprint);
  await play(page, 'Code flight');
  await expect.poll(async () => (await debug(page)).fingerprint).toBe(active.fingerprint);
  const broken = codeGame('Broken flight');
  const invalid = { ...broken, bundle: { ...broken.bundle, selection: { universe: 'missing.universe/world' } } };
  await importPackage(page, invalid);
  const beforeFailure = await debug(page);
  await card(page, 'Broken flight').getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('#lab-status')).toContainText('unknown universe');
  expect((await debug(page)).world).toBe(beforeFailure.world);
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toContainText('Time');
  await play(page, 'Space Sim');
  await expect.poll(async () => (await debug(page)).fingerprint).toBe(original.fingerprint);
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toHaveCount(0);
  await page.reload();
  await openPanel(page, 'library');
  await expect(card(page, 'Code flight')).toBeVisible();
  expect((await debug(page)).fingerprint).toBe(original.fingerprint);
  await play(page, 'Code flight');
  await expect.poll(async () => (await debug(page)).fingerprint).toBe(active.fingerprint);
  expect(errors).toEqual([]);
});

test('presentation initialization failure restores the old registry and code selection', async ({ page }) => {
  await page.goto('/'); await importPackage(page, codeGame()); await play(page, 'Code flight');
  const before = await debug(page);
  const body = { ...telemetry, source: 'var SpaceSimModule = { default() { throw new Error("broken display initializer"); } };' };
  const bad = { ...body, digest: artifactDigest((({ digest: _, ...rest }) => rest)(body)) };
  const broken = codeGame('Broken display');
  await importPackage(page, { ...broken, plugins: [force, bad], bundle: { ...broken.bundle,
    code: [force, bad].map(a => ({ id: a.manifest.id, version: a.manifest.version, digest: a.digest })) } });
  await card(page, 'Broken display').getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('#lab-status')).toContainText('broken display initializer');
  expect((await debug(page)).world).toBe(before.world);
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toContainText('Time');
  await play(page, 'Space Sim'); await play(page, 'Code flight');
});

test('copied Spacelab HTML plays compressed games and exports their code without network access', async ({ page, context }, testInfo) => {
  const file = testInfo.outputPath('my-space-lab.html'); await copyFile(resolve('dist/space-lab-offline.html'), file);
  const requests: string[] = [], errors: string[] = [];
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  await context.setOffline(true); await page.goto(pathToFileURL(file).href);
  await importPackage(page, codeGame()); await play(page, 'Code flight');
  await page.locator('#game-name').fill('Shared offline flight');
  const download = page.waitForEvent('download'); await page.locator('#lab-export').click();
  const exported = await decodePackage(new Uint8Array(await readFile(await (await download).path())));
  expect(exported.format).toBe('space-lab-game/1');
  if (exported.format === 'space-lab-game/1') expect(exported.plugins.map(p => p.digest).sort()).toEqual([force.digest, telemetry.digest].sort());
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space'); await expect(page.locator('#status')).toHaveText('FLYING'); await page.keyboard.up('Space');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('an installed content pack exposes its starting universe/system and round trips as a game', async ({ page }) => {
  const universe = JSON.parse(await readFile(resolve('games/space-sim/universes/sandbox/default/universe.json'), 'utf8'));
  universe.id = 'new-sky'; universe.name = 'New sky';
  universe.systems[0].id = 'new-system'; universe.defaultSystemId = 'new-system';
  const data = { ...gentle, manifest: { ...gentle.manifest, id: 'local.new-sky', name: 'New sky content' }, data: { universes: [{ definition: universe }] } } as DataModule;
  await page.goto('/');
  await importPackage(page, { format: 'space-lab-plugin/1', info: { id: 'local.content-pack', name: 'Content pack', description: '' }, data: [data], code: [] });
  await page.locator('.code-module-settings > details > summary').click();
  await page.locator('#plugin-universe').selectOption('local.new-sky/new-sky');
  await expect(page.locator('#plugin-system')).toHaveValue('new-system');
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('Profile enabled');
  await expect(page.locator('#universe-select')).toHaveValue('new-sky');
  await expect(page.locator('#system-select')).toHaveValue('new-system');
  await page.locator('#game-name').fill('New sky game'); await page.locator('#lab-save').click();
  await expect(card(page, 'New sky game')).toBeVisible();
  await play(page, 'Space Sim'); await play(page, 'New sky game');
  await expect(page.locator('#universe-select')).toHaveValue('new-sky');
  await expect(page.locator('#system-select')).toHaveValue('new-system');
});

test('importing a separate universe retains enabled plugins and bundles its content in a sharable game', async ({ page }) => {
  await page.goto('/'); await importPackage(page, codeGame()); await play(page, 'Code flight');
  const universe = JSON.parse(await readFile(resolve('games/space-sim/universes/sandbox/default/universe.json'), 'utf8'));
  universe.id = 'another-sky'; universe.name = 'Another sky';
  await page.locator('#lab-file').setInputFiles({ name: 'another.spaceuniverse', mimeType: 'application/gzip', buffer: gzipSync(JSON.stringify(universe)) });
  await expect(page.locator('#lab-status')).toContainText('Loaded universe Another sky');
  await expect(page.locator('#universe-select')).toHaveValue('another-sky');
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toContainText('Time');
  expect((await debug(page)).motionCapabilities.analyticCoast).toBe(false);
  const pending = page.waitForEvent('download'); await page.locator('#lab-export').click();
  const game = await decodePackage(new Uint8Array(await readFile(await (await pending).path())));
  expect(game.format).toBe('space-lab-game/1');
  if (game.format === 'space-lab-game/1') {
    expect(game.plugins).toHaveLength(2);
    expect(game.bundle.selection.universe).toBe('local.imported-universe/another-sky');
    expect(game.bundle.modules[0]!.data.universes?.[0]?.definition.id).toBe('another-sky');
  }
});
