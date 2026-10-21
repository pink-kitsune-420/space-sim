import type { PhysicsMode } from '../../../game-api/src/index';

/**
 * Allocation-free evaluation of gravitational and perturbation accelerations directly
 * on pre-allocated typed arrays.
 *
 * @param positions Interleaved [x0, y0, x1, y1, ...] positions in metres.
 * @param masses Flat body masses in kg.
 * @param mus Flat gravitational parameters (G * M) in m^3/s^2.
 * @param radii Flat physical body radii in metres.
 * @param isFixed Uint8Array where 1 indicates fixed/unaccelerated body, 0 indicates dynamic.
 * @param j2Coeffs Flat authored J2 oblateness coefficients (0 if derived from spin).
 * @param spinPeriods Flat sidereal spin periods in seconds.
 * @param count Active body count.
 * @param accelOut Interleaved [ax0, ay0, ax1, ay1, ...] acceleration output buffer.
 * @param config Physical interaction options (mode, softening ratio, J2 flag).
 * @param parentIndices Optional parent index array for rails mode.
 */
export function evaluateAccelerationsFlat(
  positions: Float64Array,
  _masses: Float64Array,
  mus: Float64Array,
  radii: Float64Array,
  isFixed: Uint8Array,
  j2Coeffs: Float64Array,
  spinPeriods: Float64Array,
  count: number,
  accelOut: Float64Array,
  config: {
    readonly mode: PhysicsMode;
    readonly softeningRatio: number;
    readonly enableJ2: boolean;
  },
  parentIndices?: Int32Array | readonly number[],
): void {
  const isRails = config.mode === 'rails';
  const isFullBody = config.mode === 'full-body';
  const enableJ2 = isFullBody && config.enableJ2;
  const softeningRatio = config.softeningRatio;

  for (let i = 0; i < count; i++) {
    const i2 = i * 2;
    if (isFixed[i] === 1) {
      accelOut[i2] = 0;
      accelOut[i2 + 1] = 0;
      continue;
    }

    const xi = positions[i2]!;
    const yi = positions[i2 + 1]!;
    let ax = 0;
    let ay = 0;

    if (isRails) {
      const pIdx = parentIndices ? parentIndices[i] ?? -1 : -1;
      if (pIdx >= 0 && pIdx < count) {
        const p2 = pIdx * 2;
        const dx = positions[p2]! - xi;
        const dy = positions[p2 + 1]! - yi;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);
        const minSafeR = radii[pIdx]! * 0.1;
        if (dist > minSafeR && distSq > 1e-12) {
          const factor = mus[pIdx]! / (distSq * dist);
          ax = dx * factor;
          ay = dy * factor;
        }
      }
      accelOut[i2] = ax;
      accelOut[i2 + 1] = ay;
      continue;
    }

    // N-body gravitation across all other bodies
    for (let j = 0; j < count; j++) {
      if (j === i) continue;

      const j2 = j * 2;
      const dx = positions[j2]! - xi;
      const dy = positions[j2 + 1]! - yi;
      const distSq = dx * dx + dy * dy;
      const rj = radii[j]!;
      const eps = rj * softeningRatio;
      const softDistSq = distSq + eps * eps;
      if (softDistSq <= 1e-12) continue;

      const softDist = Math.sqrt(softDistSq);
      const factor = mus[j]! / (softDistSq * softDist);
      ax += dx * factor;
      ay += dy * factor;

      // J2 Zonal harmonic oblateness perturbation
      if (enableJ2) {
        const dist = Math.sqrt(distSq);
        if (dist > rj * 0.8 && dist > 1e-6) {
          let j2Val = j2Coeffs[j]!;
          if (j2Val <= 0 && spinPeriods[j]! > 0 && mus[j]! > 0) {
            const omega = (2 * Math.PI) / Math.max(60, spinPeriods[j]!);
            j2Val = Math.min(0.04, Math.max(0.001, (omega * omega * rj * rj * rj) / (2 * mus[j]!)));
          }
          if (j2Val > 0) {
            const j2Factor = (1.5 * mus[j]! * j2Val * rj * rj) / (distSq * distSq * dist);
            ax += dx * j2Factor;
            ay += dy * j2Factor;
          }
        }
      }
    }

    accelOut[i2] = ax;
    accelOut[i2 + 1] = ay;
  }
}

/**
 * Computes gravitational acceleration at a single test point (e.g. ship or candidate trajectory)
 * from all active bodies, avoiding object creation.
 */
export function computeGravitationalAccelerationAt(
  x: number,
  y: number,
  positions: Float64Array,
  mus: Float64Array,
  radii: Float64Array,
  count: number,
  softeningRatio: number,
  options?: {
    readonly enableJ2?: boolean;
    readonly j2Coeffs?: Float64Array;
    readonly spinPeriods?: Float64Array;
  },
  ignoreIndex = -1,
): readonly [number, number] {
  let ax = 0;
  let ay = 0;
  const enableJ2 = options?.enableJ2 ?? false;
  const j2Coeffs = options?.j2Coeffs;
  const spinPeriods = options?.spinPeriods;

  for (let j = 0; j < count; j++) {
    if (j === ignoreIndex) continue;

    const j2 = j * 2;
    const dx = positions[j2]! - x;
    const dy = positions[j2 + 1]! - y;
    const distSq = dx * dx + dy * dy;
    const rj = radii[j]!;
    const eps = rj * softeningRatio;
    const softDistSq = distSq + eps * eps;
    if (softDistSq <= 1e-12) continue;

    const softDist = Math.sqrt(softDistSq);
    const factor = mus[j]! / (softDistSq * softDist);
    ax += dx * factor;
    ay += dy * factor;

    if (enableJ2) {
      const dist = Math.sqrt(distSq);
      if (dist > rj * 0.8 && dist > 1e-6) {
        let j2Val = j2Coeffs ? j2Coeffs[j]! : 0;
        if (j2Val <= 0 && spinPeriods && spinPeriods[j]! > 0 && mus[j]! > 0) {
          const omega = (2 * Math.PI) / Math.max(60, spinPeriods[j]!);
          j2Val = Math.min(0.04, Math.max(0.001, (omega * omega * rj * rj * rj) / (2 * mus[j]!)));
        }
        if (j2Val > 0) {
          const j2Factor = (1.5 * mus[j]! * j2Val * rj * rj) / (distSq * distSq * dist);
          ax += dx * j2Factor;
          ay += dy * j2Factor;
        }
      }
    }
  }

  return [ax, ay];
}

/**
 * Updates sidereal spin periods and directions in-place on typed arrays based on tidal torque
 * from the dominant gravitational primary.
 */
export function updateTidalTorqueFlat(
  positions: Float64Array,
  velocities: Float64Array,
  masses: Float64Array,
  mus: Float64Array,
  radii: Float64Array,
  spinPeriods: Float64Array,
  spinDirections: Float64Array,
  isFixed: Uint8Array,
  count: number,
  dt: number,
): void {
  for (let i = 0; i < count; i++) {
    if (isFixed[i] === 1) continue;

    const i2 = i * 2;
    const xi = positions[i2]!;
    const yi = positions[i2 + 1]!;
    const mi = masses[i]!;
    const ri = radii[i]!;

    // Find dominant body maximizing mu / d^2
    let bestIdx = -1;
    let maxG = -1;

    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      const j2 = j * 2;
      const dx = positions[j2]! - xi;
      const dy = positions[j2 + 1]! - yi;
      const dSq = dx * dx + dy * dy;
      if (dSq < 1) continue;
      const g = mus[j]! / dSq;
      if (g > maxG) {
        maxG = g;
        bestIdx = j;
      }
    }

    if (bestIdx < 0) continue;
    const mj = masses[bestIdx]!;
    if (mj <= mi * 2) continue;

    const p2 = bestIdx * 2;
    const dx = xi - positions[p2]!;
    const dy = yi - positions[p2 + 1]!;
    const r = Math.hypot(dx, dy);
    const rj = radii[bestIdx]!;

    if (r > rj + ri && r > 1e-6) {
      const vRelX = velocities[i2]! - velocities[p2]!;
      const vRelY = velocities[i2 + 1]! - velocities[p2 + 1]!;
      // Tangential velocity: (v_rel . [-dy, dx]) / r
      const vTan = (vRelX * (-dy) + vRelY * dx) / r;
      const omegaOrbit = vTan / r;

      const currPeriod = spinPeriods[i]! > 0 ? spinPeriods[i]! : 86400;
      const currDir = spinDirections[i]! !== 0 ? spinDirections[i]! : -1;
      const currentOmega = (2 * Math.PI / currPeriod) * currDir;
      const omegaDiff = currentOmega - omegaOrbit;

      const r6 = Math.pow(r, 6);
      const dampingFactor = Math.min(0.001, (mus[bestIdx]! * Math.pow(ri, 3)) / (r6 * 1e5));
      const newOmega = currentOmega - omegaDiff * dampingFactor * dt;

      if (Math.abs(newOmega) > 1e-6) {
        spinDirections[i] = newOmega >= 0 ? 1 : -1;
        spinPeriods[i] = Math.min(10000, Math.max(30, (2 * Math.PI) / Math.abs(newOmega)));
      }
    }
  }
}
