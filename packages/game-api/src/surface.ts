import type { Vec } from './state';
import type { PlanetFieldDefinition } from './planet-field/definition';
import type { PlanetBakeResult } from './planet-field/bake';

/** Versioned surface authoring contract. */
export interface SurfacePadDefinition {
  readonly id: string;
  readonly angleRadians: number;
  readonly widthMetres: number;
  readonly elevationMetres: number;
}

/** Deterministic radial terrain and sea generation recipe in SI metres and radians (`generatorVersion: 1`). */
export interface RadialSurfaceDefinition {
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

/** Version2 physical macro terrain: the same sphere field supplies the equatorial
 * collision profile and a bounded whole-sphere map. Radius must match the body.
 * The profile is polar-linear between fixed samples; this is not fine terrain. */
export interface PlanetSurfaceDefinition extends PlanetFieldDefinition {
  readonly kind: 'planet';
  readonly sampleCount: number;
  readonly orientationRadians: number;
}
/** Frozen v1 radial recipes and shared-field v2 recipes have separate physical identities. */
export type SurfaceDefinition = RadialSurfaceDefinition | PlanetSurfaceDefinition;

/** World-owned macro map, immutable by contract. The private collision samples
 * are deliberately omitted: mutating map arrays cannot change solid geometry. */
export type PlanetSurfaceMap = Omit<PlanetBakeResult, 'equator'>;

/** Conservative radial bounds (`minRadius`/`maxRadius` in `m`), radial derivative (`m/rad`), and slope tangent over a terrain profile or interval. */
export interface SurfaceBounds {
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly maxAbsDerivative: number;
  readonly maxSlope: number;
}

/** Point evaluation of a `SurfaceProfile` at a body-fixed polar angle: radii, elevation, and water depth in metres, unit outward normals, and contact material. */
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

/** Authored or procedural radial terrain feature metadata (mountain range or crater) with dimensions in metres and polar angle in radians. */
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
  /** Optional v2 exact rock envelope before sea clamping. Visual culling uses this
   * to retain submerged ground; contact continues to use bounds. */
  readonly groundBounds?: SurfaceBounds;
  readonly features: readonly SurfaceFeature[];
  readonly pads: readonly SurfacePadDefinition[];
  /** Optional v2 shared field/map data. No fine cells or render palette. */
  readonly planet?: PlanetSurfaceMap;
  /** Elevations plus three interval arrays and optional v2 macro map storage;
   * excludes JS objects and identity text. */
  readonly storageBytes: number;
  sampleElevation(index: number): number;
  intervalBounds(index: number): SurfaceBounds;
  copyElevations(): Float64Array;
}

/** Geometric tolerance (`m`) and work budget options for continuous chord-vs-terrain collision sweeps. */
export interface SurfaceSweepOptions {
  /** Absolute geometric tolerance in metres; defaults to at least 1e-7 m. */
  readonly toleranceMetres?: number;
  /** Optional circular footprint radius in metres, [0, 32]. Hit.position is then the
   * hull centre; hit.surface describes the nearest rock or sea contact. Ground-only
   * sweeps ignore sea level and report the nearest solid rock, including seabed. */
  readonly radiusMetres?: number;
  /** Interval visits plus clearance evaluations, including root refinement. */
  readonly maxWork?: number;
}
/** Work and tolerance accounting returned with a `SurfaceSweep` result. */
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
/** Outcome of sweeping a body-fixed linear segment from `start` to `end` against a `SurfaceProfile`: `'clear'`, `'hit'` (with contact fraction and query), or `'failed'`. */
export type SurfaceSweep =
  | (SweepResult & { readonly status: 'clear' })
  | (SweepResult & { readonly status: 'hit'; readonly fraction: number;
    /** A bracket on the drift fraction, not a time-of-flight solution. */
    readonly fractionBracket: readonly [number, number];
    /** On the drift chord. For a finite footprint this is the hull centre;
     * its hull-to-ground clearance is within the reported tolerance. */
    readonly position: Vec; readonly surface: SurfaceQuery; readonly clearanceMetres: number;
    readonly kind: 'crossing' | 'touching' })
  | (SweepResult & { readonly status: 'failed';
    readonly reason: 'work-limit' | 'precision' | 'initial-penetration';
    /** Only the prefix through this fraction was verified; do not accept the endpoint. */
    readonly verifiedFraction: number });

