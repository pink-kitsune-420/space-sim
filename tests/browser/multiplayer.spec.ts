import { openPanel } from '../helpers/workspace';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function diagnostics(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(await page.locator('#debug').textContent() || '{}') as Record<string, unknown>;
}
async function flightFocus(page: Page): Promise<void> {
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
}
/** Each pilot is a separate browser profile. A small viewport keeps two software-rendered
 * pages from starving the other tests that run in parallel. */
async function pilot(browser: Browser, url: string, name: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.goto(url);
  await openPanel(page, 'multiplayer');
  await page.locator('#player-name').fill(name);
  await page.locator('#player-name').dispatchEvent('change');
  return page;
}
const errorsOf = (page: Page): string[] => (page as Page & { errors?: string[] }).errors ?? [];

interface Server { readonly url: string; readonly child: ChildProcess; output(): string }
async function startServer(dataDir: string): Promise<Server> {
  const child = spawn(process.execPath, ['dist-server/space-sim-server.cjs', '--data', dataDir, '--port', '0', '--host', '127.0.0.1'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stderr!.on('data', chunk => { output += chunk; });
  await expect.poll(() => /http:\/\/localhost:(\d+)/.exec(output)?.[1], { timeout: 15000 }).toBeTruthy();
  return { url: `http://127.0.0.1:${/http:\/\/localhost:(\d+)/.exec(output)![1]}`, child, output: () => output };
}
async function stopServer(server: Server): Promise<void> {
  if (server.child.exitCode !== null) return;
  const exited = new Promise(done => server.child.once('exit', done));
  server.child.kill('SIGTERM');
  await exited;
}

// Two pages render at once (software WebGL in CI), so these flows get extra time.
test('a dedicated server serves the game, shows every pilot and keeps the world across restarts', async ({ browser }) => {
  test.setTimeout(150000);
  const dataDir = await mkdtemp(join(tmpdir(), 'space-sim-browser-'));
  let server = await startServer(dataDir);
  try {
    const ada = await pilot(browser, server.url, 'Ada');
    await expect(ada.locator('#join-address')).toHaveValue(server.url);
    await expect(ada.locator('#mp-status')).toContainText('comes from a Space Sim server');
    await ada.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(ada.locator('.connection')).toContainText('ONLINE');
    await expect(ada.locator('#status')).toHaveText('LANDED');
    await expect(ada.locator('#universe-select')).toBeDisabled();

    const bo = await pilot(browser, server.url, 'Bo');
    await bo.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(bo.locator('#player-list')).toContainText('Bo (you)');
    await expect(bo.locator('#player-list')).toContainText('Ada');
    await expect(ada.locator('#player-list')).toContainText('Bo');
    await expect(ada.locator('#ship-list .foreign')).toContainText('Bo');

    await flightFocus(ada);
    await ada.keyboard.down('Space');
    await expect(ada.locator('#status')).toHaveText('FLYING');
    await expect(bo.locator('#ship-list .foreign')).toContainText('FLYING');
    await ada.keyboard.up('Space');
    expect((await diagnostics(ada)).session).toBe('client');
    // Persist a stable orbit: a brief pad hop can land during shutdown/rejoin.
    await openPanel(ada, 'setup');
    await ada.locator('#preset').selectOption('planet-orbit');
    await expect.poll(async () => Number(await ada.locator('#altitude').textContent())).toBeGreaterThan(100);

    await stopServer(server);
    await expect(ada.locator('.connection')).toContainText('LOCAL FLIGHT');
    await expect(ada.locator('#mp-status')).toContainText('shutting down');
    await expect(ada.locator('#status')).toHaveText('PAUSED');
    const saved = JSON.parse(await readFile(join(dataDir, 'world.json'), 'utf8')) as { ships: Array<{ status: string }>; players: Array<{ name: string }> };
    expect(saved.players.map(p => p.name).sort()).toEqual(['Ada', 'Bo']);
    expect(saved.ships).toHaveLength(2);

    server = await startServer(dataDir);
    await openPanel(ada, 'multiplayer');
    await ada.locator('#join-address').fill(server.url);
    await ada.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(ada.locator('.connection')).toContainText('ONLINE');
    await expect(ada.locator('#player-list')).toContainText('○ Bo');
    await expect(ada.locator('#ship-list button')).toHaveCount(1);
    await expect(ada.locator('#status')).not.toHaveText('LANDED');
    expect([...errorsOf(ada), ...errorsOf(bo)]).toEqual([]);
  } finally {
    await stopServer(server);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a browser host invites a player with codes and both fly in one world', async ({ browser, browserName }) => {
  // Covered in Chromium and Firefox; WebRTC in Playwright's Linux WebKit build is unverified.
  test.skip(browserName === 'webkit', 'WebRTC data channels are not verified in Playwright WebKit');
  test.setTimeout(150000);
  const host = await pilot(browser, '/', 'Hana');
  const guest = await pilot(browser, '/', 'Gus');
  await host.getByRole('button', { name: 'Host this world' }).click();
  await expect(host.locator('.connection')).toContainText('HOSTING');
  await host.getByRole('button', { name: 'Create invite' }).click();
  await expect(host.locator('#invite-code')).toHaveValue(/^SSO1\./);
  await guest.locator('#join-address').fill(await host.locator('#invite-code').inputValue());
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guest.locator('#reply-code')).toHaveValue(/^SSA1\./);
  await host.locator('#host-reply').fill(await guest.locator('#reply-code').inputValue());
  await host.getByRole('button', { name: 'Connect player' }).click();
  await expect(guest.locator('.connection')).toContainText('ONLINE');
  await expect(host.locator('.connection')).toContainText('2 PILOTS');
  await expect(guest.locator('#player-list')).toContainText('Hana · host');
  await expect(guest.locator('#ship-list .foreign')).toContainText('Hana');

  await flightFocus(guest);
  await guest.keyboard.down('Space');
  await expect(guest.locator('#status')).toHaveText('FLYING');
  await expect(host.locator('#ship-list .foreign')).toContainText('FLYING');
  await guest.keyboard.up('Space');
  // The host is the world's owner: its pause reaches the guest.
  await openPanel(host, 'setup');
  await host.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(guest.locator('#status')).toHaveText('PAUSED');
  await openPanel(guest, 'setup');
  await expect(guest.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
  await host.getByRole('button', { name: 'Resume', exact: true }).click();
  await openPanel(host, 'multiplayer');
  await host.getByRole('button', { name: 'Stop hosting' }).click();
  await expect(guest.locator('.connection')).toContainText('LOCAL FLIGHT');
  await expect(guest.locator('#mp-status')).toContainText('stopped hosting');
  expect([...errorsOf(host), ...errorsOf(guest)]).toEqual([]);
});

test('a solo fleet keeps flying, switches ships and round-trips through a world file', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await openPanel(page, 'fleet');
  await page.getByRole('button', { name: 'Launch another' }).click();
  await expect(page.locator('#ship-list button')).toHaveCount(2);
  await expect.poll(async () => (await diagnostics(page)).ship).toBe('ship-2');
  await expect(page.locator('#ship-list button[aria-current=true]')).toContainText('Vessel 02');
  await flightFocus(page);
  await page.keyboard.press('Backslash');
  await expect.poll(async () => (await diagnostics(page)).ship).toBe('ship-1');
  const before = await diagnostics(page);
  await expect.poll(async () => (await diagnostics(page)).time).toBeGreaterThan(before.time as number);

  await openPanel(page, 'fleet');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save world' }).click();
  const file = await readFile(await (await pending).path(), 'utf8');
  const save = JSON.parse(file) as { format: string; ships: unknown[]; hostId: string; players: Array<{ id: string }> };
  expect(save.format).toBe('space-sim-world');
  expect(save.ships).toHaveLength(2);
  expect(save.players.map(p => p.id)).toEqual([save.hostId]);

  await page.getByRole('button', { name: 'Remove ship' }).click();
  await expect(page.locator('#ship-list button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove ship' })).toBeDisabled();
  await page.locator('#world-file').setInputFiles({ name: 'world.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect(page.locator('#flight-message')).toContainText('World loaded');
  await expect(page.locator('#ship-list button')).toHaveCount(2);
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('FLYING');
  expect(errors).toEqual([]);
});
