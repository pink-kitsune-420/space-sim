import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { readNodeLicense } = await vi.importActual<{
  readNodeLicense(options: { execPath: string; licensePath?: string }): Buffer;
}>('../../scripts/node_runtime_license.mjs');

let directory: string;
let execPath: string;
const license = Buffer.from('Node runtime license fixture\r\nBundled component notices\r\n');
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'node-license-test-'));
  mkdirSync(join(directory, 'bin'));
  execPath = join(directory, 'bin', 'node');
  vi.stubEnv('NODE_LICENSE_PATH', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('preserves the supplied license and bundled component notices byte for byte', () => {
  const supplied = join(directory, 'runtime-license.txt');
  writeFileSync(supplied, license);
  writeFileSync(join(directory, 'LICENSE'), 'Other automatically discovered license');
  vi.stubEnv('NODE_LICENSE_PATH', supplied);
  expect(readNodeLicense({ execPath })).toEqual(readFileSync(supplied));
});

it.each(['root', 'bin'])('discovers the license in the runtime %s directory', location => {
  writeFileSync(join(directory, location === 'bin' ? 'bin/LICENSE' : 'LICENSE'), license);
  expect(readNodeLicense({ execPath })).toEqual(license);
});

it('stops when the license is missing, with instructions for the runtime being packaged', () => {
  expect(() => readNodeLicense({ execPath })).toThrow('NODE_LICENSE_PATH');
  expect(() => readNodeLicense({ execPath })).toThrow(execPath);
});

it('does not silently replace an invalid explicit path with a discovered license', () => {
  writeFileSync(join(directory, 'LICENSE'), license);
  const missing = join(directory, 'missing-license.txt');
  expect(() => readNodeLicense({ execPath, licensePath: missing })).toThrow(missing);
});

it.each(['', '   \n'])('rejects an empty or whitespace-only license', contents => {
  const supplied = join(directory, 'runtime-license.txt');
  writeFileSync(supplied, contents);
  expect(() => readNodeLicense({ execPath, licensePath: supplied })).toThrow('empty');
});

it('rejects a directory supplied as the license path', () => {
  expect(() => readNodeLicense({ execPath, licensePath: directory })).toThrow('unreadable');
});
