import type { CollisionMode, PhysicsMode } from '../../../game-api/src/index';

/** Authoritative physical state of a celestial body within the numerical physics solver. */
export interface BodyPhysicalState {
  readonly id: string;
  readonly mass: number; // kg
  readonly mu: number; // m^3 / s^2
  readonly radius: number; // m
  readonly position: readonly [number, number]; // [x, y] in m
  readonly velocity: readonly [number, number]; // [vx, vy] in m/s
  readonly spinPeriod?: number; // s
  readonly spinDirection?: number; // -1 (CW) or 1 (CCW)
  readonly j2?: number; // dimensionless J2 oblateness coefficient
  readonly isFixed?: boolean;
  readonly parentId?: string;
}

/** Operational configuration options for numerical physics integration. */
export interface PhysicsSolverConfig {
  readonly mode: PhysicsMode;
  readonly substeps: number;
  readonly softeningRatio: number;
  readonly enableJ2: boolean;
  readonly enableTidalTorque: boolean;
  readonly collisionMode: CollisionMode;
  readonly restitution: number;
}

/** Inelastic mass-merging collision event where the higher-mass body absorbs the smaller. */
export interface CollisionMergeEvent {
  readonly type: 'merge';
  readonly survivorId: string;
  readonly absorbedId: string;
  readonly newMass: number;
  readonly newRadius: number;
  readonly newMu: number;
}

/** Partially elastic impulse collision event. */
export interface CollisionBounceEvent {
  readonly type: 'bounce';
  readonly bodyAId: string;
  readonly bodyBId: string;
  readonly impulse: number;
}

/** Discriminated union of collision events. */
export type CollisionEvent = CollisionMergeEvent | CollisionBounceEvent;

/** Output summary of a completed simulation step. */
export interface PhysicsStepResult {
  readonly time: number;
  readonly stepCount: number;
  readonly collisions: readonly CollisionEvent[];
}

/** Canonical defaults for physics solver execution. */
export const DEFAULT_SOLVER_CONFIG: PhysicsSolverConfig = Object.freeze({
  mode: 'nbody',
  substeps: 4,
  softeningRatio: Math.sqrt(0.05),
  enableJ2: true,
  enableTidalTorque: true,
  collisionMode: 'merge',
  restitution: 0.5,
});

/** Empty collision event array reused across steps to preserve zero-allocation invariants. */
export const EMPTY_COLLISIONS: readonly CollisionEvent[] = Object.freeze([]);
