import { computeGravitationalAccelerationAt } from './forces';
import { stepVelocityVerlet } from './integrator';
import {
  type BodyPhysicalState,
  type CollisionEvent,
  DEFAULT_SOLVER_CONFIG,
  EMPTY_COLLISIONS,
  type PhysicsSolverConfig,
  type PhysicsStepResult,
} from './types';

interface MutablePhysicsStepResult {
  time: number;
  stepCount: number;
  collisions: readonly CollisionEvent[];
}

/**
 * High-performance, zero-allocation headless numerical astrodynamics solver.
 *
 * Implements symplectic velocity-Verlet numerical integration with N-body gravitation,
 * optional J2 oblateness, tidal torque dissipation, and contact collision resolution
 * (inelastic merging or restitution bouncing).
 */
export class PhysicsSolver {
  private count = 0;
  private capacity: number;
  private config: PhysicsSolverConfig;

  private positions: Float64Array;
  private velocities: Float64Array;
  private accel1: Float64Array;
  private accel2: Float64Array;
  private masses: Float64Array;
  private mus: Float64Array;
  private radii: Float64Array;
  private spinPeriods: Float64Array;
  private spinDirections: Float64Array;
  private j2Coeffs: Float64Array;
  private isFixed: Uint8Array;
  private removedFlags: Uint8Array;
  private parentIndices: Int32Array;

  private bodyIds: string[] = [];
  private parentIds: (string | undefined)[] = [];
  private idToIndex: Map<string, number> = new Map();

  private currentTime = 0;
  private currentStepCount = 0;

  private readonly cachedStepResult: MutablePhysicsStepResult = {
    time: 0,
    stepCount: 0,
    collisions: EMPTY_COLLISIONS,
  };
  private readonly scratchCollisions: CollisionEvent[] = [];

  constructor(
    bodies?: readonly BodyPhysicalState[],
    config?: Partial<PhysicsSolverConfig>,
    initialCapacity = 64,
  ) {
    this.config = {
      mode: config?.mode ?? DEFAULT_SOLVER_CONFIG.mode,
      substeps: Math.max(1, Math.min(64, Math.floor(config?.substeps ?? DEFAULT_SOLVER_CONFIG.substeps))),
      softeningRatio: Math.max(0, config?.softeningRatio ?? DEFAULT_SOLVER_CONFIG.softeningRatio),
      enableJ2: config?.enableJ2 ?? DEFAULT_SOLVER_CONFIG.enableJ2,
      enableTidalTorque: config?.enableTidalTorque ?? DEFAULT_SOLVER_CONFIG.enableTidalTorque,
      collisionMode: config?.collisionMode ?? DEFAULT_SOLVER_CONFIG.collisionMode,
      restitution: Math.max(0, Math.min(1, config?.restitution ?? DEFAULT_SOLVER_CONFIG.restitution)),
    };

    const count = bodies?.length ?? 0;
    this.capacity = Math.max(initialCapacity, count * 2, 8);

    this.positions = new Float64Array(this.capacity * 2);
    this.velocities = new Float64Array(this.capacity * 2);
    this.accel1 = new Float64Array(this.capacity * 2);
    this.accel2 = new Float64Array(this.capacity * 2);
    this.masses = new Float64Array(this.capacity);
    this.mus = new Float64Array(this.capacity);
    this.radii = new Float64Array(this.capacity);
    this.spinPeriods = new Float64Array(this.capacity);
    this.spinDirections = new Float64Array(this.capacity);
    this.j2Coeffs = new Float64Array(this.capacity);
    this.isFixed = new Uint8Array(this.capacity);
    this.removedFlags = new Uint8Array(this.capacity);
    this.parentIndices = new Int32Array(this.capacity);

    if (bodies) {
      for (const b of bodies) {
        this.addBody(b);
      }
    }
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;

    let newCap = this.capacity * 2;
    while (newCap < required) newCap *= 2;

    const newPositions = new Float64Array(newCap * 2);
    const newVelocities = new Float64Array(newCap * 2);
    const newAccel1 = new Float64Array(newCap * 2);
    const newAccel2 = new Float64Array(newCap * 2);
    const newMasses = new Float64Array(newCap);
    const newMus = new Float64Array(newCap);
    const newRadii = new Float64Array(newCap);
    const newSpinPeriods = new Float64Array(newCap);
    const newSpinDirections = new Float64Array(newCap);
    const newJ2Coeffs = new Float64Array(newCap);
    const newIsFixed = new Uint8Array(newCap);
    const newRemovedFlags = new Uint8Array(newCap);
    const newParentIndices = new Int32Array(newCap);

    newPositions.set(this.positions);
    newVelocities.set(this.velocities);
    newAccel1.set(this.accel1);
    newAccel2.set(this.accel2);
    newMasses.set(this.masses);
    newMus.set(this.mus);
    newRadii.set(this.radii);
    newSpinPeriods.set(this.spinPeriods);
    newSpinDirections.set(this.spinDirections);
    newJ2Coeffs.set(this.j2Coeffs);
    newIsFixed.set(this.isFixed);
    newRemovedFlags.set(this.removedFlags);
    newParentIndices.set(this.parentIndices);

    this.capacity = newCap;
    this.positions = newPositions;
    this.velocities = newVelocities;
    this.accel1 = newAccel1;
    this.accel2 = newAccel2;
    this.masses = newMasses;
    this.mus = newMus;
    this.radii = newRadii;
    this.spinPeriods = newSpinPeriods;
    this.spinDirections = newSpinDirections;
    this.j2Coeffs = newJ2Coeffs;
    this.isFixed = newIsFixed;
    this.removedFlags = newRemovedFlags;
    this.parentIndices = newParentIndices;
  }

  private rebuildParentIndices(): void {
    for (let i = 0; i < this.count; i++) {
      const pId = this.parentIds[i];
      this.parentIndices[i] = pId !== undefined ? (this.idToIndex.get(pId) ?? -1) : -1;
    }
  }

  /** Adds a new physical body to the simulation kernel. */
  public addBody(body: BodyPhysicalState): void {
    if (this.idToIndex.has(body.id)) {
      throw new Error(`Body with id "${body.id}" already exists in physics solver.`);
    }

    this.ensureCapacity(this.count + 1);
    const idx = this.count;
    const i2 = idx * 2;

    this.positions[i2] = body.position[0];
    this.positions[i2 + 1] = body.position[1];
    this.velocities[i2] = body.velocity[0];
    this.velocities[i2 + 1] = body.velocity[1];
    this.accel1[i2] = 0;
    this.accel1[i2 + 1] = 0;
    this.accel2[i2] = 0;
    this.accel2[i2 + 1] = 0;
    this.masses[idx] = body.mass;
    this.mus[idx] = body.mu;
    this.radii[idx] = body.radius;
    this.spinPeriods[idx] = body.spinPeriod ?? 86400;
    this.spinDirections[idx] = body.spinDirection ?? -1;
    this.j2Coeffs[idx] = body.j2 ?? 0;
    this.isFixed[idx] = body.isFixed ? 1 : 0;

    this.bodyIds.push(body.id);
    this.parentIds.push(body.parentId);
    this.idToIndex.set(body.id, idx);
    this.count++;

    this.rebuildParentIndices();
  }

  /** Removes a body by ID, compacting storage in O(1) by swapping with tail element. */
  public removeBody(id: string): boolean {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return false;

    const lastIdx = this.count - 1;
    if (idx !== lastIdx) {
      const i2 = idx * 2;
      const l2 = lastIdx * 2;

      this.positions[i2] = this.positions[l2]!;
      this.positions[i2 + 1] = this.positions[l2 + 1]!;
      this.velocities[i2] = this.velocities[l2]!;
      this.velocities[i2 + 1] = this.velocities[l2 + 1]!;
      this.accel1[i2] = this.accel1[l2]!;
      this.accel1[i2 + 1] = this.accel1[l2 + 1]!;
      this.accel2[i2] = this.accel2[l2]!;
      this.accel2[i2 + 1] = this.accel2[l2 + 1]!;

      this.masses[idx] = this.masses[lastIdx]!;
      this.mus[idx] = this.mus[lastIdx]!;
      this.radii[idx] = this.radii[lastIdx]!;
      this.spinPeriods[idx] = this.spinPeriods[lastIdx]!;
      this.spinDirections[idx] = this.spinDirections[lastIdx]!;
      this.j2Coeffs[idx] = this.j2Coeffs[lastIdx]!;
      this.isFixed[idx] = this.isFixed[lastIdx]!;

      const movedId = this.bodyIds[lastIdx]!;
      this.bodyIds[idx] = movedId;
      this.parentIds[idx] = this.parentIds[lastIdx];
      this.idToIndex.set(movedId, idx);
    }

    this.bodyIds.pop();
    this.parentIds.pop();
    this.idToIndex.delete(id);
    this.count--;

    this.rebuildParentIndices();
    return true;
  }

  /** Advances the physics simulation by dt seconds with zero heap allocations. */
  public step(dt: number): PhysicsStepResult {
    if (this.count === 0 || dt <= 0) {
      this.cachedStepResult.time = this.currentTime;
      this.cachedStepResult.stepCount = this.currentStepCount;
      this.cachedStepResult.collisions = EMPTY_COLLISIONS;
      return this.cachedStepResult;
    }

    this.scratchCollisions.length = 0;
    const substeps = this.config.substeps;
    const subDt = dt / substeps;

    for (let s = 0; s < substeps; s++) {
      this.count = stepVelocityVerlet(
        this.positions,
        this.velocities,
        this.accel1,
        this.accel2,
        this.masses,
        this.mus,
        this.radii,
        this.spinPeriods,
        this.spinDirections,
        this.j2Coeffs,
        this.isFixed,
        this.removedFlags,
        this.bodyIds,
        this.parentIds,
        this.idToIndex,
        this.parentIndices,
        this.count,
        subDt,
        this.config,
        this.scratchCollisions,
      );
    }

    this.currentTime += dt;
    this.currentStepCount++;

    this.cachedStepResult.time = this.currentTime;
    this.cachedStepResult.stepCount = this.currentStepCount;
    this.cachedStepResult.collisions = this.scratchCollisions.length > 0
      ? [...this.scratchCollisions]
      : EMPTY_COLLISIONS;

    return this.cachedStepResult;
  }

  /** Returns read-only snapshots of all active body physical states. */
  public getBodies(): readonly BodyPhysicalState[] {
    const result: BodyPhysicalState[] = [];
    for (let i = 0; i < this.count; i++) {
      const i2 = i * 2;
      result.push({
        id: this.bodyIds[i]!,
        mass: this.masses[i]!,
        mu: this.mus[i]!,
        radius: this.radii[i]!,
        position: [this.positions[i2]!, this.positions[i2 + 1]!],
        velocity: [this.velocities[i2]!, this.velocities[i2 + 1]!],
        spinPeriod: this.spinPeriods[i]!,
        spinDirection: this.spinDirections[i]!,
        j2: this.j2Coeffs[i]!,
        isFixed: this.isFixed[i] === 1,
        parentId: this.parentIds[i],
      });
    }
    return result;
  }

  /** Look up physical state of a body by ID. */
  public getBody(id: string): BodyPhysicalState | undefined {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return undefined;
    const i2 = idx * 2;
    return {
      id: this.bodyIds[idx]!,
      mass: this.masses[idx]!,
      mu: this.mus[idx]!,
      radius: this.radii[idx]!,
      position: [this.positions[i2]!, this.positions[i2 + 1]!],
      velocity: [this.velocities[i2]!, this.velocities[i2 + 1]!],
      spinPeriod: this.spinPeriods[idx]!,
      spinDirection: this.spinDirections[idx]!,
      j2: this.j2Coeffs[idx]!,
      isFixed: this.isFixed[idx] === 1,
      parentId: this.parentIds[idx],
    };
  }

  /**
   * Computes total gravitational and J2 perturbation acceleration vector at [x, y] in m/s^2.
   * Useful for ship physics and ghost trajectory evaluation.
   */
  public computeAccelerationAt(
    x: number,
    y: number,
    ignoreBodyId?: string,
  ): readonly [number, number] {
    const ignoreIndex = ignoreBodyId !== undefined ? (this.idToIndex.get(ignoreBodyId) ?? -1) : -1;
    return computeGravitationalAccelerationAt(
      x,
      y,
      this.positions,
      this.mus,
      this.radii,
      this.count,
      this.config.softeningRatio,
      {
        enableJ2: this.config.mode === 'full-body' && this.config.enableJ2,
        j2Coeffs: this.j2Coeffs,
        spinPeriods: this.spinPeriods,
      },
      ignoreIndex,
    );
  }

  /** Creates an independent, deeply copied instance of the solver for trajectory forecasting. */
  public clone(): PhysicsSolver {
    const cloned = new PhysicsSolver(undefined, this.config, this.capacity);
    cloned.count = this.count;
    cloned.currentTime = this.currentTime;
    cloned.currentStepCount = this.currentStepCount;

    cloned.positions.set(this.positions);
    cloned.velocities.set(this.velocities);
    cloned.accel1.set(this.accel1);
    cloned.accel2.set(this.accel2);
    cloned.masses.set(this.masses);
    cloned.mus.set(this.mus);
    cloned.radii.set(this.radii);
    cloned.spinPeriods.set(this.spinPeriods);
    cloned.spinDirections.set(this.spinDirections);
    cloned.j2Coeffs.set(this.j2Coeffs);
    cloned.isFixed.set(this.isFixed);
    cloned.parentIndices.set(this.parentIndices);

    cloned.bodyIds = [...this.bodyIds];
    cloned.parentIds = [...this.parentIds];
    cloned.idToIndex = new Map(this.idToIndex);

    return cloned;
  }

  public getTime(): number {
    return this.currentTime;
  }

  public getStepCount(): number {
    return this.currentStepCount;
  }

  public getConfig(): PhysicsSolverConfig {
    return this.config;
  }

  public getBodyCount(): number {
    return this.count;
  }
}
