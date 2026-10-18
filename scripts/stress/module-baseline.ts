// Phase 0 measurement workloads. These are regression observations, not accuracy oracles.
// Bundled and run with --expose-gc by scripts/measure_module_baseline.mjs.
import { createHash } from 'node:crypto';
import {
  advance, createSurfaceProfile, ghost, IDLE, initialState, MODEL, READABLE_MODELS,
  setVehicle, STEP, type Body, type State, type SurfaceProfile,
} from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { prepareGame } from '../../packages/modules/src/index';
import { SAVE_FORMAT, SAVE_UNITS, SAVE_VERSION } from '../../packages/sim-core/src/save';
import { PROTOCOL } from '../../packages/net/src/protocol';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { SOLAR_UNIVERSE, TERRAIN_UNIVERSE } from '../../packages/scenarios/builtin';
import { populateStress } from '../../packages/scenarios/stress';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('Run with --expose-gc');
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]!, max: sorted.at(-1)! };
}

function worldRun(kind: 'launch-cutoff' | 'terrain' | 'fleet') {
  gc!();
  const before = process.memoryUsage();
  const buildStart = performance.now();
  const prepared = prepareGame({ environment: 'node', universe: kind === 'terrain' ? TERRAIN_UNIVERSE : kind === 'fleet' ? SOLAR_UNIVERSE : DEFAULT_UNIVERSE,
    ...(kind === 'terrain' ? { systemId: 'cratered' } : kind === 'fleet' ? { systemId: 'solar-system' } : {}) });
  prepared.runtime.activate(prepared.candidate);
  const world = prepared.world;
  const worldBuildMs = performance.now() - buildStart;
  const setupStart = performance.now();
  if (kind === 'fleet') populateStress(world, { ships: 100, asteroids: 400, seed: 7, burn: true });
  else if (kind === 'terrain') {
    world.spawn({ ownerId: 'pilot', presetId: 'crater-descent' });
    const hit = world.spawn({ ownerId: 'pilot', presetId: 'crater-descent' });
    world.put({ ...hit, state: { ...hit.state, velocity: {
      x: -10 * Math.cos(hit.state.heading), y: -10 * Math.sin(hit.state.heading),
    } } });
  } else {
    const pad = world.spawn({ ownerId: 'pilot', presetId: 'pad' });
    world.setControls(pad.id, { ...IDLE, engine: true });
    world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const exit = world.spawn({ ownerId: 'pilot', presetId: 'moon-orbit' });
    world.put({ ...exit, state: { ...exit.state, position: { x: 0, y: 2999.9 }, velocity: { x: 0, y: 100 } } });
  }
  const setupMs = performance.now() - setupStart;
  gc!();
  const populated = process.memoryUsage();
  const times: number[] = [], events: unknown[] = [];
  const ticks = kind === 'fleet' ? 1000 : 400;
  for (let tick = 0; tick < ticks; tick++) {
    // Same burn/turn/cutoff boundary as world.test.ts; fleets cut off after 1.5 s.
    if (kind === 'launch-cutoff' && tick === 150) world.setControls('ship-1', { ...IDLE, engine: true, turn: 1 });
    if (tick === (kind === 'fleet' ? 150 : 220)) {
      for (const ship of world.records()) if (ship.controls.engine) world.setControls(ship.id, IDLE);
    }
    const start = performance.now();
    events.push(...world.step());
    times.push(performance.now() - start);
  }
  gc!();
  const retained = process.memoryUsage();
  // Materialize after timing/memory: reading all sleepers adds work and cache entries.
  const ships = world.ships();
  return { scenario: kind, universe: world.universe.id, system: world.systemId, objects: world.size,
    ticks, stepSeconds: STEP, worldBuildMs, setupMs, tickMs: stats(times),
    retainedHeapBytes: { afterSetup: populated.heapUsed - before.heapUsed, afterSteps: retained.heapUsed - before.heapUsed },
    retainedArrayBufferBytes: retained.arrayBuffers - before.arrayBuffers,
    asleep: world.asleepCount, faults: ships.filter(s => s.fault).map(s => ({ id: s.id, fault: s.fault })),
    events, finalStateSha256: digest(ships),
    // Full small scenarios let reviewers compare states without relying only on a hash.
    finalShips: kind === 'fleet' ? undefined : ships };
}

function trace(state: State, body: Body, surface?: SurfaceProfile) {
  const job = ghost(state, false, body, surface);
  let samples = 0;
  for (let i = 0; i < 16_400; i++) {
    const next = job.next();
    if (next.done) return { samples, end: next.value };
    samples++;
  }
  throw new Error('Prediction did not finish within its documented sample bounds');
}
function predictions() {
  const world = new World(DEFAULT_UNIVERSE);
  setVehicle(world.system.vehicleDefaults);
  const orbit = world.presetState('planet-orbit');
  const waterBody: Body = { id: 'ocean', radius: 10, mu: 100 };
  const water = createSurfaceProfile(10, [-2, -2, -2, -2], 0, 10);
  const waterState = (speed: number): State => ({ ...initialState(), status: 'flying', heading: 0,
    position: { x: 10.001, y: 0 }, velocity: { x: speed, y: 0 } });
  return [
    { id: 'safe-orbit', state: orbit.state, body: world.body(orbit.bodyId), surface: undefined },
    { id: 'gentle-water-entry', state: waterState(-1), body: waterBody, surface: water },
    { id: 'heavy-water-entry', state: waterState(-6), body: waterBody, surface: water },
  ].map(({ id, state, body, surface }) => {
    const times: number[] = [];
    let result = trace(state, body, surface); // untimed warmup; each timed pass starts from the same immutable state
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      result = trace(state, body, surface);
      times.push(performance.now() - start);
    }
    let live = state;
    for (let tick = 0; tick < 4000 && live.status === 'flying'; tick++) live = advance(live, IDLE, STEP, body, surface);
    return { scenario: id, completePassMs: stats(times), ...result, finalLiveState: live };
  });
}

console.log(JSON.stringify({
  compatibility: { model: MODEL, readableModels: READABLE_MODELS, saveFormat: SAVE_FORMAT,
    saveVersion: SAVE_VERSION, saveUnits: SAVE_UNITS, protocol: PROTOCOL },
  composition: 'World construction includes Phase 2 static registry/resolution/activation; prediction microbenchmarks retain the Phase 0 legacy adapter.',
  method: 'Serial process; GC outside timing; three fresh worlds per case; 20 complete warm prediction passes. Heap deltas include harness storage and shared caches; not peak memory.',
  worlds: (['launch-cutoff', 'terrain', 'fleet'] as const).map(kind => ({ scenario: kind,
    runs: Array.from({ length: 3 }, () => worldRun(kind)) })),
  predictions: predictions(),
}));
