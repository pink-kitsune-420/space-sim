import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPortableModule, newModule, packageContracts } from '../../packages/module-tools/package.mjs';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
let directory: string, dataGame: Buffer, codeGame: Buffer;
test.describe.configure({ timeout: 90000 });
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-join-pack-'));
  const kit = await packageContracts(), builtin = JSON.parse(await readFile('games/space-sim/game.json', 'utf8'));
  const data = JSON.parse(await readFile('examples/modules/gentle-flight.json', 'utf8'));
  dataGame = Buffer.from(await kit.encodePackage({ ...builtin, info: { id: 'fixture.join-data', name: 'Data host', description: '' }, bundle: { ...builtin.bundle,
    modules: [data], profile: { ...builtin.bundle.profile, modules: [...builtin.bundle.profile.modules, { id: data.manifest.id, version: data.manifest.version }] } } }));
  async function build(id: string, tier: string, source: string) {
    const folder = join(directory, id); await newModule(id, folder);
    const path = join(folder, 'module.json'), descriptor = JSON.parse(await readFile(path, 'utf8'));
    const { authority: _authority, ...fields } = descriptor.manifest;
    descriptor.manifest = { ...fields, format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2', tier, environments: ['browser', 'offline', 'node'], conflicts: [] };
    descriptor.compatibility = { deterministic: true, multiplayer: true };
    await writeFile(path, JSON.stringify(descriptor)); await writeFile(join(folder, 'src/main.ts'), source);
    const output = join(directory, `${id}.spacemod`); await buildPortableModule(path, output, { typecheck: false });
    const bytes = new Uint8Array(await readFile(output)), inspected = await kit.decodeModulePackage(bytes);
    return { bytes, ref: { id, version: descriptor.manifest.version, digest: inspected.integrity.digest } };
  }
  const force = await build('fixture.join-force', 'authoritative', `export default function(c: any) {
    const state = globalThis as any; state.__joinLive = (state.__joinLive || 0) + 1;
    c.own({ dispose() { state.__joinLive--; } });
    c.contributeData({ name: 'inventory', version: 1, scope: 'world', initial: 0,
      validate(value: any) { return Number.isInteger(value) && value >= 0 && value <= 10; },
      authorize(input: any) { return input.command === 'record' && input.args === 1 && !!input.playerId; },
      reduce(input: any) { return input.state + input.args; } });
    c.contributeForce({ modelIdentity: 'join-fixture', initialState: {version: 1, value: null}, evaluate() { return {x: 0, y: 0}; } });
  }`);
  const optional = await build('fixture.optional-window', 'platform', `export default function(c: any) {
    (globalThis as any).__joinOptional = true;
    c.contributeWindow({ name: 'optional', title: 'Optional host window', controls: [] });
  }`);
  const profile = { format: 'space-sim-profile/2', id: 'fixture.join', modules: [force.ref, optional.ref].map(({ id, version }) => ({ id, version })), providers: {}, capabilities: {}, settings: {} };
  const browser = { profile, packages: [force.ref, optional.ref], requiredSlots: [] };
  const node = { profile: { ...profile, modules: [{ id: force.ref.id, version: force.ref.version }] }, packages: [force.ref], requiredSlots: [] };
  const runtime = kit.attachRuntimeFiles(kit.validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser, offline: browser, node } }),
    new Map([force, optional].map(item => [`modules/${item.ref.id}.spacemod`, item.bytes])));
  codeGame = Buffer.from(await kit.encodePackage({ ...builtin, info: { id: 'fixture.join-code', name: 'Code host', description: '' }, runtime }));
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { await useCanvas(page); });
async function server(game: Buffer, name: string): Promise<{ child: ChildProcess; url: string; stop(): Promise<void> }> {
  const folder = await mkdtemp(join(directory, 'server-')), path = join(folder, 'game.spacegame'); await writeFile(path, game);
  const child = spawn(process.execPath, ['dist-server/space-sim-server.cjs', '--data', folder, '--game', path, '--name', name, '--offer-game-pack', '--host', '127.0.0.1', '--port', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; child.stdout!.on('data', value => { output += value; }); child.stderr!.on('data', value => { output += value; });
  await expect.poll(() => { if (child.exitCode !== null) throw new Error(output); return /http:\/\/localhost:(\d+)/.exec(output)?.[1]; }, { timeout: 15000 }).toBeTruthy();
  return { child, url: `http://127.0.0.1:${/http:\/\/localhost:(\d+)/.exec(output)![1]}`, async stop() {
    if (child.exitCode !== null) return; const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
  } };
}
async function connect(page: Page, address: string) {
  await openPanel(page, 'multiplayer'); await page.getByRole('tab', { name: 'Server', exact: true }).click();
  await page.locator('#join-address').fill(address); await page.getByRole('button', { name: 'Join', exact: true }).click();
}
async function localIdentity(page: Page) { return page.locator('#debug').evaluate(element => { const value = JSON.parse(element.textContent!); return { world: value.world, fingerprint: value.fingerprint }; }); }

test('declining preserves the local game; accepted data installs once and reconnects without another prompt', async ({ page }) => {
  const host = await server(dataGame, 'Data host'), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/'); const original = await localIdentity(page); await connect(page, host.url);
    const dialog = page.getByRole('dialog', { name: 'Join Data host' }); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await expect(dialog).toContainText('example.gentle-flight'); await expect(dialog).toContainText('Data');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#mp-status')).toContainText('cancelled'); await expect.poll(() => localIdentity(page)).toEqual(original);
    await connect(page, host.url); await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Install and join', exact: true }).click();
    await expect(page.locator('.connection')).toContainText('ONLINE');
    await expect.poll(async () => (await localIdentity(page)).fingerprint).not.toBe(original.fingerprint);
    await page.locator('#leave-game').click(); await expect(page.locator('.connection')).toContainText('LOCAL FLIGHT');
    await expect.poll(() => localIdentity(page)).toEqual(original);
    await connect(page, host.url); await expect(page.locator('.connection')).toContainText('ONLINE'); await expect(dialog).toHaveCount(0);
    await page.locator('#leave-game').click(); expect(errors).toEqual([]);
  } finally { await host.stop(); }
});

test('code runs only after exact approval, optional host windows stay optional, and leaving disposes the server graph', async ({ page }) => {
  await page.addInitScript(() => {
    const Socket = globalThis.WebSocket;
    globalThis.WebSocket = class extends Socket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols); (globalThis as any).__joinSocket = this;
        this.addEventListener('message', event => {
          try { const message = JSON.parse(event.data); for (const record of message.data?.records ?? []) {
            if (record.adapter === 'fixture.join-force/inventory') (globalThis as any).__joinData = record.value;
          } } catch {}
        });
      }
    };
  });
  const host = await server(codeGame, 'Code host'), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/'); const original = await localIdentity(page); await connect(page, host.url);
    const dialog = page.getByRole('dialog', { name: 'Join Code host' }); await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => (globalThis as any).__joinLive)).toBeUndefined();
    await expect(dialog).toContainText('Trusted code can read game data'); await expect(dialog).toContainText('fixture.join-force');
    await expect(dialog).not.toContainText('fixture.optional-window');
    await dialog.getByRole('button', { name: 'Install and join', exact: true }).click();
    await expect(page.locator('.connection')).toContainText('ONLINE');
    expect(await page.evaluate(() => (globalThis as any).__joinLive)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).__joinOptional)).toBeUndefined();
    await page.evaluate(() => (globalThis as any).__joinSocket.send(JSON.stringify({ t: 'data-command', request: { adapter: 'fixture.join-force/inventory', id: 'world', command: 'record', args: 1 } })));
    await expect.poll(() => page.evaluate(() => (globalThis as any).__joinData)).toBe(1);
    await page.locator('#leave-game').click(); await expect(page.locator('.connection')).toContainText('LOCAL FLIGHT');
    expect(await page.evaluate(() => (globalThis as any).__joinLive)).toBe(0); await expect.poll(() => localIdentity(page)).toEqual(original);
    await page.reload(); expect(await page.evaluate(() => (globalThis as any).__joinLive)).toBeUndefined();
    // Reload starts a new solo world; the next disconnect must restore that instance.
    const reloadedLocal = await localIdentity(page);
    await connect(page, host.url); await expect(page.locator('.connection')).toContainText('ONLINE'); await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as any).__joinLive)).toBe(1);
    await expect.poll(() => page.evaluate(() => (globalThis as any).__joinData)).toBe(1);
    await page.locator('#leave-game').click();
    await expect(page.locator('.connection')).toContainText('LOCAL FLIGHT');
    await expect.poll(() => page.evaluate(() => (globalThis as any).__joinLive)).toBe(0);
    await expect.poll(() => localIdentity(page)).toEqual(reloadedLocal); expect(errors).toEqual([]);
  } finally { await host.stop(); }
});

test('a browser tab host offers the same reviewed data pack and stopping hosting restores the guest game', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } }), host = await context.newPage(), guest = await context.newPage();
  const errors: string[] = []; for (const page of [host, guest]) { await useCanvas(page); page.on('pageerror', error => errors.push(error.message)); }
  try {
    await host.goto('/'); await guest.goto('/'); const original = await localIdentity(guest);
    await openPanel(host, 'library'); await host.locator('#lab-file').setInputFiles({ name: 'data.spacegame', mimeType: 'application/zip', buffer: dataGame });
    const card = host.locator('.game-card').filter({ has: host.getByRole('heading', { name: 'Data host', exact: true }) });
    await card.getByRole('button', { name: 'Play · new world' }).click(); await expect(host.locator('#lab-status')).toContainText('Playing Data host');
    await expect.poll(async () => (await localIdentity(host)).fingerprint).not.toBe(original.fingerprint);
    await openPanel(host, 'multiplayer'); await host.locator('#player-name').fill('Module host'); await host.locator('#player-name').dispatchEvent('change');
    for (const page of [host, guest]) {
      await openPanel(page, 'tools');
      if (!await page.locator('#local-multiplayer').evaluate(element => (element as HTMLDetailsElement).open)) await page.locator('#local-multiplayer summary').click();
    }
    await host.getByRole('button', { name: 'Host this world' }).click();
    const row = guest.locator('#local-worlds li').filter({ hasText: 'Module host' }); await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^Join/ }).click();
    const dialog = guest.getByRole('dialog', { name: 'Join Data host' }); await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Install and join', exact: true }).click();
    await expect(guest.locator('.connection')).toContainText('ONLINE');
    await expect.poll(async () => (await localIdentity(guest)).fingerprint).toBe((await localIdentity(host)).fingerprint);
    await host.locator('#debug-stop-hosting').click(); await expect(guest.locator('.connection')).toContainText('LOCAL FLIGHT');
    await expect.poll(() => localIdentity(guest)).toEqual(original); expect(errors).toEqual([]);
  } finally { await context.close(); }
});
