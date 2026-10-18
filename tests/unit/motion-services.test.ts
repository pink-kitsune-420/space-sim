import { describe, expect, it } from 'vitest';
import type { BodyFrameProvider, ModuleProfile, OrbitalProvider, RailsProvider, RegisteredModule, State, SurfaceProvider } from '../../packages/game-api/src/index';
import { DEFAULT_PROFILE, builtinManifest, prepareGame, loadInstalledWorld } from '../../packages/modules/src/index';
import { createSimulationContext, initialState, planet } from '../../packages/sim-core/src/context';
import { BUILTIN_SERVICES } from '../../packages/sim-core/src/services';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { TERRAIN_UNIVERSE } from '../../packages/scenarios/builtin';
import { World } from '../../packages/sim-core/src/world';
import { saveWorld } from '../../packages/sim-core/src/save';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';

const identity = (id: string) => ({ id, version: '0.1.0', modelIdentity: `${id}/v1` });
function installed(slot: string, provider: unknown): { code: RegisteredModule[]; profile: ModuleProfile } {
  const id = `test.${slot}`;
  return { code: [{ manifest: builtinManifest(id, [slot]), initialize: c => c.provide(slot, provider) }],
    profile: { ...DEFAULT_PROFILE, modules: [...DEFAULT_PROFILE.modules, { id, version: '0.1.0' }],
      providers: { ...DEFAULT_PROFILE.providers, [slot]: id } } };
}
const orbit = (extra: Partial<OrbitalProvider> = {}): OrbitalProvider => ({ ...BUILTIN_SERVICES.orbits, ...identity('test.orbits'), ...extra });

describe('selected motion services', () => {
  it('registers the built-in service bundle and keeps its optimized legacy identity', () => {
    const prepared = prepareGame({ environment: 'node' });
    for (const slot of ['orbits', 'bodies', 'surfaces', 'rails']) expect(prepared.candidate.lock.providers[slot]).toBe('builtin.motion');
    expect(prepared.world.context.modelIdentity).toBe(createSimulationContext().modelIdentity);
    expect(prepared.world.soloPreview).toBe(false);
    prepared.candidate.dispose();
  });

  it('restores a selected custom orbital provider coast only with the same model identity', () => {
    const selected = installed('orbits', orbit()), code = selected.code.map(module => ({ ...module, supportsMultiplayer: true }));
    const prepared = prepareGame({ environment: 'node', ...selected, code });
    try {
      const ship = prepared.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
      for (let tick = 0; tick < 50; tick++) prepared.world.step();
      const save = JSON.parse(JSON.stringify(saveWorld(prepared.world)));
      expect(save.ships[0].coast).toBeDefined();
      const loaded = loadInstalledWorld(save, { environment: 'node', code });
      try {
        expect(loaded.world.ship(ship.id)!.state.coast?.modelIdentity).toBe(prepared.world.context.modelIdentity);
        for (let tick = 0; tick < 50; tick++) { expect(loaded.world.step()).toEqual(prepared.world.step()); }
        expect(loaded.world.ship(ship.id)!.state.position).toEqual(prepared.world.ship(ship.id)!.state.position);
        expect(loaded.world.ship(ship.id)!.state.velocity).toEqual(prepared.world.ship(ship.id)!.state.velocity);
      } finally { loaded.world.dispose(); }
      save.ships[0].coast.modelIdentity = 'other-model';
      expect(() => loadInstalledWorld(save, { environment: 'node', code })).toThrow('coast epoch is unusable');
    } finally { prepared.candidate.dispose(); }
  });

  it('checks replacement propagation against an independent circular solution and uses it in prediction', () => {
    let propagationCalls = 0;
    const provider = orbit({ propagate: (...args) => { propagationCalls++; return BUILTIN_SERVICES.orbits.propagate(...args); } });
    const context = createSimulationContext({}, { services: { orbits: provider } });
    const body = { id: 'oracle', mu: 1000, radius: 1 }, radius = 100;
    let state: State = { ...initialState(), position: { x: radius, y: 0 }, velocity: { x: 0, y: Math.sqrt(body.mu / radius) }, status: 'flying' };
    const start = state;
    for (let n = 0; n < 1000; n++) state = context.advance(state, IDLE, STEP, body);
    const theta = Math.sqrt(body.mu / radius ** 3) * state.time;
    expect(Math.abs(state.position.x - radius * Math.cos(theta))).toBeLessThan(1e-10);
    expect(Math.abs(state.position.y - radius * Math.sin(theta))).toBeLessThan(1e-10);
    const prediction = context.cloneForPrediction();
    const job = prediction.predict(start, false, body);
    job.next(); const sample = job.next().value;
    expect(typeof sample).toBe('object'); expect(propagationCalls).toBeGreaterThan(1000);
    expect(context.capabilities.rails).toBe(false); // replacement has no verified built-in binding
    prediction.dispose(); context.dispose();
  });

  it('offers numerical motion and matching ghosts when analytic services are unavailable', () => {
    const unavailable = orbit({ analytic: false, elements() { throw new Error('unavailable'); }, propagate() { throw new Error('unavailable'); } });
    const p = prepareGame({ environment: 'node', ...installed('orbits', unavailable) });
    const ship = p.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const clone = p.world.context.cloneForPrediction();
    const job = clone.predict(ship.state, false, planet); job.next();
    for (let n = 0; n < 20; n++) {
      p.world.step();
      expect(job.next().value).toMatchObject({ position: p.world.ship(ship.id)!.state.position, velocity: p.world.ship(ship.id)!.state.velocity });
    }
    expect(p.world.asleepCount).toBe(0);
    expect(p.world.context.capabilities.orbitalDiagnostics).toBe(false);
    clone.dispose(); p.candidate.dispose();
  });

  it('invalidates coast records across selected model identities and captures registration values', () => {
    const provider = orbit();
    const a = createSimulationContext({}, { services: { orbits: provider } });
    const state = a.advance(initialState('planet-orbit'), IDLE, STEP, planet);
    Object.assign(provider, { modelIdentity: 'changed', propagate() { throw new Error('mutated'); } });
    expect(a.coastAt(state.coast!, 1, planet).ok).toBe(true);
    const b = createSimulationContext({}, { services: { orbits: orbit({ modelIdentity: 'other' }) } });
    expect(b.coastAt(state.coast!, 1, planet)).toMatchObject({ ok: false });
    expect(b.advance(state, IDLE, STEP, planet).coast).not.toBe(state.coast);
    expect(a.cloneForPrediction().modelIdentity).toBe(a.modelIdentity);
  });

  it('routes frame changes through the selected body service and preserves inertial position and velocity', () => {
    let transitions = 0;
    const bodies: BodyFrameProvider = { ...identity('test.bodies'), load(universe, systemId, surfaces) {
      const system = BUILTIN_SERVICES.bodies.load(universe, systemId, surfaces);
      return { ...system, checkSOI(state, current, time) {
        if (current === 'moon') return system.checkSOI(state, current, time);
        transitions++;
        const moon = system.getResolvedBody('moon');
        const p = system.getBodyPosition('moon', time), v = system.getBodyVelocity('moon', time);
        return { switched: true, newBody: moon, newState: { ...state,
          position: { x: state.position.x - p.x, y: state.position.y - p.y },
          velocity: { x: state.velocity.x - v.x, y: state.velocity.y - v.y },
          revision: state.revision + 1, coast: undefined, water: undefined } };
      } };
    } };
    const p = prepareGame({ environment: 'node', ...installed('bodies', bodies) });
    const ship = p.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const local = p.world.context.advance(ship.state, IDLE, STEP, p.world.body(ship.bodyId));
    expect(p.world.step()).toContainEqual({ type: 'soi', shipId: ship.id, from: 'planet', to: 'moon' });
    const after = p.world.ship(ship.id)!;
    const offset = p.world.system.getBodyPosition('moon', after.state.time);
    const speed = p.world.system.getBodyVelocity('moon', after.state.time);
    expect(after.state.position.x + offset.x).toBeCloseTo(local.position.x, 9);
    expect(after.state.velocity.y + speed.y).toBeCloseTo(local.velocity.y, 9);
    expect(after.bodyId).toBe('moon'); expect(transitions).toBe(1);
    expect(p.world.asleepCount).toBe(0);
    p.candidate.dispose();
  });

  it('rejects invalid body transitions without committing a ship or contact event', () => {
    const bodies: BodyFrameProvider = { ...identity('test.bodies'), load(...args) {
      const system = BUILTIN_SERVICES.bodies.load(...args);
      return { ...system, checkSOI: state => ({ switched: true, newBody: system.rootBody,
        newState: { ...state, position: { x: NaN, y: 0 } } }) };
    } };
    const p = prepareGame({ environment: 'node', ...installed('bodies', bodies) });
    const ship = p.world.spawn({ ownerId: 'pilot' });
    expect(p.world.step()).toEqual([{ type: 'fault', shipId: ship.id, message: expect.stringContaining('body/frame') }]);
    expect(p.world.ship(ship.id)!.state).toBe(ship.state);
    p.candidate.dispose();
  });

  it('uses selected geometry for generation, preset support, live contact and prediction', () => {
    const calls = { generate: 0, support: 0, query: 0, sweep: 0 };
    const surfaces: SurfaceProvider = { ...BUILTIN_SERVICES.surfaces, ...identity('test.surfaces'),
      generate(body) { calls.generate++; return BUILTIN_SERVICES.surfaces.generate(body); },
      support(...args) { calls.support++; return BUILTIN_SERVICES.surfaces.support(...args); },
      query(...args) { calls.query++; return BUILTIN_SERVICES.surfaces.query(...args); },
      sweep(...args) { calls.sweep++; return BUILTIN_SERVICES.surfaces.sweep(...args); },
    };
    const p = prepareGame({ environment: 'node', universe: TERRAIN_UNIVERSE, ...installed('surfaces', surfaces) });
    p.world.spawn({ ownerId: 'pilot' });
    expect(calls.generate).toBeGreaterThan(0); expect(calls.support).toBeGreaterThan(0);
    const context = p.world.context, body = { id: 'fixture', radius: 10, mu: 1 };
    const profile = createSurfaceProfile(10, [0, 0, 0, 0]);
    const start: State = { ...initialState(), status: 'flying', position: { x: 10.001, y: 0 }, velocity: { x: -1, y: 0 }, heading: 0 };
    const next = context.advance(start, IDLE, STEP, body, profile);
    expect(next.contact?.time).toBeCloseTo(.001, 6);
    const clone = context.cloneForPrediction(), job = clone.predict(start, false, body, profile);
    job.next(); expect(job.next().value).toMatchObject({ position: next.position, time: next.contact!.time });
    expect(calls.query).toBeGreaterThan(0); expect(calls.sweep).toBeGreaterThan(1);
    clone.dispose(); p.candidate.dispose();
  });

  for (const bound of [0, NaN, -1, undefined, 'Infinity']) it(`steps normally for an unknown/invalid rails horizon (${bound})`, () => {
    let calls = 0;
    const rails: RailsProvider = { ...BUILTIN_SERVICES.rails, ...identity('test.rails'), horizon() { calls++; return bound as number; } };
    const p = prepareGame({ environment: 'node', ...installed('rails', rails) });
    p.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    for (let n = 0; n < 10; n++) p.world.step();
    expect(calls).toBeGreaterThan(0); expect(p.world.asleepCount).toBe(0);
    expect(p.world.ship('ship-1')!.state.time).toBeCloseTo(.1, 12);
    p.candidate.dispose();
  });

  it('retains exact rails parity for an explicitly compatible replacement policy across controls', () => {
    const rails: RailsProvider = { ...BUILTIN_SERVICES.rails, ...identity('test.rails') };
    const fast = prepareGame({ environment: 'node', ...installed('rails', rails) }).world;
    const plain = new World(DEFAULT_UNIVERSE); plain.rails = false;
    for (const w of [fast, plain]) w.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    for (let tick = 0; tick < 200; tick++) {
      if (tick === 50 || tick === 80) for (const w of [fast, plain]) w.setControls('ship-1', { ...IDLE, engine: tick === 50 });
      expect(fast.step()).toEqual(plain.step());
      if (tick % 10 === 0) {
        const actual = fast.ship('ship-1')!.state, expected = plain.ship('ship-1')!.state;
        // Identity metadata differs; all physical fields, solver and revisions are exact.
        expect({ ...actual, coast: actual.coast && { ...actual.coast, modelIdentity: undefined } })
          .toEqual({ ...expected, coast: expected.coast && { ...expected.coast, modelIdentity: undefined } });
      }
    }
    fast.dispose(); plain.dispose();
  });

  it('rejects malformed service contracts during candidate construction', () => {
    expect(() => createSimulationContext({}, { services: { orbits: { id: 'bad' } as OrbitalProvider } })).toThrow('Invalid orbits provider');
    expect(() => createSimulationContext({}, { services: { rails: { ...BUILTIN_SERVICES.rails, compatible: [{}] } as unknown as RailsProvider } })).toThrow('Invalid rails compatibility');
  });
});
