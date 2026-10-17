import { describe, expect, it } from 'vitest';
import { atan2, cos, exp, expm1, hypot, normalizeAngle, sin, twoFifths } from '../../packages/sim-core/src/dmath';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/** Distance in units in the last place. */
function ulps(a: number, b: number): number {
  if (a === b) return 0;
  const scale = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  return Math.abs(a - b) / (scale * Number.EPSILON);
}

describe('deterministic math', () => {
  it('matches the platform functions to a few ulps over the ranges physics uses', () => {
    const random = rng(42);
    let worst = { sin: 0, cos: 0, atan2: 0, hypot: 0, exp: 0, expm1: 0, twoFifths: 0 };
    for (let i = 0; i < 200_000; i++) {
      const a = (random() - 0.5) * 40, b = (random() - 0.5) * 2e7, c = (random() - 0.5) * 2e7;
      // Absolute error near sin's zeros: measure against the magnitude of the argument's unit.
      worst.sin = Math.max(worst.sin, Math.abs(sin(a) - Math.sin(a)) / Number.EPSILON);
      worst.cos = Math.max(worst.cos, Math.abs(cos(a) - Math.cos(a)) / Number.EPSILON);
      worst.atan2 = Math.max(worst.atan2, ulps(atan2(b, c), Math.atan2(b, c)));
      worst.hypot = Math.max(worst.hypot, ulps(hypot(b, c), Math.hypot(b, c)));
      const x = (random() - 0.5) * 60;
      worst.exp = Math.max(worst.exp, ulps(exp(x), Math.exp(x)));
      worst.expm1 = Math.max(worst.expm1, ulps(expm1(x / 60), Math.expm1(x / 60)));
      const ratio = 10 ** (-random() * 30);
      worst.twoFifths = Math.max(worst.twoFifths, ulps(twoFifths(ratio), ratio ** 0.4));
    }
    worst = Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(2)])) as typeof worst;
    expect(worst.sin).toBeLessThan(4);
    expect(worst.cos).toBeLessThan(4);
    expect(worst.atan2).toBeLessThan(4);
    expect(worst.hypot).toBeLessThan(2);
    expect(worst.exp).toBeLessThan(8);
    expect(worst.expm1).toBeLessThan(4);
    // Newton stalls within rounding noise of y^5; the native ** is not exact either.
    expect(worst.twoFifths).toBeLessThan(16);
  });

  it('handles large arguments, quadrants and special values like Math', () => {
    // Exact reduction up to 1.6e6 rad; beyond, whole turns of the double nearest 2π are
    // removed first, losing about 1e-16 rad per turn (deterministic all the same).
    for (const x of [1e3, -1e4, 123456.789, 1.5e6, 3e7, 1e12]) {
      const tolerance = Math.abs(x) <= 1.6e6 ? 1e-13 : Math.abs(x) / (2 * Math.PI) * 4e-16;
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(tolerance);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(tolerance);
    }
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(NaN)).toBeNaN();
    expect(cos(Infinity)).toBeNaN();
    for (const [y, x] of [[0, 1], [-0, 1], [0, -1], [-0, -1], [1, 0], [-1, 0], [0, 0], [-0, -0], [1, -1], [-1, -1],
      [Infinity, 1], [1, Infinity], [-1, -Infinity], [Infinity, -Infinity], [-Infinity, Infinity], [1e-300, 1e300]] as const) {
      expect(Object.is(atan2(y, x), Math.atan2(y, x)) || Math.abs(atan2(y, x) - Math.atan2(y, x)) < 1e-15).toBe(true);
    }
    expect(atan2(NaN, 1)).toBeNaN();
    expect(hypot(3, 4)).toBe(5);
    expect(hypot(1e300, 1e300)).toBeCloseTo(Math.hypot(1e300, 1e300), -290);
    expect(hypot(1e-300, 1e-300)).toBeGreaterThan(0);
    expect(hypot(Infinity, NaN)).toBe(Infinity);
    expect(exp(0)).toBe(1);
    expect(exp(800)).toBe(Infinity);
    expect(exp(-800)).toBe(0);
    expect(Object.is(expm1(-0), -0)).toBe(true);
    expect(twoFifths(0)).toBe(0);
    expect(twoFifths(32)).toBe(4);
    expect(twoFifths(1e-300)).toBeCloseTo(1e-120, 130);
  });

  it('normalizes angles exactly, leaving angles already in range untouched', () => {
    const random = rng(7);
    for (let i = 0; i < 10_000; i++) {
      const a = (random() - 0.5) * 2 * Math.PI * 0.999;
      expect(normalizeAngle(a)).toBe(a);
      const wrapped = normalizeAngle(a + 2 * Math.PI * (Math.floor(random() * 20) - 10));
      expect(wrapped).toBeGreaterThan(-Math.PI);
      expect(wrapped).toBeLessThanOrEqual(Math.PI);
      expect(Math.abs(wrapped - a)).toBeLessThan(1e-13);
    }
    expect(normalizeAngle(Math.PI)).toBe(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 15);
  });
});
