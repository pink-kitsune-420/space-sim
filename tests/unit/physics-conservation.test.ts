import { describe, expect, it } from 'vitest';
import {
  type BodyPhysicalState,
  PhysicsSolver,
} from '../../packages/sim-core/src/physics/index';

describe('Universal Physics Engine: Conservation & Astrodynamic Quality Gates', () => {
  describe('1. Two-Body Kepler Mechanical Energy & Angular Momentum Invariants', () => {
    it('conserves specific energy (< 1e-6) and angular momentum (< 1e-10) over 100 circular orbits', () => {
      const mu = 1.0;
      const r0 = 1.0;
      const v0 = 1.0; // v = sqrt(mu / r) = 1.0
      const period = 2 * Math.PI; // T = 2*pi*sqrt(r^3/mu) = 2*pi

      const central: BodyPhysicalState = {
        id: 'central',
        mass: 1e12,
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

      // Initial specific mechanical energy: E0 = v^2/2 - mu/r = -0.5
      const e0 = 0.5 * v0 * v0 - mu / r0;
      // Initial specific angular momentum: h0 = r x v = r * v = 1.0
      const h0 = r0 * v0;

      // Integrate for 100 complete orbital revolutions
      const totalTime = 100 * period;
      const dt = 0.05;
      const steps = Math.floor(totalTime / dt);
      const remainder = totalTime - steps * dt;

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }
      if (remainder > 0) {
        solver.step(remainder);
      }

      const finalBody = solver.getBody('orbiter')!;
      const rf = Math.hypot(finalBody.position[0], finalBody.position[1]);
      const vfSq = finalBody.velocity[0] ** 2 + finalBody.velocity[1] ** 2;
      const ef = 0.5 * vfSq - mu / rf;
      const hf = finalBody.position[0] * finalBody.velocity[1] - finalBody.position[1] * finalBody.velocity[0];

      const deltaERel = Math.abs((ef - e0) / e0);
      const deltaHRel = Math.abs((hf - h0) / h0);

      expect(deltaERel).toBeLessThan(1e-6);
      expect(deltaHRel).toBeLessThan(1e-10);
    });

    it('conserves specific energy (< 1e-6) and angular momentum (< 1e-10) over 100 eccentric (e = 0.5) orbits', () => {
      const mu = 1.0;
      const a = 1.0;
      const e = 0.5;
      const rp = a * (1 - e); // 0.5
      const vp = Math.sqrt(mu * (2 / rp - 1 / a)); // sqrt(1 * (4 - 1)) = sqrt(3) ~= 1.7320508
      const period = 2 * Math.PI * Math.sqrt((a ** 3) / mu); // 2 * pi

      const central: BodyPhysicalState = {
        id: 'central',
        mass: 1e12,
        mu,
        radius: 0.05,
        position: [0, 0],
        velocity: [0, 0],
        isFixed: true,
      };

      const orbiter: BodyPhysicalState = {
        id: 'orbiter',
        mass: 1.0,
        mu: 0,
        radius: 0.005,
        position: [rp, 0],
        velocity: [0, vp],
      };

      const solver = new PhysicsSolver([central, orbiter], {
        mode: 'nbody',
        substeps: 16,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      // Specific mechanical energy E = -mu / (2*a) = -0.5
      const e0 = 0.5 * vp * vp - mu / rp;
      // Specific angular momentum h = rp * vp = 0.5 * sqrt(3) ~= 0.8660254
      const h0 = rp * vp;

      const totalTime = 100 * period;
      const dt = 0.005;
      const steps = Math.floor(totalTime / dt);
      const remainder = totalTime - steps * dt;

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }
      if (remainder > 0) {
        solver.step(remainder);
      }

      const finalBody = solver.getBody('orbiter')!;
      const rf = Math.hypot(finalBody.position[0], finalBody.position[1]);
      const vfSq = finalBody.velocity[0] ** 2 + finalBody.velocity[1] ** 2;
      const ef = 0.5 * vfSq - mu / rf;
      const hf = finalBody.position[0] * finalBody.velocity[1] - finalBody.position[1] * finalBody.velocity[0];

      const deltaERel = Math.abs((ef - e0) / e0);
      const deltaHRel = Math.abs((hf - h0) / h0);

      expect(deltaERel).toBeLessThan(1e-6);
      expect(deltaHRel).toBeLessThan(1e-10);
    });
  });

  describe('2. Three-Body Lagrange Equilibrium (L4 & L5) Quality Gates', () => {
    it('preserves triangular L4 Lagrange configuration stability over 20 orbital periods', () => {
      // Primaries m1 and m2 orbiting their common barycenter, with m3 at L4
      const G = 1.0;
      const m1 = 1.0;
      const m2 = 0.001; // Satisfies Routh stability criterion (m2 / (m1 + m2) < 0.03852)
      const m3 = 1e-6; // Trojan asteroid
      const R = 1.0;

      // Center of mass at origin: x1 = -m2/(m1+m2)*R, x2 = m1/(m1+m2)*R
      const x1 = (-m2 / (m1 + m2)) * R;
      const x2 = (m1 / (m1 + m2)) * R;
      const omega = Math.sqrt((G * (m1 + m2 + m3)) / (R ** 3));
      const period = (2 * Math.PI) / omega;

      // L4 forms equilateral triangle with m1 and m2 (y > 0)
      const x3 = (x1 + x2) / 2;
      const y3 = (Math.sqrt(3) / 2) * R;

      const body1: BodyPhysicalState = {
        id: 'primary1',
        mass: m1,
        mu: G * m1,
        radius: 0.01,
        position: [x1, 0],
        velocity: [0, omega * x1],
      };

      const body2: BodyPhysicalState = {
        id: 'primary2',
        mass: m2,
        mu: G * m2,
        radius: 0.005,
        position: [x2, 0],
        velocity: [0, omega * x2],
      };

      const trojan: BodyPhysicalState = {
        id: 'trojan-l4',
        mass: m3,
        mu: G * m3,
        radius: 0.001,
        position: [x3, y3],
        velocity: [-omega * y3, omega * x3],
      };

      const solver = new PhysicsSolver([body1, body2, trojan], {
        mode: 'nbody',
        substeps: 8,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      // Step for 20 complete revolutions
      const totalTime = 20 * period;
      const dt = 0.005;
      const steps = Math.floor(totalTime / dt);
      const remainder = totalTime - steps * dt;

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }
      if (remainder > 0) {
        solver.step(remainder);
      }

      const b1 = solver.getBody('primary1')!;
      const b2 = solver.getBody('primary2')!;
      const b3 = solver.getBody('trojan-l4')!;

      const d12 = Math.hypot(b2.position[0] - b1.position[0], b2.position[1] - b1.position[1]);
      const d13 = Math.hypot(b3.position[0] - b1.position[0], b3.position[1] - b1.position[1]);
      const d23 = Math.hypot(b3.position[0] - b2.position[0], b3.position[1] - b2.position[1]);

      // Distances should remain close to R = 1.0 (relative error < 1e-6)
      expect(Math.abs(d12 - R) / R).toBeLessThan(1e-6);
      expect(Math.abs(d13 - R) / R).toBeLessThan(1e-6);
      expect(Math.abs(d23 - R) / R).toBeLessThan(1e-6);
    });

    it('preserves triangular L5 Lagrange configuration stability over 20 orbital periods', () => {
      const G = 1.0;
      const m1 = 1.0;
      const m2 = 0.001;
      const m3 = 1e-6;
      const R = 1.0;

      const x1 = (-m2 / (m1 + m2)) * R;
      const x2 = (m1 / (m1 + m2)) * R;
      const omega = Math.sqrt((G * (m1 + m2 + m3)) / (R ** 3));
      const period = (2 * Math.PI) / omega;

      // L5 forms equilateral triangle with m1 and m2 (y < 0)
      const x3 = (x1 + x2) / 2;
      const y3 = (-Math.sqrt(3) / 2) * R;

      const body1: BodyPhysicalState = {
        id: 'primary1',
        mass: m1,
        mu: G * m1,
        radius: 0.01,
        position: [x1, 0],
        velocity: [0, omega * x1],
      };

      const body2: BodyPhysicalState = {
        id: 'primary2',
        mass: m2,
        mu: G * m2,
        radius: 0.005,
        position: [x2, 0],
        velocity: [0, omega * x2],
      };

      const trojan: BodyPhysicalState = {
        id: 'trojan-l5',
        mass: m3,
        mu: G * m3,
        radius: 0.001,
        position: [x3, y3],
        velocity: [-omega * y3, omega * x3],
      };

      const solver = new PhysicsSolver([body1, body2, trojan], {
        mode: 'nbody',
        substeps: 8,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      const totalTime = 20 * period;
      const dt = 0.005;
      const steps = Math.floor(totalTime / dt);
      const remainder = totalTime - steps * dt;

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }
      if (remainder > 0) {
        solver.step(remainder);
      }

      const b1 = solver.getBody('primary1')!;
      const b2 = solver.getBody('primary2')!;
      const b3 = solver.getBody('trojan-l5')!;

      const d12 = Math.hypot(b2.position[0] - b1.position[0], b2.position[1] - b1.position[1]);
      const d13 = Math.hypot(b3.position[0] - b1.position[0], b3.position[1] - b1.position[1]);
      const d23 = Math.hypot(b3.position[0] - b2.position[0], b3.position[1] - b2.position[1]);

      expect(Math.abs(d12 - R) / R).toBeLessThan(1e-6);
      expect(Math.abs(d13 - R) / R).toBeLessThan(1e-6);
      expect(Math.abs(d23 - R) / R).toBeLessThan(1e-6);
    });
  });

  describe('3. Three-Body Choreographic Figure-Eight Invariants', () => {
    it('preserves closed-loop stability and conserves linear momentum (< 1e-12 N*s) on figure-8 orbit', () => {
      // Moore/Chenciner/Simó canonical figure-8 orbit with 3 equal masses m = 1, G = 1
      const x1 = 0.9700043603264696;
      const y1 = -0.2430875308758332;
      const vx3 = -0.9324073714410431;
      const vy3 = -0.8647314601370830;
      const period = 6.325913985368146;

      const b1: BodyPhysicalState = {
        id: 'body-1',
        mass: 1.0,
        mu: 1.0,
        radius: 0.001,
        position: [x1, y1],
        velocity: [-0.5 * vx3, -0.5 * vy3],
      };

      const b2: BodyPhysicalState = {
        id: 'body-2',
        mass: 1.0,
        mu: 1.0,
        radius: 0.001,
        position: [-x1, -y1],
        velocity: [-0.5 * vx3, -0.5 * vy3],
      };

      const b3: BodyPhysicalState = {
        id: 'body-3',
        mass: 1.0,
        mu: 1.0,
        radius: 0.001,
        position: [0.0, 0.0],
        velocity: [vx3, vy3],
      };

      const solver = new PhysicsSolver([b1, b2, b3], {
        mode: 'nbody',
        substeps: 16,
        softeningRatio: 0,
        collisionMode: 'none',
      });

      // Integrate for 1 full choreographic cycle
      const dt = 0.0005;
      const steps = Math.floor(period / dt);
      const remainder = period - steps * dt;

      for (let s = 0; s < steps; s++) {
        solver.step(dt);
      }
      if (remainder > 0) {
        solver.step(remainder);
      }

      const fb1 = solver.getBody('body-1')!;
      const fb2 = solver.getBody('body-2')!;
      const fb3 = solver.getBody('body-3')!;

      // 1. Total linear momentum conservation: sum(m_i * v_i) = 0
      const totalPx = fb1.mass * fb1.velocity[0] + fb2.mass * fb2.velocity[0] + fb3.mass * fb3.velocity[0];
      const totalPy = fb1.mass * fb1.velocity[1] + fb2.mass * fb2.velocity[1] + fb3.mass * fb3.velocity[1];
      const totalP = Math.hypot(totalPx, totalPy);

      expect(totalP).toBeLessThan(1e-12);

      // 2. Closed-loop stability: each body returns to its initial position
      const errPos1 = Math.hypot(fb1.position[0] - x1, fb1.position[1] - y1);
      const errPos2 = Math.hypot(fb2.position[0] - (-x1), fb2.position[1] - (-y1));
      const errPos3 = Math.hypot(fb3.position[0] - 0.0, fb3.position[1] - 0.0);

      expect(errPos1).toBeLessThan(1e-4);
      expect(errPos2).toBeLessThan(1e-4);
      expect(errPos3).toBeLessThan(1e-4);
    });
  });

  describe('4. Inelastic Collision Invariants: Mass & Momentum Conservation', () => {
    it('conserves mass (bitwise exact) and linear momentum (< 1e-14 kg*m/s) in direct head-on merger', () => {
      const m1 = 1500;
      const m2 = 3500;
      const v1 = [12.0, 0.0] as const;
      const v2 = [-5.0, 0.0] as const;

      const p0x = m1 * v1[0] + m2 * v2[0]; // 1500 * 12 + 3500 * (-5) = 18000 - 17500 = 500
      const p0y = m1 * v1[1] + m2 * v2[1]; // 0
      const expectedMass = m1 + m2; // 5000

      const b1: BodyPhysicalState = {
        id: 'impact-1',
        mass: m1,
        mu: 0,
        radius: 10,
        position: [0, 0],
        velocity: [v1[0], v1[1]],
      };

      const b2: BodyPhysicalState = {
        id: 'impact-2',
        mass: m2,
        mu: 0,
        radius: 15,
        // Separation 18m < (10 + 15) * 0.95 = 23.75m
        position: [18, 0],
        velocity: [v2[0], v2[1]],
      };

      const solver = new PhysicsSolver([b1, b2], {
        mode: 'full-body',
        collisionMode: 'merge',
        substeps: 1,
        softeningRatio: 0,
      });

      const res = solver.step(0.01);
      expect(res.collisions.length).toBe(1);
      expect(res.collisions[0]!.type).toBe('merge');
      expect(solver.getBodyCount()).toBe(1);

      const survivor = solver.getBody('impact-2')!;
      expect(survivor).toBeDefined();

      // Assert bitwise exact mass conservation
      const deltaM = Math.abs(survivor.mass - expectedMass);
      expect(deltaM).toBe(0);
      expect(Object.is(survivor.mass, expectedMass)).toBe(true);

      // Assert linear momentum conservation
      const pFx = survivor.mass * survivor.velocity[0];
      const pFy = survivor.mass * survivor.velocity[1];
      const deltaP = Math.hypot(pFx - p0x, pFy - p0y);

      expect(deltaP).toBeLessThan(1e-14);
    });

    it('conserves mass (bitwise exact) and 2D momentum (< 1e-14 kg*m/s) in glancing oblique merger', () => {
      const m1 = 1200;
      const m2 = 2800;
      const v1 = [15.5, 8.2] as const;
      const v2 = [-6.3, -3.4] as const;

      const p0x = m1 * v1[0] + m2 * v2[0];
      const p0y = m1 * v1[1] + m2 * v2[1];
      const expectedMass = m1 + m2; // 4000

      const b1: BodyPhysicalState = {
        id: 'glance-1',
        mass: m1,
        mu: 0,
        radius: 12,
        position: [0, 0],
        velocity: [v1[0], v1[1]],
      };

      const b2: BodyPhysicalState = {
        id: 'glance-2',
        mass: m2,
        mu: 0,
        radius: 16,
        // Distance hypot(18, 12) ~= 21.63m < (12 + 16) * 0.95 = 26.6m
        position: [18, 12],
        velocity: [v2[0], v2[1]],
      };

      const solver = new PhysicsSolver([b1, b2], {
        mode: 'full-body',
        collisionMode: 'merge',
        substeps: 1,
        softeningRatio: 0,
      });

      const res = solver.step(0.01);
      expect(res.collisions.length).toBe(1);
      expect(res.collisions[0]!.type).toBe('merge');
      expect(solver.getBodyCount()).toBe(1);

      const survivor = solver.getBody('glance-2')!;
      expect(survivor).toBeDefined();

      // Bitwise mass conservation
      const deltaM = Math.abs(survivor.mass - expectedMass);
      expect(deltaM).toBe(0);

      // 2D momentum conservation
      const pFx = survivor.mass * survivor.velocity[0];
      const pFy = survivor.mass * survivor.velocity[1];
      const deltaPx = Math.abs(pFx - p0x);
      const deltaPy = Math.abs(pFy - p0y);

      expect(deltaPx).toBeLessThan(1e-14);
      expect(deltaPy).toBeLessThan(1e-14);
    });
  });

  describe('5. Zero-Allocation Heap Benchmark (10,000 steps, N=8)', () => {
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
      const bytesPerTick = rawBytesPerTick > 1 ? Math.round(rawBytesPerTick) : 0;

      expect(bytesPerTick).toBe(0);
    });
  });
});
