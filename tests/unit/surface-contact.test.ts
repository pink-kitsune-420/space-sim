import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/surface-contact.json';
import {
  createSurfaceProfile, dmath, generateSurface, querySurface, sweepSurface, SURFACE_SWEEP_MAX_WORK,
  type SurfaceProfile, type SurfaceSweep, type Vec,
} from '../../packages/sim-core/src/index';

const circle = createSurfaceProfile(10, [0, 0, 0, 0]);
const polar = (radius: number, theta: number): Vec => ({ x: radius * Math.cos(theta), y: radius * Math.sin(theta) });
function contact(result: SurfaceSweep) {
  expect(result.status).toBe('hit');
  if (result.status !== 'hit') throw new Error(JSON.stringify(result));
  expect(Math.abs(result.clearanceMetres)).toBeLessThanOrEqual(result.diagnostics.toleranceMetres);
  expect(result.diagnostics.work).toBe(result.diagnostics.intervals + result.diagnostics.evaluations);
  expect(result.diagnostics.work).toBeLessThanOrEqual(SURFACE_SWEEP_MAX_WORK);
  expect(result.fractionBracket[0]).toBeLessThanOrEqual(result.fraction);
  expect(result.fractionBracket[1]).toBeGreaterThanOrEqual(result.fraction);
  return result;
}

describe('independent swept-contact fixtures', () => {
  it.each(fixtures.fixtures)('$id', f => {
    const p = createSurfaceProfile(f.radius, f.elevations, f.orientation);
    const start = { x: f.start[0]!, y: f.start[1]! }, end = { x: f.end[0]!, y: f.end[1]! };
    const hit = contact(sweepSurface(p, start, end));
    // Isolated tangency has ill-conditioned timing; sqrt(R*tolerance) bounds
    // geometric uncertainty along the tangent. Crossings use 2*tolerance.
    const spatial = f.id === 'isolated-tangency' ? Math.sqrt(f.radius * hit.diagnostics.toleranceMetres) : fixtures.crossingToleranceMetres;
    expect(Math.hypot(hit.position.x - f.position[0]!, hit.position.y - f.position[1]!)).toBeLessThan(spatial);
    expect(Math.abs(hit.fraction - f.fraction) * Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(spatial);
    expect(hit.surfaceIdentity).toBe(p.identity);
    expect(hit.surface).toEqual(querySurface(p, dmath.atan2(hit.position.y, hit.position.x)));
  });

  it('rejects near misses without treating the maximum envelope as ground', () => {
    const p = createSurfaceProfile(10, [0, 4, 0, -2]);
    for (const [profile, start, end] of [
      [circle, { x: -20, y: 10.001 }, { x: 20, y: 10.001 }],
      [circle, { x: 15, y: 0 }, { x: 0, y: 15 }],
      [p, { x: 12, y: -1 }, { x: 12, y: 1 }],
      [p, { x: 0, y: -9 }, { x: 0, y: -8.5 }],
      [p, { x: 30, y: 0 }, { x: 30, y: 1 }],
    ] as const) expect(sweepSurface(profile, start, end).status).toBe('clear');
  });

  it('finds a narrow seam peak with both endpoints clear in either traversal direction', () => {
    const elevations = Array<number>(64).fill(0); elevations[0] = 4;
    const p = createSurfaceProfile(10, elevations);
    // On either side of sample zero, at delta/4, interpolation gives r=13.
    const theta = Math.PI / 128, x = 13 * Math.cos(theta), y = 13 * Math.sin(theta);
    for (const sign of [-1, 1]) {
      const start = { x, y: -3 * sign }, end = { x, y: 3 * sign };
      for (const v of [start, end]) expect(Math.hypot(v.x, v.y)).toBeGreaterThan(querySurface(p, Math.atan2(v.y, v.x)).groundRadius);
      const hit = contact(sweepSurface(p, start, end));
      expect(Math.abs(hit.position.x - x)).toBeLessThan(1e-7);
      expect(Math.abs(hit.position.y + sign * y)).toBeLessThan(1e-7);
      expect(hit.fraction).toBeLessThan(.5);
    }
  });

  it('finds a tangency inside a sloped polar interval, without a sign change', () => {
    const p = createSurfaceProfile(10, [0, 4, 0, 0]), theta = Math.PI / 4;
    const q = polar(12, theta), k = 8 / Math.PI;
    const tangent = { x: k * Math.cos(theta) - 12 * Math.sin(theta), y: k * Math.sin(theta) + 12 * Math.cos(theta) };
    const norm = Math.hypot(tangent.x, tangent.y);
    const start = { x: q.x - 2 * tangent.x / norm, y: q.y - 2 * tangent.y / norm };
    const end = { x: q.x + 2 * tangent.x / norm, y: q.y + 2 * tangent.y / norm };
    const hit = contact(sweepSurface(p, start, end));
    expect(Math.hypot(hit.position.x - q.x, hit.position.y - q.y)).toBeLessThan(2e-5);
    expect(hit.fraction).toBeCloseTo(.5, 4);
    const outward = querySurface(p, theta).normal;
    expect(sweepSurface(p, { x: start.x + .001 * outward.x, y: start.y + .001 * outward.y },
      { x: end.x + .001 * outward.x, y: end.y + .001 * outward.y }).status).toBe('clear');
  });

  it('handles contact at the endpoint and a radial endpoint within tolerance', () => {
    for (const start of [{ x: 20, y: 0 }, { x: 20, y: 5 }]) {
      const hit = contact(sweepSurface(circle, start, { x: 10, y: 0 }));
      expect(hit.fraction).toBeCloseTo(1, 6);
    }
    const end = { x: -10 - 5e-8, y: 0 };
    const hit = contact(sweepSurface(circle, { x: -20, y: 0 }, end));
    expect(hit.fraction).toBe(1);
    expect(hit.position.x).toBeCloseTo(end.x, 12);
  });
});

describe('touching starts and directional corner slopes', () => {
  it('reports inward, tangent and stationary contact; permits separating liftoff', () => {
    const start = { x: 10, y: 0 };
    for (const end of [{ x: 9, y: 0 }, { x: 10, y: 2 }, start]) {
      expect(contact(sweepSurface(circle, start, end)).fraction).toBe(0);
    }
    for (const end of [{ x: 11, y: 0 }, { x: 11, y: 1 }]) {
      expect(sweepSurface(circle, start, end).status).toBe('clear');
    }
    expect(sweepSurface(circle, { x: 11, y: 0 }, { x: 11, y: 0 }).status).toBe('clear');
  });

  it('uses the slope in the direction of travel at a seam corner', () => {
    const peak = createSurfaceProfile(10, [4, 0, 0, 0]);
    const valley = createSurfaceProfile(10, [-2, 0, 0, 0]);
    for (const sign of [-1, 1]) {
      expect(sweepSurface(peak, { x: 14, y: 0 }, { x: 14, y: sign }).status).toBe('clear');
      const hit = contact(sweepSurface(valley, { x: 8, y: 0 }, { x: 8, y: sign }));
      expect(hit.fraction).toBe(0);
      expect(hit.surface.intervalIndex).toBe(0); // query API retains outgoing normal
      const tangent = contact(sweepSurface(peak, { x: 14, y: -sign }, { x: 14, y: sign }));
      expect(Math.abs(tangent.position.y)).toBeLessThan(1e-7);
    }
  });

  it('allows initial departure but still finds a later mountain with clear endpoints', () => {
    const samples = Array<number>(16).fill(0); samples[2] = 10;
    const p = createSurfaceProfile(10, samples), start = { x: 10, y: 0 }, end = { x: 11, y: 15 };
    const hit = contact(sweepSurface(p, start, end));
    expect(hit.fraction).toBeGreaterThan(.1);
    expect(hit.fraction).toBeLessThan(.8);
    expect(Math.hypot(end.x, end.y)).toBeGreaterThan(querySurface(p, Math.atan2(end.y, end.x)).groundRadius);
    const expected = oracle(samples, start, end)!;
    expect(Math.abs(hit.fraction - expected) * Math.hypot(1, 15)).toBeLessThan(2e-7);
  });

  it('reports genuinely penetrating starts while allowing valid crater-floor space', () => {
    const p = createSurfaceProfile(10, [-2, 0, 0, 0]);
    expect(sweepSurface(p, { x: 9, y: 0 }, { x: 8.5, y: 0 }).status).toBe('clear');
    for (const position of [{ x: 7, y: 0 }, { x: 0, y: 0 }]) {
      expect(sweepSurface(p, position, { x: 20, y: 0 })).toMatchObject({
        status: 'failed', reason: 'initial-penetration', verifiedFraction: 0,
      });
    }
  });
});

describe('contact bounds, work and numerical conditioning', () => {
  it('fails explicitly on exhausted work, with a verified prefix and no endpoint', () => {
    const start = { x: -20, y: 6 }, end = { x: 20, y: 6 };
    const result = sweepSurface(circle, start, end, { maxWork: 6 });
    expect(result).toMatchObject({ status: 'failed', reason: 'work-limit' });
    if (result.status !== 'failed') throw new Error('Expected failure');
    expect(result.verifiedFraction).toBeGreaterThan(0);
    expect(result.verifiedFraction).toBeLessThan(.3);
    expect(result.diagnostics.work).toBeLessThanOrEqual(6);
    expect('position' in result).toBe(false);
    const retryStart = { x: start.x + (end.x - start.x) * result.verifiedFraction, y: 6 };
    expect(contact(sweepSurface(circle, retryStart, end)).position.x).toBeCloseTo(-8, 6);
    expect(sweepSurface(circle, start, end, { maxWork: 1 })).toMatchObject({ status: 'failed', reason: 'work-limit' });
  });

  it('rejects invalid inputs and reports inadequate precision', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => sweepSurface(circle, { x: bad, y: 20 }, { x: 0, y: 0 })).toThrow('finite');
      expect(() => sweepSurface(circle, { x: 0, y: 20 }, { x: 0, y: bad })).toThrow('finite');
    }
    for (const toleranceMetres of [0, -1, NaN, Infinity]) {
      expect(() => sweepSurface(circle, { x: 0, y: 20 }, { x: 0, y: 11 }, { toleranceMetres })).toThrow('tolerance');
    }
    for (const maxWork of [0, -1, 1.5, NaN, Infinity, SURFACE_SWEEP_MAX_WORK + 1]) {
      expect(() => sweepSurface(circle, { x: 0, y: 20 }, { x: 0, y: 11 }, { maxWork })).toThrow('maxWork');
    }
    expect(sweepSurface(circle, { x: -1e16, y: 1 }, { x: 1e16, y: 1 })).toMatchObject({ status: 'failed', reason: 'precision' });
    expect(sweepSurface(circle, { x: 20, y: 0 }, { x: 10, y: 0 }, { toleranceMetres: 1e-20 })).toMatchObject({ status: 'failed', reason: 'precision' });
  });

  it('scales from compact worlds to extreme horizons and preserves rotated hits', () => {
    for (const radius of [1e-3, 512, 6_371_000, 637_100_000]) {
      const p = createSurfaceProfile(radius, [0, radius * .2, 0, -radius * .2]);
      const hit = contact(sweepSurface(p, { x: -2 * radius, y: .6 * radius }, { x: 2 * radius, y: .6 * radius }));
      expect(hit.fraction).toBeGreaterThan(0);
      expect(hit.fraction).toBeLessThan(.5);
      const angle = .71, rotated = createSurfaceProfile(radius, [0, radius * .2, 0, -radius * .2], angle);
      const rotate = (v: Vec) => ({ x: v.x * Math.cos(angle) - v.y * Math.sin(angle), y: v.x * Math.sin(angle) + v.y * Math.cos(angle) });
      const other = contact(sweepSurface(rotated, rotate({ x: -2 * radius, y: .6 * radius }), rotate({ x: 2 * radius, y: .6 * radius })));
      expect(Math.abs(hit.fraction - other.fraction) * 4 * radius).toBeLessThan(4 * hit.diagnostics.toleranceMetres);
    }
    const radius = 637_100_000, p = generateSurface({ radius });
    const hit = contact(sweepSurface(p, { x: -10000, y: radius - .01 }, { x: 10000, y: radius - .01 }));
    const expectedX = -Math.sqrt(.01 * (2 * radius - .01));
    expect(Math.abs(hit.position.x - expectedX)).toBeLessThan(1); // grazing uncertainty at this radius
  });

  it('visits bounded intervals at maximum resolution, without scanning off-path terrain', () => {
    const elevations = new Float64Array(65536);
    for (let i = 0; i < elevations.length; i++) elevations[i] = 1e-3 * (i % 2);
    const p = createSurfaceProfile(10, elevations);
    const hit = contact(sweepSurface(p, { x: -20, y: .001 }, { x: 20, y: .001 }));
    expect(hit.diagnostics.intervals).toBeLessThan(5);
    const miss = sweepSurface(p, { x: -20, y: 10.002 }, { x: 20, y: 10.002 });
    expect(miss.status).toBe('clear');
    expect(miss.diagnostics.intervals).toBe(0);
    // A high peak on the far hemisphere expands the envelope but cannot turn
    // it into a collision circle. Prove clear across thousands of flat knots.
    elevations.fill(0); elevations[49152] = 4;
    const farPeak = createSurfaceProfile(10, elevations);
    const longMiss = sweepSurface(farPeak, { x: -20, y: 10.002 }, { x: 20, y: 10.002 });
    expect(longMiss.status).toBe('clear');
    expect(longMiss.diagnostics.intervals).toBeGreaterThan(10000);
    expect(longMiss.diagnostics.work).toBeLessThanOrEqual(SURFACE_SWEEP_MAX_WORK);
  });

  it('preserves earliest crossing under drift partitioning', () => {
    const samples = Array<number>(64).fill(0); samples[0] = 4;
    const p = createSurfaceProfile(10, samples), start = { x: 13, y: -3 }, end = { x: 13, y: 3 };
    const whole = contact(sweepSurface(p, start, end));
    const at = (t: number) => ({ x: 13, y: -3 + 6 * t });
    for (const count of [2, 7, 64]) {
      let found = false;
      for (let i = 0; i < count; i++) {
        const result = sweepSurface(p, at(i / count), at((i + 1) / count));
        if (result.status === 'clear') continue;
        const part = contact(result);
        expect(Math.abs((i + part.fraction) / count - whole.fraction) * 6).toBeLessThan(2e-7);
        found = true;
        break;
      }
      expect(found).toBe(true);
    }
  });
});

// Independent slow oracle: dense parameter sampling + bisection, interpolating
// fixture samples directly rather than calling surface queries or production
// interval/minimum helpers. Random cases target robust crossings, not tangencies.
function oracle(samples: readonly number[], start: Vec, end: Vec): number | undefined {
  const gap = (t: number): number => {
    const x = start.x + (end.x - start.x) * t, y = start.y + (end.y - start.y) * t;
    let angle = Math.atan2(y, x); if (angle < 0) angle += 2 * Math.PI;
    const u = angle * samples.length / (2 * Math.PI), i = Math.floor(u) % samples.length, f = u - Math.floor(u);
    return Math.hypot(x, y) - (10 + samples[i]! * (1 - f) + samples[(i + 1) % samples.length]! * f);
  };
  for (let i = 1; i <= 8192; i++) {
    if (gap(i / 8192) > 0) continue;
    let lo = (i - 1) / 8192, hi = i / 8192;
    for (let n = 0; n < 45; n++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) > 0) lo = mid; else hi = mid;
    }
    return hi;
  }
  return undefined;
}

it('agrees with an independent dense oracle on seeded multi-rim crossings and clear chords', () => {
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  let hits = 0, misses = 0;
  for (let n = 0; n < 100; n++) {
    const samples = Array.from({ length: 32 }, () => random() * 6 - 3);
    const profile: SurfaceProfile = createSurfaceProfile(10, samples);
    const angle = random() * 2 * Math.PI, offset = random() * 14, u = polar(1, angle), normal = { x: -u.y, y: u.x };
    const start = { x: -20 * u.x + offset * normal.x, y: -20 * u.y + offset * normal.y };
    const end = { x: 20 * u.x + offset * normal.x, y: 20 * u.y + offset * normal.y };
    const expected = oracle(samples, start, end), actual = sweepSurface(profile, start, end);
    if (expected === undefined) { expect(actual.status).toBe('clear'); misses++; }
    else { expect(Math.abs(contact(actual).fraction - expected) * 40).toBeLessThan(2e-7); hits++; }
  }
  expect(hits).toBeGreaterThan(20);
  expect(misses).toBeGreaterThan(5);
});
