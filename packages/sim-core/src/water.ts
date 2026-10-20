/** Host-only point-vessel ocean buoyancy and linear-drag model (`packages/sim-core`). Evaluated inside `SimulationContext` numerical KDK steps via `CORE_MOTION`; uses deterministic `dmath` transcendentals in the body-fixed polar surface frame. */
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

/** Equilibrium floating radius in `m` from the body centre at body-fixed polar `angle` (in `rad`), or `groundRadius` when dry. Host-only (`packages/sim-core`). */
export function waterFloatRadius(profile: SurfaceProfile, angle: number, query = querySurface): number {
  const q = query(profile, angle), sea = profile.seaRadiusMetres;
  if (sea === undefined || q.waterDepth === 0) return q.groundRadius;
  // Half-submerged equilibrium, with draft bounded for tiny worlds/shallow water.
  return sea - Math.min(.25, sea * .005, q.waterDepth / 2);
}

/** Computes net gravity-buoyancy scale (`gravityFactor` in `[-1, 1]`, where `0` is neutral at `waterFloatRadius`) and linear drag rate (`drag` in `1/s`) at a body-fixed `position` (in `m`). Host-only (`packages/sim-core`). */
export function waterForces(profile: SurfaceProfile, position: { x: number; y: number }, query = querySurface): {
  gravityFactor: number; drag: number;
} {
  const sea = profile.seaRadiusMetres, angle = dm.atan2(position.y, position.x);
  const depth = sea === undefined ? 0 : Math.max(0, sea - dm.hypot(position.x, position.y));
  const halfDraft = sea === undefined ? 0 : sea - waterFloatRadius(profile, angle, query);
  const immersion = halfDraft > 0 ? Math.min(1, depth / (2 * halfDraft)) : 0;
  return { gravityFactor: 1 - 2 * immersion, drag: WATER_DRAG_PER_SECOND * immersion };
}
