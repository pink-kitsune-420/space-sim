import { querySurface, type SurfaceProfile } from './surface';
import * as dm from './dmath';

/** Point-vessel gameplay model: no waves, mass, hull shape or fluid solver. */
export const WATER_CRASH_SPEED = 5;
export const WATER_DRAG_PER_SECOND = 16;

/** Exact velocity kick for constant acceleration and linear drag, avoiding a
 * first-order drag/force ordering error and unstable explicit damping. */
export function dampedKick(velocity: number, acceleration: number, drag: number, seconds: number): number {
  return drag === 0 ? velocity + acceleration * seconds
    : velocity * dm.exp(-drag * seconds) + acceleration * -dm.expm1(-drag * seconds) / drag;
}

export function waterFloatRadius(profile: SurfaceProfile, angle: number, query = querySurface): number {
  const q = query(profile, angle), sea = profile.seaRadiusMetres;
  if (sea === undefined || q.waterDepth === 0) return q.groundRadius;
  // Half-submerged equilibrium, with draft bounded for tiny worlds/shallow water.
  return sea - Math.min(.25, sea * .005, q.waterDepth / 2);
}

export function waterForces(profile: SurfaceProfile, position: { x: number; y: number }, query = querySurface): {
  gravityFactor: number; drag: number;
} {
  const sea = profile.seaRadiusMetres, angle = dm.atan2(position.y, position.x);
  const depth = sea === undefined ? 0 : Math.max(0, sea - dm.hypot(position.x, position.y));
  const halfDraft = sea === undefined ? 0 : sea - waterFloatRadius(profile, angle, query);
  const immersion = halfDraft > 0 ? Math.min(1, depth / (2 * halfDraft)) : 0;
  return { gravityFactor: 1 - 2 * immersion, drag: WATER_DRAG_PER_SECOND * immersion };
}
