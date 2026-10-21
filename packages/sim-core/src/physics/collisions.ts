import type { CollisionMode } from '../../../game-api/src/index';
import type { CollisionEvent } from './types';

/**
 * Detects and resolves body-body contact collisions in-place on flat buffers.
 *
 * Supports:
 * - 'merge': Inelastic collision preserving linear momentum, mass, volume, and gravitational parameter.
 *   Removes the absorbed body from buffers via compacting in O(N).
 * - 'bounce': Partially elastic collision with restitution and positional depenetration.
 * - 'none': Contact pass-through without interaction.
 *
 * @returns The updated active body count after any merges.
 */
export function resolveCollisionsFlat(
  positions: Float64Array,
  velocities: Float64Array,
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
  collisionMode: CollisionMode,
  restitution: number,
  eventsOut: CollisionEvent[],
): number {
  if (collisionMode === 'none' || count < 2) {
    return count;
  }

  if (collisionMode === 'bounce') {
    for (let i = 0; i < count; i++) {
      const i2 = i * 2;
      const xi = positions[i2]!;
      const yi = positions[i2 + 1]!;
      const ri = radii[i]!;

      for (let j = i + 1; j < count; j++) {
        const j2 = j * 2;
        const xj = positions[j2]!;
        const yj = positions[j2 + 1]!;
        const rj = radii[j]!;

        const dx = xj - xi;
        const dy = yj - yi;
        const minDist = (ri + rj) * 0.95;
        const distSq = dx * dx + dy * dy;

        if (distSq <= minDist * minDist) {
          const d = Math.sqrt(distSq);
          const nx = dx / Math.max(1, d);
          const ny = dy / Math.max(1, d);

          const vRelX = velocities[i2]! - velocities[j2]!;
          const vRelY = velocities[i2 + 1]! - velocities[j2 + 1]!;
          const vNorm = vRelX * nx + vRelY * ny;

          if (vNorm > 0) {
            const fixedI = isFixed[i] === 1;
            const fixedJ = isFixed[j] === 1;
            const invMassI = fixedI ? 0 : 1 / masses[i]!;
            const invMassJ = fixedJ ? 0 : 1 / masses[j]!;
            const invMassSum = invMassI + invMassJ;

            if (invMassSum > 0) {
              const impulse = ((1 + restitution) * vNorm) / invMassSum;

              if (!fixedI) {
                velocities[i2] = velocities[i2]! - impulse * invMassI * nx;
                velocities[i2 + 1] = velocities[i2 + 1]! - impulse * invMassI * ny;
              }
              if (!fixedJ) {
                velocities[j2] = velocities[j2]! + impulse * invMassJ * nx;
                velocities[j2 + 1] = velocities[j2 + 1]! + impulse * invMassJ * ny;
              }

              // Positional separation to prevent interpenetration sticking
              const overlap = (minDist - d) * 0.5 + 1;
              if (!fixedI && !fixedJ) {
                positions[i2] = positions[i2]! - nx * overlap;
                positions[i2 + 1] = positions[i2 + 1]! - ny * overlap;
                positions[j2] = positions[j2]! + nx * overlap;
                positions[j2 + 1] = positions[j2 + 1]! + ny * overlap;
              } else if (!fixedI) {
                positions[i2] = positions[i2]! - nx * ((minDist - d) + 1);
                positions[i2 + 1] = positions[i2 + 1]! - ny * ((minDist - d) + 1);
              } else if (!fixedJ) {
                positions[j2] = positions[j2]! + nx * ((minDist - d) + 1);
                positions[j2 + 1] = positions[j2 + 1]! + ny * ((minDist - d) + 1);
              }

              eventsOut.push({
                type: 'bounce',
                bodyAId: bodyIds[i]!,
                bodyBId: bodyIds[j]!,
                impulse,
              });
            }
          }
        }
      }
    }
    return count;
  }

  // collisionMode === 'merge'
  removedFlags.fill(0, 0, count);
  let anyMerged = false;

  for (let i = 0; i < count; i++) {
    if (removedFlags[i] === 1) continue;
    const i2 = i * 2;
    const ri = radii[i]!;

    for (let j = i + 1; j < count; j++) {
      if (removedFlags[j] === 1) continue;
      const j2 = j * 2;
      const rj = radii[j]!;

      const dx = positions[j2]! - positions[i2]!;
      const dy = positions[j2 + 1]! - positions[i2 + 1]!;
      const minDist = (ri + rj) * 0.95;
      const distSq = dx * dx + dy * dy;

      if (distSq <= minDist * minDist) {
        // Higher mass absorbs the other
        const [surv, abs] = masses[i]! >= masses[j]! ? [i, j] : [j, i];
        const s2 = surv * 2;
        const a2 = abs * 2;

        const mSurv = masses[surv]!;
        const mAbs = masses[abs]!;
        const totalMass = mSurv + mAbs;

        const newVx = (mSurv * velocities[s2]! + mAbs * velocities[a2]!) / totalMass;
        const newVy = (mSurv * velocities[s2 + 1]! + mAbs * velocities[a2 + 1]!) / totalMass;

        if (isFixed[surv] === 0) {
          velocities[s2] = newVx;
          velocities[s2 + 1] = newVy;
        }

        masses[surv] = totalMass;
        mus[surv] = mus[surv]! + mus[abs]!;

        const rSurv = radii[surv]!;
        const rAbs = radii[abs]!;
        radii[surv] = Math.cbrt(rSurv * rSurv * rSurv + rAbs * rAbs * rAbs);

        removedFlags[abs] = 1;
        anyMerged = true;

        eventsOut.push({
          type: 'merge',
          survivorId: bodyIds[surv]!,
          absorbedId: bodyIds[abs]!,
          newMass: totalMass,
          newRadius: radii[surv]!,
          newMu: mus[surv]!,
        });
      }
    }
  }

  if (!anyMerged) {
    return count;
  }

  // Compact active bodies in O(N)
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < count; readIdx++) {
    if (removedFlags[readIdx] === 0) {
      if (writeIdx !== readIdx) {
        const w2 = 2 * writeIdx;
        const r2 = 2 * readIdx;
        positions[w2] = positions[r2]!;
        positions[w2 + 1] = positions[r2 + 1]!;
        velocities[w2] = velocities[r2]!;
        velocities[w2 + 1] = velocities[r2 + 1]!;
        masses[writeIdx] = masses[readIdx]!;
        mus[writeIdx] = mus[readIdx]!;
        radii[writeIdx] = radii[readIdx]!;
        spinPeriods[writeIdx] = spinPeriods[readIdx]!;
        spinDirections[writeIdx] = spinDirections[readIdx]!;
        j2Coeffs[writeIdx] = j2Coeffs[readIdx]!;
        isFixed[writeIdx] = isFixed[readIdx]!;
        bodyIds[writeIdx] = bodyIds[readIdx]!;
        parentIds[writeIdx] = parentIds[readIdx];
      }
      writeIdx++;
    } else {
      idToIndex.delete(bodyIds[readIdx]!);
    }
  }

  bodyIds.length = writeIdx;
  parentIds.length = writeIdx;

  for (let k = 0; k < writeIdx; k++) {
    idToIndex.set(bodyIds[k]!, k);
  }

  for (let k = 0; k < writeIdx; k++) {
    const pId = parentIds[k];
    parentIndices[k] = pId !== undefined ? (idToIndex.get(pId) ?? -1) : -1;
  }

  return writeIdx;
}
