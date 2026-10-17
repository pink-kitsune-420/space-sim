// Package the Space Sim game as a standalone desktop executable using Node's
// Single Executable Application (SEA) support. Embeds dist-desktop/space-sim-desktop.cjs
// (which includes the full web game client) into a standalone binary.
// It builds for the platform it runs on; CI builds Windows, macOS and Linux.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-desktop');
const script = join(out, 'space-sim-desktop.cjs');
if (!existsSync(script)) {
  throw new Error('dist-desktop/space-sim-desktop.cjs is missing: run npm run build first.');
}

mkdirSync(out, { recursive: true });
const exe = join(out, process.platform === 'win32' ? 'space-sim.exe' : 'space-sim');
const blob = join(out, 'sea-prep.blob');
const config = join(out, 'sea-config.json');

writeFileSync(
  config,
  JSON.stringify({
    main: script,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  })
);

execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);

if (process.platform === 'darwin') {
  try {
    execFileSync('codesign', ['--remove-signature', exe]);
  } catch {
    // optional on non-darwin dev environments
  }
}
if (process.platform === 'win32') {
  try {
    execFileSync('signtool', ['remove', '/s', exe]);
  } catch {
    // optional if signtool is not in PATH
  }
}

await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});

if (process.platform === 'darwin') {
  try {
    execFileSync('codesign', ['--sign', '-', exe]);
  } catch {
    // optional
  }
}

rmSync(blob);
rmSync(config);

const nodeLicense = [
  join(dirname(process.execPath), '..', 'LICENSE'),
  join(dirname(process.execPath), 'LICENSE'),
].find(existsSync);
if (nodeLicense) {
  copyFileSync(nodeLicense, join(out, 'NODE-LICENSE.txt'));
} else {
  console.warn(`Node.js LICENSE not found next to ${process.execPath}; add NODE-LICENSE.txt before distributing.`);
}

const version = execFileSync(exe, ['--version'], { encoding: 'utf8' }).trim();
console.log(`Desktop game executable: ${exe} (${(statSync(exe).size / 1048576).toFixed(0)} MiB) · ${version}`);
