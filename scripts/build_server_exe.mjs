// Package the dedicated server as one executable. Node's single executable application
// support embeds dist-server/space-sim-server.cjs (which already contains the web game)
// in a copy of this Node binary, so players run it without installing anything.
// It builds for the platform it runs on; CI builds Windows, macOS and Linux.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-server');
const script = join(out, 'space-sim-server.cjs');
if (!existsSync(script)) throw new Error('dist-server/space-sim-server.cjs is missing: run npm run build first.');

const exe = join(out, process.platform === 'win32' ? 'space-sim-server.exe' : 'space-sim-server');
const blob = join(out, 'sea-prep.blob');
const config = join(out, 'sea-config.json');
writeFileSync(config, JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true,
  useSnapshot: false, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
if (process.platform === 'win32') {
  try { execFileSync('signtool', ['remove', '/s', exe]); } catch {}
}
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);
rmSync(blob); rmSync(config);

// The executable contains the Node.js runtime, so its license (which lists the
// runtime's bundled components) must travel with it.
const nodeLicense = [join(dirname(process.execPath), '..', 'LICENSE'), join(dirname(process.execPath), 'LICENSE')].find(existsSync);
if (nodeLicense) copyFileSync(nodeLicense, join(out, 'NODE-LICENSE.txt'));
else console.warn(`Node.js LICENSE not found next to ${process.execPath}; add NODE-LICENSE.txt before distributing.`);

const version = execFileSync(exe, ['--version'], { encoding: 'utf8' }).trim();
console.log(`Server executable: ${exe} (${(statSync(exe).size / 1048576).toFixed(0)} MiB) · ${version}`);
