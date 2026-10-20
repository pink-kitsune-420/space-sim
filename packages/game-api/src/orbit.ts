import type { Vec } from './state';

/** Body-relative 2D inertial position (`m`) and velocity (`m/s`) vector pair (+Y up). */
export interface OrbitalState { readonly position: Vec; readonly velocity: Vec }
/** Two-body Keplerian orbital elements in SI units (`m`, `m²/s`, `m²/s²`, `s`, `rad`) around a central body. `null` fields indicate unbound parabolic or hyperbolic trajectories. */
export interface Elements {
  readonly energy: number;
  readonly angularMomentum: number;
  readonly eccentricityVector: Vec;
  readonly eccentricity: number;
  readonly semilatusRectum: number;
  readonly periapsis: number;
  readonly apoapsis: number | null;
  readonly semiMajorAxis: number | null;
  readonly period: number | null;
  readonly periapsisAngle: number | null;
  readonly kind: 'elliptic' | 'parabolic' | 'hyperbolic';
  readonly radial: boolean;
}
/** Convergence and iteration diagnostics from universal-variable or Kepler anomaly root finding (`residualSeconds` in `s`). */
export interface SolverDiagnostics {
  readonly converged: boolean;
  readonly iterations: number;
  readonly bracketIterations: number;
  readonly residualSeconds: number | null;
  readonly usedBisection: boolean;
  readonly reason: string | null;
}
/** Result of propagating a two-body `OrbitalState` forward or backward in simulation seconds. */
export type Propagation = { readonly ok: true; readonly state: OrbitalState; readonly diagnostics: SolverDiagnostics }
  | { readonly ok: false; readonly diagnostics: SolverDiagnostics };
/** Iteration caps controlling Kepler/universal-variable orbital propagation root solvers. */
export interface SolverOptions {
  readonly maxIterations?: number;
  readonly maxBracketIterations?: number;
  readonly maxNewtonIterations?: number;
}
