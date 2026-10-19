import type { Vec } from './spacelab/sim-core';
import type { CelestialBody, FullBodyOptions, MutableVec, OrbitElementsCache, OrbitGhostSample, SimulationMode } from './types';

export const EPSILON = 1e-6;

export const DEFAULT_FULL_BODY_OPTIONS: FullBodyOptions = {
  enableJ2Oblateness: true,
  enableTidalTorque: true,
  collisionMode: 'merge',
  restitution: 0.5,
};

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function findDominantBody(pos: Vec, bodies: readonly CelestialBody[], ignoreBodyId?: string): CelestialBody | null {
  let bestBody: CelestialBody | null = null;
  let maxGravity = -1;

  for (const b of bodies) {
    if (b.id === ignoreBodyId) continue;
    const d = distance(pos, b.position);
    if (d < 1) continue;
    const g = b.mu / (d * d);
    if (g > maxGravity) {
      maxGravity = g;
      bestBody = b;
    }
  }
  return bestBody;
}

export function computeCircularVelocity(pos: Vec, parent: CelestialBody, requestedDir: Vec): Vec {
  const dx = pos.x - parent.position.x;
  const dy = pos.y - parent.position.y;
  const r = Math.hypot(dx, dy);
  if (r <= parent.radius) {
    return { x: parent.velocity.x, y: parent.velocity.y };
  }

  const vCirc = Math.sqrt(parent.mu / r);
  const rx = dx / r;
  const ry = dy / r;

  const ccwX = -ry;
  const ccwY = rx;
  const cwX = ry;
  const cwY = -rx;

  const dotCcw = ccwX * requestedDir.x + ccwY * requestedDir.y;
  const dotCw = cwX * requestedDir.x + cwY * requestedDir.y;

  const chosenX = dotCcw >= dotCw ? ccwX : cwX;
  const chosenY = dotCcw >= dotCw ? ccwY : cwY;

  return {
    x: parent.velocity.x + chosenX * vCirc,
    y: parent.velocity.y + chosenY * vCirc,
  };
}

export function getOrComputeOrbitElements(
  body: CelestialBody,
  bodies: readonly CelestialBody[],
  timeSec: number,
  forceRefresh = false,
): OrbitElementsCache | null {
  if (body.isFixed) return null;

  const parent = body.parentId
    ? (bodies.find(b => b.id === body.parentId) ?? findDominantBody(body.position, bodies, body.id))
    : findDominantBody(body.position, bodies, body.id);

  if (!parent || parent.id === body.id || parent.mu <= 0) return null;

  // Cache hit check: within 0.25s of simulation time and matching parent
  if (
    !forceRefresh &&
    body.orbitCache &&
    body.orbitCache.parentBodyId === parent.id &&
    Math.abs(timeSec - body.orbitCache.epochTime) < 0.25
  ) {
    return body.orbitCache;
  }

  const rx = body.position.x - parent.position.x;
  const ry = body.position.y - parent.position.y;
  const r = Math.hypot(rx, ry);
  if (r < parent.radius * 0.5) return null;

  const vx = body.velocity.x - parent.velocity.x;
  const vy = body.velocity.y - parent.velocity.y;
  const vSq = vx * vx + vy * vy;
  const rv = rx * vx + ry * vy;
  const mu = parent.mu;

  const energy = vSq / 2 - mu / r;
  const h = rx * vy - ry * vx;
  const hSq = h * h;

  // Eccentricity vector e_vec = ((v^2 - mu/r)*r_vec - rv*v_vec) / mu
  const ex = ((vSq - mu / r) * rx - rv * vx) / mu;
  const ey = ((vSq - mu / r) * ry - rv * vy) / mu;
  const e = Math.hypot(ex, ey);
  const omega = Math.atan2(ey, ex);

  const isBound = energy < 0 && e < 0.999;
  let semiMajorAxis: number | null = null;
  let periapsisRadius: number;
  let apoapsisRadius: number | null = null;
  let orbitalPeriod: number | null = null;
  let apoapsisOffset: MutableVec | null = null;

  if (isBound) {
    semiMajorAxis = -mu / (2 * energy);
    periapsisRadius = semiMajorAxis * (1 - e);
    apoapsisRadius = semiMajorAxis * (1 + e);
    orbitalPeriod = 2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / mu);
    apoapsisOffset = {
      x: -apoapsisRadius * Math.cos(omega),
      y: -apoapsisRadius * Math.sin(omega),
    };
  } else {
    // Parabolic / hyperbolic periapsis
    periapsisRadius = hSq / (mu * (1 + e));
  }

  const periapsisOffset: MutableVec = {
    x: periapsisRadius * Math.cos(omega),
    y: periapsisRadius * Math.sin(omega),
  };

  // Generate relative orbital points around parent (64 samples for smooth rendering)
  const relativeOrbitPoints: MutableVec[] = [];
  const sampleCount = 64;

  if (isBound && semiMajorAxis !== null) {
    const a = semiMajorAxis;
    const p = a * (1 - e * e);
    for (let i = 0; i <= sampleCount; i++) {
      const nu = (i / sampleCount) * Math.PI * 2;
      const rNu = p / (1 + e * Math.cos(nu));
      const phi = omega + nu;
      relativeOrbitPoints.push({
        x: rNu * Math.cos(phi),
        y: rNu * Math.sin(phi),
      });
    }
  } else {
    // Hyperbolic arc limited to safe opening angle
    const maxNu = e > 1 ? Math.acos(-1 / e) * 0.8 : Math.PI * 0.7;
    for (let i = -sampleCount / 2; i <= sampleCount / 2; i++) {
      const nu = (i / (sampleCount / 2)) * maxNu;
      const p = hSq / mu;
      const rNu = p / (1 + e * Math.cos(nu));
      const phi = omega + nu;
      relativeOrbitPoints.push({
        x: rNu * Math.cos(phi),
        y: rNu * Math.sin(phi),
      });
    }
  }

  const cache: OrbitElementsCache = {
    parentBodyId: parent.id,
    epochTime: timeSec,
    semiMajorAxis,
    eccentricity: e,
    periapsisRadius,
    apoapsisRadius,
    orbitalPeriod,
    isBound,
    relativeOrbitPoints,
    periapsisOffset,
    apoapsisOffset,
  };

  body.orbitCache = cache;
  return cache;
}

export function computeAcceleration(
  pos: Vec,
  bodies: readonly CelestialBody[],
  mode: SimulationMode,
  currentBody?: CelestialBody,
  fullBodyOpts: FullBodyOptions = DEFAULT_FULL_BODY_OPTIONS,
): Vec {
  let ax = 0;
  let ay = 0;

  if (mode === 'kepler' && currentBody?.parentId) {
    const parent = bodies.find(b => b.id === currentBody.parentId);
    if (parent) {
      const dx = parent.position.x - pos.x;
      const dy = parent.position.y - pos.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      if (dist > parent.radius * 0.1) {
        const factor = parent.mu / (distSq * dist);
        ax += dx * factor;
        ay += dy * factor;
      }
    }
    return { x: ax, y: ay };
  }

  // N-Body gravity summation
  for (const other of bodies) {
    if (currentBody && other.id === currentBody.id) continue;
    const dx = other.position.x - pos.x;
    const dy = other.position.y - pos.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);
    // Softening avoids numerical blowup on near contact
    const softDistSq = distSq + (other.radius * other.radius * 0.05);
    const softDist = Math.sqrt(softDistSq);
    const factor = other.mu / (softDistSq * softDist);
    ax += dx * factor;
    ay += dy * factor;

    // Full body physics: J2 oblateness perturbation from spinning primary body
    if (mode === 'full-body' && fullBodyOpts.enableJ2Oblateness && dist > other.radius * 0.8) {
      const omega = (2 * Math.PI) / Math.max(60, other.rotation.period);
      // Oblateness factor based on rotational speed vs surface gravity
      const j2 = Math.min(0.04, Math.max(0.001, (omega * omega * Math.pow(other.radius, 3)) / (2 * other.mu)));
      const j2Factor = (1.5 * other.mu * j2 * other.radius * other.radius) / (distSq * distSq * dist);
      ax += dx * j2Factor;
      ay += dy * j2Factor;
    }
  }

  return { x: ax, y: ay };
}

export function predictGhostTrajectory(
  candidatePos: Vec,
  candidateVel: Vec,
  bodies: readonly CelestialBody[],
  mode: SimulationMode,
  maxSteps = 400,
  fullBodyOpts: FullBodyOptions = DEFAULT_FULL_BODY_OPTIONS,
): {
  ghostPath: OrbitGhostSample[];
  parentBody: CelestialBody | null;
  circularSpeed: number;
  currentSpeed: number;
  apoapsisRadius: number | null;
  periapsisRadius: number | null;
  orbitalPeriod: number | null;
} {
  const currentSpeed = Math.hypot(candidateVel.x, candidateVel.y);
  const parent = findDominantBody(candidatePos, bodies);
  if (!parent) {
    return {
      ghostPath: [],
      parentBody: null,
      circularSpeed: 0,
      currentSpeed,
      apoapsisRadius: null,
      periapsisRadius: null,
      orbitalPeriod: null,
    };
  }

  const relPos = { x: candidatePos.x - parent.position.x, y: candidatePos.y - parent.position.y };
  const relVel = { x: candidateVel.x - parent.velocity.x, y: candidateVel.y - parent.velocity.y };
  const r0 = Math.hypot(relPos.x, relPos.y);
  const circularSpeed = Math.sqrt(parent.mu / Math.max(1, r0));

  // Compute classical two-body orbital elements for period / apsides
  const v0Sq = relVel.x * relVel.x + relVel.y * relVel.y;
  const energy = v0Sq / 2 - parent.mu / r0;
  const h = relPos.x * relVel.y - relPos.y * relVel.x;
  const hSq = h * h;
  const eccentricity = Math.sqrt(Math.max(0, 1 + (2 * energy * hSq) / (parent.mu * parent.mu)));

  let semiMajorAxis: number | null = null;
  let periapsisRadius: number | null = null;
  let apoapsisRadius: number | null = null;
  let orbitalPeriod: number | null = null;

  if (energy < 0 && eccentricity < 0.999) {
    semiMajorAxis = -parent.mu / (2 * energy);
    periapsisRadius = semiMajorAxis * (1 - eccentricity);
    apoapsisRadius = semiMajorAxis * (1 + eccentricity);
    orbitalPeriod = 2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / parent.mu);
  } else {
    // Parabolic / hyperbolic
    periapsisRadius = hSq / (parent.mu * (1 + eccentricity));
  }

  // Predict ghost path forward numerically
  const ghostPath: OrbitGhostSample[] = [];
  let p = { x: candidatePos.x, y: candidatePos.y };
  let v = { x: candidateVel.x, y: candidateVel.y };
  let t = 0;

  // Choose adaptive dt based on distance to parent and velocity
  const baseSpeed = Math.max(currentSpeed, circularSpeed, 10);
  const targetPeriod = orbitalPeriod ? Math.min(orbitalPeriod, 5000) : (2 * Math.PI * r0) / baseSpeed;
  const dt = Math.max(0.05, Math.min(10, targetPeriod / maxSteps));

  ghostPath.push({ position: { ...p }, velocity: { ...v }, time: 0 });

  let minR = r0;
  let maxR = r0;
  let periSampleIndex = 0;
  let apoSampleIndex = 0;

  for (let step = 0; step < maxSteps; step++) {
    // Verlet step for candidate
    const a1 = computeAcceleration(p, bodies, mode, undefined, fullBodyOpts);
    const pNext = {
      x: p.x + v.x * dt + 0.5 * a1.x * dt * dt,
      y: p.y + v.y * dt + 0.5 * a1.y * dt * dt,
    };
    const a2 = computeAcceleration(pNext, bodies, mode, undefined, fullBodyOpts);
    const vNext = {
      x: v.x + 0.5 * (a1.x + a2.x) * dt,
      y: v.y + 0.5 * (a1.y + a2.y) * dt,
    };

    p = pNext;
    v = vNext;
    t += dt;

    // Check collision with any body
    let collided = false;
    for (const b of bodies) {
      const d = distance(p, b.position);
      if (d <= b.radius) {
        collided = true;
        ghostPath.push({ position: { ...p }, velocity: { ...v }, time: t, collided: true });
        break;
      }
    }
    if (collided) break;

    // Check distance relative to parent
    const currRelR = distance(p, parent.position);
    if (currRelR < minR) {
      minR = currRelR;
      periSampleIndex = ghostPath.length;
    }
    if (currRelR > maxR) {
      maxR = currRelR;
      apoSampleIndex = ghostPath.length;
    }

    // Check escape (distance > 10x initial radius and moving away)
    if (currRelR > r0 * 12 && currRelR > 500000) {
      ghostPath.push({ position: { ...p }, velocity: { ...v }, time: t, escaped: true });
      break;
    }

    // Stop after closing loop (~ 1 full orbit)
    if (step > 30 && distance(p, candidatePos) < (r0 * 0.05 + 100)) {
      ghostPath.push({ position: { ...candidatePos }, velocity: { ...v }, time: t });
      break;
    }

    ghostPath.push({ position: { ...p }, velocity: { ...v }, time: t });
  }

  if (eccentricity >= 0.025) {
    if (periSampleIndex > 0 && periSampleIndex < ghostPath.length) {
      const sample = ghostPath[periSampleIndex];
      if (sample) sample.isPeriapsis = true;
    }
    if (apoSampleIndex > 0 && apoSampleIndex < ghostPath.length && semiMajorAxis !== null) {
      const sample = ghostPath[apoSampleIndex];
      if (sample) sample.isApoapsis = true;
    }
  }

  return {
    ghostPath,
    parentBody: parent,
    circularSpeed,
    currentSpeed,
    apoapsisRadius,
    periapsisRadius,
    orbitalPeriod,
  };
}

export function stepSimulation(
  bodies: CelestialBody[],
  mode: SimulationMode,
  dt: number,
  substeps = 4,
  fullBodyOpts: FullBodyOptions = DEFAULT_FULL_BODY_OPTIONS,
  recordTrail = true,
): { mergedEvents: { survivor: CelestialBody; absorbed: CelestialBody }[] } {
  const mergedEvents: { survivor: CelestialBody; absorbed: CelestialBody }[] = [];
  const subDt = dt / substeps;

  for (let s = 0; s < substeps; s++) {
    // 1. Compute initial accelerations
    const accelerations: Vec[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.isFixed) {
        accelerations.push({ x: 0, y: 0 });
      } else {
        accelerations.push(computeAcceleration(b.position, bodies, mode, b, fullBodyOpts));
      }
    }

    // 2. Update positions: r(t + dt) = r(t) + v(t)*dt + 0.5*a(t)*dt^2
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.isFixed) continue;
      const a = accelerations[i]!;
      b.position.x += b.velocity.x * subDt + 0.5 * a.x * subDt * subDt;
      b.position.y += b.velocity.y * subDt + 0.5 * a.y * subDt * subDt;
    }

    // 3. Compute new accelerations at r(t + dt)
    const nextAccelerations: Vec[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.isFixed) {
        nextAccelerations.push({ x: 0, y: 0 });
      } else {
        nextAccelerations.push(computeAcceleration(b.position, bodies, mode, b, fullBodyOpts));
      }
    }

    // 4. Update velocities: v(t + dt) = v(t) + 0.5*(a(t) + a(t+dt))*dt (Velocity Verlet)
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (b.isFixed) continue;
      const a1 = accelerations[i]!;
      const a2 = nextAccelerations[i]!;
      b.velocity.x += 0.5 * (a1.x + a2.x) * subDt;
      b.velocity.y += 0.5 * (a1.y + a2.y) * subDt;

      // Update ring particles
      if (b.rings?.particles) {
        for (const p of b.rings.particles) {
          p.angle += p.speed * subDt;
        }
      }

      // Full body physics: tidal torque dissipation
      if (mode === 'full-body' && fullBodyOpts.enableTidalTorque && !b.isFixed) {
        const parent = findDominantBody(b.position, bodies, b.id);
        if (parent && parent.mass > b.mass * 2) {
          const dx = b.position.x - parent.position.x;
          const dy = b.position.y - parent.position.y;
          const r = Math.hypot(dx, dy);
          if (r > parent.radius + b.radius) {
            const vRelX = b.velocity.x - parent.velocity.x;
            const vRelY = b.velocity.y - parent.velocity.y;
            // Tangential speed: (v_rel . [-dy, dx]) / r
            const vTan = (vRelX * (-dy) + vRelY * dx) / r;
            const omegaOrbit = vTan / r;
            const currentOmega = (2 * Math.PI / b.rotation.period) * b.rotation.direction;
            const omegaDiff = currentOmega - omegaOrbit;
            // Gradual tidal spin synchronization
            const dampingFactor = Math.min(0.001, (parent.mu * Math.pow(b.radius, 3)) / (Math.pow(r, 6) * 1e5));
            const newOmega = currentOmega - omegaDiff * dampingFactor * subDt;
            if (Math.abs(newOmega) > 1e-6) {
              b.rotation.direction = newOmega >= 0 ? 1 : -1;
              b.rotation.period = Math.min(10000, Math.max(30, (2 * Math.PI) / Math.abs(newOmega)));
            }
          }
        }
      }
    }

    // 5. Collision & Merging / Bouncing Check
    const removedIndices = new Set<number>();
    for (let i = 0; i < bodies.length; i++) {
      if (removedIndices.has(i)) continue;
      const bi = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        if (removedIndices.has(j)) continue;
        const bj = bodies[j]!;

        const d = distance(bi.position, bj.position);
        const minDist = (bi.radius + bj.radius) * 0.95;

        if (d <= minDist) {
          if (mode === 'full-body' && fullBodyOpts.collisionMode === 'bounce') {
            // Elastic / semi-elastic collision with restitution
            const nx = (bj.position.x - bi.position.x) / Math.max(1, d);
            const ny = (bj.position.y - bi.position.y) / Math.max(1, d);

            const vRelX = bi.velocity.x - bj.velocity.x;
            const vRelY = bi.velocity.y - bj.velocity.y;
            const vNorm = vRelX * nx + vRelY * ny;

            if (vNorm > 0) {
              const e = fullBodyOpts.restitution;
              const impulse = ((1 + e) * vNorm) / ((1 / bi.mass) + (1 / bj.mass));
              if (!bi.isFixed) {
                bi.velocity.x -= (impulse / bi.mass) * nx;
                bi.velocity.y -= (impulse / bi.mass) * ny;
              }
              if (!bj.isFixed) {
                bj.velocity.x += (impulse / bj.mass) * nx;
                bj.velocity.y += (impulse / bj.mass) * ny;
              }

              // Positional separation to prevent interpenetration
              const overlap = (minDist - d) * 0.5 + 1;
              if (!bi.isFixed) {
                bi.position.x -= nx * overlap;
                bi.position.y -= ny * overlap;
              }
              if (!bj.isFixed) {
                bj.position.x += nx * overlap;
                bj.position.y += ny * overlap;
              }
            }
          } else {
            // Inelastic Merge! The one with higher mass absorbs the other
            const [survivor, absorbed, removeIdx] = bi.mass >= bj.mass
              ? [bi, bj, j]
              : [bj, bi, i];

            const totalMass = survivor.mass + absorbed.mass;
            survivor.velocity.x = (survivor.mass * survivor.velocity.x + absorbed.mass * absorbed.velocity.x) / totalMass;
            survivor.velocity.y = (survivor.mass * survivor.velocity.y + absorbed.mass * absorbed.velocity.y) / totalMass;
            survivor.mass = totalMass;
            survivor.mu += absorbed.mu;
            survivor.radius = Math.cbrt(Math.pow(survivor.radius, 3) + Math.pow(absorbed.radius, 3));

            removedIndices.add(removeIdx);
            mergedEvents.push({ survivor, absorbed });
          }
        }
      }
    }

    if (removedIndices.size > 0) {
      const remaining = bodies.filter((_, idx) => !removedIndices.has(idx));
      bodies.length = 0;
      bodies.push(...remaining);
    }
  }

  if (recordTrail) recordTrails(bodies);
  return { mergedEvents };
}

/** One visible trail sample per rendered frame, independent of physics work. */
export function recordTrails(bodies: readonly CelestialBody[]): void {
  for (const b of bodies) {
    b.trail.push({ x: b.position.x, y: b.position.y });
    if (b.trail.length > 70) {
      b.trail.shift();
    }
  }
}
