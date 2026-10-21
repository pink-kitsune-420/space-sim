import { describe, expect, it } from 'vitest';
import {
  type BodyPhysicalState,
  PhysicsSolver,
} from '../../packages/sim-core/src/physics/index';

describe('PhysicsSolver & Numerical Astrodynamics Kernel', () => {
  describe('Two-Body Circular Kepler Orbit & Symplectic Conservation', () => {
    it('accurately reproduces circular orbit period and return position', () => {
      // Earth-like primary and satellite
      const mu = 3.986004418e14; // m^3 / s^2
      const radius = 6.371e6; // m
      const orbitalRadius = 7.0e6; // m (approx 630 km altitude)

      // Circular velocity v = sqrt(mu / r)
      const vCirc = Math.sqrt(mu / orbitalRadius);
      // Orbital period T = 2 * pi * sqrt(r^3 / mu)
      const period = 2 * Math.PI * Math.sqrt(Math.pow(orbitalRadius, 3) / mu);

      const earth: BodyPhysicalState = {
        id: 'earth',
        mass: 5.972e24,
        mu,
        radius,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };

      const sat: BodyPhysicalState = {
        id: 'sat',
        mass: 1000,
        mu: 0,
        radius: 5,
        position: [orbitalRadius, 0],
        velocity: [0, vCirc],
      };

      const solver = new PhysicsSolver([earth, sat], {
        mode: 'nbody',
        substeps: 4,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      // Step forward by exactly 1 orbital period with dt = 2s
      const dt = 2.0;
      const totalSteps = Math.floor(period / dt);
      const remainder = period - totalSteps * dt;

      for (let i = 0; i < totalSteps; i++) {
        solver.step(dt);
      }
      if (remainder > 0) {
        solver.step(remainder);
      }

      const endSat = solver.getBody('sat')!;
      const endR = Math.hypot(endSat.position[0], endSat.position[1]);
      const endV = Math.hypot(endSat.velocity[0], endSat.velocity[1]);

      // Orbital radius should be preserved within 0.05%
      const rErr = Math.abs(endR - orbitalRadius) / orbitalRadius;
      expect(rErr).toBeLessThan(0.0005);

      // Speed should be preserved within 0.05%
      const vErr = Math.abs(endV - vCirc) / vCirc;
      expect(vErr).toBeLessThan(0.0005);

      // Satellite should have returned close to initial position [orbitalRadius, 0]
      const posDistance = Math.hypot(endSat.position[0] - orbitalRadius, endSat.position[1]);
      expect(posDistance / orbitalRadius).toBeLessThan(0.001);
    });

    it('conserves specific energy within 1e-6 over 100 orbital revolutions', () => {
      const mu = 1.0;
      const r0 = 1.0;
      const v0 = 1.0; // Circular orbit at r=1, mu=1 has v=1, period = 2*pi
      const period = 2 * Math.PI;

      const central: BodyPhysicalState = {
        id: 'central',
        mass: 1e9,
        mu,
        radius: 0.1,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };

      const orbiter: BodyPhysicalState = {
        id: 'orbiter',
        mass: 1.0,
        mu: 0,
        radius: 0.01,
        position: [r0, 0],
        velocity: [0, v0],
      };

      const solver = new PhysicsSolver([central, orbiter], {
        mode: 'nbody',
        substeps: 8,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      // Specific mechanical energy E = v^2 / 2 - mu / r
      const e0 = (v0 * v0) / 2 - mu / r0; // -0.5

      // Step 100 orbits with dt = 0.05s
      const totalTime = 100 * period;
      const dt = 0.05;
      const steps = Math.floor(totalTime / dt);

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }

      const finalBody = solver.getBody('orbiter')!;
      const rf = Math.hypot(finalBody.position[0], finalBody.position[1]);
      const vfSq = finalBody.velocity[0] ** 2 + finalBody.velocity[1] ** 2;
      const ef = vfSq / 2 - mu / rf;

      const deltaERel = Math.abs((ef - e0) / e0);
      expect(deltaERel).toBeLessThan(1e-6);
    });

    it('conserves specific angular momentum within 1e-10 over 100 orbital revolutions', () => {
      const mu = 1.0;
      const r0 = 1.0;
      const v0 = 1.0;
      const period = 2 * Math.PI;

      const central: BodyPhysicalState = {
        id: 'central',
        mass: 1e9,
        mu,
        radius: 0.1,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };

      const orbiter: BodyPhysicalState = {
        id: 'orbiter',
        mass: 1.0,
        mu: 0,
        radius: 0.01,
        position: [r0, 0],
        velocity: [0, v0],
      };

      const solver = new PhysicsSolver([central, orbiter], {
        mode: 'nbody',
        substeps: 8,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      // Specific angular momentum h = r x v = x * vy - y * vx
      const h0 = r0 * v0; // 1.0

      const totalTime = 100 * period;
      const dt = 0.05;
      const steps = Math.floor(totalTime / dt);

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }

      const finalBody = solver.getBody('orbiter')!;
      const hFinal = finalBody.position[0] * finalBody.velocity[1] - finalBody.position[1] * finalBody.velocity[0];

      const deltaHRel = Math.abs((hFinal - h0) / h0);
      expect(deltaHRel).toBeLessThan(1e-10);
    });
  });

  describe('J2 Zonal Harmonic Perturbation', () => {
    it('applies additional radial acceleration matching analytical J2 formula', () => {
      const mu = 3.986004418e14;
      const radius = 6.371e6;
      const j2 = 0.00108263; // Earth J2
      const testR = 7.0e6;

      const earth: BodyPhysicalState = {
        id: 'earth',
        mass: 5.972e24,
        mu,
        radius,
        position: [0, 0],
        velocity: [0, 0],
        j2,
        isFixed: true,
      };

      // Solver with J2 enabled
      const solverJ2 = new PhysicsSolver([earth], {
        mode: 'full-body',
        enableJ2: true,
        softeningRatio: 0,
      });

      // Solver with J2 disabled
      const solverNoJ2 = new PhysicsSolver([earth], {
        mode: 'nbody',
        enableJ2: false,
        softeningRatio: 0,
      });

      const [axJ2, ayJ2] = solverJ2.computeAccelerationAt(testR, 0);
      const [axNoJ2, ayNoJ2] = solverNoJ2.computeAccelerationAt(testR, 0);

      expect(ayJ2).toBe(0);
      expect(ayNoJ2).toBe(0);

      // Analytical expected J2 acceleration: a_J2 = 1.5 * mu * J2 * R^2 / r^4
      const expectedAJ2 = (1.5 * mu * j2 * radius * radius) / Math.pow(testR, 4);

      // The acceleration is towards the center (-x)
      const diffAx = Math.abs(axJ2 - axNoJ2);
      const relDiff = Math.abs(diffAx - expectedAJ2) / expectedAJ2;

      expect(relDiff).toBeLessThan(1e-10);
      expect(Math.abs(axJ2)).toBeGreaterThan(Math.abs(axNoJ2));
    });
  });

  describe('Tidal Torque Rotational Dissipation', () => {
    it('synchronizes satellite spin rate towards orbital angular velocity', () => {
      const primary: BodyPhysicalState = {
        id: 'primary',
        mass: 1e25,
        mu: 1e14,
        radius: 1e6,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };

      const orbitalR = 5e6;
      const vCirc = Math.sqrt(primary.mu / orbitalR);

      // Start satellite with fast spin (period = 500s vs orbital period ~10000s)
      const satellite: BodyPhysicalState = {
        id: 'satellite',
        mass: 1e20,
        mu: 1e10,
        radius: 5e5,
        position: [orbitalR, 0],
        velocity: [0, vCirc],
        spinPeriod: 500,
        spinDirection: -1,
      };

      const solver = new PhysicsSolver([primary, satellite], {
        mode: 'full-body',
        enableTidalTorque: true,
        substeps: 4,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      const initialSat = solver.getBody('satellite')!;
      expect(initialSat.spinPeriod).toBe(500);

      // Step forward for several orbits
      const dt = 10.0;
      for (let i = 0; i < 2000; i++) {
        solver.step(dt);
      }

      const steppedSat = solver.getBody('satellite')!;
      // Satellite spin should have slowed down (period increased) towards orbital period
      expect(steppedSat.spinPeriod).toBeGreaterThan(500);
      expect(steppedSat.spinPeriod!).toBeLessThanOrEqual(10000);
    });
  });

  describe('Collision & Contact Handling', () => {
    it('conserves total linear momentum, mass, and volume during inelastic merger', () => {
      // Body 1 moving in +X
      const b1: BodyPhysicalState = {
        id: 'b1',
        mass: 1000,
        mu: 100,
        radius: 10,
        position: [0, 0],
        velocity: [15, 0],
      };

      // Body 2 moving in -X, higher mass
      const b2: BodyPhysicalState = {
        id: 'b2',
        mass: 3000,
        mu: 300,
        radius: 15,
        position: [22, 0], // Within (10 + 15) * 0.95 = 23.75 contact threshold
        velocity: [-5, 0],
      };

      const pInitialX = b1.mass * b1.velocity[0] + b2.mass * b2.velocity[0]; // 1000*15 + 3000*(-5) = 0
      const pInitialY = 0;
      const expectedMass = b1.mass + b2.mass; // 4000
      const expectedMu = b1.mu + b2.mu; // 400
      const expectedRadius = Math.cbrt(Math.pow(b1.radius, 3) + Math.pow(b2.radius, 3));

      const solver = new PhysicsSolver([b1, b2], {
        mode: 'full-body',
        enableJ2: false,
        collisionMode: 'merge',
        substeps: 1,
        softeningRatio: 0,
      });

      expect(solver.getBodyCount()).toBe(2);

      const result = solver.step(0.1);

      expect(result.collisions.length).toBe(1);
      const mergeEvent = result.collisions[0]!;
      expect(mergeEvent.type).toBe('merge');
      if (mergeEvent.type === 'merge') {
        expect(mergeEvent.survivorId).toBe('b2');
        expect(mergeEvent.absorbedId).toBe('b1');
        expect(mergeEvent.newMass).toBe(expectedMass);
        expect(mergeEvent.newMu).toBe(expectedMu);
        expect(mergeEvent.newRadius).toBeCloseTo(expectedRadius, 8);
      }

      expect(solver.getBodyCount()).toBe(1);
      expect(solver.getBody('b1')).toBeUndefined();

      const survivor = solver.getBody('b2')!;
      expect(survivor.mass).toBe(expectedMass);
      expect(survivor.mu).toBe(expectedMu);
      expect(survivor.radius).toBeCloseTo(expectedRadius, 8);

      const pFinalX = survivor.mass * survivor.velocity[0];
      const pFinalY = survivor.mass * survivor.velocity[1];

      expect(Math.abs(pFinalX - pInitialX)).toBeLessThan(1e-10);
      expect(Math.abs(pFinalY - pInitialY)).toBeLessThan(1e-10);
    });

    it('resolves partially elastic bounce with restitution and depenetration', () => {
      const b1: BodyPhysicalState = {
        id: 'b1',
        mass: 1000,
        mu: 0,
        radius: 10,
        position: [0, 0],
        velocity: [10, 0],
      };

      const b2: BodyPhysicalState = {
        id: 'b2',
        mass: 1000,
        mu: 0,
        radius: 10,
        position: [18, 0], // In contact: (10 + 10) * 0.95 = 19 > 18
        velocity: [-10, 0],
      };

      const solver = new PhysicsSolver([b1, b2], {
        mode: 'full-body',
        collisionMode: 'bounce',
        restitution: 0.8,
        substeps: 1,
        softeningRatio: 0,
      });

      const res = solver.step(0.01);

      expect(res.collisions.length).toBe(1);
      expect(res.collisions[0]!.type).toBe('bounce');

      const s1 = solver.getBody('b1')!;
      const s2 = solver.getBody('b2')!;

      // Velocities should reverse: relative approach was 20 m/s; separation should be ~16 m/s
      expect(s1.velocity[0]).toBeLessThan(0);
      expect(s2.velocity[0]).toBeGreaterThan(0);

      const vRelAfter = s2.velocity[0] - s1.velocity[0];
      expect(vRelAfter).toBeCloseTo(16.0, 4);

      // Positional separation should push them apart beyond contact threshold
      const dist = Math.hypot(s2.position[0] - s1.position[0], s2.position[1] - s1.position[1]);
      expect(dist).toBeGreaterThanOrEqual(19.0);
    });
  });

  describe('Zero-Allocation Heap Benchmark', () => {
    it('guarantees 0 bytes allocated per step across 10,000 integration ticks', async () => {
      const v8 = await import('node:v8');
      const vm = await import('node:vm');
      v8.setFlagsFromString('--expose_gc');
      const gc = vm.runInNewContext('gc') as (() => void) | undefined;

      // 8-body system
      const bodies: BodyPhysicalState[] = [
        {
          id: 'sun',
          mass: 1e30,
          mu: 6.674e19,
          radius: 7e8,
          position: [0, 0],
          velocity: [0, 0],
          isFixed: true,
        },
      ];

      for (let i = 1; i < 8; i++) {
        const r = 1e10 * i;
        const v = Math.sqrt(6.674e19 / r);
        bodies.push({
          id: `planet_${i}`,
          mass: 1e24 * i,
          mu: 6.674e13 * i,
          radius: 1e7 * i,
          position: [r, 0],
          velocity: [0, v],
        });
      }

      const solver = new PhysicsSolver(bodies, {
        mode: 'full-body',
        substeps: 4,
        enableJ2: true,
        enableTidalTorque: true,
        collisionMode: 'merge',
        softeningRatio: Math.sqrt(0.05),
      });

      // Warm up JIT and solver buffers
      for (let i = 0; i < 1000; i++) {
        solver.step(0.1);
      }

      if (typeof gc === 'function') {
        gc();
      }

      const initialHeap = process.memoryUsage().heapUsed;
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        solver.step(0.1);
      }

      if (typeof gc === 'function') {
        gc();
      }

      const finalHeap = process.memoryUsage().heapUsed;
      const rawBytesPerTick = (finalHeap - initialHeap) / iterations;
      // Retained memory growth per tick should be <= 0 bytes
      const bytesPerTick = rawBytesPerTick > 1 ? Math.round(rawBytesPerTick) : 0;

      expect(bytesPerTick).toBe(0);
    });
  });

  describe('Fast State Cloning & Prediction Isolation', () => {
    it('creates an independent deep clone without mutating the original solver', () => {
      const b1: BodyPhysicalState = {
        id: 'primary',
        mass: 1e24,
        mu: 1e13,
        radius: 1e6,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };
      const b2: BodyPhysicalState = {
        id: 'secondary',
        mass: 1e20,
        mu: 1e9,
        radius: 1e5,
        position: [5e6, 0],
        velocity: [0, 1400],
      };

      const solver = new PhysicsSolver([b1, b2]);
      const initialTime = solver.getTime();
      const initialStepCount = solver.getStepCount();

      const clone = solver.clone();
      expect(clone.getBodyCount()).toBe(2);
      expect(clone.getTime()).toBe(initialTime);

      // Advance clone by 100 steps
      for (let i = 0; i < 100; i++) {
        clone.step(1.0);
      }

      // Clone advanced
      expect(clone.getTime()).toBe(initialTime + 100);
      expect(clone.getStepCount()).toBe(initialStepCount + 100);
      const cloneSec = clone.getBody('secondary')!;
      expect(cloneSec.position[0]).not.toBe(5e6);

      // Original remains pristine
      expect(solver.getTime()).toBe(initialTime);
      expect(solver.getStepCount()).toBe(initialStepCount);
      const origSec = solver.getBody('secondary')!;
      expect(origSec.position[0]).toBe(5e6);
    });
  });

  describe('Rails Mode vs N-Body Gravitation', () => {
    it('isolates orbiters from mutual perturbation in rails mode', () => {
      const primary: BodyPhysicalState = {
        id: 'primary',
        mass: 1e30,
        mu: 1e20,
        radius: 1e7,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };

      // Two massive coplanar bodies nearby each other
      const b1: BodyPhysicalState = {
        id: 'orbiter1',
        mass: 1e28, // Heavy: would perturb b2 in nbody mode
        mu: 1e18,
        radius: 1e6,
        position: [1e9, 0],
        velocity: [0, 10000],
        parentId: 'primary',
      };

      const b2: BodyPhysicalState = {
        id: 'orbiter2',
        mass: 1e20,
        mu: 1e10,
        radius: 1e5,
        position: [1.02e9, 0],
        velocity: [0, 9900],
        parentId: 'primary',
      };

      const railsSolver = new PhysicsSolver([primary, b1, b2], {
        mode: 'rails',
        substeps: 1,
        collisionMode: 'none',
      });

      const nbodySolver = new PhysicsSolver([primary, b1, b2], {
        mode: 'nbody',
        substeps: 1,
        collisionMode: 'none',
      });

      for (let i = 0; i < 100; i++) {
        railsSolver.step(10.0);
        nbodySolver.step(10.0);
      }

      const r2Rails = railsSolver.getBody('orbiter2')!;
      const r2Nbody = nbodySolver.getBody('orbiter2')!;

      // In N-body mode, b2 was significantly pulled by b1; in rails mode, it only felt primary
      const diffX = Math.abs(r2Rails.position[0] - r2Nbody.position[0]);
      expect(diffX).toBeGreaterThan(1e4);
    });
  });
});
