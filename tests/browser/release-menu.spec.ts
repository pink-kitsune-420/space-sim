import { test, expect, type Page } from '@playwright/test';
import { copyFile, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { disableNetwork } from '../helpers/offline';

let ids: string[];
test.beforeAll(async () => {
  const folders = (await readdir('modules', { withFileTypes: true })).filter(entry => entry.isDirectory());
  ids = await Promise.all(folders.map(async folder => JSON.parse(await readFile(`modules/${folder.name}/module.json`, 'utf8')).manifest.id));
});
test.beforeEach(async ({ page }) => { await useCanvas(page); });
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }

test('clean menu exposes real controls and the full searchable bundled-source catalogue', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openPanel(page, 'library');
  await expect(page.locator('#plugin-overview')).toHaveText('6 simulation options · 9 display options · 0 imported plugins');
  await expect(page.locator('#presentation-list input[type="checkbox"]')).toHaveCount(9);
  await expect(page.locator('#presentation-list input[data-module="builtin.throttle"]')).toBeChecked();
  await expect(page.locator('#presentation-list input[data-module="builtin.navball"]')).toBeChecked();
  await expect(page.locator('#presentation-list')).toBeVisible();
  await expect(page.locator('.game-card').filter({ hasText: 'Space Sim' })).not.toContainText('0 code plugins');
  await page.locator('.code-module-settings > summary').click();
  await expect(page.locator('#installed-code-empty')).toBeVisible();
  await page.locator('.code-module-settings > details > summary').click();
  await expect(page.locator('#authoritative-module-list')).toContainText('Universe content');
  await expect(page.locator('#authoritative-module-list')).toContainText('Orbital flight');
  await page.locator('#browse-bundled-modules').click();
  const rows = page.locator('[data-bundled-module]');
  expect((await rows.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.bundledModule))).sort()).toEqual([...ids].sort());
  await expect(page.getByRole('status').filter({ hasText: `${ids.length} of ${ids.length} bundled packages` })).toBeVisible();
  await page.getByLabel('Find a bundled package').fill('trainer');
  await expect(page.locator('[data-bundled-module]:visible')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('authoritative');
  await expect(page.locator('[data-bundled-module]:visible')).toHaveCount(1);
  await expect(page.locator('[data-bundled-module]:visible')).toContainText(/trainer/i);
  await page.getByLabel('Find a bundled package').fill('nothing-matches-this');
  await expect(page.getByText('No bundled packages match your search.')).toBeVisible();
  await page.getByLabel('Find a bundled package').fill(''); await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('');
  await expect(page.locator('[data-bundled-module]:visible')).toHaveCount(ids.length);
  await page.locator('#library-window').screenshot({ path: testInfo.outputPath('mod-menu-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#library-window').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.locator('#library-window').screenshot({ path: testInfo.outputPath('mod-menu-mobile.png') });
  expect(errors).toEqual([]);
});

test('simulation drafts survive display changes and only apply at an explicit new world', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'library');
  const before = await debug(page);
  await page.locator('.code-module-settings > summary').click();
  await page.locator('.code-module-settings > details > summary').click();
  const example = page.locator('input[data-enable="example.steady-lift"]'); await example.check();
  await page.locator('input[data-module="builtin.telemetry"]').uncheck();
  await expect(example).toBeChecked();
  expect((await debug(page)).world).toBe(before.world);
  await page.locator('.game-card').filter({has:page.getByRole('heading',{name:'Space Sim',exact:true})}).getByRole('button',{name:'Play · new world',exact:true}).click();
  await expect(page.locator('#lab-status')).toContainText('Playing Space Sim');
  await expect(example).not.toBeChecked();
  await example.check();const beforeApply=await debug(page);
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('Profile enabled');
  await expect.poll(async () => (await debug(page)).world).not.toBe(beforeApply.world);
  await expect(example).toBeChecked();
  await page.locator('.module-settings > summary').click(); await page.locator('#reset-modules').click();
  await expect(example).not.toBeChecked();
  expect((await debug(page)).fingerprint).toBe(before.fingerprint);
});

test('offline release keeps the bundled catalogue and controls available without network access', async ({ page, context }, testInfo) => {
  const file = testInfo.outputPath('0.6.1a-offline.html'); await copyFile(resolve('dist/space-lab-offline.html'), file);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await disableNetwork(context); await page.goto(pathToFileURL(file).href); await openPanel(page, 'library');
  await expect(page.locator('#presentation-list')).toBeVisible();
  await page.locator('#bundled-module-summary').click();
  await expect(page.locator('[data-bundled-module]')).toHaveCount(ids.length);
  await page.getByLabel('Find a bundled package').fill('navball');
  await expect(page.locator('[data-bundled-module]:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
});
