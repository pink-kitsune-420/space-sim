import type { Vec } from './state';

/** Versioned surface authoring contract. */
export interface SurfacePadDefinition {
  readonly id: string;
  readonly angleRadians: number;
  readonly widthMetres: number;
  readonly elevationMetres: number;
}

export interface SurfaceDefinition {
  readonly kind: 'radial';
  readonly generatorVersion: 1;
  readonly seed: number;
  readonly sampleCount: number;
  readonly maxReliefMetres: number;
  readonly minFeatureWidthMetres: number;
  readonly orientationRadians: number;
  readonly mountainRangeCount: number;
  readonly craterCount: number;
  /** Absolute body-local sea radius; waves never change this level. */
  readonly seaRadiusMetres?: number;
  readonly pads?: readonly SurfacePadDefinition[];
}

export interface SurfaceBounds {
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly maxAbsDerivative: number;
  readonly maxSlope: number;
}

export interface SurfaceQuery {
  readonly groundRadius: number;
  readonly firstContactRadius: number;
  readonly waterDepth: number;
  readonly elevation: number;
  readonly groundNormal: Readonly<{ x: number; y: number }>;
  readonly normal: Readonly<{ x: number; y: number }>;
  readonly intervalIndex: number;
  readonly material: 'rock' | 'water';
}

export type SurfaceFeature = Readonly<{
  id: string;
  kind: 'mountain-range';
  angleRadians: number;
  widthMetres: number;
  heightMetres: number;
} | {
  id: string;
  kind: 'crater';
  angleRadians: number;
  bowlRadiusMetres: number;
  rimWidthMetres: number;
  centralPeakWidthMetres: number;
  depthMetres: number;
  rimHeightMetres: number;
  centralPeakHeightMetres: number;
}>;

/** Private Float64 storage; reads/copies cannot mutate authoritative geometry.
 * No cache or browser globals. Callers own profile lifetimes. */
export interface SurfaceProfile {
  readonly identity: string;
  readonly referenceRadius: number;
  readonly orientationRadians: number;
  readonly sampleCount: number;
  readonly seaRadiusMetres?: number;
  /** Exact polar-linear sea crossings, wrapped to [0, 2*pi). */
  readonly coastAngles: readonly number[];
  readonly hasWater: boolean;
  readonly bounds: SurfaceBounds;
  readonly features: readonly SurfaceFeature[];
  readonly pads: readonly SurfacePadDefinition[];
  /** Elevations plus three interval arrays; excludes JS objects and identity text. */
  readonly storageBytes: number;
  sampleElevation(index: number): number;
  intervalBounds(index: number): SurfaceBounds;
  copyElevations(): Float64Array;
}

export interface SurfaceSweepOptions {
  /** Absolute geometric tolerance in metres; defaults to at least 1e-7 m. */
  readonly toleranceMetres?: number;
  /** Interval visits plus clearance evaluations, including root refinement. */
  readonly maxWork?: number;
}
export interface SurfaceSweepDiagnostics {
  readonly toleranceMetres: number;
  readonly intervals: number;
  readonly evaluations: number;
  readonly work: number;
}
interface SweepResult {
  readonly surfaceIdentity: string;
  readonly diagnostics: SurfaceSweepDiagnostics;
}
export type SurfaceSweep =
  | (SweepResult & { readonly status: 'clear' })
  | (SweepResult & { readonly status: 'hit'; readonly fraction: number;
    /** A bracket on the drift fraction, not a time-of-flight solution. */
    readonly fractionBracket: readonly [number, number];
    /** On the drift chord, within the reported tolerance of ground. */
    readonly position: Vec; readonly surface: SurfaceQuery; readonly clearanceMetres: number;
    readonly kind: 'crossing' | 'touching' })
  | (SweepResult & { readonly status: 'failed';
    readonly reason: 'work-limit' | 'precision' | 'initial-penetration';
    /** Only the prefix through this fraction was verified; do not accept the endpoint. */
    readonly verifiedFraction: number });

