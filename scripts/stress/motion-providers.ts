// Phase 3 custom-path overhead, separate from the unchanged Phase 0 workloads.
import { createHash } from 'node:crypto';
import type { ForceExtension, MotionContextOptions, State } from '../../packages/game-api/src/index';
import { createSimulationContext, initialState, planet } from '../../packages/sim-core/src/context';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('Run with --expose-gc');
const force: ForceExtension = { moduleId: 'measure.zero-force', version: '0.1.0', hook: {
  modelIdentity: 'zero/v1', initialState: { version: 1, value: 0 }, evaluate: () => ({ x: 0, y: 0 }),
  commit: ({ moduleState }) => ({ version: 1, value: (moduleState.value as number) + 1 }),
} };
const variants: Array<{ name: string; options: MotionContextOptions }> = [
  { name: 'builtin-numerical', options: {} },
  { name: 'replacement', options: { dynamics: { id: 'measure.numerical', version: '0.1.0', modelIdentity: 'kdk/v1',
    supportsForces: true, step: (input, services) => services.numerical(input) } } },
  { name: 'stateful-zero-force', options: { forces: [force] } },
];
const canonical = (state: State) => ({ time: state.time, position: state.position, velocity: state.velocity,
  heading: state.heading, throttle: state.throttle, status: state.status, revision: state.revision, dynamics: state.dynamics });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function run(options: MotionContextOptions) {
  const context = createSimulationContext({}, options);
  let state = initialState('planet-orbit');
  for (let i = 0; i < 200; i++) state = context.step(state, IDLE, STEP, planet);
  const samples: number[] = [];
  gc!();
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < 2000; i++) {
    const begin = performance.now();
    state = context.step(state, IDLE, STEP, planet);
    samples.push(performance.now() - begin);
  }
  const elapsed = performance.now() - start;
  gc!();
  const retainedHeapBytes = process.memoryUsage().heapUsed - before;
  samples.sort((a, b) => a - b);
  context.dispose();
  return { steps: 2000, elapsedMs: elapsed, meanStepMs: elapsed / 2000,
    stepP95Ms: samples[Math.floor(samples.length * .95)], retainedHeapBytes,
    finalPhysicalStateSha256: digest(canonical(state)), finalModuleState: state.moduleState ?? null };
}
const measurements = variants.map(v => ({ variant: v.name, runs: Array.from({ length: 3 }, () => run(v.options)) }));
const expected = measurements[0]!.runs[0]!.finalPhysicalStateSha256;
const physicalStatesEqual = measurements.every(v => v.runs.every(r => r.finalPhysicalStateSha256 === expected));
function sharedRun(withRule: boolean) {
  const world = new World(DEFAULT_UNIVERSE, {
    createContext: (settings, options) => createSimulationContext(settings, { ...options, dynamics: variants[1]!.options.dynamics }),
    rules: withRule ? [{ moduleId: 'measure.shared-rule', version: '0.1.0', hook: {
      modelIdentity: 'zero-command/v1', initialState: { version: 1, value: 0 }, seed: 7,
      evaluate: ({ state, random }) => { random(); return { state: { version: 1, value: (state.value as number) + 1 } }; },
    } }] : [],
  });
  world.spawn({ ownerId: 'measure', presetId: 'planet-orbit' });
  for (let n = 0; n < 200; n++) world.step();
  gc!(); const before = process.memoryUsage().heapUsed, start = performance.now();
  for (let n = 0; n < 2000; n++) world.step();
  const meanStepMs = (performance.now() - start) / 2000;
  gc!(); const retainedHeapBytes = process.memoryUsage().heapUsed - before;
  const result = { meanStepMs, retainedHeapBytes,
    finalPhysicalStateSha256: digest(canonical(world.ship('ship-1')!.state)), finalModuleState: world.moduleState };
  world.dispose(); return result;
}
const sharedWorld = [false, true].map(enabled => ({ enabled, runs: Array.from({ length: 3 }, () => sharedRun(enabled)) }));
const sharedWorldStatesEqual = sharedWorld.every(v => v.runs.every(r => r.finalPhysicalStateSha256 === sharedWorld[0]!.runs[0]!.finalPhysicalStateSha256));
console.log(JSON.stringify({ method: 'Three serial runs per variant, 200 warm steps then 2000 timed 10-ms numerical steps; GC outside timing. Stateful force adds detached input/state copies, staged evaluations and validation. Retained heap includes timing storage and is not allocation/peak memory. This microbenchmark is separate from Phase 0 release budgets.',
  measurements, physicalStatesEqual, sharedWorld, sharedWorldStatesEqual }));
if (!physicalStatesEqual || !sharedWorldStatesEqual) process.exitCode = 1;
