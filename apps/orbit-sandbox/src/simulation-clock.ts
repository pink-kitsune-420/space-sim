import type { CelestialBody, FullBodyOptions, SimulationMode } from './types';
import { recordTrails, stepSimulation } from './physics';
import { WARP_FACTORS } from './spacelab/sim-core';

export const SANDBOX_MAX_WARP = 100000;
const CPU_BUDGET_MS = 8;
// Close to the former 50× / 60 FPS / four-step resolution. Faster warp adds work.
const MAX_STEP_SECONDS = .2;

/** Resolve orbital curvature and approach/contact times without enlarging steps at high warp. */
function maximumStep(bodies: readonly CelestialBody[]): number {
  let result = MAX_STEP_SECONDS;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (a.isFixed && b.isFixed) continue;
      const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
      const radii = a.radius + b.radius;
      const radius = Math.max(distance, radii * .5, 1);
      const mu = a.mu + b.mu;
      if (mu > 0) result = Math.min(result, .05 * Math.sqrt(radius * radius * radius / mu));
      const speed = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (speed > 0) result = Math.min(result, (Math.max(0, distance - radii) + radii * .1) / speed * .5);
    }
  }
  return result;
}

/** A frame advances only time actually integrated. Unserved wall-time demand is discarded. */
export function advanceSandboxFrame(
  bodies: CelestialBody[], mode: SimulationMode, wallSeconds: number, warp: number,
  options: FullBodyOptions, disableLimiter = false, now: () => number = () => performance.now(),
): { requestedSeconds: number; simulatedSeconds: number; limited: boolean; steps: number } {
  const requestedSeconds = Math.max(0, Math.min(.1, wallSeconds)) * Math.max(0, Math.min(SANDBOX_MAX_WARP, warp));
  let simulatedSeconds = 0, steps = 0;
  const deadline = disableLimiter ? Infinity : now() + CPU_BUDGET_MS;
  const frameStep = Math.min(MAX_STEP_SECONDS, requestedSeconds / 4);
  while (simulatedSeconds < requestedSeconds) {
    if (steps && !disableLimiter && now() >= deadline) break;
    const step = Math.min(frameStep, maximumStep(bodies), requestedSeconds - simulatedSeconds);
    if (!(step > 0) || simulatedSeconds + step === simulatedSeconds) break;
    stepSimulation(bodies, mode, step, 1, options, false);
    simulatedSeconds += step;
    steps++;
    // Ignore only rounding residue, never substitute a larger physical step.
    if (requestedSeconds - simulatedSeconds <= requestedSeconds * Number.EPSILON * 4) { simulatedSeconds = requestedSeconds; break; }
  }
  if (steps) recordTrails(bodies);
  return { requestedSeconds, simulatedSeconds, limited: simulatedSeconds < requestedSeconds, steps };
}

/** Select a supported lower factor with headroom; overload never raises warp automatically. */
export function sustainableWarp(current: number, simulatedSeconds: number, wallSeconds: number): number {
  const available = wallSeconds > 0 ? simulatedSeconds / wallSeconds * .8 : 0;
  if (available >= current) return current;
  let next = .2;
  for (const factor of WARP_FACTORS) if (factor <= available && factor < current) next = factor;
  return Math.min(current, next);
}
