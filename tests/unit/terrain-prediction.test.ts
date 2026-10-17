import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/surface-contact.json';
import examples from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import {
  advance, createSurfaceProfile, generateSurface, ghost, GHOST_TERRAIN_MAX_STEPS, IDLE, initialState,
  loadSystem, magnitude, querySurface, STEP, surfaceContactTolerance, validateUniverse,
  type Body, type GhostSample, type State, type SurfaceProfile,
} from '../../packages/sim-core/src/index';
import { hermiteControls } from '../../packages/render-2d/src/index';

const body: Body = { id: 'fixture', radius: 10, mu: 1 };
function trace(start: State, profile: SurfaceProfile, target = body, coarse = false) {
  const job = ghost(start, coarse, target, profile), samples: GhostSample[] = [];
  for (let i = 0; i <= GHOST_TERRAIN_MAX_STEPS + 2; i++) {
    const r = job.next();
    if (r.done) return { samples, end: r.value };
    samples.push(r.value);
  }
  throw new Error('Unbounded terrain prediction');
}
const flying = (position: State['position'], velocity = { x: 0, y: 0 }): State => ({
  ...initialState(), status: 'flying', position, velocity,
});

describe('terrain ghost and live contact agreement', () => {
  it.each(fixtures.fixtures)('matches independent drift contact $id', f => {
    const profile = createSurfaceProfile(f.radius, f.elevations, f.orientation);
    // Independently invert the first gravity half kick to author this exact drift.
    const [x, y] = f.start as [number, number], [ex, ey] = f.end as [number, number];
    const g = body.mu / Math.hypot(x, y) ** 3;
    const start = flying({ x, y }, { x: (ex - x) / STEP + x * g * STEP / 2,
      y: (ey - y) / STEP + y * g * STEP / 2 });
    const live = advance(start, IDLE, STEP, body, profile);
    const result = trace(start, profile), hit = result.samples.at(-1)!;
    expect(result.end).toBe('impact');
    expect(hit.position).toEqual(live.position);
    expect(hit.time).toBe(live.contact!.time);
    expect(hit.velocity).toEqual(live.contact!.impactVelocity);
    const tolerance = f.id === 'isolated-tangency' ? Math.sqrt(f.radius * surfaceContactTolerance(profile)) : 3e-7;
    expect(Math.hypot(hit.position.x - f.position[0]!, hit.position.y - f.position[1]!)).toBeLessThan(tolerance);
    expect(Math.abs(hit.time - STEP * f.fraction) * Math.hypot(ex - x, ey - y) / STEP).toBeLessThan(tolerance);
    expect(trace(start, profile, body, true)).toEqual(result);
    // Render every verified drift as a line, including zero-time initial contact.
    const prev = result.samples.at(-2)!;
    const [a, b] = hermiteControls(prev, hit);
    expect(a.x).toBeCloseTo(prev.position.x + (hit.position.x - prev.position.x) / 3, 12);
    expect(b.y).toBeCloseTo(hit.position.y - (hit.position.y - prev.position.y) / 3, 12);
  });

  it('matches all shared motion steps on a below-reference crater descent, then stops', () => {
    const profile = createSurfaceProfile(10, [-2, -2, -2, -2]), target = { ...body, mu: 1000 };
    let live = flying({ x: 9.5, y: 0 }, { x: -.2, y: 0 });
    const before = JSON.stringify(live), result = trace(live, profile, target);
    expect(JSON.stringify(live)).toBe(before);
    expect(result.end).toBe('impact');
    expect(result.samples.length).toBeGreaterThan(20);
    for (const sample of result.samples.slice(1)) {
      live = advance(live, IDLE, STEP, target, profile);
      expect(sample.position).toEqual(live.position);
      expect(sample.time).toBe(live.contact?.time ?? live.time);
    }
    expect(magnitude(live.position)).toBeCloseTo(8, 7);
    expect(live.status).toBe('crashed');
    expect(result.samples.at(-1)!.time).toBeLessThanOrEqual(live.time);
  });

  it('keeps safe Kepler ghosts exact and bounds long numerical passes explicitly', () => {
    const profile = createSurfaceProfile(10, [0, 4, 0, 0]);
    const safe = flying({ x: 20, y: 0 }, { x: 0, y: Math.sqrt(body.mu / 20) });
    const result = trace(safe, profile);
    expect(result.end).toBe('closed');
    expect(result.samples.length).toBeLessThan(256);
    expect(result.samples.every(s => !s.linear)).toBe(true);
    // Orbit inside a remote mountain envelope: clear locally, too slow to hit
    // within 81.92 seconds. Never call it closed or fabricate an envelope impact.
    const partial = trace(flying({ x: 12, y: 0 }, { x: 0, y: -Math.sqrt(body.mu / 12) }), profile);
    expect(partial.end).toBe('open');
    expect(partial.samples).toHaveLength(GHOST_TERRAIN_MAX_STEPS + 1);
    expect(partial.samples.at(-1)!.time).toBeCloseTo(GHOST_TERRAIN_MAX_STEPS * STEP, 8);
  });

  it('reports geometry/state/precision failures and never publishes an unverified drift', () => {
    const profile = createSurfaceProfile(10, [0, 0]);
    expect(trace(flying({ x: 9, y: 0 }), profile)).toEqual({ samples: [], end: 'failed' });
    expect(trace(flying({ x: 20, y: 0 }), createSurfaceProfile(11, [0, 0]))).toEqual({ samples: [], end: 'failed' });
    const huge = flying({ x: -1e16, y: 1 }, { x: 2e18, y: 0 });
    const result = trace(huge, profile);
    expect(result.end).toBe('failed');
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]!.position).toEqual(huge.position);
  });
});

describe('terrain preset placement', () => {
  const loaded = loadSystem(validateUniverse(examples)), target = loaded.rootBody, profile = generateSurface(target);
  it('places a legacy landed start on the first authored pad, with normal heading', () => {
    const start = loaded.initialState('pad', profile).state;
    expect(magnitude(start.position)).toBeCloseTo(520, 12);
    expect(start.heading).toBeCloseTo(Math.PI / 2, 12);
    expect(advance(start, IDLE, STEP, target, profile).position).toEqual(start.position);
  });

  it('flies the authored crater descent to safe below-reference ground', () => {
    const moon = loadSystem(validateUniverse(examples), 'cratered'), body = moon.rootBody;
    const profile = generateSurface(body);
    let state = moon.initialState('crater-descent', profile).state;
    const result = trace(state, profile, body), impact = result.samples.at(-1)!;
    expect(result.end).toBe('impact');
    for (let i = 0; i < 1000 && state.status === 'flying'; i++) state = advance(state, IDLE, STEP, body, profile);
    expect(state.status).toBe('landed');
    expect(magnitude(state.position)).toBeCloseTo(148, 6);
    expect(impact.position).toEqual(state.position);
    expect(impact.time).toBe(state.contact!.time);
  });

  function system(preset: Record<string, unknown>) {
    return loadSystem(validateUniverse({ ...examples, systems: [{ ...examples.systems[0], presets: [
      { id: 'test', name: 'Test', bodyId: 'dry-planet', ...preset },
    ] }] }));
  }
  it('relocates explicit landed positions radially from above or inside ground', () => {
    for (const radius of [100, 800]) {
      const loaded = system({ kind: 'landed', position: [0, radius] });
      const start = loaded.initialState('test', profile).state;
      expect(magnitude(start.position)).toBeCloseTo(520, 12);
      expect(start.velocity).toEqual({ x: 0, y: 0 });
    }
  });
  it('honors state presets below the reference radius and rejects buried or moving starts', () => {
    let angle = 0;
    for (let i = 0; i < profile.sampleCount; i++) if (profile.sampleElevation(i) < -1) {
      angle = profile.orientationRadians + i * Math.PI * 2 / profile.sampleCount; break;
    }
    const ground = querySurface(profile, angle).groundRadius;
    expect(ground).toBeLessThan(target.radius);
    const point = (r: number) => [r * Math.cos(angle), r * Math.sin(angle)];
    const valid = system({ kind: 'state', position: point(ground + .1), velocity: [0, 0] });
    expect(magnitude(valid.initialState('test', profile).state.position)).toBeCloseTo(ground + .1, 10);
    expect(() => system({ kind: 'state', position: point(ground - 1), velocity: [0, 0] }).initialState('test', profile)).toThrow('inside terrain');
    expect(() => system({ kind: 'landed', velocity: [1, 0] }).initialState('test', profile)).toThrow('zero velocity');
    expect(() => system({ kind: 'landed', headingRadians: 0 }).initialState('test', profile)).toThrow('normal alignment');
    expect(() => system({ kind: 'state' }).initialState('test', profile)).toThrow('requires position and velocity');
  });
});
