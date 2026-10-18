import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

for (const { withoutLocks, legacy } of [
  { withoutLocks: false, legacy: false }, { withoutLocks: true, legacy: false }, { withoutLocks: false, legacy: true },
]) test(`two offline windows join one local server as separate pilots${withoutLocks ? ' without Web Locks' : ''}${legacy ? ' in an older saved universe' : ''}`, async ({ browser }) => {
  test.setTimeout(60000);
  const dataDir = await mkdtemp(join(tmpdir(), 'space-sim-offline-mp-'));
  const server = spawn(process.execPath, ['dist-server/space-sim-server.cjs', '--data', dataDir, '--port', '0',
    ...(legacy ? ['--import', resolve('tests/fixtures/world-save-v1.json')] : [])],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  server.stdout!.on('data', chunk => { output += chunk; });
  server.stderr!.on('data', chunk => { output += chunk; });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  try {
    await expect.poll(() => /http:\/\/localhost:(\d+)/.exec(output)?.[1], { timeout: 15000 }).toBeTruthy();
    const port = /http:\/\/localhost:(\d+)/.exec(output)![1]!;
    const pages = [await context.newPage(), await context.newPage()];
    const errors: string[] = [];
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', error => errors.push(error.message));
      await useCanvas(page);
      if (withoutLocks) await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
      await page.goto(pathToFileURL(resolve('dist/space-lab-offline.html')).href);
      await openPanel(page, 'multiplayer');
      await page.getByRole('tab', { name: 'Server', exact: true }).click();
      await page.locator('#player-name').fill(`Offline pilot ${index + 1}`);
      await page.locator('#join-address').fill(`localhost:${port}`);
      await page.getByRole('button', { name: 'Join', exact: true }).click();
      await expect(page.locator('.connection')).toContainText('ONLINE');
    }
    for (const page of pages) {
      await expect(page.locator('.connection')).toContainText('ONLINE');
      await expect(page.locator('#player-list')).toContainText('Offline pilot 1');
      await expect(page.locator('#player-list')).toContainText('Offline pilot 2');
      await expect(page.locator('#player-list li')).toHaveCount(legacy ? 4 : 2);
    }
    const first = pages[0]!;
    const ship = JSON.parse(await first.locator('#debug').textContent() || '{}').ship;
    await first.reload();
    await openPanel(first, 'multiplayer');
    await first.getByRole('tab', { name: 'Server', exact: true }).click();
    await first.locator('#player-name').fill('Offline pilot 1');
    await first.locator('#join-address').fill(`localhost:${port}`);
    await first.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(first.locator('.connection')).toContainText('ONLINE');
    await expect(first.locator('#player-list li')).toHaveCount(legacy ? 4 : 2);
    await expect.poll(async () => JSON.parse(await first.locator('#debug').textContent() || '{}').ship).toBe(ship);
    await expect(pages[1]!.locator('.connection')).toContainText('ONLINE');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    if (server.exitCode === null) {
      const exited = new Promise<void>(done => server.once('exit', () => done()));
      server.kill('SIGTERM');
      await exited;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
