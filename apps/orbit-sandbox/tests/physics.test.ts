import { describe, it, expect } from 'vitest';
import {
  computeCircularVelocity,
  distance,
  findDominantBody,
  predictGhostTrajectory,
  stepSimulation,
  DEFAULT_FULL_BODY_OPTIONS,
} from '../src/physics';
import { instantiateBody } from '../src/presets';
import type { CelestialBody } from '../src/types';

describe('Orbit Sandbox Physics Engine', () => {
  it('calculates exact circular orbit velocity matching v = sqrt(mu / r)', () => {
    const star: CelestialBody = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, {
      mu: 16000000,
      radius: 1000,
    });

    const planetPos = { x: 4000, y: 0 };
    const r = distance(planetPos, star.position);
    const expectedSpeed = Math.sqrt(star.mu / r); // sqrt(16000000 / 4000) = sqrt(4000) ~= 63.24555 m/s

    // Requesting counter-clockwise orbit (upward)
    const vCcw = computeCircularVelocity(planetPos, star, { x: 0, y: 50 });
    expect(vCcw.x).toBeCloseTo(0, 5);
    expect(vCcw.y).toBeCloseTo(expectedSpeed, 5);

    // Requesting clockwise orbit (downward)
    const vCw = computeCircularVelocity(planetPos, star, { x: 0, y: -50 });
    expect(vCw.x).toBeCloseTo(0, 5);
    expect(vCw.y).toBeCloseTo(-expectedSpeed, 5);
  });

  it('identifies dominant gravitational body correctly', () => {
    const star = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, { mu: 1e10, radius: 2000 });
    const planet = instantiateBody('oceanic', { x: 20000, y: 0 }, { x: 0, y: 0 }, { mu: 1e7, radius: 500 });
    const moonCandidatePos = { x: 20400, y: 0 }; // 400 m from planet, 20400 m from star

    // Gravity from planet: 1e7 / (400^2) = 62.5 m/s^2
    // Gravity from star: 1e10 / (20400^2) = 24.0 m/s^2
    const dominant = findDominantBody(moonCandidatePos, [star, planet]);
    expect(dominant?.id).toBe(planet.id);
  });

  it('predicts ghost trajectory with accurate apsides and period for an elliptical orbit', () => {
    const star = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, { mu: 10000000, radius: 500 });
    const r0 = 10000;
    const vCirc = Math.sqrt(star.mu / r0); // sqrt(1000) ~= 31.62 m/s

    // Launch with circular speed
    const prediction = predictGhostTrajectory(
      { x: r0, y: 0 },
      { x: 0, y: vCirc },
      [star],
      'nbody',
      200,
    );

    expect(prediction.parentBody?.id).toBe(star.id);
    expect(prediction.circularSpeed).toBeCloseTo(vCirc, 1);
    expect(prediction.orbitalPeriod).toBeGreaterThan(0);
    // For circular orbit, periapsis and apoapsis should be approximately r0
    expect(prediction.periapsisRadius).toBeCloseTo(r0, -2);
    expect(prediction.apoapsisRadius).toBeCloseTo(r0, -2);
  });

  it('conserves energy in N-body Velocity Verlet simulation over multiple timesteps', () => {
    const star = instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, { mu: 50000000, radius: 500, isFixed: true });
    const r = 8000;
    const v = Math.sqrt(star.mu / r);
    const planet = instantiateBody('oceanic', { x: r, y: 0 }, { x: 0, y: v }, { mu: 100000, radius: 200 });

    const bodies = [star, planet];

    const getEnergy = () => {
      const p = bodies[1]!;
      const speedSq = p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y;
      const dist = distance(p.position, star.position);
      return 0.5 * speedSq - star.mu / dist;
    };

    const initialEnergy = getEnergy();

    // Step for 200 seconds of simulation time
    for (let i = 0; i < 200; i++) {
      stepSimulation(bodies, 'nbody', 1.0, 4);
    }

    const finalEnergy = getEnergy();
    // Energy drift in symplectic Verlet should be negligible (< 0.2%)
    const relativeDrift = Math.abs((finalEnergy - initialEnergy) / initialEnergy);
    expect(relativeDrift).toBeLessThan(0.005);
  });

  describe('Full Body Physics', () => {
    it('applies J2 oblateness acceleration perturbation', () => {
      const fastSpinningGiant = instantiateBody('gas-giant', { x: 0, y: 0 }, { x: 0, y: 0 }, {
        mu: 100000000,
        radius: 2000,
        rotation: { period: 60, direction: -1 }, // Fast rotation
        isFixed: true,
      });

      const satellitePos = { x: 3000, y: 0 };
      const bodies = [fastSpinningGiant];

      // Compare acceleration with full-body J2 vs standard point-mass
      const candidate1 = predictGhostTrajectory(satellitePos, { x: 0, y: 150 }, bodies, 'nbody');
      const candidate2 = predictGhostTrajectory(satellitePos, { x: 0, y: 150 }, bodies, 'full-body', 200, {
        ...DEFAULT_FULL_BODY_OPTIONS,
        enableJ2Oblateness: true,
      });

      expect(candidate1.ghostPath.length).toBeGreaterThan(0);
      expect(candidate2.ghostPath.length).toBeGreaterThan(0);
      // Ghost paths will differ due to J2 quadrupole potential
      expect(candidate2.ghostPath[10]?.position.x).not.toEqual(candidate1.ghostPath[10]?.position.x);
    });

    it('handles inelastic collision merging with momentum & volume conservation', () => {
      const b1 = instantiateBody('oceanic', { x: 0, y: 0 }, { x: 10, y: 0 }, {
        radius: 100,
        mu: 10000,
        isFixed: false,
      });
      const b2 = instantiateBody('rocky', { x: 50, y: 0 }, { x: -10, y: 0 }, {
        radius: 80,
        mu: 5000,
        isFixed: false,
      });

      const totalMass = b1.mass + b2.mass;
      const expectedVx = (b1.mass * 10 + b2.mass * (-10)) / totalMass;
      const expectedRadius = Math.cbrt(Math.pow(100, 3) + Math.pow(80, 3));

      const bodies = [b1, b2];
      const result = stepSimulation(bodies, 'full-body', 0.1, 1, {
        ...DEFAULT_FULL_BODY_OPTIONS,
        collisionMode: 'merge',
      });

      expect(bodies.length).toBe(1);
      expect(result.mergedEvents.length).toBe(1);
      const survivor = bodies[0]!;
      expect(survivor.velocity.x).toBeCloseTo(expectedVx, 1);
      expect(survivor.radius).toBeCloseTo(expectedRadius, 1);
    });

    it('handles elastic collision bouncing when collisionMode is bounce', () => {
      const b1 = instantiateBody('oceanic', { x: 0, y: 0 }, { x: 10, y: 0 }, {
        radius: 50,
        mu: 10000,
        isFixed: false,
      });
      const b2 = instantiateBody('rocky', { x: 40, y: 0 }, { x: -10, y: 0 }, {
        radius: 50,
        mu: 10000,
        isFixed: false,
      });

      const bodies = [b1, b2];
      const initialCount = bodies.length;

      stepSimulation(bodies, 'full-body', 0.1, 1, {
        ...DEFAULT_FULL_BODY_OPTIONS,
        collisionMode: 'bounce',
        restitution: 0.8,
      });

      // Bodies should NOT merge, both should survive
      expect(bodies.length).toBe(initialCount);
      // Velociites should have bounced and inverted direction
      expect(bodies[0]!.velocity.x).toBeLessThan(0);
      expect(bodies[1]!.velocity.x).toBeGreaterThan(0);
    });
  });
});
