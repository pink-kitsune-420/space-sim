/** Host-only surface support and landing safety rules (`packages/sim-core`). Modules access surface support and validation through `@space-sim/game-api` `CORE_MOTION` (`CoreMotion.services.surfaces.support` / `validate`) and `SURFACE_GEOMETRY` (`SurfaceProvider`). */
import { querySurface, surfaceIdentity, type SurfaceDefinition, type SurfaceProfile } from './surface';
import { surfaceContactTolerance, type SurfaceSweep } from './surface-contact';
import * as dm from './dmath';
import { discSupport } from './surface-disc';

/** Maximum survivable terrain touchdown speed (`5` `m/s`) relative to the rotating ground; water entry uses `WATER_CRASH_SPEED`. Host-only (`packages/sim-core`). */
export const MAX_LANDING_SPEED = 5;
/** Maximum safe touchdown angle (`π / 9` `rad`, `20°`) between the ship's body-fixed heading and every incident terrain support normal. Host-only (`packages/sim-core`). */
export const MAX_LANDING_ATTITUDE = Math.PI / 9;
/** Maximum safe terrain slope angle (`π / 6` `rad`, `30°`) from the local radial direction for a survivable dry touchdown. Host-only (`packages/sim-core`). */
export const MAX_LANDING_SLOPE = Math.PI / 6;

import type { SurfaceSupport } from '../../game-api/src/index';
export type { SurfaceSupport } from '../../game-api/src/index';

/** A contact failure must leave the caller's snapshot/time unadvanced. Host-only (`packages/sim-core`). */
export class SurfaceContactError extends Error {
  constructor(readonly result: Extract<SurfaceSweep, { status: 'failed' }>) {
    super(`Terrain contact failed: ${result.reason}; verified drift fraction ${result.verifiedFraction}`);
    this.name = 'SurfaceContactError';
  }
}

/** Configured bodies must use their exact generated identity; fixtures may be
 * paired with an unconfigured headless body of the same reference radius (in `m`).
 * Exposed via `CORE_MOTION.services.surfaces.validate` and `SURFACE_GEOMETRY`. Host-only (`packages/sim-core`). */
export function validateMotionSurface(body: { readonly radius: number; readonly surface?: SurfaceDefinition },
  profile: SurfaceProfile): void {
  if (profile.referenceRadius !== body.radius || (body.surface && profile.identity !== surfaceIdentity(body))) {
    throw new Error('Motion surface does not match body geometry');
  }
}

/** Static point support with friction at body-fixed polar `angle` (in `rad`): no sliding model. Corners cannot hide an
 * unsafe adjacent face behind the outgoing-normal query convention.
 * Exposed via `CORE_MOTION.services.surfaces.support` and `SURFACE_GEOMETRY`. Host-only (`packages/sim-core`). */
export function surfaceSupport(profile: SurfaceProfile, angle: number, radiusMetres = 0): SurfaceSupport {
  if (radiusMetres) {
    const contact = discSupport(profile, angle, radiusMetres);
    const support = surfaceSupport(profile, contact.angle);
    return { ...support, centerRadiusMetres: contact.radius };
  }
  const query = querySurface(profile, angle);
  // This function supports solid ground, including submerged seabed.
  const surface = { ...query, normal: query.groundNormal };
  const tau = 2 * Math.PI, delta = tau / profile.sampleCount;
  const theta = ((angle % tau) + tau) % tau;
  const local = ((theta - profile.orientationRadians) % tau + tau) % tau;
  const u = local / delta, nearest = Math.round(u);
  const normals = [surface.normal];
  if (profile.sampleCount > 1 && Math.abs(u - nearest) <= Math.max(
    8 * Number.EPSILON * profile.sampleCount,
    surfaceContactTolerance(profile) / (surface.groundRadius * delta))) {
    const knot = nearest % profile.sampleCount;
    // Evaluate the two interval derivatives at the contact angle/radius. The
    // tiny tolerance band is deliberately conservative for landing and liftoff.
    normals.length = 0;
    for (const i of [(knot + profile.sampleCount - 1) % profile.sampleCount, knot]) {
      const derivative = (profile.sampleElevation((i + 1) % profile.sampleCount)
        - profile.sampleElevation(i)) / delta;
      const slope = derivative / surface.groundRadius, length = dm.hypot(1, slope);
      normals.push({ x: (dm.cos(theta) + slope * dm.sin(theta)) / length,
        y: (dm.sin(theta) - slope * dm.cos(theta)) / length });
    }
  }
  const radial = { x: dm.cos(theta), y: dm.sin(theta) };
  const maxSlopeRadians = Math.max(...normals.map(n => dm.atan2(
    Math.abs(radial.x * n.y - radial.y * n.x), radial.x * n.x + radial.y * n.y)));
  return { surface, normals, maxSlopeRadians };
}

/** Returns true when a touchdown at body-fixed `heading` (`rad`) and ground-relative `speed` (`m/s`) is within `MAX_LANDING_SPEED`, `MAX_LANDING_SLOPE`, and `MAX_LANDING_ATTITUDE` for all incident normals in `support`. Host-only (`packages/sim-core`). */
export function safeSurfaceLanding(support: SurfaceSupport, heading: number, speed: number): boolean {
  const direction = { x: dm.cos(heading), y: dm.sin(heading) };
  return speed <= MAX_LANDING_SPEED && support.maxSlopeRadians <= MAX_LANDING_SLOPE
    && support.normals.every(n => direction.x * n.x + direction.y * n.y >= dm.cos(MAX_LANDING_ATTITUDE));
}
