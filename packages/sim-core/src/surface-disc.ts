/** Host geometry for opt-in circular spacecraft. All points are body-fixed metres.
 * Distance is to the authoritative polar-linear curve, never the render tessellation. */
import type { SurfaceProfile, SurfaceSweep, SurfaceSweepOptions, Vec } from '../../game-api/src/index';
import { querySurface } from './surface';
import * as dm from './dmath';

const TAU = 2 * Math.PI;
const roundoffFloor = (profile: SurfaceProfile) => 128 * Number.EPSILON
  * Math.max(profile.bounds.maxRadius, profile.bounds.maxAbsDerivative) * TAU;
const contactTolerance = (profile: SurfaceProfile) => Math.max(1e-7, roundoffFloor(profile));
interface Budget { work: number; limit: number }
function spend(budget: Budget): void {
  if (++budget.work > budget.limit) throw new Error('disc-work-limit');
}
function closest(profile: SurfaceProfile, p: Vec, tolerance: number, budget: Budget) {
  const radial = dm.hypot(p.x, p.y), angle = dm.atan2(p.y, p.x);
  const at = querySurface(profile, angle);
  let best = Math.abs(radial - at.groundRadius), bestAngle = angle;
  if (radial < at.groundRadius) return { clearance: -best, angle, normal: at.groundNormal };
  // A point at this polar angle gives an upper bound. Any closer point is inside
  // this angular cone; outside it even the infinite radial ray is farther away.
  const cone = best < radial ? dm.atan2(best / radial, Math.sqrt(Math.max(0, 1 - (best / radial) * (best / radial)))) + tolerance / radial : Math.PI;
  const delta = TAU / profile.sampleCount;
  const loIndex = Math.floor((angle - cone - profile.orientationRadians) / delta);
  const hiIndex = Math.floor((angle + cone - profile.orientationRadians) / delta);
  function interval(lo: number, hi: number, r0: number, derivative: number): void {
    spend(budget);
    const radius = (t: number) => r0 + derivative * (t - lo);
    const distance = (t: number) => {
      spend(budget);
      const r = radius(t), d = dm.hypot(r * dm.cos(t) - p.x, r * dm.sin(t) - p.y);
      if (d < best) { best = d; bestAngle = t; }
      return d;
    };
    const r1 = radius(hi), maxR = Math.max(r0, r1);
    const maxAngle = Math.max(Math.abs(lo - angle), Math.abs(hi - angle));
    const sinBound = maxAngle < Math.PI / 2 ? dm.sin(maxAngle) : 1;
    const cosBound = dm.cos(Math.min(Math.PI, maxAngle));
    // f = .5*distance². This lower bound proves f'' positive throughout the
    // interval. Otherwise subdivide using a rigorous arc-length distance bound.
    const second = derivative * derivative + (cosBound >= 0 ? Math.min(r0, r1) : maxR) * radial * cosBound
      - 2 * Math.abs(derivative) * radial * sinBound;
    if (second > 0) {
      const slope = (t: number) => {
        spend(budget);
        const r = radius(t), c = dm.cos(t), s = dm.sin(t);
        return derivative * (r - p.x * c - p.y * s) - r * (-p.x * s + p.y * c);
      };
      if (slope(lo) >= 0) { distance(lo); return; }
      if (slope(hi) <= 0) { distance(hi); return; }
      let a = lo, b = hi;
      const speed = dm.hypot(derivative, maxR);
      for (let n = 0; n < 64 && (b - a) * speed > tolerance / 4; n++) {
        const mid = (a + b) / 2;
        if (slope(mid) > 0) b = mid; else a = mid;
      }
      distance((a + b) / 2); return;
    }
    const mid = (lo + hi) / 2, d = distance(mid);
    const arc = dm.hypot(derivative, maxR) * (hi - lo) / 2;
    if (d - arc >= best - tolerance / 4 || arc <= tolerance / 4) return;
    interval(lo, mid, r0, derivative);
    interval(mid, hi, radius(mid), derivative);
  }
  for (let i = loIndex; i <= hiIndex; i++) {
    const index = ((i % profile.sampleCount) + profile.sampleCount) % profile.sampleCount;
    const knot = profile.orientationRadians + i * delta;
    const derivative = (profile.sampleElevation((index + 1) % profile.sampleCount) - profile.sampleElevation(index)) / delta;
    const lo = Math.max(knot, angle - cone), hi = Math.min(knot + delta, angle + cone);
    const r = profile.referenceRadius + profile.sampleElevation(index) + derivative * (lo - knot);
    interval(lo, hi, r, derivative);
  }
  const surface = querySurface(profile, bestAngle);
  const qx = surface.groundRadius * dm.cos(bestAngle), qy = surface.groundRadius * dm.sin(bestAngle);
  return { clearance: best, angle: bestAngle,
    normal: best > 0 ? { x: (p.x - qx) / best, y: (p.y - qy) / best } : surface.groundNormal };
}

/** Signed hull-to-ground distance (m); bounded work and a conservative envelope
 * shortcut keep distant flight cheap. Exposed to modules by radius-aware sweeps. */
export function discGroundClearance(profile: SurfaceProfile, p: Vec, radius: number, tolerance = 1e-7, budget: Budget = { work: 0, limit: 262144 }) {
  const r = dm.hypot(p.x, p.y), gap = r - profile.bounds.maxRadius - radius;
  if (gap > radius) return { clearance: gap, angle: dm.atan2(p.y, p.x), normal: { x: p.x / r, y: p.y / r } };
  const result = closest(profile, p, tolerance, budget);
  return { ...result, clearance: result.clearance - radius };
}

/** A 1-Lipschitz distance gives conservative advancement along the whole drift:
 * no fixed temporal samples and no tunnelling. Exhaustion returns failed. */
export function sweepDisc(profile: SurfaceProfile, start: Vec, end: Vec, options: SurfaceSweepOptions): SurfaceSweep {
  const radius = options.radiusMetres!, tolerance = options.toleranceMetres ?? contactTolerance(profile);
  const limit = options.maxWork ?? 262144;
  if (!(radius > 0 && radius <= 32) || !Number.isFinite(radius) || !(tolerance > 0) || !Number.isFinite(tolerance)
    || !Number.isInteger(limit) || limit < 1 || limit > 262144
    || !Number.isFinite(start.x + start.y + end.x + end.y)) throw new Error('Invalid circular hull sweep');
  const budget = { work: 0, limit }, dx = end.x - start.x, dy = end.y - start.y, length = dm.hypot(dx, dy);
  let t = 0;
  const diagnostics = () => ({ toleranceMetres: tolerance, intervals: 0, evaluations: Math.min(budget.work, limit), work: Math.min(budget.work, limit) });
  const failed = (reason: 'work-limit' | 'initial-penetration' | 'precision'): SurfaceSweep => ({ status: 'failed', reason,
    verifiedFraction: t, surfaceIdentity: profile.identity, diagnostics: diagnostics() });
  if (tolerance < roundoffFloor(profile)) return failed('precision');
  try {
    for (let n = 0; n < 1024; n++) {
      spend(budget);
      const position = { x: start.x + t * dx, y: start.y + t * dy };
      const near = discGroundClearance(profile, position, radius, tolerance, budget);
      if (t === 0 && near.clearance < -tolerance) return failed('initial-penetration');
      if (near.clearance <= tolerance && (length === 0 || near.normal.x * dx + near.normal.y * dy <= 0)) {
        const surface = querySurface(profile, near.angle);
        return { status: 'hit', fraction: t, fractionBracket: [t, t], position,
          surface: { ...surface, ...(profile.hasWater ? { material: 'rock' as const, firstContactRadius: surface.groundRadius } : {}), normal: near.normal }, clearanceMetres: near.clearance, kind: t === 0 ? 'touching' : 'crossing',
          surfaceIdentity: profile.identity, diagnostics: diagnostics() };
      }
      if (t === 1 || length === 0) return { status: 'clear', surfaceIdentity: profile.identity, diagnostics: diagnostics() };
      // At a separating initial tangency, the tolerance bounds the tiny unchecked
      // prefix; every later step is bounded by distance to the solid surface.
      const advance = Math.max(tolerance / 2, near.clearance - tolerance / 4) / length;
      const next = Math.min(1, t + advance);
      if (next === t) return failed('precision');
      t = next;
    }
  } catch (error) { if (!(error instanceof Error) || error.message !== 'disc-work-limit') throw error; }
  return failed('work-limit');
}

/** Radial hull-centre support, solved against the same signed distance as sweeps. */
export function discSupport(profile: SurfaceProfile, angle: number, radius: number) {
  if (!(radius > 0 && radius <= 32) || !Number.isFinite(radius)) throw new Error('Invalid circular hull radius');
  const x = dm.cos(angle), y = dm.sin(angle), tolerance = contactTolerance(profile);
  let lo = querySurface(profile, angle).groundRadius, hi = profile.bounds.maxRadius + radius + tolerance / 2;
  const budget = { work: 0, limit: 262144 };
  for (let i = 0; i < 64 && hi - lo > tolerance / 4; i++) {
    const mid = (lo + hi) / 2;
    if (discGroundClearance(profile, { x: mid * x, y: mid * y }, radius, tolerance, budget).clearance < 0) lo = mid; else hi = mid;
  }
  const near = discGroundClearance(profile, { x: hi * x, y: hi * y }, radius, tolerance, budget);
  return { radius: hi, angle: near.angle, normal: near.normal };
}
