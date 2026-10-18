import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

const suffix = process.platform === 'win32' ? '.exe' : '';
const game = resolve(`dist-desktop/space-sim${suffix}`);
const server = resolve(`dist-server/space-sim-server${suffix}`);
test.skip(!existsSync(game) || !existsSync(server), 'Run npm run package -- --target=multiplayer first');

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  child.kill('SIGTERM');
  await exited;
}

test('standalone game joins its matching standalone server', async ({ page }) => {
  test.setTimeout(60000);
  const dataDir = await mkdtemp(join(tmpdir(), 'space-sim-packaged-'));
  const children: ChildProcess[] = [];
  const launch = async (program: string, args: string[], address: RegExp): Promise<string> => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout!.on('data', chunk => { output += chunk; });
    child.stderr!.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += error.message; });
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return address.exec(output)?.[1];
    }, { timeout: 15000 }).toBeTruthy();
    return address.exec(output)![1]!;
  };
  try {
    const host = await launch(server, ['--data', dataDir, '--port', '0', '--host', '127.0.0.1'], /(http:\/\/localhost:\d+)/);
    const client = await launch(game, ['--no-open', '--port', '0'], /(http:\/\/127\.0\.0\.1:\d+)/);
    await useCanvas(page);
    await page.goto(client);
    await openPanel(page, 'multiplayer');
    await page.getByRole('tab', { name: 'Server', exact: true }).click();
    await page.locator('#player-name').fill('Packaged pilot');
    // Use IPv4 explicitly: the test server is bound only to IPv4.
    await page.locator('#join-address').fill(host.replace('localhost', '127.0.0.1'));
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page.locator('.connection')).toContainText('ONLINE');
    await expect(page.locator('#player-list')).toContainText('Packaged pilot (you)');
    await expect(page.locator('#status')).toHaveText('LANDED');
  } finally {
    await Promise.all(children.map(stop));
    await rm(dataDir, { recursive: true, force: true });
  }
});
