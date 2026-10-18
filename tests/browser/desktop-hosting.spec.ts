import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

async function diagnostics(page: Page) {
  return JSON.parse(await page.locator('#debug').textContent() || '{}');
}

test('desktop hosts the loaded save over LAN and keeps that world when stopped', async ({ page, browser }) => {
  test.setTimeout(120000);
  // Run this same flow against the packaged executable when validating a release.
  const executable = process.env.SPACE_SIM_DESKTOP_EXE;
  const child = spawn(executable ?? process.execPath,
    [...(executable ? [] : [resolve('dist-desktop/space-sim-desktop.cjs')]), '--no-open', '--port', '0'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', data => { output += data; });
  child.stderr!.on('data', data => { output += data; });
  child.on('error', error => { output += error.message; });
  const guestContext = await browser.newContext();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
    }, { timeout: 15000 }).toBeTruthy();
    const desktop = /http:\/\/127\.0\.0\.1:\d+/.exec(output)![0];
    await useCanvas(page);
    await page.goto(desktop);
    await openPanel(page, 'setup');
    await page.locator('#preset').selectOption('planet-orbit');
    await openPanel(page, 'fleet');
    await page.getByRole('button', { name: 'Launch another', exact: true }).click();
    await expect(page.locator('#ship-list button')).toHaveCount(2);
    const download = page.waitForEvent('download');
    await page.locator('#save-world').click();
    const bytes = await readFile(await (await download).path());
    await page.getByRole('button', { name: 'Remove ship', exact: true }).click();
    await expect(page.locator('#ship-list button')).toHaveCount(1);
    await page.locator('#world-file').setInputFiles({ name: 'loaded.spaceuniverse', mimeType: 'application/gzip', buffer: bytes });
    await expect(page.locator('#ship-list button')).toHaveCount(2);
    const loaded = await diagnostics(page);
    await openPanel(page, 'settings');
    await page.locator('#players-toggle').click();
    await page.locator('.split-count [data-count="2"]').click();
    await expect.poll(async () => (await diagnostics(page)).localPlayers.count).toBe(2);
    await page.locator('#controls-close').click();
    const beforeHosting = await diagnostics(page);
    await openPanel(page, 'multiplayer');
    await page.locator('#player-name').fill('Desktop host');
    await page.getByRole('button', { name: 'Host on this computer', exact: true }).click();
    await expect(page.locator('#mp-status')).toContainText('Hosting your loaded world');
    await expect(page.locator('.connection')).toContainText('HOSTING');
    await expect(page.locator('#create-invite')).toBeHidden();
    await expect.poll(async () => (await diagnostics(page)).world).toBe(loaded.world);
    await expect.poll(async () => (await diagnostics(page)).localPlayers.count).toBe(2);
    await expect.poll(async () => (await diagnostics(page)).time).toBeGreaterThan(loaded.time);
    const link = await page.locator('#mp-computer-links a').first().getAttribute('href');
    const guestUrl = new URL(link!);
    const guest = await guestContext.newPage();
    guest.on('pageerror', error => errors.push(error.message));
    await useCanvas(guest);
    await guest.goto(guestUrl.href);
    await expect(guest.locator('.connection')).toContainText('ONLINE');
    await expect(guest.locator('#host-computer')).toBeHidden();
    await expect(guest.locator('meta[name="space-sim-desktop"]')).toHaveCount(0);
    await expect.poll(async () => (await diagnostics(guest)).world).toBe(loaded.world);
    await expect.poll(async () => (await diagnostics(guest)).ships).toBe(beforeHosting.ships + 1);
    await expect(page.locator('#player-list')).toContainText('Desktop host (you)');

    // A page served to guests cannot take desktop control, even if given the token.
    const token = await page.locator('meta[name="space-sim-desktop"]').getAttribute('content');
    const controlUrl = `${desktop.replace('http:', 'ws:')}/desktop/host?token=${token}`;
    const rejected = await guest.evaluate(url => new Promise<boolean>(resolve => {
      const socket = new WebSocket(url);
      socket.onopen = () => { socket.close(); resolve(false); };
      socket.onerror = () => resolve(true);
    }), controlUrl);
    expect(rejected).toBe(true);
    // A second local window also cannot replace the active host.
    expect(await page.evaluate(url => new Promise<boolean>(resolve => {
      const socket = new WebSocket(url);
      socket.onopen = () => { socket.close(); resolve(false); };
      socket.onerror = () => resolve(true);
    }), controlUrl)).toBe(true);

    await page.bringToFront();
    await page.locator('#stop-hosting').click();
    await expect(guest.locator('#mp-status')).toContainText('host stopped hosting');
    await expect.poll(async () => (await diagnostics(page)).session).toBe('local');
    const stopped = await diagnostics(page);
    expect(stopped.world).toBe(loaded.world);
    expect(stopped.ships).toBe(beforeHosting.ships + 1);
    expect(stopped.localPlayers.count).toBe(2);
    expect(stopped.ship).toBe(beforeHosting.ship);
    expect(stopped.time).toBeGreaterThan(loaded.time);
    await page.locator('#host-computer').click();
    await expect(page.locator('#mp-status')).toContainText('Hosting your loaded world');
    await expect.poll(async () => (await diagnostics(page)).world).toBe(loaded.world);
    const restartedLink = await page.locator('#mp-computer-links a').first().getAttribute('href');
    await guest.bringToFront();
    await guest.goto(restartedLink!);
    await expect(guest.locator('.connection')).toContainText('ONLINE');
    // Reloading the owner window tears down the LAN listener and all bridges.
    await page.bringToFront();
    await page.reload();
    await guest.bringToFront();
    await expect.poll(async () => (await diagnostics(guest)).session).toBe('local');
    await expect.poll(async () => guest.evaluate(url => new Promise<boolean>(resolve => {
      const socket = new WebSocket(url);
      socket.onopen = () => { socket.close(); resolve(false); };
      socket.onerror = () => resolve(true);
    }), `${new URL(restartedLink!).origin.replace('http:', 'ws:')}/ws`)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(done => child.once('exit', () => done()));
      child.kill('SIGTERM');
      await exited;
    }
  }
});
