import { describe, expect, it } from 'vitest';
import type { Body, DynamicsProvider, ForceExtension, ForceHook, ModuleState, RegisteredModule, State } from '../../packages/game-api/src/index';
import { MAX_MODULE_STATE_BYTES, validateModuleState } from '../../packages/game-runtime/src/motion';
import { DEFAULT_PROFILE, builtinManifest, prepareGame } from '../../packages/modules/src/index';
import { createSimulationContext, initialState, planet } from '../../packages/sim-core/src/context';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { saveWorld } from '../../packages/sim-core/src/save';
import { HostSession } from '../../packages/net/src/host';
import { loopback } from '../../packages/net/src/connection';
import { OCEAN_UNIVERSE, TERRAIN_UNIVERSE } from '../../packages/scenarios/builtin';
import { MOTION_EXAMPLES, motionExampleProfile } from '../../examples/modules/motion';
import { Prediction } from '../../apps/web/src/prediction';

const zero = (): ForceHook => ({ modelIdentity: 'zero/v1', initialState: { version: 1, value: 0 },
  evaluate: () => ({ x: 0, y: 0 }), commit: ({ moduleState }) => ({ version: 1, value: (moduleState.value as number) + 1 }) });
const extension = (hook = zero(), moduleId = 'test.force'): ForceExtension => ({ moduleId, version: '0.1.0', hook });
const numerical: DynamicsProvider = { id: 'test.numerical', version: '0.1.0', modelIdentity: 'numerical/v1', supportsForces: true, step: (input, services) => services.numerical(input) };
const smallBody: Body = { id: 'tiny', radius: 1, mu: 1e-30 };
const free: State = { ...initialState(), status: 'flying', position: { x: 0, y: 1000 }, velocity: { x: 0, y: 1 }, time: 1 };
function withForce(hook = zero()): World {
  return new World(DEFAULT_UNIVERSE, { soloPreview: false, createContext: settings => createSimulationContext(settings, { forces: [extension(hook)] }) });
}

describe('motion provider and authoritative force boundary', () => {
  it('integrates a constant acceleration at both KDK stages and commits state once', () => {
    const epochs: number[] = [];
    const context = createSimulationContext({}, { forces: [extension({ ...zero(), evaluate: input => {
      epochs.push(input.time);
      expect(input.tick).toBe(100);
      expect(Object.isFrozen(input.state)).toBe(true);
      return { x: 4, y: 0 };
    } })] });
    const next = context.advance(free, IDLE, STEP, smallBody);
    expect(epochs).toEqual([1, 1.01]);
    expect(next.position.x).toBe(.0002);
    expect(next.velocity.x).toBe(.04);
    expect(next.position.y).toBe(1000.01);
    expect(next.moduleState?.['test.force']).toEqual({ version: 1, value: 1 });
    expect(free.moduleState).toBeUndefined();
  });

  it('actually delegates replacement motion, validates it, and drops old analytic caches', () => {
    const context = createSimulationContext({}, { dynamics: { ...numerical, step: input => ({ ...input.state,
      time: input.state.time + input.seconds, revision: input.state.revision + 1,
      position: { x: 12, y: 2000 }, velocity: { x: 0, y: 0 } }) } });
    const start = createSimulationContext().advance(initialState('planet-orbit'), IDLE, STEP, planet);
    const next = context.advance(start, IDLE, STEP, planet);
    expect(next.position).toEqual({ x: 12, y: 2000 });
    expect(next.coast).toBeUndefined(); expect(next.solver).toBeUndefined();
    expect(context.keplerCoast(next, planet)).toBeUndefined();
    expect(context.coastAt(start.coast!, 2, planet)).toMatchObject({ ok: false, diagnostics: { reason: expect.stringContaining('unavailable') } });
  });

  it('lets a replacement evaluate the active forces and rejects providers without force support', () => {
    const forces = [extension({ ...zero(), evaluate: () => ({ x: 4, y: 0 }) })];
    expect(() => createSimulationContext({}, { forces, dynamics: { ...numerical, supportsForces: false } })).toThrow('does not support force');
    const context = createSimulationContext({}, { forces, dynamics: { ...numerical, step(input, services) {
      const acceleration = services.acceleration(input.state.time, input.state.position, input.state.velocity);
      return { ...input.state, time: input.state.time + input.seconds, revision: input.state.revision + 1,
        velocity: { x: acceleration.x * input.seconds, y: 1 } };
    } } });
    expect(context.advance(free, IDLE, STEP, smallBody).velocity).toEqual({ x: .04, y: 1 });
    expect(() => createSimulationContext({}, { forces, dynamics: { ...numerical, step(input, services) {
      services.acceleration(input.state.time + 1, input.state.position, input.state.velocity);
      return input.state;
    } } }).advance(free, IDLE, STEP, smallBody)).toThrow('invalid integrator stage');
  });

  it('evaluates fractional water-entry stages but commits exactly once for the outer tick', () => {
    const epochs: number[] = [];
    const body: Body = { id: 'water', radius: 10, mu: 100 };
    const surface = createSurfaceProfile(10, [-2, -2, -2, -2], 0, 10);
    const context = createSimulationContext({}, { forces: [extension({ ...zero(), evaluate(input) {
      epochs.push(input.time); return { x: 0, y: 0 };
    } })] });
    const start: State = { ...free, time: 0, heading: 0, position: { x: 10.001, y: 0 }, velocity: { x: -1, y: 0 } };
    const next = context.advance(start, IDLE, STEP, body, surface);
    expect(next.waterEntry?.time).toBeGreaterThan(0);
    expect(next.waterEntry?.time).toBeLessThan(STEP);
    expect(epochs).toContain(next.waterEntry?.time);
    expect(epochs.at(-1)).toBeCloseTo(STEP, 15);
    expect(next.moduleState?.['test.force']?.value).toBe(1);
  });

  for (const example of ['force', 'numerical'] as const) it(`${example} example flies, predicts the same idle motion, and stays solo`, () => {
    const prepared = prepareGame({ environment: 'node', code: MOTION_EXAMPLES, profile: motionExampleProfile(example) });
    const world = prepared.world;
    prepared.runtime.activate(prepared.candidate);
    const ship = world.spawn({ ownerId: 'pilot' });
    world.setControls(ship.id, { ...IDLE, engine: true });
    for (let i = 0; i < 100; i++) expect(world.step().filter(e => e.type === 'fault')).toEqual([]);
    expect(world.ship(ship.id)!.state.status).toBe('flying');
    world.setControls(ship.id, IDLE);
    const start = world.ship(ship.id)!.state;
    const clone = world.context.cloneForPrediction();
    expect(clone.modelIdentity).toBe(world.context.modelIdentity);
    const job = clone.predict(start, false, world.body(ship.bodyId), world.surface(ship.bodyId));
    job.next();
    for (let i = 0; i < 20; i++) {
      world.step();
      const sample = job.next();
      expect(sample.done).toBe(false);
      if (!sample.done) {
        expect(sample.value.position).toEqual(world.ship(ship.id)!.state.position);
        expect(sample.value.velocity).toEqual(world.ship(ship.id)!.state.velocity);
      }
    }
    job.return('open'); clone.dispose();
    expect(world.context.capabilities).toEqual({ analyticCoast: false, rails: false, orbitalDiagnostics: false, legacyCompatible: false });
    expect(world.soloPreview).toBe(true);
    expect(() => saveWorld(world)).toThrow('solo');
    const host = new HostSession(world);
    expect(() => host.accept(loopback()[0])).toThrow('cannot host multiplayer');
    world.dispose();
  });

  it('does not enable installed developer modules, and retains the exact default identity', () => {
    const prepared = prepareGame({ environment: 'node', code: MOTION_EXAMPLES });
    expect(prepared.profile).toEqual(DEFAULT_PROFILE);
    expect(prepared.world.soloPreview).toBe(false);
    expect(prepared.world.context.modelIdentity).toBe(createSimulationContext(prepared.world.context.vehicle).modelIdentity);
    expect(prepared.candidate.forceExtensions).toEqual([]);
    prepared.candidate.dispose();
  });

  it('runs hooks in resolved before/after order with stable module ties', () => {
    const calls: string[] = [];
    const module = (id: string, before: string[] = []): RegisteredModule => ({
      manifest: { ...builtinManifest(id, []), before },
      initialize: c => c.contributeForce({ ...zero(), evaluate() { calls.push(id); return { x: 0, y: 0 }; } }),
    });
    const code = [module('test.z', ['test.a']), module('test.a'), module('test.b')];
    const prepared = prepareGame({ environment: 'node', code, profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, ...code.map(m => ({ id: m.manifest.id, version: m.manifest.version }))] } });
    const ship = prepared.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    prepared.world.step();
    expect(calls).toEqual(['test.b', 'test.z', 'test.a', 'test.b', 'test.z', 'test.a']);
    expect(prepared.world.ship(ship.id)!.state.moduleState?.['test.a']?.value).toBe(1);
    prepared.candidate.dispose();
  });

  it('captures configuration and rejects late registration or mutation during a flight', () => {
    const hook = zero(), forces = [extension(hook)];
    const context = createSimulationContext({}, { forces });
    const identity = context.modelIdentity;
    (hook as { evaluate: ForceHook['evaluate'] }).evaluate = () => ({ x: 999, y: 999 });
    forces.length = 0;
    const next = context.advance(free, IDLE, STEP, smallBody);
    expect(next.velocity.x).toBe(0);
    expect(context.modelIdentity).toBe(identity);
    expect(() => Object.assign(context, { modelIdentity: 'changed mid-flight' })).toThrow();
    const prepared = prepareGame({ environment: 'node', code: MOTION_EXAMPLES, profile: motionExampleProfile('force') });
    expect(() => prepared.candidate.contributeForce('test.late', '0.1.0', zero())).toThrow('late');
    prepared.candidate.dispose();
    expect(createSimulationContext({}, { forces: [extension({ ...zero(), modelIdentity: 'other parameters' })] }).modelIdentity).not.toBe(identity);
  });

  it('keeps state copies isolated between two worlds and suspended prediction jobs', () => {
    const a = withForce(), b = withForce();
    const shipA = a.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const shipB = b.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    a.step(); b.step();
    const live = a.ship(shipA.id)!.state;
    const clone = a.context.cloneForPrediction();
    const job = clone.predict(live, false, a.body(shipA.bodyId));
    job.next();
    for (let i = 0; i < 40; i++) job.next();
    expect(a.ship(shipA.id)!.state).toBe(live);
    expect(live.moduleState?.['test.force']?.value).toBe(1);
    a.step();
    expect(a.ship(shipA.id)!.state.moduleState?.['test.force']?.value).toBe(2);
    expect(b.ship(shipB.id)!.state.moduleState?.['test.force']?.value).toBe(1);
    expect(Object.isFrozen(live.moduleState?.['test.force'])).toBe(true);
    job.return('open'); clone.dispose(); a.dispose(); b.dispose();
  });

  it('never sleeps custom motion, including wrecks and resting ships, and respects control changes', () => {
    const a = withForce(), b = withForce(); b.rails = false;
    for (const w of [a, b]) {
      for (const presetId of ['pad', 'planet-orbit']) w.spawn({ ownerId: 'pilot', presetId });
      const wreck = w.spawn({ ownerId: 'pilot' });
      w.put({ ...wreck, state: { ...wreck.state, status: 'crashed' } });
    }
    for (let i = 0; i < 250; i++) {
      for (const w of [a, b]) w.setControls('ship-1', { turn: i < 25 ? .4 : 0, throttle: i < 60 ? .1 : 0, engine: i < 100 });
      expect(a.step()).toEqual(b.step());
      expect(a.ships()).toEqual(b.ships());
      expect(a.asleepCount).toBe(0);
    }
    a.dispose(); b.dispose();
  });

  for (const base of [TERRAIN_UNIVERSE, OCEAN_UNIVERSE]) it(`keeps numerical/contact equivalence in ${base.id}`, () => {
    const builtin = new World(base), custom = new World(base, { createContext: settings => createSimulationContext(settings, { dynamics: numerical }) });
    for (const preset of builtin.system.presets) {
      let a = builtin.presetState(preset.id).state, b = custom.presetState(preset.id).state;
      const body = builtin.body(preset.bodyId), surface = builtin.surface(preset.bodyId);
      for (let i = 0; i < 250; i++) {
        a = builtin.context.step(a, IDLE, STEP, body, surface);
        b = custom.context.advance(b, IDLE, STEP, body, surface);
        expect(b).toEqual(a);
      }
    }
    builtin.dispose(); custom.dispose();
  });

  it('rolls back every staged namespace on commit failure and faults only the failing ship', () => {
    const bad: ForceHook = { ...zero(), commit(input) {
      if (Math.hypot(input.state.position.x, input.state.position.y) <= input.body.radius + 1) throw new Error('rejected proposal');
      return { version: 1, value: 1 };
    } };
    const world = new World(DEFAULT_UNIVERSE, { createContext: settings => createSimulationContext(settings, {
      forces: [extension(zero(), 'test.first'), extension(bad, 'test.second')],
    }) });
    const pad = world.spawn({ ownerId: 'pilot' });
    world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const events = world.step();
    expect(events).toEqual([{ type: 'fault', shipId: pad.id, message: expect.stringContaining('Module test.second force.commit tick 0') }]);
    expect(world.ship(pad.id)!.state).toBe(pad.state);
    expect(world.ship(pad.id)!.state.moduleState).toBeUndefined();
    expect(world.ship('ship-2')!.state.moduleState?.['test.first']?.value).toBe(1);
    world.dispose();
  });

  for (const acceleration of [NaN, Infinity, 10001]) it(`rejects invalid acceleration ${acceleration} without committing state`, () => {
    const w = withForce({ ...zero(), evaluate: () => ({ x: acceleration, y: 0 }) });
    const ship = w.spawn({ ownerId: 'pilot' });
    expect(w.step()).toEqual([{ type: 'fault', shipId: ship.id, message: expect.stringContaining('test.force force.evaluate tick 0') }]);
    expect(w.ship(ship.id)!.state).toBe(ship.state);
    w.dispose();
  });

  it('rejects async/invalid provider results and attempts to mutate read-only inputs', () => {
    for (const step of [
      () => Promise.resolve(free) as unknown as State,
      () => ({ ...free, time: 1.01, position: { x: NaN, y: 1000 } }),
      (input: { state: State }) => { Object.assign(input.state.position, { y: 2000 }); return free; },
    ]) {
      const context = createSimulationContext({}, { dynamics: { ...numerical, step } });
      expect(() => context.advance(free, IDLE, STEP, smallBody)).toThrow('test.numerical dynamics.step tick 100');
      expect(free.position).toEqual({ x: 0, y: 1000 });
    }
    const context = createSimulationContext({}, { forces: [extension({ ...zero(), commit: () => ({ version: 2, value: 0 }) })] });
    expect(() => context.advance(free, IDLE, STEP, smallBody)).toThrow('schema changes require a restart');
  });

  it('validates finite, versioned, size-bounded state, including failed prediction jobs', () => {
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    for (const value of [NaN, Infinity, undefined, cyclic, new Date(), new Array(2), 'x'.repeat(MAX_MODULE_STATE_BYTES)]) {
      expect(() => validateModuleState({ version: 1, value } as ModuleState)).toThrow();
    }
    expect(() => validateModuleState({ version: 0, value: 1 })).toThrow('schema version');
    const context = createSimulationContext({}, { forces: [extension({ ...zero(), evaluate() { throw new Error('bad'); } })] });
    const job = context.cloneForPrediction().predict(free, false, smallBody);
    job.next(); expect(job.next()).toEqual({ done: true, value: 'failed' });
    expect(() => context.advance({ ...free, moduleState: { 'test.unknown': { version: 1, value: 0 } } }, IDLE, STEP, smallBody)).toThrow('no active force hook');
  });

  it('lets idle numerical previews progress, then invalidates them at command boundaries', () => {
    const w = withForce();
    const ship = w.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const preview = new Prediction(() => {});
    preview.update(w.context, ship.state, w.body(ship.bodyId), undefined, ship.id, 0, false, IDLE);
    w.step();
    preview.update(w.context, w.ship(ship.id)!.state, w.body(ship.bodyId), undefined, ship.id, 0, false, IDLE);
    expect(preview.passCount).toBe(1);
    w.setThrottle(ship.id, .7);
    preview.update(w.context, w.ship(ship.id)!.state, w.body(ship.bodyId), undefined, ship.id, 0, false, IDLE);
    expect(preview.passCount).toBe(2);
    w.setControls(ship.id, { ...IDLE, turn: 1 }); w.step();
    preview.update(w.context, w.ship(ship.id)!.state, w.body(ship.bodyId), undefined, ship.id, 0, false, { ...IDLE, turn: 1 });
    expect(preview.passCount).toBe(3);
    preview.invalidate(); w.dispose();
  });
});
