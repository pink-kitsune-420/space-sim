/** Host-only ocean buoyancy and linear-drag model (`packages/sim-core`). Evaluated inside numerical KDK steps; uses deterministic `dmath` in the body-fixed frame. Circular hulls approximate the sea locally as a plane (relative curvature error O(hull radius / sea radius)); legacy points retain their draft model. */
import { querySurface, type SurfaceProfile } from './surface';
import * as dm from './dmath';

/** Point-vessel gameplay model: no waves, mass, hull shape or fluid solver. Maximum survivable inward radial water-entry speed in `m/s`. Host-only (`packages/sim-core`). */
export const WATER_CRASH_SPEED = 5;
/** Linear water drag rate at full immersion in `1/s` (`s⁻¹`). Host-only (`packages/sim-core`). */
export const WATER_DRAG_PER_SECOND = 16;

/** Exact velocity kick (in `m/s`) for constant acceleration (`m/s²`) and linear drag (`1/s`) over `seconds` (`s`), avoiding a
 * first-order drag/force ordering error and unstable explicit damping. Uses deterministic `dmath.exp`/`expm1`. Host-only (`packages/sim-core`). */
export function dampedKick(velocity: number, acceleration: number, drag: number, seconds: number): number {
  return drag === 0 ? velocity + acceleration * seconds
    : velocity * dm.exp(-drag * seconds) + acceleration * -dm.expm1(-drag * seconds) / drag;
}

/** Equilibrium centre radius (`m`) at body-fixed polar angle (`rad`). Circular
 * hulls have neutral half-area immersion at sea level; the caller must also
 * check that this placement clears the seabed. Legacy points use bounded draft. */
export function waterFloatRadius(profile: SurfaceProfile, angle: number, query = querySurface, hullRadius = 0): number {
  const q = query(profile, angle), sea = profile.seaRadiusMetres;
  if (sea === undefined || q.waterDepth === 0) return q.groundRadius + hullRadius;
  if (hullRadius > 0) return sea;
  // Half-submerged equilibrium, with draft bounded for tiny worlds/shallow water.
  return sea - Math.min(.25, sea * .005, q.waterDepth / 2);
}

/** Fraction of circular hull area below the local radial sea plane. This is a
 * two-dimensional buoyancy approximation, not a fluid or displaced-volume solver. */
function circularImmersion(offset: number, radius: number): number {
  const q = offset / radius;
  if (q >= 1) return 0;
  if (q <= -1) return 1;
  const halfChord = Math.sqrt((1 - q) * (1 + q));
  return (dm.atan2(halfChord, q) - q * halfChord) / Math.PI;
}

/** Computes net gravity-buoyancy scale (`gravityFactor` in `[-1, 1]`, where `0` is neutral at `waterFloatRadius`) and linear drag rate (`drag` in `1/s`) at a body-fixed `position` (in `m`). Host-only (`packages/sim-core`). */
export function waterForces(profile: SurfaceProfile, position: { x: number; y: number }, query = querySurface, hullRadius = 0): {
  gravityFactor: number; drag: number;
} {
  const sea = profile.seaRadiusMetres, angle = dm.atan2(position.y, position.x);
  if (hullRadius > 0) {
    const immersion = sea === undefined || !profile.hasWater ? 0 : circularImmersion(dm.hypot(position.x, position.y) - sea, hullRadius);
    return { gravityFactor: 1 - 2 * immersion, drag: WATER_DRAG_PER_SECOND * immersion };
  }
  const depth = sea === undefined ? 0 : Math.max(0, sea - dm.hypot(position.x, position.y));
  const halfDraft = sea === undefined ? 0 : sea - waterFloatRadius(profile, angle, query);
  const immersion = halfDraft > 0 ? Math.min(1, depth / (2 * halfDraft)) : 0;
  return { gravityFactor: 1 - 2 * immersion, drag: WATER_DRAG_PER_SECOND * immersion };
}
