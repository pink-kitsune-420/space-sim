import { openPanel } from '../helpers/workspace';
import { test, expect, type Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { buildModule } from '../../packages/module-tools/author.mjs';
import type { CodeArtifact } from '../../packages/game-runtime/src/artifact';
import { spawn } from 'node:child_process';

// Import/export and server flows span many frames on software WebGL in CI.
test.describe.configure({ timeout: 90000 });
let force: CodeArtifact, telemetry: CodeArtifact, numerical: CodeArtifact;
test.beforeAll(async () => {
  const built = await Promise.all(['force', 'telemetry', 'numerical'].map(name =>
    buildModule(resolve(`examples/modules/${name}/module.json`), undefined, { typecheck: false })));
  force = built[0]!; telemetry = built[1]!; numerical = built[2]!;
});
const payload = (value: unknown) => ({ name: 'local.module.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function manager(page: Page) {
  await openPanel(page, 'library');
  await page.locator('.code-module-settings > summary').click();
  await page.locator('.code-module-settings > details > summary').click();
}
async function enable(page: Page, id: string) {
  await page.locator(`#authoritative-module-list input[data-enable="${id}"]`).check();
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('Profile enabled');
}

test('installed code stays inactive until enabled; settings, fork/export, dependency errors and removal preserve the right world', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await manager(page);
  await expect(page.locator('.code-module-settings')).toContainText('Do not import untrustworthy code');
  const original = await debug(page);
  await page.locator('#code-module-file').setInputFiles(payload(force));
  await expect(page.locator('#code-module-status')).toContainText('Code has not run');
  expect((await debug(page)).world).toBe(original.world);
  expect((await debug(page)).fingerprint).toBe(original.fingerprint);
  await enable(page, force.manifest.id);
  const enabled = await debug(page);
  expect(enabled.world).not.toBe(original.world);
  expect(enabled.fingerprint).not.toBe(original.fingerprint);
  expect(enabled.motionCapabilities.rails).toBe(false);
  await expect(page.locator('#save-world')).toBeEnabled();
  await expect(page.locator('#host-game')).toBeEnabled();
  const settings = page.locator('input[data-owner="local.steady-lift"][data-setting="acceleration"]');
  await settings.fill('3'); await page.locator('#apply-code-modules').click();
  await expect.poll(async () => (await debug(page)).fingerprint).not.toBe(enabled.fingerprint);
  const changed = await debug(page);
  await settings.fill('999'); await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('must be in');
  expect((await debug(page)).world).toBe(changed.world);
  await page.locator('.module-settings > summary').click();
  const download = page.waitForEvent('download'); await page.locator('#export-profile').click();
  const profile = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(profile.code).toEqual([{ id: force.manifest.id, version: force.manifest.version, digest: force.digest }]);
  expect(profile.modules).toEqual([]);
  await page.locator('#reset-modules').click();
  await page.locator('#installed-code-modules').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#installed-code-modules li')).toHaveCount(0);
  const builtin = await debug(page);
  await page.locator('#module-file').setInputFiles(payload(profile));
  await expect(page.locator('#module-status')).toContainText('Install exact code artifact');
  expect((await debug(page)).world).toBe(builtin.world);
  await page.locator('#code-module-file').setInputFiles(payload(force));
  await page.locator('#module-file').setInputFiles(payload(profile));
  await expect(page.locator('#enable-imported-profile')).toBeVisible();
  expect((await debug(page)).world).toBe(builtin.world);
  await page.locator('#enable-imported-profile').click();
  await expect.poll(async () => (await debug(page)).fingerprint).toBe(changed.fingerprint);
  await openPanel(page, 'fleet');
  const saveDownload = page.waitForEvent('download'); await page.locator('#save-world').click();
  const saved = JSON.parse(await readFile(await (await saveDownload).path(), 'utf8'));
  await page.locator('#world-file').setInputFiles(payload(saved));
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect(page.locator('#flight-message')).toContainText('World loaded');
  await expect.poll(async () => (await debug(page)).fingerprint).toBe(changed.fingerprint);
  expect(errors).toEqual([]);
});

test('copied and renamed offline HTML imports presentation and replacement code without network access', async ({ page, context }, testInfo) => {
  const file = testInfo.outputPath('renamed-with-local-modules.html');
  await copyFile(resolve('dist/space-sim-offline.html'), file);
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true); await page.goto(pathToFileURL(file).href); await manager(page);
  const original = await debug(page);
  await page.locator('#code-module-file').setInputFiles(payload(telemetry));
  await expect(page.locator('#code-module-status')).toContainText('Code has not run');
  const displaySettings = page.locator('.presentation-settings');
  if (!await displaySettings.evaluate(el => (el as HTMLDetailsElement).open)) await displaySettings.locator('summary').click({ position: { x: 8, y: 8 } });
  await expect(displaySettings).toHaveAttribute('open', '');
  await page.locator('#presentation-list input[data-module="local.telemetry"]').check();
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toContainText('Time');
  expect((await debug(page)).fingerprint).toBe(original.fingerprint);
  expect((await debug(page)).world).toBe(original.world);
  await page.locator('#presentation-list input[data-module="local.telemetry"]').uncheck();
  await expect(page.locator('[data-panel="local.telemetry/telemetry"]')).toHaveCount(0);
  await page.locator('#installed-code-modules').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.locator('#code-module-file').setInputFiles(payload(numerical));
  await enable(page, numerical.manifest.id);
  expect((await debug(page)).motionCapabilities.analyticCoast).toBe(false);
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('Space'); await expect(page.locator('#status')).toHaveText('FLYING'); await page.keyboard.up('Space');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await debug(page)).samples, { timeout: 15000 }).toBeGreaterThan(4);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('a browser with the same locally enabled artifact can join its dedicated server', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'space-sim-code-browser-'));
  await mkdir(join(directory, 'modules'));
  await writeFile(join(directory, 'modules', 'force.module.json'), JSON.stringify(force));
  await page.goto('/'); await manager(page);
  await page.locator('#code-module-file').setInputFiles(payload(force)); await enable(page, force.manifest.id);
  await page.locator('.module-settings > summary').click();
  const download = page.waitForEvent('download'); await page.locator('#export-profile').click();
  const profile = await readFile(await (await download).path(), 'utf8');
  await writeFile(join(directory, 'profile.json'), profile);
  const child = spawn(process.execPath, ['dist-server/space-sim-server.cjs', '--data', directory, '--host', '127.0.0.1', '--port', '0',
    '--module-directory', 'modules', '--module-profile', 'profile.json'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  try {
    await expect.poll(() => /http:\/\/localhost:(\d+)/.exec(output)?.[1], { timeout: 15000 }).toBeTruthy();
    const port = /http:\/\/localhost:(\d+)/.exec(output)![1];
    const fingerprint = (await debug(page)).fingerprint;
    await openPanel(page, 'multiplayer');
    await page.locator('#join-address').fill(`ws://127.0.0.1:${port}`);
    await page.locator('#join-game').click();
    await expect(page.locator('#mp-status')).toContainText('Joined');
    expect((await debug(page)).fingerprint).toBe(fingerprint);
    await openPanel(page, 'library');
    await expect(page.locator('#load-module')).toBeDisabled();
    await expect(page.locator('.game-card').getByRole('button', { name: 'Play · new world', exact: true })).toBeDisabled();
    await expect(page.locator('#lab-save')).toBeDisabled();
    await expect(page.locator('#lab-export')).toBeDisabled();
  } finally {
    if (child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill('SIGTERM'); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
