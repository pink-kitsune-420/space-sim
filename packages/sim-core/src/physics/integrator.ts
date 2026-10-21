import { evaluateAccelerationsFlat, updateTidalTorqueFlat } from './forces';
import { resolveCollisionsFlat } from './collisions';
import type { CollisionEvent, PhysicsSolverConfig } from './types';

/**
 * Performs a single symplectic Kick-Drift-Kick velocity-Verlet sub-step in-place on flat buffers.
 *
 * Mathematical sequence:
 * 1. a1 = evaluateForces(r_t)
 * 2. r_{t+dt} = r_t + v_t * dt + 0.5 * a1 * dt^2
 * 3. a2 = evaluateForces(r_{t+dt})
 * 4. v_{t+dt} = v_t + 0.5 * (a1 + a2) * dt
 * 5. Update tidal torque spin dissipation (if enabled)
 * 6. Detect and resolve collisions (merge or bounce)
 *
 * @returns Updated body count (reduced if mergers occurred).
 */
export function stepVelocityVerlet(
  positions: Float64Array,
  velocities: Float64Array,
  accel1: Float64Array,
  accel2: Float64Array,
  masses: Float64Array,
  mus: Float64Array,
  radii: Float64Array,
  spinPeriods: Float64Array,
  spinDirections: Float64Array,
  j2Coeffs: Float64Array,
  isFixed: Uint8Array,
  removedFlags: Uint8Array,
  bodyIds: string[],
  parentIds: (string | undefined)[],
  idToIndex: Map<string, number>,
  parentIndices: Int32Array,
  count: number,
  subDt: number,
  config: PhysicsSolverConfig,
  collisionsOut: CollisionEvent[],
): number {
  if (count === 0 || subDt <= 0) {
    return count;
  }

  // 1. Initial accelerations at r(t)
  evaluateAccelerationsFlat(
    positions,
    masses,
    mus,
    radii,
    isFixed,
    j2Coeffs,
    spinPeriods,
    count,
    accel1,
    config,
    parentIndices,
  );

  // 2. Position drift: r(t + dt) = r(t) + v(t)*dt + 0.5*a1*dt^2
  const dtSqHalf = 0.5 * subDt * subDt;
  for (let i = 0; i < count; i++) {
    if (isFixed[i] === 1) continue;
    const i2 = i * 2;
    positions[i2] = positions[i2]! + velocities[i2]! * subDt + accel1[i2]! * dtSqHalf;
    positions[i2 + 1] = positions[i2 + 1]! + velocities[i2 + 1]! * subDt + accel1[i2 + 1]! * dtSqHalf;
  }

  // 3. New accelerations at r(t + dt)
  evaluateAccelerationsFlat(
    positions,
    masses,
    mus,
    radii,
    isFixed,
    j2Coeffs,
    spinPeriods,
    count,
    accel2,
    config,
    parentIndices,
  );

  // 4. Velocity kick: v(t + dt) = v(t) + 0.5*(a1 + a2)*dt
  const dtHalf = 0.5 * subDt;
  for (let i = 0; i < count; i++) {
    if (isFixed[i] === 1) continue;
    const i2 = i * 2;
    velocities[i2] = velocities[i2]! + (accel1[i2]! + accel2[i2]!) * dtHalf;
    velocities[i2 + 1] = velocities[i2 + 1]! + (accel1[i2 + 1]! + accel2[i2 + 1]!) * dtHalf;
  }

  // 5. Tidal torque rotational dissipation
  if (config.mode === 'full-body' && config.enableTidalTorque) {
    updateTidalTorqueFlat(
      positions,
      velocities,
      masses,
      mus,
      radii,
      spinPeriods,
      spinDirections,
      isFixed,
      count,
      subDt,
    );
  }

  // 6. Contact and collision resolution
  if (config.collisionMode !== 'none') {
    return resolveCollisionsFlat(
      positions,
      velocities,
      masses,
      mus,
      radii,
      spinPeriods,
      spinDirections,
      j2Coeffs,
      isFixed,
      removedFlags,
      bodyIds,
      parentIds,
      idToIndex,
      parentIndices,
      count,
      config.collisionMode,
      config.restitution,
      collisionsOut,
    );
  }

  return count;
}
