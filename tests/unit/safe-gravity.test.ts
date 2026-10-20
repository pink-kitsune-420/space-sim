import { describe, expect, it } from 'vitest';
import { evaluateSafeRadialGravity } from '../../packages/sim-core/src/index';

describe('evaluateSafeRadialGravity', () => {
  const mu = 4e14, core = 1000, out = { x: 0, y: 0 };
  it('matches point-mass gravity outside the core', () => {
    evaluateSafeRadialGravity(3000, 4000, mu, core, out);
    const r = 5000;
    expect(out.x).toBeCloseTo(-mu / (r * r) * .6, 9);
    expect(out.y).toBeCloseTo(-mu / (r * r) * .8, 9);
  });
  it('is continuous at the core radius and linear inside', () => {
    evaluateSafeRadialGravity(core, 0, mu, core, out);
    const edge = out.x;
    expect(edge).toBeCloseTo(-mu / (core * core), 6);
    evaluateSafeRadialGravity(core / 2, 0, mu, core, out);
    expect(out.x).toBeCloseTo(edge / 2, 6);
  });
  it('stays finite at and near the centre', () => {
    for (const [x, y] of [[0, 0], [1e-300, 0], [0, -1e-200]]) {
      evaluateSafeRadialGravity(x!, y!, mu, core, out);
      expect(Number.isFinite(out.x) && Number.isFinite(out.y)).toBe(true);
    }
    evaluateSafeRadialGravity(0, 0, mu, core, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
  it('falls back to point mass for an invalid core radius and returns out', () => {
    expect(evaluateSafeRadialGravity(2000, 0, mu, 0, out)).toBe(out);
    expect(out.x).toBeCloseTo(-mu / 4e6, 6);
  });
});
