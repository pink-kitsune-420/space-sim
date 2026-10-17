import { instantiateBody, createRingBelt } from './presets';
import type { CelestialBody, FullBodyOptions } from './types';

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  camera: { center: { x: number; y: number }; scale: number };
  mode: 'nbody' | 'kepler' | 'full-body';
  fullBodyOptions?: Partial<FullBodyOptions>;
  build: () => CelestialBody[];
}

export const TEST_SCENARIOS: readonly TestScenario[] = [
  {
    id: 'figure-eight',
    name: 'Figure-8 3-Body Choreography',
    description: 'Moore (1993) three equal masses chasing each other along a periodic figure-eight curve.',
    camera: { center: { x: 0, y: 0 }, scale: 0.025 },
    mode: 'nbody',
    build: () => {
      // Dimensionless Moore figure-8 initial conditions scaled to sandbox units
      const scalePos = 5000;
      const scaleVel = 35;
      const x1 = 0.97000436 * scalePos;
      const y1 = -0.24308753 * scalePos;
      const vx1 = (0.46620531) * scaleVel;
      const vy1 = (0.43236573) * scaleVel;

      const mu = 50000000;
      const r = 180;

      const b1 = instantiateBody('oceanic', { x: x1, y: y1 }, { x: vx1, y: vy1 }, {
        id: 'moore-1',
        name: 'Body Alpha',
        radius: r,
        mu,
      });

      const b2 = instantiateBody('volcanic', { x: -x1, y: -y1 }, { x: vx1, y: vy1 }, {
        id: 'moore-2',
        name: 'Body Beta',
        radius: r,
        mu,
      });

      const b3 = instantiateBody('icy', { x: 0, y: 0 }, { x: -2 * vx1, y: -2 * vy1 }, {
        id: 'moore-3',
        name: 'Body Gamma',
        radius: r,
        mu,
      });

      return [b1, b2, b3];
    },
  },
  {
    id: 'j2-precession',
    name: 'J2 Quadrupole Apsidal Precession',
    description: 'Fast-spinning oblate giant planet causing continuous precession of an eccentric satellite orbit.',
    camera: { center: { x: 0, y: 0 }, scale: 0.012 },
    mode: 'full-body',
    fullBodyOptions: { enableJ2Oblateness: true },
    build: () => {
      const giant = instantiateBody('gas-giant', { x: 0, y: 0 }, { x: 0, y: 0 }, {
        id: 'oblate-giant',
        name: 'Oblate Giant (Fast Spin)',
        radius: 2200,
        mu: 300000000,
        rotation: { period: 45, direction: -1 }, // Extreme spin
        isFixed: true,
      });

      // Eccentric orbit starting at periapsis
      const rPeri = 4500;
      const vPeri = Math.sqrt(giant.mu / rPeri) * 1.25; // 25% faster than circular -> eccentric
      const satellite = instantiateBody('rocky', { x: rPeri, y: 0 }, { x: 0, y: vPeri }, {
        id: 'probe',
        name: 'Precessing Probe',
        radius: 120,
        mu: 50000,
      });

      return [giant, satellite];
    },
  },
  {
    id: 'tidal-locking',
    name: 'Tidal Torque Spin Synchronization',
    description: 'Moon in close orbit spinning rapidly, dissipating energy until spin period matches orbital period.',
    camera: { center: { x: 0, y: 0 }, scale: 0.015 },
    mode: 'full-body',
    fullBodyOptions: { enableTidalTorque: true },
    build: () => {
      const primary = instantiateBody('oceanic', { x: 0, y: 0 }, { x: 0, y: 0 }, {
        id: 'primary',
        name: 'Primary Planet',
        radius: 1200,
        mu: 80000000,
        isFixed: true,
      });

      const dist = 5000;
      const vCirc = Math.sqrt(primary.mu / dist);
      // Fast initial spin (period = 30s)
      const moon = instantiateBody('rocky', { x: dist, y: 0 }, { x: 0, y: vCirc }, {
        id: 'locking-moon',
        name: 'Tidal Locking Moon',
        radius: 250,
        mu: 500000,
        rotation: { period: 30, direction: -1 },
      });

      return [primary, moon];
    },
  },
  {
    id: 'elastic-bounce',
    name: 'Kinetic Collision Restitution Benchmark',
    description: 'Head-on collision of two planets with restitution coefficient e = 0.85.',
    camera: { center: { x: 0, y: 0 }, scale: 0.05 },
    mode: 'full-body',
    fullBodyOptions: { collisionMode: 'bounce', restitution: 0.85 },
    build: () => {
      const p1 = instantiateBody('oceanic', { x: -1200, y: 0 }, { x: 25, y: 0 }, {
        id: 'collider-1',
        name: 'Collider Alpha',
        radius: 200,
        mu: 5000000,
      });

      const p2 = instantiateBody('volcanic', { x: 1200, y: 0 }, { x: -25, y: 0 }, {
        id: 'collider-2',
        name: 'Collider Beta',
        radius: 200,
        mu: 5000000,
      });

      return [p1, p2];
    },
  },
  {
    id: 'dense-rings',
    name: 'Dense Ring Belt Stress Test (500 Particles)',
    description: 'Gas giant with 500 discrete Keplerian orbiting ring particles testing framerate stability.',
    camera: { center: { x: 0, y: 0 }, scale: 0.009 },
    mode: 'nbody',
    build: () => {
      const giant = instantiateBody('gas-giant', { x: 0, y: 0 }, { x: 0, y: 0 }, {
        id: 'saturn-analog',
        name: 'Ringed Titan (500 Particles)',
        radius: 2500,
        mu: 450000000,
        rings: createRingBelt(3600, 7500, 450000000, 'rgba(216, 185, 142, 0.55)', 500),
        isFixed: true,
      });

      return [giant];
    },
  },
];
