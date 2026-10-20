import type { Body, Coast, Controls, GhostEnd, GhostSample, State } from './state';
import type { Propagation } from './orbit';
import type { SurfaceProfile } from './surface';
import type { VehicleDefaults } from './universe';
import type { MotionServices } from './services';
import type { MotionCapabilities, MotionContextOptions } from './motion';

/** Motion context with an optional numerical/contact replacement and force schedule.
 * All motion is synchronous, body-relative 2D SI: metres, seconds, radians (+Y up).
 * Methods leave input state untouched. Contexts are owned per world/vehicle definition;
 * craft with the same handling share a context. No DOM or timers.
 * Prediction consumers own a clone and dispose it when a job ends or is cancelled. */
export interface SimulationContext {
  readonly modelIdentity: string;
  readonly stepSeconds: 0.01;
  readonly vehicle: Readonly<VehicleDefaults>;
  readonly capabilities: MotionCapabilities;
  readonly services: MotionServices;
  validateState(state: State, body: Body, surface?: SurfaceProfile): void;
  step(state: State, controls: Controls, seconds: number, body: Body, surface?: SurfaceProfile): State;
  advance(state: State, controls: Controls, seconds: number, body: Body, surface?: SurfaceProfile): State;
  predict(start: State, coarse: boolean, body: Body, surface?: SurfaceProfile): Generator<GhostSample, GhostEnd>;
  keplerCoast(state: State, body: Body, surface?: SurfaceProfile, seconds?: number): Coast | undefined;
  coastAt(coast: Coast, time: number, body: Body, surface?: SurfaceProfile, options?: { readonly cache?: boolean }): Propagation;
  coastCacheStats(coast: Coast | undefined): CoastCacheStats;
  /** Same immutable configuration; fresh derived caches and no live mutable state. */
  cloneForPrediction(): SimulationContext;
  /** Release derived caches. Idempotent; the context can rebuild them if reused. */
  dispose(): void;
}
/** Read-only diagnostic counters for a simulation context's derived Kepler coast sample cache. */
export interface CoastCacheStats {
  readonly samples: number;
  readonly hits: number;
  readonly misses: number;
  readonly capacity: number;
}
/** Composition supplies a fresh context for each world, including restores and mirrors. */
export type SimulationContextFactory = (settings: Readonly<VehicleDefaults>, options?: MotionContextOptions) => SimulationContext;
