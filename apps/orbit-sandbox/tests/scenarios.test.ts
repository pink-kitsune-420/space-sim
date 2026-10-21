import { describe, expect, it } from 'vitest';
import { TEST_SCENARIOS } from '../src/scenarios';
import { advanceSandboxFrame } from '../src/simulation-clock';
import { DEFAULT_FULL_BODY_OPTIONS } from '../src/physics';
import { PhysicsSolver } from '../src/spacelab/sim-core';
import type { CelestialBody } from '../src/types';

const figureEight = TEST_SCENARIOS.find(scenario => scenario.id === 'figure-eight')!;
const length = 5000; // metres per canonical length unit
const canonicalPeriod = 6.325913985368146;

// Equal masses and radii: pairwise Plummer softening is symmetric in this scenario.
function specificEnergy(bodies: readonly CelestialBody[]): number {
  let energy = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    energy += (a.velocity.x ** 2 + a.velocity.y ** 2) / 2;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      energy -= b.mu / Math.sqrt(
        (a.position.x - b.position.x) ** 2 + (a.position.y - b.position.y) ** 2 + b.radius ** 2 * .05,
      );
    }
  }
  return energy;
}

describe('actual Sandbox Figure-8 scenario', () => {
  it('scales canonical positions and velocities using the same gravitational time unit', () => {
    const [a, b, c] = figureEight.build() as [CelestialBody, CelestialBody, CelestialBody];
    const speed = Math.sqrt(a.mu / length); // m/s; T = sqrt(L^3 / mu)
    expect(a.position.x / length).toBeCloseTo(.9700043603264696, 14);
    expect(a.position.y / length).toBeCloseTo(-.2430875308758332, 14);
    expect(a.velocity.x / speed).toBeCloseTo(.46620368572052155, 14);
    expect(a.velocity.y / speed).toBeCloseTo(.4323657300685415, 14);
    expect(b.mu).toBe(a.mu); expect(c.mu).toBe(a.mu);
    expect(b.position).toEqual({ x: -a.position.x, y: -a.position.y });
    expect(b.velocity).toEqual(a.velocity);
    expect(c.velocity).toEqual({ x: -2 * a.velocity.x, y: -2 * a.velocity.y });
  });

  it('survives a full frame-clock cycle and converges to the same softened shared-solver model', () => {
    const bodies = figureEight.build();
    const period = canonicalPeriod * Math.sqrt(length ** 3 / bodies[0]!.mu);
    const energy = specificEnergy(bodies);
    const reference = new PhysicsSolver(bodies.map(b => ({
      id: b.id, mass: b.mass, mu: b.mu, radius: b.radius,
      position: [b.position.x, b.position.y], velocity: [b.velocity.x, b.velocity.y],
    })), { mode: 'nbody', substeps: 16, softeningRatio: Math.sqrt(.05), collisionMode: 'merge' });

    let time = 0;
    while (time < period) {
      const dt = Math.min(1 / 60, period - time);
      const result = advanceSandboxFrame(bodies, figureEight.mode, dt, 1, DEFAULT_FULL_BODY_OPTIONS, true);
      expect(result.limited).toBe(false);
      expect(bodies).toHaveLength(3);
      reference.step(dt);
      time += result.simulatedSeconds;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
          expect(distance).toBeGreaterThan(a.radius + b.radius);
        }
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      const ref = reference.getBody(body.id)!;
      const error = Math.hypot(body.position.x - ref.position[0], body.position.y - ref.position[1]) / length;
      expect(error).toBeLessThan(1e-4);
    }
    const energyDrift = Math.abs((specificEnergy(bodies) - energy) / energy);
    expect(energyDrift).toBeLessThan(1e-6);
  });
});
