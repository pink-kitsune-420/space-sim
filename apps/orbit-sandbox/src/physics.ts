import {
  type BodyPhysicalState,
  type PhysicsMode,
  PhysicsSolver,
  type PhysicsSolverConfig,
  type Vec,
} from './spacelab/sim-core';
import type {
  CelestialBody,
  FullBodyOptions,
  MutableVec,
  OrbitElementsCache,
  OrbitGhostSample,
  SimulationMode,
} from './types';

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

export function findDominantBody(
  pos: Vec,
  bodies: readonly CelestialBody[],
  ignoreBodyId?: string,
): CelestialBody | null {
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

function toBodyPhysicalState(
  b: CelestialBody,
  mode: SimulationMode,
  bodies: readonly CelestialBody[],
): BodyPhysicalState {
  let parentId = b.parentId;
  if (!parentId && !b.isFixed && mode === 'kepler') {
    parentId = findDominantBody(b.position, bodies, b.id)?.id ?? null;
  }
  return {
    id: b.id,
    mass: b.mass,
    mu: b.mu,
    radius: b.radius,
    position: [b.position.x, b.position.y],
    velocity: [b.velocity.x, b.velocity.y],
    spinPeriod: b.rotation.period,
    spinDirection: b.rotation.direction,
    isFixed: b.isFixed,
    parentId: parentId ?? undefined,
  };
}

let sandboxSolver: PhysicsSolver | null = null;

function syncSandboxSolver(
  bodies: readonly CelestialBody[],
  mode: SimulationMode,
  fullBodyOpts: FullBodyOptions,
  substeps = 4,
): PhysicsSolver {
  const solverMode: PhysicsMode = mode === 'kepler' ? 'rails' : mode;
  const config: Partial<PhysicsSolverConfig> = {
    mode: solverMode,
    substeps,
    softeningRatio: Math.sqrt(0.05),
    enableJ2: mode === 'full-body' && fullBodyOpts.enableJ2Oblateness,
    enableTidalTorque: mode === 'full-body' && fullBodyOpts.enableTidalTorque,
    collisionMode: mode === 'full-body' ? fullBodyOpts.collisionMode : 'merge',
    restitution: fullBodyOpts.restitution,
  };

  if (!sandboxSolver) {
    const physicalBodies = bodies.map(b => toBodyPhysicalState(b, mode, bodies));
    sandboxSolver = new PhysicsSolver(physicalBodies, config, Math.max(64, bodies.length * 2));
    return sandboxSolver;
  }

  let needsReset = sandboxSolver.getBodyCount() !== bodies.length;
  if (!needsReset) {
    for (let i = 0; i < bodies.length; i++) {
      if (sandboxSolver.getBodyId(i) !== bodies[i]!.id) {
        needsReset = true;
        break;
      }
    }
  }

  if (needsReset) {
    const physicalBodies = bodies.map(b => toBodyPhysicalState(b, mode, bodies));
    sandboxSolver.resetBodies(physicalBodies);
    sandboxSolver.updateConfig(config);
    return sandboxSolver;
  }

  const solver = sandboxSolver;
  solver.updateConfig(config);
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    solver.setBodyPosition(i, b.position.x, b.position.y);
    solver.setBodyVelocity(i, b.velocity.x, b.velocity.y);
    if (solver.getBodyMass(i) !== b.mass) solver.setBodyMass(i, b.mass);
    if (solver.getBodyMu(i) !== b.mu) solver.setBodyMu(i, b.mu);
    if (solver.getBodyRadius(i) !== b.radius) solver.setBodyRadius(i, b.radius);
    if (
      solver.getBodySpinPeriod(i) !== b.rotation.period ||
      solver.getBodySpinDirection(i) !== b.rotation.direction
    ) {
      solver.setBodySpin(i, b.rotation.period, b.rotation.direction);
    }
  }

  return solver;
}

function computeTwoBodyAcceleration(
  x: number,
  y: number,
  parent: CelestialBody,
): readonly [number, number] {
  const dx = parent.position.x - x;
  const dy = parent.position.y - y;
  const distSq = dx * dx + dy * dy;
  const dist = Math.sqrt(distSq);
  if (dist > parent.radius * 0.1) {
    const factor = parent.mu / (distSq * dist);
    return [dx * factor, dy * factor];
  }
  return [0, 0];
}

export function computeAcceleration(
  pos: Vec,
  bodies: readonly CelestialBody[],
  mode: SimulationMode,
  currentBody?: CelestialBody,
  fullBodyOpts: FullBodyOptions = DEFAULT_FULL_BODY_OPTIONS,
): Vec {
  if (mode === 'kepler' && currentBody?.parentId) {
    const parent = bodies.find(b => b.id === currentBody.parentId);
    if (parent) {
      const [ax, ay] = computeTwoBodyAcceleration(pos.x, pos.y, parent);
      return { x: ax, y: ay };
    }
    return { x: 0, y: 0 };
  }

  const solver = syncSandboxSolver(bodies, mode, fullBodyOpts);
  const [ax, ay] = solver.computeAccelerationAt(pos.x, pos.y, currentBody?.id);
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

  // Predict ghost path forward numerically using PhysicsSolver force evaluation
  const solver = syncSandboxSolver(bodies, mode, fullBodyOpts);
  const ghostPath: OrbitGhostSample[] = [];
  let px = candidatePos.x;
  let py = candidatePos.y;
  let vx = candidateVel.x;
  let vy = candidateVel.y;
  let t = 0;

  // Choose adaptive dt based on distance to parent and velocity
  const baseSpeed = Math.max(currentSpeed, circularSpeed, 10);
  const targetPeriod = orbitalPeriod ? Math.min(orbitalPeriod, 5000) : (2 * Math.PI * r0) / baseSpeed;
  const dt = Math.max(0.05, Math.min(10, targetPeriod / maxSteps));

  ghostPath.push({ position: { x: px, y: py }, velocity: { x: vx, y: vy }, time: 0 });

  let minR = r0;
  let maxR = r0;
  let periSampleIndex = 0;
  let apoSampleIndex = 0;

  for (let step = 0; step < maxSteps; step++) {
    const [a1x, a1y] = mode === 'kepler' && parent
      ? computeTwoBodyAcceleration(px, py, parent)
      : solver.computeAccelerationAt(px, py);

    const pNextX = px + vx * dt + 0.5 * a1x * dt * dt;
    const pNextY = py + vy * dt + 0.5 * a1y * dt * dt;

    const [a2x, a2y] = mode === 'kepler' && parent
      ? computeTwoBodyAcceleration(pNextX, pNextY, parent)
      : solver.computeAccelerationAt(pNextX, pNextY);

    vx += 0.5 * (a1x + a2x) * dt;
    vy += 0.5 * (a1y + a2y) * dt;
    px = pNextX;
    py = pNextY;
    t += dt;

    // Check collision with any body
    let collided = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const d = Math.hypot(px - b.position.x, py - b.position.y);
      if (d <= b.radius) {
        collided = true;
        ghostPath.push({ position: { x: px, y: py }, velocity: { x: vx, y: vy }, time: t, collided: true });
        break;
      }
    }
    if (collided) break;

    // Check distance relative to parent
    const currRelR = Math.hypot(px - parent.position.x, py - parent.position.y);
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
      ghostPath.push({ position: { x: px, y: py }, velocity: { x: vx, y: vy }, time: t, escaped: true });
      break;
    }

    // Stop after closing loop (~ 1 full orbit)
    if (step > 30 && Math.hypot(px - candidatePos.x, py - candidatePos.y) < (r0 * 0.05 + 100)) {
      ghostPath.push({ position: { x: candidatePos.x, y: candidatePos.y }, velocity: { x: vx, y: vy }, time: t });
      break;
    }

    ghostPath.push({ position: { x: px, y: py }, velocity: { x: vx, y: vy }, time: t });
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
  if (bodies.length === 0 || dt <= 0) {
    return { mergedEvents: [] };
  }

  const solver = syncSandboxSolver(bodies, mode, fullBodyOpts, substeps);
  const result = solver.step(dt);
  const mergedEvents: { survivor: CelestialBody; absorbed: CelestialBody }[] = [];

  // 1. Process merges if any occurred
  if (result.collisions.length > 0) {
    for (const c of result.collisions) {
      if (c.type === 'merge') {
        const survivor = bodies.find(b => b.id === c.survivorId);
        const absorbed = bodies.find(b => b.id === c.absorbedId);
        if (survivor && absorbed) {
          mergedEvents.push({ survivor, absorbed });
          const absIdx = bodies.indexOf(absorbed);
          if (absIdx >= 0) {
            bodies.splice(absIdx, 1);
          }
          survivor.mass = c.newMass;
          survivor.mu = c.newMu;
          survivor.radius = c.newRadius;
        }
      }
    }
  }

  // 2. Update bodies in-place from flat solver buffers with zero allocations
  const count = solver.getBodyCount();
  for (let i = 0; i < count; i++) {
    const id = solver.getBodyId(i)!;
    let b = bodies[i];
    if (!b || b.id !== id) {
      b = bodies.find(item => item.id === id);
    }
    if (b) {
      b.position.x = solver.getBodyX(i);
      b.position.y = solver.getBodyY(i);
      b.velocity.x = solver.getBodyVx(i);
      b.velocity.y = solver.getBodyVy(i);
      b.mass = solver.getBodyMass(i);
      b.mu = solver.getBodyMu(i);
      b.radius = solver.getBodyRadius(i);
      b.rotation.period = solver.getBodySpinPeriod(i);
      b.rotation.direction = (solver.getBodySpinDirection(i) >= 0 ? 1 : -1) as 1 | -1;

      // Update ring particles
      if (b.rings?.particles) {
        for (const p of b.rings.particles) {
          p.angle += p.speed * dt;
        }
      }
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
