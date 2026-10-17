// Bundle a TypeScript stress/benchmark entry with rolldown and run it in Node.
// Usage: node scripts/stress/run.mjs <entry.ts> [args...]
// Output goes to test-results/stress-build/ (ignored by git).
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { build } from 'rolldown';

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('Usage: node scripts/stress/run.mjs <entry.ts> [args...]');
  process.exit(2);
}
const file = resolve('test-results/stress-build', basename(entry).replace(/\.ts$/, '.mjs'));
await build({ input: resolve(entry), platform: 'node', logLevel: 'warn', output: { file, format: 'esm' } });
const result = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=4096', file, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
