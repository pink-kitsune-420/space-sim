import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ target: 'multiplayer', exec: vi.fn() }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(), execFileSync: harness.exec,
}));
vi.mock('node:util', async original => ({
  ...await original<typeof import('node:util')>(), parseArgs: () => ({ values: { target: harness.target } }),
}));
vi.mock('node:fs', async original => ({
  ...await original<typeof import('node:fs')>(),
  // Reproduce a checkout with existing (potentially stale) distributions.
  existsSync: () => true, statSync: () => ({ size: 1024 }),
}));

beforeEach(() => {
  vi.resetModules();
  harness.exec.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

const packageDistribution = () => vi.importActual('../../scripts/package.mjs');
const commands = () => harness.exec.mock.calls.map(([command, args]) => [command, args]);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

it('rebuilds existing output once before packaging a matching game and server', async () => {
  harness.target = 'multiplayer';
  await packageDistribution();
  expect(commands()).toEqual([
    [npm, ['run', 'build']],
    ['node', ['scripts/build_game_exe.mjs']],
    ['node', ['scripts/build_server_exe.mjs']],
  ]);
});

it.each(['desktop-exe', 'server-exe', 'offline'])('refreshes existing output for %s', async target => {
  harness.target = target;
  await packageDistribution();
  expect(commands()[0]).toEqual([npm, ['run', 'build']]);
  expect(commands()).toHaveLength(target === 'offline' ? 1 : 2);
});

it('does not package stale bundles when rebuilding fails', async () => {
  harness.target = 'multiplayer';
  harness.exec.mockImplementation(() => { throw new Error('Build failed'); });
  await expect(packageDistribution()).rejects.toThrow('Build failed');
  expect(commands()).toEqual([[npm, ['run', 'build']]]);
});
