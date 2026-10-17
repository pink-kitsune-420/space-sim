import type { Vec, BodyAppearance } from './spacelab/sim-core';

export interface MutableVec {
  x: number;
  y: number;
}

export interface RingParticle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  opacity: number;
}

export interface RingBelt {
  innerRadius: number;
  outerRadius: number;
  color: string;
  particleCount: number;
  particles?: RingParticle[];
}

export interface CelestialBody {
  id: string;
  name: string;
  parentId: string | null;
  position: MutableVec;
  velocity: MutableVec;
  radius: number;
  mass: number;
  mu: number;
  color: string;
  accentColor: string;
  atmosphereColor: string;
  surfaceFeatures: 'globe-lines' | 'craters' | 'smooth' | 'star';
  appearance: BodyAppearance & { colors: readonly [string, string, string, string] };
  rotation: {
    period: number;
    direction: 1 | -1;
    phaseRadiansAtEpoch?: number;
  };
  isFixed?: boolean;
  rings?: RingBelt;
  trail: MutableVec[];
  showOrbitLine?: boolean;
  orbitCache?: OrbitElementsCache;
}

export interface OrbitElementsCache {
  parentBodyId: string;
  epochTime: number;
  semiMajorAxis: number | null;
  eccentricity: number;
  periapsisRadius: number;
  apoapsisRadius: number | null;
  orbitalPeriod: number | null;
  isBound: boolean;
  relativeOrbitPoints: MutableVec[];
  periapsisOffset: MutableVec;
  apoapsisOffset: MutableVec | null;
}

export type SimulationMode = 'nbody' | 'kepler' | 'full-body';

export interface FullBodyOptions {
  enableJ2Oblateness: boolean;
  enableTidalTorque: boolean;
  collisionMode: 'merge' | 'bounce';
  restitution: number; // 0.0 (inelastic) to 1.0 (elastic)
}

export interface OrbitGhostSample {
  position: Vec;
  velocity: Vec;
  time: number;
  isApoapsis?: boolean;
  isPeriapsis?: boolean;
  collided?: boolean;
  escaped?: boolean;
}

export interface SlingshotCandidate {
  origin: Vec;
  currentDrag: Vec;
  velocity: Vec;
  presetId: string;
  isSnappingCircular: boolean;
  parentBody: CelestialBody | null;
  ghostPath: OrbitGhostSample[];
  circularSpeed: number;
  currentSpeed: number;
  apoapsisRadius: number | null;
  periapsisRadius: number | null;
  orbitalPeriod: number | null;
}

export interface PlanetPresetTemplate {
  id: string;
  name: string;
  category: 'rocky' | 'oceanic' | 'gas' | 'icy' | 'volcanic' | 'star';
  radius: number;
  mu: number;
  color: string;
  accentColor: string;
  atmosphereColor: string;
  surfaceFeatures: 'globe-lines' | 'craters' | 'smooth' | 'star';
  appearance: BodyAppearance & { colors: readonly [string, string, string, string] };
  rotation: { period: number; direction: 1 | -1 };
  hasRings?: boolean;
  isFixed?: boolean;
}
