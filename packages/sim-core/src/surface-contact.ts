/** Host-only body-fixed polar terrain contact sweeps (`packages/sim-core`). Modules access surface contact sweeps through `@space-sim/game-api` `CORE_MOTION` (`CoreMotion.services.surfaces.sweep` / `sweepGround`) and `SURFACE_GEOMETRY` (`SurfaceProvider`).
 * Endpoints `start` and `end` are body-fixed Cartesian coordinates in `m`; tolerances and clearances are in `m`. */
import type { SurfaceSweepOptions, SurfaceSweepDiagnostics, SurfaceSweep } from '../../game-api/src/index';
export type { SurfaceSweepOptions, SurfaceSweepDiagnostics, SurfaceSweep } from '../../game-api/src/index';
import { createSurfaceProfile, querySurface, type SurfaceProfile } from './surface';
import * as dm from './dmath';

interface Point { readonly x: number; readonly y: number }
/** Maximum combined interval-traversal and polar-query work budget (`262,144`) permitted in a single surface contact sweep before returning `status: 'failed'` with `reason: 'work-limit'`. Host-only (`packages/sim-core`). */
export const SURFACE_SWEEP_MAX_WORK = 262_144;
const TAU = 2 * Math.PI;

/** Shared roundoff floor (in `m`) for drift contact, state validation and support. Host-only (`packages/sim-core`). */
export function surfaceContactTolerance(profile: SurfaceProfile): number {
  return Math.max(1e-7, 128 * Number.EPSILON
    * Math.max(profile.bounds.maxRadius, profile.bounds.maxAbsDerivative) * TAU);
}

/** Earliest point contact on a straight, body-local drift against authoritative
 * linear POLAR geometry. No rendering mesh, temporal sampling or envelope hit.
 *
 * In coordinates along the chord, p = u*s + n*b. Its radius as a function of
 * angle is |b|*sec(alpha). On each profile interval ground radius is linear in
 * angle, so clearance is strictly convex. Its unique minimum satisfies
 * s*hypot(s,b) = -b*dr/dtheta. Check that minimum as well as interval endpoints:
 * this proves exclusion and finds interior crossings and isolated tangencies.
 */
export function sweepSurface(profile: SurfaceProfile, start: Point, end: Point,
  options: SurfaceSweepOptions = {}): SurfaceSweep {
  if (profile.seaRadiusMetres === undefined || !profile.hasWater) return sweepGroundSurface(profile, start, end, options);
  options = { ...options, toleranceMetres: options.toleranceMetres ?? surfaceContactTolerance(profile) };
  // The union of rock and a sea disc. Each solver retains its convex proof;
  // max(ground, sea) need not be linear within a sampled ground interval.
  let sea = SEA_PROFILES.get(profile);
  if (!sea) {
    sea = createSurfaceProfile(profile.seaRadiusMetres, [0, 0]);
    SEA_PROFILES.set(profile, sea);
  }
  const water = sweepGroundSurface(sea, start, end, options);
  const remap = (result: SurfaceSweep, diagnostics = result.diagnostics): SurfaceSweep => {
    if (result.status !== 'hit') return { ...result, surfaceIdentity: profile.identity, diagnostics };
    const surface = querySurface(profile, dm.atan2(result.position.y, result.position.x));
    return { ...result, surfaceIdentity: profile.identity, diagnostics, surface,
      clearanceMetres: dm.hypot(result.position.x, result.position.y) - surface.firstContactRadius };
  };
  // A prefix proved against sea alone has not yet been checked against rock.
  if (water.status === 'failed') return remap({ ...water, verifiedFraction: 0 });
  const remaining = (options.maxWork ?? SURFACE_SWEEP_MAX_WORK) - water.diagnostics.work;
  if (remaining < 1) return { status: 'failed', reason: 'work-limit', verifiedFraction: 0,
    surfaceIdentity: profile.identity, diagnostics: water.diagnostics };
  const ground = sweepGroundSurface(profile, start, end, { ...options, maxWork: remaining });
  const diagnostics = { toleranceMetres: Math.max(water.diagnostics.toleranceMetres, ground.diagnostics.toleranceMetres),
    intervals: water.diagnostics.intervals + ground.diagnostics.intervals,
    evaluations: water.diagnostics.evaluations + ground.diagnostics.evaluations,
    work: water.diagnostics.work + ground.diagnostics.work };
  if (ground.status === 'failed') return remap({ ...ground,
    verifiedFraction: Math.min(ground.verifiedFraction, water.status === 'hit' ? water.fraction : 1) }, diagnostics);
  return remap(water.status === 'hit' && (ground.status !== 'hit' || water.fraction < ground.fraction) ? water : ground, diagnostics);
}

const SEA_PROFILES = new WeakMap<SurfaceProfile, SurfaceProfile>();

/** Rock/seabed only, also used after a survivable water entry. */
export function sweepGroundSurface(profile: SurfaceProfile, start: Point, end: Point,
  options: SurfaceSweepOptions = {}): SurfaceSweep {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw new Error('Surface sweep endpoints must be finite');
  }
  // Include polar-query knot snapping and angular arithmetic in the roundoff floor.
  const floor = 128 * Number.EPSILON * Math.max(profile.bounds.maxRadius,
    profile.bounds.maxAbsDerivative) * TAU;
  const tolerance = options.toleranceMetres ?? surfaceContactTolerance(profile);
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error('Surface sweep tolerance must be finite and positive');
  const maxWork = options.maxWork ?? SURFACE_SWEEP_MAX_WORK;
  if (!Number.isInteger(maxWork) || maxWork < 1 || maxWork > SURFACE_SWEEP_MAX_WORK) {
    throw new Error(`Surface sweep maxWork must be an integer in [1, ${SURFACE_SWEEP_MAX_WORK}]`);
  }
  let intervals = 0, evaluations = 0, verifiedFraction = 0;
  const diagnostics = (): SurfaceSweepDiagnostics => ({ toleranceMetres: tolerance,
    intervals, evaluations, work: intervals + evaluations });
  const failed = (reason: 'work-limit' | 'precision' | 'initial-penetration'): SurfaceSweep =>
    ({ status: 'failed', reason, verifiedFraction, surfaceIdentity: profile.identity, diagnostics: diagnostics() });
  const clear = (): SurfaceSweep => ({ status: 'clear', surfaceIdentity: profile.identity, diagnostics: diagnostics() });
  const budget = (): boolean => intervals + evaluations < maxWork;
  const scale = Math.max(profile.bounds.maxRadius, Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y));
  const conditioningError = 32 * Number.EPSILON * scale * (1 + profile.bounds.maxSlope);
  if (!Number.isFinite(floor) || tolerance < floor || conditioningError > tolerance) return failed('precision');
  const epsilon = tolerance / scale;
  if (!Number.isFinite(epsilon) || epsilon === 0) return failed('precision');
  const x0 = start.x / scale, y0 = start.y / scale;
  const x1 = end.x / scale, y1 = end.y / scale;
  const dx = x1 - x0, dy = y1 - y0, length = dm.hypot(dx, dy);
  const startRadius = dm.hypot(x0, y0);
  const startQuery = querySurface(profile, dm.atan2(y0, x0));
  evaluations++;
  const initialClearance = startRadius - startQuery.groundRadius / scale;
  if (initialClearance < -epsilon) return failed('initial-penetration');

  // Stable line coordinates keep a distant fly-through from subtracting large
  // nearly equal Cartesian positions during event refinement.
  const ux = length === 0 ? 1 : dx / length, uy = length === 0 ? 0 : dy / length;
  const nx = -uy, ny = ux;
  const b = x0 * nx + y0 * ny, s0 = x0 * ux + y0 * uy, s1 = x1 * ux + y1 * uy;
  const fraction = (s: number): number => length === 0 ? 0 : Math.max(0, Math.min(1, (s - s0) / length));
  const point = (s: number): Point => ({ x: (ux * s + nx * b) * scale, y: (uy * s + ny * b) * scale });
  const hit = (s: number, lo: number, hi: number, kind: 'crossing' | 'touching'): SurfaceSweep => {
    if (!budget()) return failed('work-limit');
    evaluations++;
    const position = length === 0 ? { ...start } : point(s);
    const surface = querySurface(profile, dm.atan2(position.y, position.x));
    const clearanceMetres = dm.hypot(position.x, position.y) - surface.groundRadius;
    if (!Number.isFinite(clearanceMetres) || Math.abs(clearanceMetres) > tolerance) return failed('precision');
    return { status: 'hit', fraction: fraction(s), fractionBracket: [fraction(lo), fraction(hi)],
      position, surface: { ...surface, normal: surface.groundNormal }, clearanceMetres, kind,
      surfaceIdentity: profile.identity, diagnostics: diagnostics() };
  };
  if (length === 0) return initialClearance <= epsilon ? hit(s0, s0, s0, 'touching') : clear();

  // The outer circle only excludes impossible contact; it is never the ground.
  const outer = profile.bounds.maxRadius / scale + epsilon;
  if (Math.abs(b) > outer) return clear();
  const extent = Math.sqrt((outer - Math.abs(b)) * (outer + Math.abs(b)));
  let a = Math.max(s0, -extent);
  const finish = Math.min(s1, extent);
  if (a > finish) return clear();
  verifiedFraction = fraction(a);

  if (b === 0) {
    // A radial chord hits before reaching the origin, where angle is undefined.
    if (s0 >= 0) return clear();
    const ground = startQuery.groundRadius / scale;
    const target = -ground;
    if (s1 < target - epsilon) return clear();
    const s = Math.min(s1, Math.max(s0, target));
    return hit(s, s, s, initialClearance <= epsilon ? 'touching' : 'crossing');
  }

  const direction = -Math.sign(b), delta = TAU / profile.sampleCount;
  const angleAt = (s: number): number => dm.atan2(uy * s + ny * b, ux * s + nx * b);
  const theta0 = angleAt(a);
  const sweepAngle = dm.atan2(Math.abs(b) * (finish - a), a * finish + b * b);
  const thetaEnd = theta0 + direction * sweepAngle;
  let coordinate = (theta0 - profile.orientationRadians) / delta;
  const nearest = Math.round(coordinate);
  if (Math.abs(coordinate - nearest) <= 8 * Number.EPSILON * profile.sampleCount) coordinate = nearest;
  let interval = direction > 0 ? Math.floor(coordinate) : Math.ceil(coordinate) - 1;
  const gap = (s: number): number | undefined => {
    if (!budget()) return undefined;
    evaluations++;
    return dm.hypot(s, b) - querySurface(profile, angleAt(s)).groundRadius / scale;
  };

  // A segment sweeps at most pi radians; this also bounds even adversarial input.
  for (let visited = 0; visited <= profile.sampleCount + 1; visited++, interval += direction) {
    if (!budget()) return failed('work-limit');
    intervals++;
    const index = ((interval % profile.sampleCount) + profile.sampleCount) % profile.sampleCount;
    const knot = profile.orientationRadians + (direction > 0 ? interval + 1 : interval) * delta;
    const last = direction * (knot - thetaEnd) >= 0;
    let z = finish;
    if (!last) {
      const ex = dm.cos(knot), ey = dm.sin(knot);
      z = b * (ux * ex + uy * ey) / (nx * ex + ny * ey);
      if (!Number.isFinite(z) || z < a - epsilon || z > finish + epsilon) return failed('precision');
      z = Math.max(a, Math.min(finish, z));
    }
    const derivative = (profile.sampleElevation((index + 1) % profile.sampleCount)
      - profile.sampleElevation(index)) / delta / scale;
    const target = -derivative * b, absTarget = Math.abs(target), b2 = b * b;
    // Rationalized quadratic in s^2 avoids cancellation at shallow minima.
    const stationary = target === 0 ? 0 : Math.sign(target) * Math.sqrt(absTarget)
      * Math.sqrt(2 * absTarget / (dm.hypot(b2, 2 * target) + b2));
    const minimum = Math.max(a, Math.min(z, stationary));
    const fa = gap(a), fm = minimum === a ? fa : gap(minimum);
    if (fa === undefined || fm === undefined) return failed('work-limit');
    if (![fa, fm, minimum].every(Number.isFinite)) return failed('precision');

    // Only an initially touching, strictly separating drift may leave contact.
    // At a knot the interval in the direction of travel supplies this derivative.
    const departing = a === s0 && initialClearance <= epsilon && minimum === a
      && a * dm.hypot(a, b) + derivative * b > 0;
    if (!departing && (fa <= 0 || (a === s0 && initialClearance <= epsilon))) return hit(a, a, a, 'touching');
    if (!departing && fm <= epsilon) {
      if (fm >= 0) return hit(minimum, minimum, minimum, 'touching');
      let lo = a, hi = minimum, fhi = fm;
      for (let iteration = 0; iteration < 80; iteration++) {
        if (hi - lo <= epsilon && Math.abs(fhi) <= epsilon) return hit(hi, lo, hi, 'crossing');
        const mid = lo + (hi - lo) / 2;
        if (mid === lo || mid === hi) return failed('precision');
        const f = gap(mid);
        if (f === undefined) return failed('work-limit');
        if (!Number.isFinite(f)) return failed('precision');
        if (f <= 0) { hi = mid; fhi = f; } else lo = mid;
      }
      return failed('precision');
    }
    verifiedFraction = fraction(z);
    if (last) return clear();
    a = z;
  }
  return failed('precision');
}
