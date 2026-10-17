// Headless world stress benchmark: many ships firing engines at once plus asteroids
// on orbits chosen to exercise the orbital mechanics (belts, planet crossers, SOI
// transitions, hyperbolic flybys, impacts, near-parabolic and near-radial paths).
//
// Run: node scripts/stress/run.mjs scripts/stress/world-bench.ts --universe=full --ships=500 --asteroids=2000
// Options (all optional):
//   --universe=full|solar|default   --system=<id>   --ships=N   --asteroids=N
//   --seconds=S (simulated)   --burn=S (engines on for the first S seconds)
//   --seed=N   --json=<file>   --profile-every=N (heap sample interval in ticks)
import { writeFileSync } from 'node:fs';
import { IDLE, STEP, elements, magnitude } from '../../packages/sim-core/src/index';
import { World, type WorldEvent } from '../../packages/sim-core/src/world';
import { BUILTIN_UNIVERSES } from '../../packages/scenarios/builtin';
import { STRESS_OWNER, populateStress } from '../../packages/scenarios/stress';

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const option = (key: string, fallback: string): string => args.get(key) ?? fallback;
const universeKey = option('universe', 'full');
const universe = BUILTIN_UNIVERSES[universeKey];
if (!universe) throw new Error(`Unknown universe ${universeKey}; built in: ${Object.keys(BUILTIN_UNIVERSES).join(', ')}`);
const systemId = args.get('system') ?? universe.defaultSystemId;
const shipCount = Number(option('ships', '200'));
const asteroidCount = Number(option('asteroids', '1000'));
const seconds = Number(option('seconds', '10'));
const burnSeconds = Number(option('burn', '5'));
const heapEvery = Number(option('profile-every', '100'));
const seed = Number(option('seed', '1')) >>> 0 || 1;

const gc = (globalThis as { gc?: () => void }).gc;
const heapMiB = (): number => process.memoryUsage().heapUsed / 1048576;

const buildStart = performance.now();
const world = new World(universe, { systemId, id: 'stress' });
const buildMs = performance.now() - buildStart;
const bodies = world.system.getAllBodies();

const stress = populateStress(world, { ships: shipCount, asteroids: asteroidCount, seed, burn: true, shipOwner: 'pilot' });
const kinds = new Map(Object.entries(stress.kinds));

const initialEnergy = new Map<string, { bodyId: string; energy: number }>();
for (const ship of world.ships()) {
  if (ship.ownerId !== STRESS_OWNER) continue;
  initialEnergy.set(ship.id, { bodyId: ship.bodyId, energy: elements(ship.state, world.body(ship.bodyId).mu).energy });
}

gc?.();
const heapStart = heapMiB();
const ticks = Math.round(seconds / STEP);
const burnTicks = Math.round(burnSeconds / STEP);
const times = new Float64Array(ticks);
const eventCounts = { contact: 0, soi: 0, fault: 0 };
const faults = new Map<string, number>();
const soiPairs = new Map<string, number>();
let heapPeak = heapStart;
const heapSamples: Array<{ tick: number; heapMiB: number }> = [];
const runStart = performance.now();
for (let t = 0; t < ticks; t++) {
  if (t === burnTicks) for (const ship of world.ships()) if (ship.controls.engine) world.setControls(ship.id, IDLE);
  const start = performance.now();
  const events: WorldEvent[] = world.step();
  times[t] = performance.now() - start;
  for (const e of events) {
    eventCounts[e.type]++;
    if (e.type === 'fault') faults.set(e.message, (faults.get(e.message) ?? 0) + 1);
    if (e.type === 'soi') soiPairs.set(`${e.from}→${e.to}`, (soiPairs.get(`${e.from}→${e.to}`) ?? 0) + 1);
  }
  if (t % heapEvery === 0) {
    const heap = heapMiB();
    heapPeak = Math.max(heapPeak, heap);
    heapSamples.push({ tick: t, heapMiB: +heap.toFixed(1) });
  }
}
const runMs = performance.now() - runStart;
const heapEnd = heapMiB();
gc?.();
const heapAfterGc = heapMiB();

// Energy check: coasting asteroids that never left their starting body.
let worstEnergy = 0, checked = 0, coasting = 0, numerical = 0;
const status = { flying: 0, landed: 0, crashed: 0, faulted: 0 };
for (const ship of world.ships()) {
  if (ship.fault) status.faulted++; else status[ship.state.status]++;
  if (ship.state.dynamics === 'kepler') coasting++; else numerical++;
  const start = initialEnergy.get(ship.id);
  if (!start || ship.bodyId !== start.bodyId || ship.state.status !== 'flying' || ship.fault) continue;
  const body = world.body(ship.bodyId);
  const energy = elements(ship.state, body.mu).energy;
  const scale = Math.max(Math.abs(start.energy), body.mu / magnitude(ship.state.position));
  worstEnergy = Math.max(worstEnergy, Math.abs(energy - start.energy) / scale);
  checked++;
}

const sorted = [...times].sort((a, b) => a - b);
const pct = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
const phase = (from: number, to: number): { mean: number; p95: number } => {
  const part = [...times.subarray(from, Math.max(from, to))].sort((a, b) => a - b);
  if (!part.length) return { mean: 0, p95: 0 };
  return { mean: +(part.reduce((a, b) => a + b, 0) / part.length).toFixed(3),
    p95: +part[Math.min(part.length - 1, Math.floor(part.length * 0.95))]!.toFixed(3) };
};
const objects = world.size;
const report = {
  measuredAt: new Date().toISOString(), node: process.version,
  universe: universe.id, system: systemId, bodies: bodies.length, ships: shipCount, asteroids: asteroidCount,
  asteroidKinds: Object.fromEntries(kinds), objects, simulatedSeconds: seconds, burnSeconds, ticks,
  worldBuildMs: +buildMs.toFixed(1),
  tickMs: { mean: +(runMs / ticks).toFixed(3), p50: +pct(0.5).toFixed(3), p95: +pct(0.95).toFixed(3),
    p99: +pct(0.99).toFixed(3), max: +sorted[sorted.length - 1]!.toFixed(3) },
  firstTickMs: +times[0]!.toFixed(3),
  burnPhaseMs: phase(1, burnTicks), coastPhaseMs: phase(burnTicks + 1, ticks),
  microsecondsPerObjectTick: +(runMs * 1000 / ticks / Math.max(1, objects)).toFixed(3),
  realtimeFactor: +((seconds * 1000) / runMs).toFixed(3),
  heapMiB: { start: +heapStart.toFixed(1), peak: +heapPeak.toFixed(1), end: +heapEnd.toFixed(1), afterGc: +heapAfterGc.toFixed(1) },
  events: eventCounts, soiTransitions: Object.fromEntries(soiPairs), faults: Object.fromEntries(faults),
  finalStatus: status, finalDynamics: { kepler: coasting, numerical },
  energyCheck: { coastingObjectsChecked: checked, worstRelativeEnergyDrift: worstEnergy },
  awakeAtEnd: world.size - world.asleepCount,
  heapSamples,
};
const json = option('json', '');
if (json) writeFileSync(json, JSON.stringify(report, null, 2) + '\n');
const { heapSamples: _samples, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
