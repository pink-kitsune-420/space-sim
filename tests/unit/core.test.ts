import { describe, expect, it } from 'vitest';
import { Clock, DEFAULT_VEHICLE, IDLE, STEP, initialState, legacyHeading, magnitude, planet, predict, setGodMode, step,
  type Controls, type State } from '../../packages/sim-core/src/index';

function run(start: State, seconds: number, dt = STEP, command: Controls = IDLE): State {
  let state = start;
  for (let i = 0; i < Math.round(seconds / dt); i++) state = step(state, command, dt);
  return state;
}
function circularError(dt: number, direction: number): number {
  const initial = initialState('planet-orbit');
  const start = { ...initial, velocity: { x: direction * initial.velocity.x, y: 0 } };
  const state = run(start, 20, dt);
  const r = magnitude(start.position), omega = magnitude(start.velocity) / r;
  const exact = { x: direction * r * Math.sin(omega * 20), y: r * Math.cos(omega * 20) };
  return Math.hypot(state.position.x - exact.x, state.position.y - exact.y);
}

describe('scenario and numerical dynamics under Node', () => {
  it('converts legacy frames to SI and headings to world axes', () => {
    expect(planet.mu).toBeCloseTo(5242.88 / .02 ** 2);
    expect(planet.mu / planet.radius ** 2).toBe(50);
    expect(DEFAULT_VEHICLE.acceleration).toBe(.05 / .02 ** 2);
    expect(legacyHeading(0)).toBe(Math.PI / 2);
    expect(legacyHeading(64)).toBe(0);
  });
  it.each([1, -1])('converges at second order against the analytic circular solution, direction %s', direction => {
    const errors = [.01, .005, .0025].map(dt => circularError(dt, direction));
    expect(errors[0]!).toBeLessThan(.02);
    expect(errors[0]! / errors[1]!).toBeGreaterThan(3.95);
    expect(errors[1]! / errors[2]!).toBeGreaterThan(3.95);
  });
  it('conserves signed angular momentum and bounds energy drift over 10 orbits', () => {
    const start = initialState('planet-orbit');
    const state = run(start, 282, .01);
    const h = (s: State): number => s.position.x * s.velocity.y - s.position.y * s.velocity.x;
    const e = (s: State): number => magnitude(s.velocity) ** 2 / 2 - planet.mu / magnitude(s.position);
    expect(Math.abs(h(state) / h(start) - 1)).toBeLessThan(1e-11);
    expect(Math.abs(e(state) / e(start) - 1)).toBeLessThan(1e-9);
  });
  it('stays attached below launch acceleration, launches at default throttle and stops thrust on release', () => {
    const pad = initialState();
    expect(run(pad, 2).position).toEqual(pad.position);
    expect(run({ ...pad, throttle: .1 }, 1, STEP, { ...IDLE, engine: true }).status).toBe('landed');
    const flying = run(pad, .5, STEP, { ...IDLE, engine: true });
    expect(flying.status).toBe('flying');
    expect(flying.position.y).toBeGreaterThan(513);
    const released = step(flying);
    const burning = step(flying, { ...IDLE, engine: true });
    expect(released.velocity.y).toBeLessThan(flying.velocity.y);
    expect(burning.velocity.y).toBeGreaterThan(released.velocity.y);
  });
  it.each([
    { speed: -2, heading: Math.PI / 2, expected: 'landed' },
    { speed: -20, heading: Math.PI / 2, expected: 'crashed' },
    { speed: -2, heading: 0, expected: 'crashed' },
  ])('classifies surface contact by impact speed and attitude: $expected', ({ speed, heading, expected }) => {
    const state: State = { ...initialState(), status: 'flying', heading,
      position: { x: 0, y: 512.001 }, velocity: { x: 0, y: speed } };
    const hit = step(state);
    expect(hit.status).toBe(expected);
    expect(magnitude(hit.position)).toBeCloseTo(512, 10);
    expect(hit.velocity).toEqual({ x: 0, y: 0 });
  });
  it('detects an interior fly-through when both drift endpoints are outside', () => {
    const state: State = { ...initialState(), status: 'flying', position: { x: 0, y: 600 },
      velocity: { x: 0, y: -200000 } };
    expect(step(state).status).toBe('crashed');
  });
  it.each([-20, -200000])('god mode survives an impact at %s m/s and disabling restores crashes', speed => {
    const falling: State = { ...initialState(), status: 'flying', heading: 0,
      position: { x: 0, y: 512.001 }, velocity: { x: 0, y: speed } };
    const invulnerable = setGodMode(falling, true);
    expect(invulnerable.position).toEqual(falling.position);
    expect(invulnerable.velocity).toEqual(falling.velocity);
    const hit = step(invulnerable);
    expect(hit.status).toBe('landed');
    expect(magnitude(hit.position)).toBeCloseTo(planet.radius);
    expect(hit.velocity).toEqual({ x: 0, y: 0 });
    expect(step(setGodMode(invulnerable, false)).status).toBe('crashed');
    const recovered = setGodMode(step(falling), true);
    expect(recovered.status).toBe('landed');
    expect(step({ ...recovered, heading: Math.PI / 2 }, { ...IDLE, engine: true }).status).toBe('flying');
  });
  it('matches an independently implemented RK4 burn oracle', () => {
    // Separate derivative and RK4 integration; no calls to production gravity or step.
    const derivative = (q: number[]): number[] => {
      const [x, y, vx, vy] = q as [number, number, number, number];
      const r3 = Math.hypot(x, y) ** 3;
      return [vx, vy, -planet.mu * x / r3 + 62.5, -planet.mu * y / r3];
    };
    let q = [0, 640, Math.sqrt(planet.mu / 640), 0];
    const dt = .001;
    for (let i = 0; i < 1000; i++) {
      const k1 = derivative(q);
      const k2 = derivative(q.map((v, j) => v + dt / 2 * k1[j]!));
      const k3 = derivative(q.map((v, j) => v + dt / 2 * k2[j]!));
      const k4 = derivative(q.map((v, j) => v + dt * k3[j]!));
      q = q.map((v, j) => v + dt / 6 * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!));
    }
    const state = run(initialState('planet-orbit'), 1, STEP, { ...IDLE, engine: true });
    expect(Math.hypot(state.position.x - q[0]!, state.position.y - q[1]!)).toBeLessThan(.002);
    expect(Math.hypot(state.velocity.x - q[2]!, state.velocity.y - q[3]!)).toBeLessThan(.002);
  });
  it('converges at second order during simultaneous turning and throttle ramp against RK4', () => {
    // Independent time-dependent force: heading=.3*turnRate*t, throttle=.5+.2*.78125*t.
    const derivative = (q: number[], t: number): number[] => {
      const [x, y, vx, vy] = q as [number, number, number, number];
      const r3 = Math.hypot(x, y) ** 3;
      const heading = .3 * DEFAULT_VEHICLE.turnRate * t;
      const acceleration = 125 * (.5 + .2 * .78125 * t);
      return [vx, vy, -planet.mu * x / r3 + acceleration * Math.cos(heading),
        -planet.mu * y / r3 + acceleration * Math.sin(heading)];
    };
    let q = [0, 640, Math.sqrt(planet.mu / 640), 0];
    const dt = .0005;
    for (let i = 0; i < 2000; i++) {
      const t = i * dt;
      const k1 = derivative(q, t);
      const k2 = derivative(q.map((v, j) => v + dt / 2 * k1[j]!), t + dt / 2);
      const k3 = derivative(q.map((v, j) => v + dt / 2 * k2[j]!), t + dt / 2);
      const k4 = derivative(q.map((v, j) => v + dt * k3[j]!), t + dt);
      q = q.map((v, j) => v + dt / 6 * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!));
    }
    const errors = [.01, .005, .0025].map(dt => {
      const actual = run(initialState('planet-orbit'), 1, dt, { engine: true, turn: .3, throttle: .2 });
      return Math.hypot(actual.position.x - q[0]!, actual.position.y - q[1]!,
        actual.velocity.x - q[2]!, actual.velocity.y - q[3]!);
    });
    expect(errors[0]! / errors[1]!).toBeGreaterThan(3.95);
    expect(errors[1]! / errors[2]!).toBeGreaterThan(3.95);
  });
  it('samples a coast without mutating the live snapshot and terminates at contact', () => {
    const start: State = { ...initialState(), status: 'flying', position: { x: 0, y: 513 } };
    const frozen = JSON.stringify(start);
    const path = [...predict(start)];
    expect(path.length).toBeLessThan(100);
    expect(magnitude(path.at(-1)!.position)).toBeCloseTo(512);
    expect(JSON.stringify(start)).toBe(frozen);
    expect([...predict(initialState('planet-orbit'), 1000)]).toHaveLength(6001);
  });
  it('rejects invalid state, controls, body and unbounded timesteps', () => {
    expect(() => step(initialState(), IDLE, 1)).toThrow();
    expect(() => step({ ...initialState(), position: { x: NaN, y: 0 } })).toThrow();
    expect(() => step(initialState(), { ...IDLE, turn: NaN })).toThrow();
    expect(() => step(initialState(), IDLE, STEP, { ...planet, mu: 0 })).toThrow();
  });
});

describe('bounded scheduler', () => {
  it('replays the same command sequence at 30/60/120/144 Hz', () => {
    const states = [30, 60, 120, 144].map(hz => {
      let state = initialState('planet-orbit');
      const clock = new Clock();
      for (let i = 0; i < hz * 10; i++) clock.advance(1 / hz, () => {
        state = step(state, { turn: state.time < 1 ? 1 : 0, engine: state.time >= 2 && state.time < 3, throttle: 0 });
      });
      return state;
    });
    for (const state of states) expect(state).toEqual(states[0]);
    expect(states[0]!.time).toBeCloseTo(10, 10);
  });
  it('limits catch-up and clears the remainder on pause', () => {
    const clock = new Clock();
    let steps = 0;
    clock.advance(5, () => steps++);
    expect(steps).toBe(20);
    expect(clock.droppedSeconds).toBe(4.8);
    clock.advance(.005, () => steps++);
    clock.reset(); clock.advance(.005, () => steps++);
    expect(steps).toBe(20);
  });
});
