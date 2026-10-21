import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPortableModule, newModule, packageContracts } from '../../packages/module-tools/package.mjs';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

let directory: string, moduleBytes: Buffer;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'phase2-device-browser-'));
  const source = join(directory, 'source'); await newModule('test.device', source);
  const path = join(source, 'module.json'), descriptor = JSON.parse(await readFile(path, 'utf8'));
  const { authority: _authority, ...fields } = descriptor.manifest;
  descriptor.manifest = { ...fields, format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2', tier: 'platform',
    conflicts: [], requires: [{ name: 'core.ui', version: '^1.0.0' }] };
  descriptor.guides = ['docs/players/device.json'];
  await mkdir(join(source, 'docs/players'), { recursive: true });
  await writeFile(join(source, 'docs/players/device.json'), JSON.stringify({ id: 'device-help', audience: 'players', title: 'Device help', summary: 'An imported device guide', blocks: [{ type: 'paragraph', text: '<script>Only text</script>' }] }));
  await writeFile(path, JSON.stringify(descriptor));
  await writeFile(join(source, 'src/main.ts'), `import { CORE_UI, type ModuleInitializationV2 } from '@space-sim/game-api';
export default function initialize(context: ModuleInitializationV2): void {
  const ui = context.use(CORE_UI);
  context.contributeGuide({ id: 'device-help', audience: 'players', title: 'Device help', summary: 'An imported device guide', asset: 'docs/players/device.json' });
  context.contributeActions([{ id: 'test.device/ping', label: 'Ping', category: 'system', mode: 'press', defaultKeys: [] }]);
  context.contributeWindow({ name: 'device', title: '<img src=x onerror=alert(1)> Device window', controls: [
    { kind: 'text', id: 'status', text: 'Ready' }, { kind: 'button', id: 'ping', label: 'Ping device', action: 'test.device/ping' }
  ] });
  context.own(ui.onAction('test.device/ping', () => ui.set('test.device/device/status', 'Ping received')));
  ui.open('test.device/device');
}`);
  const output = join(directory, 'device.spacemod'); await buildPortableModule(path, output, { typecheck: false }); moduleBytes = await readFile(output);
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
test.describe.configure({ timeout: 60000 });
test.beforeEach(async ({ page }) => { await useCanvas(page); });

test('device package installs inertly, activates only on restart, and replays disabled after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'device.spacemod', mimeType: 'application/zip', buffer: moduleBytes });
  await expect(page.locator('#lab-status')).toContainText('Code has not run');
  await expect(page.locator('.module-windows')).toHaveCount(0);
  await expect(page.locator('.device-module-settings')).toHaveAttribute('open', '');
  await page.locator('input[data-module-id="test.device"]').check();
  await expect(page.locator('#device-module-status')).toContainText('New world required');
  await page.locator('#apply-device-modules').click();
  await expect(page.locator('#device-module-status')).toContainText('enabled for this game');
  await expect(page.locator('.module-windows img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ping device', exact: true }).click();
  await expect(page.locator('.module-windows')).toContainText('Ping received');
  await openPanel(page, 'manual');
  await page.getByRole('button', { name: 'Device help An imported device guide' }).click();
  await expect(page.locator('#manual-page')).toContainText('<script>Only text</script>');
  await expect(page.locator('#manual-page script')).toHaveCount(0);
  await openPanel(page, 'library');
  await page.locator('#game-name').fill('Portable device game');
  await page.locator('#lab-save').click();
  const card = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Portable device game', exact: true }) });
  await expect(card).toBeVisible();
  // Unsaved edits must not replace the committed selection in an export.
  await page.locator('input[data-module-id="test.device"]').uncheck();
  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export game', exact: true }).click();
  const kit = await packageContracts();
  const exported = await kit.decodePackage(new Uint8Array(await readFile(await (await download).path())));
  if (exported.format !== 'space-lab-game/1') throw new Error('Expected a game export');
  expect(exported.runtime!.plans.browser!.packages[0]!.id).toBe('test.device');
  expect(exported.runtime!.plans.node!.packages).toEqual([]);
  await page.reload(); await openPanel(page, 'library'); await page.locator('.device-module-settings > summary').click();
  await expect(page.locator('input[data-module-id="test.device"]')).not.toBeChecked();
  await expect(page.locator('.module-windows')).toHaveCount(0);
  await card.getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('#lab-status')).toContainText('Playing Portable device game');
  await page.getByRole('button', { name: 'Ping device', exact: true }).click();
  await expect(page.locator('.module-windows')).toContainText('Ping received');
  const beforeSave = JSON.parse(await page.locator('#debug').textContent() || '{}');
  await openPanel(page, 'fleet');
  const saveDownload = page.waitForEvent('download'); await page.locator('#save-world').click();
  const savedBytes = await readFile(await (await saveDownload).path());
  await page.reload(); await openPanel(page, 'fleet');
  await expect(page.locator('.module-windows')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name: 'progress.spaceuniverse', mimeType: 'application/zip', buffer: savedBytes });
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect(page.locator('#flight-message')).toContainText('Universe loaded');
  expect(JSON.parse(await page.locator('#debug').textContent() || '{}').fingerprint).toBe(beforeSave.fingerprint);
  await expect(page.locator('.module-windows')).toHaveCount(1);
  expect(errors).toEqual([]);
});
