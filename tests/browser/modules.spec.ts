import { disableNetwork } from '../helpers/offline';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { test, expect, type Page } from '@playwright/test';
import { copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import gentle from '../../examples/modules/gentle-flight.json' with { type: 'json' };

test.beforeEach(async ({ page }) => { await useCanvas(page); });

const payload = (value: unknown) => ({ name: 'module.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function openModules(page: Page) {
  await openPanel(page, 'library');
  await page.locator('details').filter({ has: page.locator('#module-name') }).locator('summary').click();
}

test('data imports start a new solo world, round trip the profile and keep the previous world after rejection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await openModules(page);
  await expect.poll(async () => (await debug(page)).world).toBeTruthy();
  const original = (await debug(page)).world;
  await page.locator('#module-file').setInputFiles(payload(gentle));
  await expect(page.locator('#module-name')).toHaveText('Gentle flight');
  await expect(page.locator('#module-status')).toContainText('new world');
  await expect(page.locator('#save-world')).toBeEnabled();
  await expect(page.locator('#host-game')).toBeEnabled();
  await expect.poll(async () => (await debug(page)).world).not.toBe(original);
  await expect.poll(async () => (await debug(page)).vehicle).toEqual({ acceleration: 75, turnRate: .6, initialThrottle: .5 });
  const active = (await debug(page)).world;
  await page.locator('#module-file').setInputFiles(payload({ ...gentle, data: { vehicle: { override: true, settings: { turnRate: -2 } } } }));
  await expect(page.locator('#module-status')).toContainText('example.gentle-flight setting turnRate');
  expect((await debug(page)).world).toBe(active);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-profile').click();
  const exported = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
  expect(exported.modules[0]).toEqual(gentle);
  await page.locator('#reset-modules').click();
  await expect(page.locator('#module-name')).toHaveText('Built-in default');
  await expect(page.locator('#save-world')).toBeEnabled();
  const invalid = { ...exported, profile: { ...exported.profile,
    modules: exported.profile.modules.filter((m: { id: string }) => m.id !== 'builtin.motion') } };
  await page.locator('#module-file').setInputFiles(payload(invalid));
  await expect(page.locator('#module-status')).toContainText('missing dependency builtin.motion');
  await expect(page.locator('#module-name')).toHaveText('Built-in default');
  await page.locator('#module-file').setInputFiles(payload(exported));
  await expect(page.locator('#module-name')).toHaveText('Gentle flight');
  expect(errors).toEqual([]);
});

test('a copied offline HTML imports data and flies with networking disabled', async ({ page, context }, testInfo) => {
  const path = testInfo.outputPath('renamed-game.html');
  await copyFile(resolve('dist/space-lab-offline.html'), path);
  const requests: string[] = [], errors: string[] = [];
  page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await disableNetwork(context);
  await page.goto(pathToFileURL(path).href);
  await openModules(page);
  await page.locator('#module-file').setInputFiles(payload(gentle));
  await expect(page.locator('#module-name')).toHaveText('Gentle flight');
  // At half throttle the gentler engine cannot lift off; full throttle can.
  await openPanel(page, 'ship');
  await page.locator('#throttle').fill('100');
  await page.locator('#throttle').dispatchEvent('input');
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect.poll(async () => Number(await page.locator('#altitude').textContent())).toBeGreaterThan(1);
  await page.keyboard.up('Space');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await debug(page)).predictionEnd, { timeout: 15000 }).toBe('closed');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('legacy universe imports export as portable module profiles and data universes select their own default system', async ({ page }) => {
  await page.goto('/');
  await openModules(page);
  const universe = JSON.parse(await readFile(resolve('games/space-sim/universes/sandbox/default/universe.json'), 'utf8'));
  universe.id = 'portable-universe'; universe.name = 'Portable universe';
  await page.locator('#universe-file').setInputFiles(payload(universe));
  await expect(page.locator('#universe-select')).toHaveValue('portable-universe');
  await openPanel(page, 'library');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-profile').click();
  const bundle = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
  expect(bundle.modules[0].manifest.id).toBe('local.imported-universe');
  await page.locator('#reset-modules').click();
  await page.locator('#module-file').setInputFiles(payload(bundle));
  await expect(page.locator('#universe-select')).toHaveValue('portable-universe');
  await expect(page.locator('#module-status')).toContainText('new world');
  const differentSystem = structuredClone(universe);
  differentSystem.systems = [differentSystem.systems[0]];
  differentSystem.systems[0].id = 'new-system'; differentSystem.defaultSystemId = 'new-system';
  const module = { ...gentle, data: { universes: [{ definition: differentSystem }] } };
  await page.locator('#module-file').setInputFiles(payload(module));
  await expect(page.locator('#system-select')).toHaveValue('new-system');
  await expect(page.locator('#module-status')).toContainText('loaded');
  // A portable profile resolves against built-ins and its own data, even if the
  // active legacy universe replaced built-in IDs with different flight settings.
  const shadow = JSON.parse(await readFile(resolve('games/space-sim/universes/sandbox/default/universe.json'), 'utf8'));
  shadow.systems[0].vehicleDefaults = { acceleration: 333 };
  await page.locator('#universe-file').setInputFiles(payload(shadow));
  await expect.poll(async () => (await debug(page)).vehicle?.acceleration).toBe(333);
  await page.locator('#module-file').setInputFiles(payload({ format: 'space-sim-module-profile/1', modules: [],
    profile: { format: 'space-sim-profile/1', id: 'builtin.default', modules: [
      { id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }],
      providers: { content: 'builtin.content', motion: 'builtin.motion' }, settings: {} },
    selection: { universe: 'builtin.content/default-universe' } }));
  await expect.poll(async () => (await debug(page)).vehicle?.acceleration).toBe(125);
});

for (const example of ['force', 'numerical']) test(`static ${example} motion example flies with conservative diagnostics and restarts to the default profile`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/?motion-example=${example}`);
  await openModules(page);
  await expect(page.locator('#module-name')).toHaveText(example === 'force' ? 'example.steady-lift' : 'example.numerical-flight');
  await expect(page.locator('#save-world')).toBeDisabled();
  await expect(page.locator('#host-game')).toBeDisabled();
  await expect(page.locator('#host-computer')).toBeDisabled();
  await expect(page.locator('#debug-host-game')).toBeDisabled();
  await expect(page.locator('#periapsis')).toHaveText('Unavailable · custom motion');
  await expect(page.locator('#apoapsis')).toHaveText('Unavailable · custom motion');
  await expect.poll(async () => (await debug(page)).motionCapabilities).toEqual({
    analyticCoast: false, rails: false, orbitalDiagnostics: false, legacyCompatible: false,
  });
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect.poll(async () => Number(await page.locator('#altitude').textContent())).toBeGreaterThan(1);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await debug(page)).samples).toBeGreaterThan(4);
  expect((await debug(page)).asleep).toBe(0);
  expect((await debug(page)).orbit).toBeNull();
  const oldWorld = (await debug(page)).world;
  await openPanel(page, 'library');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-profile').click();
  const bundle = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
  await page.locator('#reset-modules').click();
  await expect(page.locator('#module-name')).toHaveText('Built-in default');
  await expect.poll(async () => (await debug(page)).world).not.toBe(oldWorld);
  await expect(page.locator('#save-world')).toBeEnabled();
  await page.locator('#module-file').setInputFiles(payload(bundle));
  await expect(page.locator('#module-name')).toHaveText(bundle.profile.id);
  await expect(page.locator('#status')).toHaveText('LANDED');
  expect(errors).toEqual([]);
});

test('a copied offline HTML runs the static force example without network access', async ({ page, context }, testInfo) => {
  const path = testInfo.outputPath('force-preview.html');
  await copyFile(resolve('dist/space-lab-offline.html'), path);
  const requests: string[] = [], errors: string[] = [];
  page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await disableNetwork(context);
  await page.goto(`${pathToFileURL(path).href}?motion-example=force`);
  await expect(page.locator('#periapsis')).toHaveText('Unavailable · custom motion');
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect.poll(async () => Number(await page.locator('#altitude').textContent())).toBeGreaterThan(1);
  await page.keyboard.up('Space');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await debug(page)).samples).toBeGreaterThan(4);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('the shared rule example predicts without consuming live state and preserves solo gates', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?motion-example=rule');
  await openModules(page);
  await expect(page.locator('#module-name')).toHaveText('example.scheduled-cutoff');
  await expect(page.locator('#save-world')).toBeDisabled();
  await expect(page.locator('#host-game')).toBeDisabled();
  await expect(page.locator('#host-computer')).toBeDisabled();
  await expect(page.locator('#debug-host-game')).toBeDisabled();
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await debug(page)).samples, { timeout: 15000 }).toBeGreaterThan(4);
  await expect(page.locator('#periapsis')).toHaveText('Unavailable · custom motion');
  expect((await debug(page)).asleep).toBe(0);
  await openPanel(page, 'library');
  await page.locator('#reset-modules').click();
  await expect(page.locator('#save-world')).toBeEnabled();
  expect(errors).toEqual([]);
});
