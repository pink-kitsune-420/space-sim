import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/surface-contact.json';
import {
  advance, coastAt, createSurfaceProfile, generateSurface, IDLE, initialState, magnitude,
  MAX_LANDING_ATTITUDE, MAX_LANDING_SLOPE, querySurface, setGodMode, STEP, step,
  surfaceContactTolerance, SurfaceContactError, surfaceSupport,
  type Body, type State, type SurfaceProfile, type Vec,
} from '../../packages/sim-core/src/index';

const body: Body = { id: 'fixture', radius: 10, mu: 1 };
const flat = createSurfaceProfile(10, [0, 0, 0, 0]);
const polar = (r: number, a: number): Vec => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
function flying(position: Vec, velocity: Vec = { x: 0, y: 0 }, heading = Math.atan2(position.y, position.x)): State {
  return { ...initialState(), status: 'flying', position, velocity, heading };
}
// Independent KDK inverse: choose full-step initial v to produce an authored
// straight drift. This does not call the production gravity/sweep/query helpers.
function drift(start: Vec, end: Vec, target = body): State {
  const scale = target.mu / Math.hypot(start.x, start.y) ** 3;
  return flying(start, { x: (end.x - start.x) / STEP + start.x * scale * STEP / 2,
    y: (end.y - start.y) / STEP + start.y * scale * STEP / 2 });
}
const run = (s: State, profile: SurfaceProfile, target = body): State => step(s, IDLE, STEP, target, profile);

describe('Phase 4b opt-in terrain motion', () => {
  it.each(fixtures.fixtures)('integrates independent drift fixture $id', f => {
    const profile = createSurfaceProfile(f.radius, f.elevations, f.orientation);
    const target = { ...body, radius: f.radius };
    const start = { x: f.start[0]!, y: f.start[1]! }, end = { x: f.end[0]!, y: f.end[1]! };
    const hit = run(drift(start, end, target), profile, target);
    expect(hit.status).not.toBe('flying');
    const tolerance = f.id === 'isolated-tangency' ? Math.sqrt(f.radius * surfaceContactTolerance(profile)) : 3e-7;
    expect(Math.hypot(hit.position.x - f.position[0]!, hit.position.y - f.position[1]!)).toBeLessThan(tolerance);
    expect(Math.abs(hit.contact!.fraction - f.fraction) * Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(tolerance);
    expect(hit.contact!.time).toBeCloseTo(STEP * hit.contact!.fraction, 14);
    expect(hit.contact!.surfaceIdentity).toBe(profile.identity);
    expect(hit.time).toBe(STEP);
    expect(hit.velocity).toEqual({ x: 0, y: 0 });
    expect(run(hit, profile, target).position).toEqual(hit.position);
  });

  it('allows below-reference flight and rejects actual penetration and invalid support', () => {
    const crater = createSurfaceProfile(10, [-2, 0, 0, 0]);
    const state = flying({ x: 9, y: 0 });
    expect(run(state, crater).status).toBe('flying');
    expect(() => run(state, flat)).toThrow('inside ground');
    expect(() => run(flying({ x: 7.99, y: 0 }), crater)).toThrow('inside ground');
    expect(() => run({ ...state, status: 'landed' }, crater)).toThrow('support state');
    expect(() => run({ ...flying({ x: 8, y: 0 }, { x: 1, y: 0 }), status: 'landed' }, crater)).toThrow('support state');
    expect(run({ ...state, position: { x: 8, y: 0 }, status: 'landed' }, crater).position).toEqual({ x: 8, y: 0 });
  });

  it('finds a narrow seam peak in both directions with both endpoints clear', () => {
    const samples = Array<number>(64).fill(0); samples[0] = 4;
    const profile = createSurfaceProfile(10, samples);
    const angle = Math.PI / 128, x = 13 * Math.cos(angle), y = 13 * Math.sin(angle);
    for (const sign of [-1, 1]) {
      const hit = run(drift({ x, y: -3 * sign }, { x, y: 3 * sign }), profile);
      expect(hit.status).toBe('crashed');
      expect(hit.position.x).toBeCloseTo(x, 6);
      expect(hit.position.y).toBeCloseTo(-sign * y, 6);
      expect(hit.contact!.fraction).toBeLessThan(.5);
    }
  });

  it('does not treat a remote maximum envelope as physical ground', () => {
    const profile = createSurfaceProfile(10, [0, 4, 0, -2]);
    expect(run(drift({ x: 12, y: -1 }, { x: 12, y: 1 }), profile).status).toBe('flying');
  });

  it('bounds error against analytic radial free-fall time and impact speed below the reference circle', () => {
    const profile = createSurfaceProfile(10, [-1, -1, -1, -1]), target = { ...body, mu: 1000 };
    // Analytic radial fall from rest: r=r0*cos(eta)^2; integrate dt/deta.
    const r0 = 12, ground = 9, ratio = ground / r0;
    const expectedTime = Math.sqrt(r0 ** 3 / (2 * target.mu))
      * (Math.acos(Math.sqrt(ratio)) + Math.sqrt(ratio * (1 - ratio)));
    const expectedSpeed = Math.sqrt(2 * target.mu * (1 / ground - 1 / r0));
    for (const dt of [.01, .005, .0025]) {
      let state = flying({ x: r0, y: 0 });
      for (let i = 0; i < 1000 && state.status === 'flying'; i++) state = step(state, IDLE, dt, target, profile);
      expect(state.status).toBe('crashed');
      expect(state.position.x).toBeCloseTo(ground, 7);
      expect(Math.abs(magnitude(state.contact!.impactVelocity) - expectedSpeed)).toBeLessThan(.002);
      // Drift interpolation error depends on the event's phase within the step;
      // cancellation makes monotonic refinement ratios inappropriate. Check a
      // second-order envelope plus contact's geometric timing uncertainty.
      expect(Math.abs(state.contact!.time - expectedTime)).toBeLessThan(2e-5 * (dt / STEP) ** 2 + 2e-8);
    }
  });

  it('throws explicit contact failures without advancing or mutating the input', () => {
    const state = drift({ x: -1e16, y: 1 }, { x: 1e16, y: 1 });
    const before = JSON.stringify(state);
    try { run(state, flat); throw new Error('Expected contact failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(SurfaceContactError);
      expect((error as SurfaceContactError).result).toMatchObject({ status: 'failed', reason: 'precision', verifiedFraction: 0 });
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects mismatched radius/configuration rather than silently using another profile', () => {
    expect(() => run(flying({ x: 20, y: 0 }), createSurfaceProfile(11, [0, 0]))).toThrow('match body');
    const target: Body = { ...body, surface: { kind: 'radial', generatorVersion: 1, seed: 1, sampleCount: 32,
      maxReliefMetres: 1, minFeatureWidthMetres: 8, orientationRadians: 0, mountainRangeCount: 1, craterCount: 0 } };
    expect(() => run(flying({ x: 20, y: 0 }), flat, target)).toThrow('match body');
    expect(run(flying({ x: 20, y: 0 }), generateSurface(target), target).status).toBe('flying');
  });
});

describe('local-normal landing, corner support and liftoff', () => {
  it('lands against the local normal; radial attitude fails on an otherwise safe slope', () => {
    const profile = createSurfaceProfile(10, [0, 9, 0, 0]), angle = Math.PI / 4;
    // r=14.5 and dr/dtheta=18/pi give an independently calculated 21.56 degree slope.
    const normalHeading = angle - Math.atan((18 / Math.PI) / 14.5);
    const start = flying(polar(14.501, angle), polar(-2, angle), normalHeading);
    const landed = run(start, profile);
    expect(landed.status).toBe('landed');
    expect(magnitude(landed.position)).toBeCloseTo(14.5, 7);
    expect(run({ ...start, heading: angle }, profile).status).toBe('crashed');
    expect(run({ ...start, velocity: polar(-6, angle) }, profile).status).toBe('crashed');
  });

  it('rejects excessive slope even with perfect normal alignment; God mode supports it', () => {
    const profile = createSurfaceProfile(10, [0, 30, 0, 0]), angle = Math.PI / 4;
    const heading = angle - Math.atan((60 / Math.PI) / 25);
    const state = flying(polar(25.001, angle), polar(-2, angle), heading);
    expect(run(state, profile).status).toBe('crashed');
    const landed = run(setGodMode(state, true), profile);
    expect(landed.status).toBe('landed');
    expect(run(landed, profile).position).toEqual(landed.position);
  });

  it('checks both faces of a corner, including rotated knots and the seam', () => {
    for (const orientation of [0, .71]) {
      // Outgoing interval is flat, incoming slope is 32.48 degrees at r=10.
      const profile = createSurfaceProfile(10, [0, 0, 0, 10], orientation);
      expect(surfaceSupport(profile, orientation).normals).toHaveLength(2);
      expect(surfaceSupport(profile, orientation).maxSlopeRadians).toBeGreaterThan(MAX_LANDING_SLOPE);
      const state = flying(polar(10.001, orientation), polar(-2, orientation), orientation);
      expect(run(state, profile).status).toBe('crashed');
      expect(run(setGodMode(state, true), profile).status).toBe('landed');
    }
    const valley = createSurfaceProfile(10, [0, 8, 0, 0]);
    const support = surfaceSupport(valley, 0);
    expect(support.maxSlopeRadians).toBeLessThan(MAX_LANDING_SLOPE);
    // Both faces meet the slope limit; outgoing normal alone aligns perfectly,
    // but is more than 20 degrees away from the incoming flat face.
    const heading = -Math.atan(16 / (10 * Math.PI));
    expect(run(flying({ x: 10.001, y: 0 }, { x: -2, y: 0 }, heading), valley).status).toBe('crashed');
  });

  it('uses attitude at the contact epoch rather than at the end of a turn step', () => {
    const state = flying({ x: 10.002, y: 0 }, { x: -2, y: 0 }, MAX_LANDING_ATTITUDE + .002);
    const hit = step(state, { ...IDLE, turn: -1 }, STEP, body, flat);
    expect(hit.contact!.fraction).toBeLessThan(.11);
    expect(hit.heading).toBeLessThan(MAX_LANDING_ATTITUDE);
    expect(hit.status).toBe('crashed');
  });

  it('holds position through turns/low thrust, lifts along the normal and settles after cutoff', () => {
    const profile = createSurfaceProfile(10, [0, 9, 0, 0]), angle = Math.PI / 4;
    const heading = angle - Math.atan((18 / Math.PI) / 14.5);
    let state = run(flying(polar(14.501, angle), polar(-2, angle), heading), profile);
    const point = state.position;
    for (let i = 0; i < 100; i++) state = run(state, profile);
    expect(state.position).toEqual(point);
    expect(step({ ...state, throttle: 0 }, { ...IDLE, engine: true, turn: 1 }, STEP, body, profile).position).toEqual(point);
    // At this slope the tangential heading has a large radial component; radial
    // thrust testing would launch it, but local support must hold it.
    const tangent = heading + Math.PI / 2;
    expect(step({ ...state, heading: tangent }, { ...IDLE, engine: true }, STEP, body, profile).status).toBe('landed');
    const launch = step(state, { ...IDLE, engine: true }, STEP, body, profile);
    expect(launch.status).toBe('flying');
    expect(magnitude(launch.position)).toBeGreaterThan(magnitude(point));
    expect(step(launch, IDLE, STEP, body, profile).velocity).not.toEqual(step(launch, { ...IDLE, engine: true }, STEP, body, profile).velocity);
    // A compact pad with stronger gravity makes a full launch/cutoff/landing
    // cycle short enough to exercise thousands of stable support steps.
    const strong = { ...body, mu: 1000 };
    let hop: State = { ...flying({ x: 0, y: 10 }), status: 'landed', throttle: .1 };
    hop = step(hop, { ...IDLE, engine: true }, STEP, strong, flat);
    expect(hop.status).toBe('flying');
    for (let i = 0; i < 500 && hop.status === 'flying'; i++) hop = run(hop, flat, strong);
    expect(hop.status).toBe('landed');
    for (let i = 0; i < 1000; i++) hop = run(hop, flat, strong);
    expect(hop.position.y).toBeCloseTo(10, 9);
  });

  it('requires separation from both incident faces before corner liftoff', () => {
    const profile = createSurfaceProfile(10, [0, 8, 0, 0]);
    const state = { ...flying({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2 - .1), status: 'landed' as const };
    expect(step(state, { ...IDLE, engine: true }, STEP, body, profile).status).toBe('landed');
    expect(step({ ...state, heading: 0 }, { ...IDLE, engine: true }, STEP, body, profile).status).toBe('flying');
  });
});

describe('terrain coast envelopes and physical cache identity', () => {
  const profile = createSurfaceProfile(10, [0, 4, 0, -2]);
  const orbit = (r: number) => flying({ x: r, y: 0 }, { x: 0, y: Math.sqrt(body.mu / r) });
  it('retains Kepler coasting above the maximum envelope and numerical motion below it', () => {
    const safe = advance(orbit(20), IDLE, STEP, body, profile);
    expect(safe.dynamics).toBe('kepler');
    expect(safe.coast!.contactSurfaceIdentity).toBe(profile.identity);
    expect(coastAt(safe.coast!, 100, body, profile).ok).toBe(true);
    const unsafe = advance(orbit(12), IDLE, STEP, body, profile);
    expect(unsafe.dynamics).toBe('numerical');
    expect(unsafe.status).toBe('flying'); // envelope is an exclusion bound, not ground
    expect(unsafe.coast).toBeUndefined();
  });

  it('invalidates coasts when switching geometry or the circular preview contact model', () => {
    const preview = advance(orbit(12), IDLE, STEP, body);
    expect(preview.dynamics).toBe('kepler');
    expect(advance(preview, IDLE, STEP, body, profile).dynamics).toBe('numerical');
    expect(coastAt(preview.coast!, 1, body, profile).ok).toBe(false);
    const safe = advance(orbit(20), IDLE, STEP, body, profile);
    expect(coastAt(safe.coast!, 1, body).ok).toBe(false);
    expect(advance(safe, IDLE, STEP, body).coast).not.toBe(safe.coast);
    const other = createSurfaceProfile(10, [0, 3, 0, -2]);
    expect(coastAt(safe.coast!, 1, body, other).ok).toBe(false);
    expect(advance(safe, IDLE, STEP, body, other).coast).not.toBe(safe.coast);
    expect(step(safe, IDLE, STEP, body, profile).coast).toBeUndefined();
  });

  it('rejects a forged coast through the envelope even with a matching identity', () => {
    const preview = advance(orbit(12), IDLE, STEP, body);
    const forged = { ...preview.coast!, contactSurfaceIdentity: profile.identity };
    expect(coastAt(forged, 100, body, profile).ok).toBe(false);
    // An epoch whose orbit later dips into the envelope is valid only until it gets there
    // (model v2): from apoapsis at r=20 it reaches r=14 after ~150 s, periapsis at 214 s.
    const crossing = advance(flying({ x: 20, y: 0 }, { x: 0, y: .2 }), IDLE, STEP, body);
    const unsafe = { ...crossing.coast!, contactSurfaceIdentity: profile.identity };
    expect(coastAt(unsafe, 100, body, profile).ok).toBe(true);
    expect(coastAt(unsafe, 300, body, profile).ok).toBe(false);
    expect(coastAt(unsafe, 300, body, profile).diagnostics.reason).toBe('Coast reaches the ground before this time');
  });

  it('coasts an escaping arc whose conic dips inside the ground on exact Kepler motion', () => {
    // Nearly radial and faster than escape: the periapsis lies inside the body, but the arc
    // only ever climbs away. An approaching one is valid until it reaches the envelope.
    const speed = Math.sqrt(2 * body.mu / 30) * 1.5;
    const escaping = advance(flying({ x: 0, y: 30 }, { x: .01, y: speed }), IDLE, STEP, body, profile);
    expect(escaping.dynamics).toBe('kepler');
    expect(coastAt(escaping.coast!, 1000, body, profile).ok).toBe(true);
    const approaching = advance(flying({ x: 0, y: 30 }, { x: .01, y: -speed }), IDLE, STEP, body, profile);
    expect(approaching.dynamics).toBe('kepler');
    expect(coastAt(approaching.coast!, 20, body, profile).ok).toBe(true);
    expect(coastAt(approaching.coast!, 60, body, profile).ok).toBe(false);
  });

  it('keeps headless callers circular until explicitly supplied a profile', () => {
    const target: Body = { ...body, surface: { kind: 'radial', generatorVersion: 1, seed: 1, sampleCount: 32,
      maxReliefMetres: 1, minFeatureWidthMetres: 8, orientationRadians: 0, mountainRangeCount: 1, craterCount: 0 } };
    const generated = generateSurface(target);
    const angle = .6, ground = querySurface(generated, angle).groundRadius;
    const state = flying(polar(10.001, angle), polar(-2, angle));
    expect(magnitude(step(state, IDLE, STEP, target).position)).toBeCloseTo(10, 9);
    const explicit = flying(polar(ground + .001, angle), polar(-2, angle));
    expect(magnitude(step(explicit, IDLE, STEP, target, generated).position)).toBeCloseTo(ground, 7);
  });
});
