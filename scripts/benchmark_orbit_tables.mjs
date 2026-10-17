import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';

// Same series recurrence and stopping rule as the production Stumpff kernel.
// This isolates denominator arithmetic versus precomputed coefficient reads.
const coefficients = new Float64Array(40);
for (let k = 1; k <= 20; k++) {
  coefficients[2 * (k - 1)] = -1 / ((2 * k + 1) * (2 * k + 2));
  coefficients[2 * (k - 1) + 1] = -1 / ((2 * k + 2) * (2 * k + 3));
}
function arithmetic(z) {
  let c = .5, s = 1 / 6, tc = c, ts = s;
  for (let k = 1; k <= 20; k++) {
    tc *= -z / ((2 * k + 1) * (2 * k + 2));
    ts *= -z / ((2 * k + 2) * (2 * k + 3));
    c += tc; s += ts;
    if (Math.abs(tc) + Math.abs(ts) < Number.EPSILON * (Math.abs(c) + Math.abs(s))) break;
  }
  return c + s;
}
function lookup(z) {
  let c = .5, s = 1 / 6, tc = c, ts = s;
  for (let k = 0; k < 20; k++) {
    tc *= z * coefficients[2 * k];
    ts *= z * coefficients[2 * k + 1];
    c += tc; s += ts;
    if (Math.abs(tc) + Math.abs(ts) < Number.EPSILON * (Math.abs(c) + Math.abs(s))) break;
  }
  return c + s;
}
const size = 4096, sine = new Float64Array(size + 1);
for (let i = 0; i <= size; i++) sine[i] = Math.sin(i * 2 * Math.PI / size);
function sinLookup(angle) {
  const phase = angle * size / (2 * Math.PI), whole = Math.floor(phase);
  const index = ((whole % size) + size) % size;
  return sine[index] + (sine[index + 1] - sine[index]) * (phase - whole);
}
let checksum = 0;
const inputs = Float64Array.from({ length: 4096 }, (_, i) => i / 4096 - .5);
function measure(fn, scale = 1) {
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < 300000; i++) sum += fn(inputs[i & 4095] * scale);
  checksum += sum;
  return performance.now() - start;
}
const samples = { coefficientArithmetic: [], coefficientLookup: [], nativeSine: [], interpolatedSine: [] };
for (let round = 0; round < 12; round++) {
  const order = round % 2 ? Object.keys(samples).reverse() : Object.keys(samples);
  for (const key of order) {
    const fn = { coefficientArithmetic: arithmetic, coefficientLookup: lookup, nativeSine: Math.sin, interpolatedSine: sinLookup }[key];
    const ms = measure(fn, key.includes('Sine') ? 100 : 1);
    if (round >= 3) samples[key].push(ms);
  }
}
let coefficientError = 0, sineError = 0;
for (let i = 0; i < 100000; i++) {
  const z = i / 99999 - .5, angle = z * 100;
  coefficientError = Math.max(coefficientError, Math.abs(arithmetic(z) - lookup(z)));
  sineError = Math.max(sineError, Math.abs(Math.sin(angle) - sinLookup(angle)));
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const medians = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, median(values)]));
const report = { measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
  workload: '300000 calls per batch; 3 warmups + 9 alternating-order samples; 4096 varied inputs',
  coefficientTableBytes: coefficients.byteLength, sineTableBytes: sine.byteLength,
  medianMilliseconds: medians, speedup: {
    coefficients: medians.coefficientArithmetic / medians.coefficientLookup,
    sine: medians.nativeSine / medians.interpolatedSine,
  }, maxAbsoluteDifference: { coefficients: coefficientError, sine: sineError }, samples, checksum,
  caveat: 'Node microbenchmark, not whole-flight/browser speedup; sampled trig is not enabled in physics.' };
await writeFile('private-docs/measurements/m2-lookup-tables.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
