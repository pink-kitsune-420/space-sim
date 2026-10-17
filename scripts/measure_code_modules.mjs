import { build } from 'rolldown';
import { buildModule } from '../packages/module-tools/author.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { cpus } from 'node:os';
const out = process.argv[2] ?? 'test-results/code-modules-measurement.json';
const artifact = resolve('test-results/stress-build/steady-lift.module.json');
await buildModule('examples/modules/force/module.json', artifact);
const file = resolve('test-results/stress-build/code-modules.mjs');
await build({ input: resolve('scripts/stress/code-modules.ts'), platform: 'node', logLevel: 'warn', output: { file, format: 'esm' } });
const results = JSON.parse(execFileSync(process.execPath, [file, artifact], { encoding: 'utf8' }));
const report = { measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  note: 'Working-tree Phase 6; two alternating trials after 200 warmup ticks, 2000 measured ticks each. Same public force hook and numerical kernel. No universal device-performance claim.', ...results };
await mkdir(dirname(resolve(out)), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!results.equivalentFinalStates) process.exitCode = 1;
