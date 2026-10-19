import { expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDefines } from '../../scripts/build_info.mjs';
import { version } from '../../package.json';

it('uses the canonical package version and explicit development identity in every build definition', () => {
  const info = JSON.parse(buildDefines(true).__SPACELAB_BUILD_INFO__!);
  expect(info.version).toBe(version); expect(info.development).toBe(true);
  expect(typeof info.revision).toBe('string');
});

it('source archives retain their semantic dev version when Git is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spacelab-build-version-'));
  try {
    await mkdir(join(root, 'scripts')); await cp('scripts/build_info.mjs', join(root, 'scripts/build_info.mjs'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.7.0-dev.2' }));
    const module = await import(pathToFileURL(join(root, 'scripts/build_info.mjs')).href);
    expect(JSON.parse(module.buildDefines().__SPACELAB_BUILD_INFO__)).toEqual({ version: '0.7.0-dev.2', development: true, revision: '' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('syncs native metadata, increments the Android build code once and reports drift without writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spacelab-native-version-'));
  try {
    for (const directory of ['scripts', 'src-tauri', 'android/app']) await mkdir(join(root, directory), { recursive: true });
    await cp('scripts/sync_versions.mjs', join(root, 'scripts/sync_versions.mjs'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.7.0-dev.2' }));
    await writeFile(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.6.1-alpha' }));
    await writeFile(join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.6.1-alpha"\n[dependencies]\nserde = { version = "1" }\n');
    const gradle = join(root, 'android/app/build.gradle');
    await writeFile(gradle, 'versionCode 11\nversionName "0.6.1-alpha"\n');
    const run = (...args: string[]) => execFileSync(process.execPath, [resolve(root, 'scripts/sync_versions.mjs'), ...args], { stdio: 'pipe' });
    expect(() => run('--check')).toThrow(); expect(await readFile(gradle, 'utf8')).toContain('versionCode 11');
    run(); run(); run('--check');
    expect(JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version).toBe('0.7.0-dev.2');
    expect(await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8')).toContain('serde = { version = "1" }');
    expect(await readFile(gradle, 'utf8')).toBe('versionCode 12\nversionName "0.7.0-dev.2"\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
