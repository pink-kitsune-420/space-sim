import { openPanel } from '../helpers/workspace';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function diagnostics(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(await page.locator('#debug').textContent() || '{}') as Record<string, unknown>;
}
async function flightFocus(page: Page): Promise<void> {
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
}
/** Keep real networking/session checks within their budget on software GPUs. */
async function preparePilot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, { apply(target, receiver, args) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(target, receiver, args);
    } });
  });
}
/** Each pilot is a separate browser profile. A small viewport keeps two software-rendered
 * pages from starving the other tests that run in parallel. */
async function pilot(browser: Browser, url: string, name: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await preparePilot(page);
  await page.goto(url);
  await openPanel(page, 'multiplayer');
  await page.locator('#player-name').fill(name);
  await page.locator('#player-name').dispatchEvent('change');
  return page;
}
const errorsOf = (page: Page): string[] => (page as Page & { errors?: string[] }).errors ?? [];

/** Exercise actual clipboard-paste behavior without depending on system clipboard access. */
async function paste(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).evaluate((input, value) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', value);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    // Firefox strips data passed to synthetic ClipboardEvent constructors. Supply the
    // test clipboard explicitly; real user paste events already carry native data.
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    input.dispatchEvent(event);
  }, text);
}

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
  await host.locator('#internet-play').uncheck(); // Network smoke must not depend on public STUN availability.
  await host.getByRole('button', { name: 'Create invite' }).click();
  await expect(host.locator('#invite-code')).toHaveValue(/^SSO1\./);
  await guest.getByRole('tab', { name: 'Invite code' }).click();
  await guest.locator('#invite-input').fill(await host.locator('#invite-code').inputValue());
  await guest.getByRole('button', { name: 'Make reply code' }).click();
  await expect(guest.locator('#reply-code')).toHaveValue(/^SSA1\./);
  await expect(guest.locator('#mp-reply')).toContainText('Not connected yet');
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

test('an invite link prepares the reply and pasting it connects without another button', async ({ browser, browserName }) => {
  test.skip(browserName === 'webkit', 'WebRTC data channels are not verified in Playwright WebKit');
  test.setTimeout(60000);
  const host = await pilot(browser, '/', 'Link host');
  const guest = await pilot(browser, '/', 'Link guest');
  try {
    await host.getByRole('button', { name: 'Host this world' }).click();
    await host.locator('#internet-play').uncheck();
    await host.getByRole('button', { name: 'Create invite' }).click();
    await expect(host.locator('#invite-code')).toHaveValue(/^SSO1\./);
    await host.getByRole('button', { name: 'Copy invite link' }).click();
    const link = await host.locator('#mp-share-link').inputValue();
    expect(new URL(link).hash).toMatch(/^#invite=SSO1/);
    expect(new URL(link).searchParams.has('invite')).toBe(false);
    await guest.goto(link);
    await expect(guest.locator('#reply-code')).toHaveValue(/^SSA1\./);
    expect(new URL(guest.url()).hash).toBe('');
    await paste(host, '#host-reply', await guest.locator('#reply-code').inputValue());
    await expect(guest.locator('.connection')).toContainText('ONLINE');
    await expect(host.locator('.connection')).toContainText('2 PILOTS');
    const downloading = host.waitForEvent('download');
    await host.getByRole('button', { name: 'Save connection report' }).click();
    const report = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
    expect(report.connection).toBe('connected');
    expect(report.candidates.host).toBeGreaterThan(0);
    expect(report).not.toHaveProperty('sdp');
    expect([...errorsOf(host), ...errorsOf(guest)]).toEqual([]);
  } finally {
    await host.context().close(); await guest.context().close();
  }
});

test('server game links autojoin and still ask for a world password', async ({ browser }) => {
  test.setTimeout(60000);
  const dataDir = await mkdtemp(join(tmpdir(), 'space-sim-link-'));
  await writeFile(join(dataDir, 'server.json'), JSON.stringify({ password: 'orbit' }));
  const server = await startServer(dataDir);
  const guest = await pilot(browser, server.url, 'Link pilot');
  try {
    await guest.goto(`${server.url}/#join=1`);
    await expect(guest.locator('#password-row')).toBeVisible();
    expect(new URL(guest.url()).hash).toBe('');
    await guest.locator('#join-password').fill('orbit');
    let opened = 0;
    guest.on('websocket', () => { opened++; });
    await guest.locator('#join-address').evaluate(input => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await expect(guest.locator('.connection')).toContainText('ONLINE');
    expect(opened).toBe(1);
    await guest.getByRole('button', { name: 'Copy game link' }).click();
    await expect(guest.locator('#mp-share-link')).toHaveValue(`${server.url}/#join=1`);
    expect(await guest.locator('#mp-share-link').inputValue()).not.toContain('orbit');
    expect(errorsOf(guest)).toEqual([]);
  } finally {
    await guest.context().close(); await stopServer(server);
    await rm(dataDir, { recursive: true, force: true });
  }
});

/** Tabs of one browser share storage and a BroadcastChannel. */
async function tab(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await preparePilot(page);
  await page.goto('/');
  await openPanel(page, 'multiplayer');
  await page.locator('#player-name').fill(name);
  await page.locator('#player-name').dispatchEvent('change');
  return page;
}
async function say(page: Page, text: string): Promise<void> {
  await page.locator('#chat-form').evaluate((form, line) => {
    (form.querySelector('#chat-input') as HTMLInputElement).value = line;
    (form as HTMLFormElement).requestSubmit();
  }, text);
}

test('a second tab of the same browser joins a hosting tab in one click, and pilots chat', async ({ browser }) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const host = await tab(context, 'Hana');
  const guest = await tab(context, 'Gus');
  await expect(guest.locator('#local-empty')).toBeVisible();
  await host.getByRole('button', { name: 'Host this world' }).click();
  await expect(host.locator('.connection')).toContainText('HOSTING');
  await guest.getByRole('tab', { name: 'This browser' }).click();
  await expect(guest.locator('#local-worlds')).toContainText('Hana');
  await guest.locator('#local-worlds').getByRole('button', { name: /^Join Hana/ }).click();
  await expect(guest.locator('.connection')).toContainText('ONLINE');
  await expect(host.locator('.connection')).toContainText('2 PILOTS');
  // Shared storage holds the host's seat; the guest takes a seat of its own.
  await expect(guest.locator('#player-list')).toContainText('Gus (you)');
  await expect(guest.locator('#player-list')).toContainText('Hana · host');

  await say(guest, 'hello from the other tab');
  await expect(host.locator('#chat-messages')).toContainText('hello from the other tab');
  await expect(guest.locator('#chat-messages')).toContainText('Gus (you)');

  // A cheat placement goes through the host: everyone sees the ship in orbit.
  await say(guest, '/throw on');
  await say(guest, '/orbit 300');
  await expect(guest.locator('#chat-messages')).toContainText('sent to the host');
  await expect(guest.locator('#status')).toHaveText('FLYING');
  await expect(host.locator('#ship-list .foreign')).toContainText('FLYING');

  await guest.close();
  await expect(host.locator('.connection')).toContainText('1 PILOT');
  expect([...errorsOf(host)]).toEqual([]);
  await context.close();
});

test('other pilots get slow coast previews with automatic crowd control and an off switch', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const host = await tab(context, 'Orbit host');
  const guest = await tab(context, 'Orbit guest');
  const stats = async (page: Page) => (await diagnostics(page)).otherOrbits as { paths: number; starts: number; enabled: boolean; workMs: number };
  try {
    await host.getByRole('button', { name: 'Host this world' }).click();
    await guest.getByRole('tab', { name: 'This browser' }).click();
    await guest.locator('#local-worlds').getByRole('button', { name: /^Join Orbit host/ }).click();
    await expect(guest.locator('.connection')).toContainText('ONLINE');
    await openPanel(guest, 'setup');
    await guest.locator('#preset').selectOption('planet-orbit');
    await expect.poll(async () => (await stats(host)).paths).toBe(1);
    expect((await stats(host)).enabled).toBe(true);
    await openPanel(host, 'multiplayer');
    await host.locator('#other-orbit-mode').selectOption('off');
    await expect.poll(async () => (await stats(host)).paths).toBe(0);
    await host.locator('#other-orbit-mode').selectOption('always');
    await expect.poll(async () => (await stats(host)).paths).toBe(1);
    // Sample several refresh cycles for a bounded forecast-rate/performance record.
    const samples: Record<string, unknown>[] = [];
    const sampleStart = Date.now();
    const onStart = await host.evaluate(() => performance.now() / 1000);
    for (let i = 0; i < 12; i++) {
      await host.waitForTimeout(250);
      const d = await diagnostics(host);
      samples.push({ otherOrbits: d.otherOrbits, predictionP95Ms: d.predictionP95Ms,
        workP95Ms: d.workP95Ms, renderP95Ms: d.renderP95Ms });
    }
    await test.info().attach('other-orbit-profile', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    const first = (samples[0]!.otherOrbits as { starts: number }).starts;
    const last = (samples.at(-1)!.otherOrbits as { starts: number }).starts;
    expect(last - first).toBeLessThanOrEqual(Math.ceil((Date.now() - sampleStart) / 1000) + 1);
    const onEnd = await host.evaluate(() => performance.now() / 1000);
    await host.locator('#other-orbit-mode').selectOption('off');
    const offStart = await host.evaluate(() => performance.now() / 1000);
    await host.waitForTimeout(3000);
    const offEnd = await host.evaluate(() => performance.now() / 1000);
    const pending = host.waitForEvent('download');
    await host.locator('#export-log').evaluate((button: HTMLButtonElement) => button.click());
    const log = JSON.parse(await readFile(await (await pending).path(), 'utf8')) as { frames: Array<Record<string, number>> };
    const steady = (start: number, end: number) => log.frames.filter(frame => frame.t! >= start && frame.t! <= end);
    const profile = { samples, on: steady(onStart, onEnd), off: steady(offStart, offEnd) };
    expect(profile.on.length).toBeGreaterThan(10);
    expect(profile.off.length).toBeGreaterThan(10);
    await writeFile(test.info().outputPath('other-orbit-steady-profile.json'), JSON.stringify(profile, null, 2));
    await openPanel(guest, 'multiplayer');
    await guest.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect.poll(async () => (await stats(host)).paths).toBe(0);
    expect([...errorsOf(host), ...errorsOf(guest)]).toEqual([]);
  } finally { await context.close(); }
});

test('joining an address with no server explains how to start one', async ({ page }) => {
  await preparePilot(page);
  await page.goto('/');
  await openPanel(page, 'multiplayer');
  await page.getByRole('tab', { name: 'Server' }).click();
  await page.locator('#join-address').fill('localhost:1');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.locator('#mp-status')).toContainText('Start the dedicated server first');
});

test('a solo fleet keeps flying, switches ships and round-trips through a world file', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await preparePilot(page);
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
