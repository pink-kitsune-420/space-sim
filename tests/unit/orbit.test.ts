import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/orbits.json';
import { advance, Clock, COAST_CACHE_BUDGET, COAST_CACHE_CAPACITY, coastAt, coastCacheStats, elements, IDLE, initialState, magnitude, planet, predict, propagate, STEP,
  step, stumpff, timeToApsis, timeToRadius, type OrbitalState, type State } from '../../packages/sim-core/src/index';

function solved(s: OrbitalState, mu: number, dt: number): OrbitalState {
  const result = propagate(s, mu, dt);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.reason!);
  return result.state;
}
function error(a: OrbitalState, b: OrbitalState, L = 1, V = 1): number {
  return Math.max(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) / L,
    Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y) / V);
}

describe('universal-variable kernel under Node', () => {
  it.each(fixtures.fixtures)('agrees with independent refined RK4: $id', f => {
    expect(error(solved(f.input, f.mu, f.seconds), f.expected, f.lengthScale, f.speedScale))
      .toBeLessThan(f.normalizedTolerance);
  });
  it.each([-1, 1])('matches circular quarter/full periods through 100 revolutions, direction %s', direction => {
    const s = { position: { x: 1, y: 0 }, velocity: { x: 0, y: direction } };
    for (const cycles of [0, 1e-10, -.25, .25, 1, 10.25, 100, 100.25]) {
      const a = 2 * Math.PI * cycles;
      const expected = { position: { x: Math.cos(a), y: direction * Math.sin(a) },
        velocity: { x: -Math.sin(a), y: direction * Math.cos(a) } };
      expect(error(solved(s, 1, a), expected)).toBeLessThan(1e-9);
    }
  });
  it.each([.1, .9, .999])('locates eccentric apoapsis and returns from 100 periods, e=%s', eccentricity => {
    // Start at apoapsis (L=1). Known periapsis avoids using the production anomaly solver as oracle.
    const a = 1 / (1 + eccentricity), rp = a * (1 - eccentricity);
    const s = { position: { x: 1, y: 0 }, velocity: { x: 0, y: Math.sqrt(1 - eccentricity) } };
    const period = 2 * Math.PI * a ** 1.5;
    const pe = solved(s, 1, period / 2);
    expect(error(pe, { position: { x: -rp, y: 0 }, velocity: { x: 0, y: -Math.sqrt((1 + eccentricity) / rp) } }))
      .toBeLessThan(1e-8); // Small periapsis amplifies absolute velocity conditioning.
    expect(error(solved(s, 1, period * 100), s)).toBeLessThan(1e-9);
  });
  it('preserves energy and signed momentum, reverses time and composes partitions', () => {
    for (const fixture of fixtures.fixtures) {
      const { input, mu, seconds, lengthScale: L, speedScale: V } = fixture;
      const final = solved(input, mu, seconds);
      const before = elements(input, mu), after = elements(final, mu);
      expect(Math.abs(after.energy - before.energy) / (V * V)).toBeLessThan(1e-10);
      expect(Math.abs(after.angularMomentum - before.angularMomentum) / (L * V)).toBeLessThan(1e-10);
      if (Math.abs(before.energy / (V * V)) > 1e-5) {
        expect(Math.abs((after.energy - before.energy) / before.energy)).toBeLessThan(1e-10);
      }
      if (!before.radial) expect(Math.abs(after.angularMomentum / before.angularMomentum - 1)).toBeLessThan(1e-10);
      expect(error(solved(final, mu, -seconds), input, L, V)).toBeLessThan(1e-9);
      const halfway = solved(input, mu, seconds / 2);
      expect(error(solved(halfway, mu, seconds / 2), final, L, V)).toBeLessThan(1e-9);
    }
  });
  it('returns signed elements, stable apsides and absent ambiguous angles/events', () => {
    const circle = initialState('planet-orbit');
    const e = elements(circle, planet.mu);
    expect(e.angularMomentum).toBeLessThan(0);
    expect(e.periapsis).toBeCloseTo(640, 10);
    expect(e.apoapsis).toBeCloseTo(640, 10);
    expect(e.periapsisAngle).toBeNull();
    expect(timeToApsis(circle, planet.mu, 'periapsis')).toBeNull();
    expect(timeToRadius(circle, planet.mu, 640)).toBeNull();
    const hyperbola = elements({ position: { x: 1, y: 0 }, velocity: { x: 0, y: 2 } }, 1);
    expect(hyperbola.kind).toBe('hyperbolic');
    expect(hyperbola.apoapsis).toBeNull();
    expect(hyperbola.period).toBeNull();
    expect(hyperbola.periapsis).toBeCloseTo(1);
  });
  it.each([.1, .9, 1 - 1e-10, 1, 1 + 1e-10, 1.1, 2])('radius/event times agree with propagated geometry, e=%s', e => {
    const s = { position: { x: 1, y: 0 }, velocity: { x: 0, y: Math.sqrt(1 + e) } };
    const dt = timeToRadius(s, 1, 1.1, 'outbound');
    expect(dt).not.toBeNull();
    expect(magnitude(solved(s, 1, dt!).position)).toBeCloseTo(1.1, 10);
    const pe = timeToApsis(s, 1, 'periapsis');
    expect(pe).toBeCloseTo(0);
    const apo = timeToApsis(s, 1, 'apoapsis');
    if (e < 1) expect(Math.abs(magnitude(solved(s, 1, apo!).position) / elements(s, 1).apoapsis! - 1)).toBeLessThan(1e-12);
    else expect(apo).toBeNull();
    expect(timeToRadius(s, 1, .5)).toBeNull();
  });
  it('supports radial motion up to collision and rejects intervals through the singularity in either time direction', () => {
    for (const speed of [0, -.3, -Math.sqrt(2), -2]) {
      const s = { position: { x: 1, y: 0 }, velocity: { x: speed, y: 0 } };
      const dt = timeToRadius(s, 1, .5)!;
      expect(dt).toBeGreaterThan(0);
      expect(magnitude(solved(s, 1, dt).position)).toBeCloseTo(.5, 10);
      const collision = timeToRadius(s, 1, 0)!;
      expect(collision).toBeGreaterThan(dt);
      expect(propagate(s, 1, collision * 1.01).ok).toBe(false);
      expect(propagate({ ...s, velocity: { x: -speed, y: 0 } }, 1, -collision * 1.01).ok).toBe(false);
    }
  });
  it('uses stable Stumpff values near zero and at finite positive/negative arguments', () => {
    expect(stumpff(0)).toEqual({ c: .5, s: 1 / 6 });
    for (const z of [-100, -1, -1e-12, 1e-12, 1, 100]) {
      const { c, s } = stumpff(z), root = Math.sqrt(Math.abs(z));
      if (Math.abs(z) < 1e-8) { expect(c).toBeCloseTo(.5, 11); expect(s).toBeCloseTo(1 / 6, 11); }
      else {
        expect(c).toBeCloseTo(z > 0 ? (1 - Math.cos(root)) / z : (Math.cosh(root) - 1) / -z, 10);
        expect(s).toBeCloseTo(z > 0 ? (root - Math.sin(root)) / root ** 3 : (Math.sinh(root) - root) / root ** 3, 10);
      }
    }
  });
  it('converges on hyperbolic arcs whose cancellation residual floor sits above the tolerance', () => {
    // Inbound escape arc that used to spin to the iteration limit (bugs.md B18).
    const s = { position: { x: -95075400.73535405, y: 84571443.31614678 },
      velocity: { x: 381.75955921210385, y: -335.5154437488568 } };
    const mu = 4288033571153.716, dt = 975613.8541723267;
    const final = solved(s, mu, dt);
    const before = elements(s, mu), after = elements(final, mu);
    expect(before.kind).toBe('hyperbolic');
    expect(Math.abs(after.energy / before.energy - 1)).toBeLessThan(1e-10);
    expect(error(solved(final, mu, -dt), s, magnitude(s.position), magnitude(s.velocity))).toBeLessThan(1e-9);
    // Sweep both directions through periapsis: inbound forward and outbound backward.
    for (let i = 0; i < 400; i++) {
      const tilt = 10 ** (-2 - (i % 14)), k = 1.5 + (i % 7) * .2, out = i % 2 ? 1 : -1;
      const v = k * Math.sqrt(1 / 1e3);
      const state = { position: { x: 1e3, y: 0 }, velocity: { x: out * v, y: v * tilt } };
      const result = propagate(state, 1, -out * 10 ** (1 + (i % 9)) * (1 + i / 400));
      expect(result.ok, JSON.stringify({ i, ...result.diagnostics })).toBe(true);
    }
    // An ordinary e≈1.9 flyby of the home planet; a sleeping ship read during warp used to
    // fault at scattered instants on its outbound leg.
    const v = 2.05 * Math.sqrt(2 * planet.mu / 4500);
    const flyby = { position: { x: 4500, y: 0 }, velocity: { x: -v, y: v * .251188643150958 } };
    for (let t = 100; t < 210; t += .01) {
      const result = propagate(flyby, planet.mu, t);
      expect(result.ok, JSON.stringify({ t, ...result.diagnostics })).toBe(true);
    }
  });
  it('bounds work, exercises bracketed fallback and publishes diagnostics without invalid states', () => {
    const s = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1.2 } };
    const fallback = propagate(s, 1, .7, { maxNewtonIterations: 0 });
    expect(fallback.ok).toBe(true);
    expect(fallback.diagnostics.usedBisection).toBe(true);
    for (const result of [propagate(s, 1, .7, { maxIterations: 0 }),
      propagate(s, 1, .7, { maxBracketIterations: 0 }), propagate(s, 0, .7), propagate(s, 1, NaN),
      propagate({ ...s, position: { x: 0, y: 0 } }, 1, .7),
      propagate({ ...s, velocity: { x: 1e308, y: 0 } }, 1, 1e308)]) {
      expect(result.ok).toBe(false);
      expect(result.diagnostics.reason).toBeTruthy();
      expect('state' in result).toBe(false);
      expect(result.diagnostics.iterations).toBeLessThanOrEqual(96);
    }
    expect(() => stumpff(-1e308)).toThrow();
    expect(() => elements(s, NaN)).toThrow();
  });
});

describe('calculated live coast and burn boundaries', () => {
  it('reuses exact timed states, bounds RAM use and isolates caches across burn epochs', () => {
    const state = advance(initialState('planet-orbit'));
    const coast = state.coast!;
    const first = coastAt(coast, .5);
    expect(coastAt(coast, .5)).toBe(first);
    expect(coastCacheStats(coast).hits).toBe(1);
    expect(Object.isFrozen(coast)).toBe(true);
    if (!first.ok) throw new Error(first.diagnostics.reason!);
    expect(Object.isFrozen(first.state.position)).toBe(true);
    for (let i = 0; i < COAST_CACHE_CAPACITY + 10; i++) {
      const result = coastAt(coast, 1 + i * .01);
      expect(result.ok).toBe(true);
    }
    expect(coastCacheStats(coast).samples).toBe(COAST_CACHE_CAPACITY);
    const old = coastAt(coast, .5);
    expect(old).not.toBe(first); // FIFO eviction causes a fresh exact solve, not a stale value.
    expect(old).toEqual(first);
    const burn = advance(state, { ...IDLE, engine: true });
    const next = advance(burn);
    expect(next.coast).not.toBe(coast);
    // Live steps never store their timestamps: each tick asks for a new one.
    expect(coastCacheStats(next.coast).samples).toBe(0);
    coastAt(next.coast!, next.time + 1);
    expect(coastCacheStats(next.coast).samples).toBe(1);
    expect(coastCacheStats(next.coast).hits).toBe(0);
  });
  it('bounds the cache across every coast of a large fleet', () => {
    const coasts = [0, 1, 2, 3, 4].map(i => advance({ ...initialState('planet-orbit'), time: i }).coast!);
    for (const coast of coasts) for (let i = 0; i < 8000; i++) coastAt(coast, coast.epochSeconds + i * .01);
    const total = coasts.reduce((sum, coast) => sum + coastCacheStats(coast).samples, 0);
    expect(total).toBeLessThanOrEqual(COAST_CACHE_BUDGET);
    // The newest coast keeps its entries; the oldest gave them up first.
    expect(coastCacheStats(coasts[4]).samples).toBe(8000);
    expect(coastCacheStats(coasts[0]).samples).toBeLessThan(8000);
  });
  it('does not cache mutable external epoch records', () => {
    const frozen = advance(initialState('planet-orbit')).coast!;
    const mutable = { ...frozen, position: { ...frozen.position }, velocity: { ...frozen.velocity } };
    const before = coastAt(mutable, .2);
    mutable.velocity.x += 1;
    const after = coastAt(mutable, .2);
    expect(after).not.toEqual(before);
    expect(coastCacheStats(mutable).samples).toBe(0);
  });
  it('rejects unknown frames/interior epochs and falls back explicitly from a corrupt coast', () => {
    const live = advance(initialState('planet-orbit'));
    const coast = live.coast!;
    expect(coastAt(coast, 0).ok).toBe(true);
    expect(coastAt({ ...coast, bodyId: 'unknown' }, 1).ok).toBe(false);
    expect(coastAt({ ...coast, position: { x: 0, y: 1 } }, 1).ok).toBe(false);
    expect(coastAt({ ...coast, mu: 1 }, 1).ok).toBe(false);
    expect(coastAt(coast, 1, { ...planet, radius: 630 }).ok).toBe(false);
    const fallback = advance({ ...live, coast: { ...coast, epochSeconds: NaN } });
    expect(fallback.dynamics).toBe('numerical');
    expect(fallback.coast).toBeUndefined();
    expect(fallback.solver!.converged).toBe(false);
    expect(Object.values(fallback.position).every(Number.isFinite)).toBe(true);
  });
  it('keeps the same epoch while coasting/turning and creates a new epoch after each burn', () => {
    let state = advance(initialState('planet-orbit'));
    const coast = state.coast;
    for (let i = 0; i < 20; i++) state = advance(state, { ...IDLE, turn: 1 });
    expect(state.coast).toBe(coast);
    expect(state.dynamics).toBe('kepler');
    for (let j = 0; j < 10; j++) {
      const before = state;
      const burn = advance(state, { ...IDLE, engine: true }, .003);
      expect(burn).toEqual(step(before, { ...IDLE, engine: true }, .003));
      expect(burn.coast).toBeUndefined();
      expect(burn.dynamics).toBe('numerical');
      const coasted = advance(burn, IDLE, .007);
      expect(coasted.coast!.position).toEqual(burn.position);
      expect(coasted.coast!.velocity).toEqual(burn.velocity);
      expect(coasted.coast!.epochSeconds).toBe(burn.time);
      expect(error(coasted, solved(burn, planet.mu, .007), 640, 150)).toBeLessThan(1e-12);
      expect(magnitude({ x: burn.position.x - before.position.x, y: burn.position.y - before.position.y })).toBeLessThan(1);
      state = coasted;
    }
  });
  it('agrees at common epochs across render rates and arbitrary coast partitions', () => {
    const start = initialState('planet-orbit');
    const states = [30, 60, 120, 144].map(hz => {
      let state = start;
      const clock = new Clock();
      for (let i = 0; i < hz * 10; i++) clock.advance(1 / hz, () => { state = advance(state); });
      return state;
    });
    for (const state of states) expect(state).toEqual(states[0]);
    let state = start;
    for (let i = 0; i < 2000; i++) state = advance(state, IDLE, .005);
    expect(error(state, states[0]!, 640, 150)).toBeLessThan(1e-11);
    expect(error(state, solved(start, planet.mu, 10), 640, 150)).toBeLessThan(1e-11);
  });
  it('uses the same timed state evaluations for prediction and live coast', () => {
    const start = initialState('planet-orbit');
    const path = [...predict(start, 1)];
    for (const sample of path) {
      const expected = solved(start, planet.mu, sample.time - start.time);
      expect(magnitude({ x: sample.position.x - expected.position.x, y: sample.position.y - expected.position.y })).toBeLessThan(1e-8);
    }
    let live = start;
    for (let i = 0; i < 100; i++) live = advance(live);
    expect(path.at(-1)!.position).toEqual(live.position);
  });
  it('keeps unsafe trajectories and surface flight numerical, with contact intact', () => {
    const falling: State = { ...initialState(), status: 'flying', position: { x: 0, y: 512.001 }, velocity: { x: 0, y: -20 } };
    expect(advance(falling).status).toBe('crashed');
    expect(advance(falling).dynamics).toBe('numerical');
    expect(advance(initialState()).coast).toBeUndefined();
    expect(() => advance(initialState(), IDLE, STEP * 2)).toThrow();
  });
});
