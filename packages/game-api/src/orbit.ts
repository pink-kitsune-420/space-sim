import type { Vec } from './state';

export interface OrbitalState { readonly position: Vec; readonly velocity: Vec }
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
export interface SolverDiagnostics {
  readonly converged: boolean;
  readonly iterations: number;
  readonly bracketIterations: number;
  readonly residualSeconds: number | null;
  readonly usedBisection: boolean;
  readonly reason: string | null;
}
export type Propagation = { readonly ok: true; readonly state: OrbitalState; readonly diagnostics: SolverDiagnostics }
  | { readonly ok: false; readonly diagnostics: SolverDiagnostics };
export interface SolverOptions {
  readonly maxIterations?: number;
  readonly maxBracketIterations?: number;
  readonly maxNewtonIterations?: number;
}
