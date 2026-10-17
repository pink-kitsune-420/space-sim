import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { generateSurface } from '../packages/sim-core/src/surface.ts';

if (!global.gc) throw new Error('Run with --expose-gc for retained-memory measurements');
const examples = JSON.parse(await readFile(new URL('../games/space-sim/universes/sandbox/terrain/universe.json', import.meta.url), 'utf8'));
const base = examples.systems[0].bodies[0];
const maximum = { ...base.surface, pads: undefined, sampleCount: 65536,
  minFeatureWidthMetres: 4 * (2 * Math.PI * base.radius / 65536), mountainRangeCount: 256, craterCount: 4096 };
const cases = [
  ...examples.systems.map(system => ({ id: system.id, bodies: system.bodies })),
  { id: 'minimum-resolution', bodies: [{ ...base, surface: { ...base.surface, pads: undefined,
    sampleCount: 32, minFeatureWidthMetres: 2 * Math.PI * base.radius } }] },
  { id: 'maximum-resolution-and-features', bodies: [{ ...base, surface: maximum }] },
  { id: 'maximum-width-and-features', bodies: [{ ...base, surface: { ...maximum, minFeatureWidthMetres: 2 * Math.PI * base.radius } }] },
  { id: 'maximum-pads', bodies: [{ ...base, surface: { ...maximum,
    pads: Array.from({ length: 64 }, (_, i) => ({ id: `pad-${i}`, angleRadians: i / 64 * 2 * Math.PI,
      widthMetres: maximum.minFeatureWidthMetres, elevationMetres: 0 })) } }] },
  { id: 'universe-sample-and-feature-limits', bodies: Array.from({ length: 16 }, (_, i) => ({ ...base,
    surface: { ...maximum, seed: i, mountainRangeCount: 64, craterCount: 960 } })) },
];
const results = [];
for (const scenario of cases) {
  const times = [], heaps = [], buffers = [];
  let numericStorageBytes = 0, features = 0, pads = 0, samples = 0;
  for (let run = 0; run < 4; run++) {
    global.gc();
    const before = process.memoryUsage(), start = performance.now();
    let profiles = scenario.bodies.map(generateSurface);
    times.push(performance.now() - start);
    global.gc();
    const after = process.memoryUsage();
    heaps.push(after.heapUsed - before.heapUsed);
    buffers.push(after.arrayBuffers - before.arrayBuffers);
    numericStorageBytes = profiles.reduce((total, p) => total + p.storageBytes, 0);
    features = profiles.reduce((total, p) => total + p.features.length, 0);
    pads = profiles.reduce((total, p) => total + p.pads.length, 0);
    samples = profiles.reduce((total, p) => total + p.sampleCount, 0);
    profiles = undefined;
    global.gc();
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  results.push({ id: scenario.id, bodies: scenario.bodies.length, samples, features, pads,
    firstCallMilliseconds: times[0], warmMedianMilliseconds: median(times.slice(1)), allMilliseconds: times,
    numericStorageBytes, retainedArrayBufferBytesMedian: median(buffers), retainedHeapBytesMedian: median(heaps) });
}
const report = { measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
  architecture: process.arch, cpu: cpus()[0]?.model,
  method: 'Four serial generations per case; first call then median of three warm calls. Explicit GC outside timing; retained heap and ArrayBuffers reported separately. No geometry copies retained.',
  complexity: 'O(N*(1+ranges+craters+pads)) time; 32*N numeric bytes retained, plus metadata/identity/JS closures. Profiles are caller-owned, without a global cache.',
  caveat: 'Headless Node measurements on this host, not browser frame or mobile budgets. First call per case includes validation/allocation but may reuse warmed JIT code. GC deltas are noisy; peak/transient memory is not measured.',
  cases: results };
const outputDirectory = new URL('../private-docs/measurements/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('surface-generation.json', outputDirectory), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
