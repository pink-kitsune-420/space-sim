// Save/load cost of a large world: JSON size, gzip size, and time to save, stringify,
// parse and validate. Run: node scripts/stress/run.mjs scripts/stress/save-bench.ts --asteroids=20000
import { gzipSync } from 'node:zlib';
import { World } from '../../packages/sim-core/src/world';
import { loadWorld, saveWorld } from '../../packages/sim-core/src/save';
import { BUILTIN_UNIVERSES } from '../../packages/scenarios/builtin';
import { populateStress } from '../../packages/scenarios/stress';

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const asteroids = Number(args.get('asteroids') ?? 20000);
const world = new World(BUILTIN_UNIVERSES.full!, { id: 'w-save' });
populateStress(world, { ships: 200, asteroids, seed: 4, burn: true });
for (let i = 0; i < 300; i++) world.step();
const time = (fn: () => unknown): [number, unknown] => { const t = performance.now(); const r = fn(); return [performance.now() - t, r]; };
const [saveMs, save] = time(() => saveWorld(world, { savedAt: new Date().toISOString() }));
const [stringifyMs, text] = time(() => JSON.stringify(save));
const json = text as string;
const [gzipMs, gz] = time(() => gzipSync(json, { level: 6 }));
const [parseMs, parsed] = time(() => JSON.parse(json));
let loadMs = NaN, error = '';
try { [loadMs] = time(() => loadWorld(parsed)); } catch (e) { error = (e as Error).message; }
console.log(JSON.stringify({ objects: world.size, jsonMiB: +(json.length / 1048576).toFixed(2),
  gzipMiB: +((gz as Buffer).length / 1048576).toFixed(2), saveMs: +saveMs.toFixed(1), stringifyMs: +stringifyMs.toFixed(1),
  gzipMs: +gzipMs.toFixed(1), parseMs: +parseMs.toFixed(1), loadMs: +loadMs.toFixed(1), error }, null, 2));
