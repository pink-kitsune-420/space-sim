import type { ServiceKey } from './modules-v2';
import type { SimulationContextFactory } from './context';
import type { Body, Controls, Vec } from './state';
import type { Elements, OrbitalState, Propagation, SolverOptions } from './orbit';
import type { LoadedSystem, ResolvedBody, UniverseDefinition } from './universe';
import type { SurfaceProfile, SurfaceQuery, SurfaceSweep, SurfaceSweepOptions } from './surface';

/** Canonical identity and behavioral `modelIdentity` fingerprint of an authoritative motion service provider. */
export interface ProviderIdentity {
  readonly id: string;
  readonly version: string;
  /** All parameters affecting behavior; local identity, not a package fingerprint. */
  readonly modelIdentity: string;
}
/** Analytic providers promise two-body propagation and conservative radius events.
 * A provider without that verified contract sets analytic=false; ordinary motion remains usable. */
export interface OrbitalProvider extends ProviderIdentity {
  readonly analytic: boolean;
  elements(state: OrbitalState, mu: number): Elements;
  propagate(state: OrbitalState, mu: number, seconds: number, options?: SolverOptions): Propagation;
  timeToRadius(state: OrbitalState, mu: number, radius: number, direction: 'inbound' | 'outbound', elements?: Elements): number | null;
}
/** Local terrain contact support at a polar angle (radians): query sample, outward support normals, and maximum slope angle in radians. */
export interface SurfaceSupport {
  readonly surface: SurfaceQuery;
  readonly normals: readonly Vec[];
  readonly maxSlopeRadians: number;
  /** Hull-centre radial support distance in metres when a finite radius was requested. */
  readonly centerRadiusMetres?: number;
}
/** All geometry uses the public radial SurfaceProfile contract. Query, contact and
 * generation must agree, including preset placement, water and prediction. */
export interface SurfaceProvider extends ProviderIdentity {
  generate(body: Body): SurfaceProfile;
  identity(body: Body): string;
  validate(body: Body, profile: SurfaceProfile): void;
  query(profile: SurfaceProfile, angle: number): SurfaceQuery;
  /** Optional radiusMetres uses circular hull support on solid terrain, including seabed;
   * omitted is legacy point support. Floating equilibrium belongs to motion, not rock support. */
  support(profile: SurfaceProfile, angle: number, radiusMetres?: number): SurfaceSupport;
  sweep(profile: SurfaceProfile, start: Vec, end: Vec, options?: SurfaceSweepOptions): SurfaceSweep;
  sweepGround(profile: SurfaceProfile, start: Vec, end: Vec, options?: SurfaceSweepOptions): SurfaceSweep;
}
/** Owns ephemerides, coordinate changes, SOI selection and preset placement.
 * Returned systems are isolated per world; mutable derived ephemeris caches are permitted. */
export interface BodyFrameProvider extends ProviderIdentity {
  load(universe: UniverseDefinition, systemId: string, surfaces: SurfaceProvider): LoadedSystem;
}
/** Tuple of `modelIdentity` strings (`dynamics`, `orbits`, `bodies`, `surfaces`) that a `RailsProvider` certifies for analytic sleep. */
export interface RailsBinding {
  readonly dynamics: string;
  readonly orbits: string;
  readonly bodies: string;
  readonly surfaces: string;
}
/** Sleep requires an explicit compatible binding and a conservative event horizon.
 * 0 means unknown; Infinity is allowed only when no event is possible. The world
 * additionally checks idle controls, contact and exact fixed-point eligibility.
 * Evaluation uses the selected orbital provider and the context's guarded coastAt. */
export interface RailsProvider extends ProviderIdentity {
  readonly compatible: readonly RailsBinding[];
  horizon(system: LoadedSystem, body: ResolvedBody, state: OrbitalState, epoch: OrbitalState, time: number, top: number): number;
}
/** Group of motion services composed into simulation contexts: orbits, body frames, surfaces, and rails. */
export interface MotionServices {
  readonly orbits: OrbitalProvider;
  readonly bodies: BodyFrameProvider;
  readonly surfaces: SurfaceProvider;
  readonly rails: RailsProvider;
}
/** Authoritative command emitted by world rules to modify ship controls or throttle. */
export interface RuleCommand {
  readonly shipId: string;
  readonly controls?: Controls;
  readonly throttle?: number;
}

/** Service key for the simulation motion context factory (`motion@1.0.0`). */
export const MOTION_CONTEXTS: ServiceKey<SimulationContextFactory> = Object.freeze({ slot: 'motion', version: '1.0.0' });
/** Service key for orbital mechanics calculation service (`orbits@1.0.0`). */
export const ORBITAL_MOTION: ServiceKey<OrbitalProvider> = Object.freeze({ slot: 'orbits', version: '1.0.0' });
/** Service key for celestial body frame resolution service (`bodies@1.0.0`). */
export const BODY_FRAMES: ServiceKey<BodyFrameProvider> = Object.freeze({ slot: 'bodies', version: '1.0.0' });
/** Service key for surface terrain and collision geometry query service (`surfaces@1.0.0`). */
export const SURFACE_GEOMETRY: ServiceKey<SurfaceProvider> = Object.freeze({ slot: 'surfaces', version: '1.0.0' });
/** Service key for rails horizon evaluation and sleep scheduling policy (`rails@1.0.0`). */
export const RAILS_POLICY: ServiceKey<RailsProvider> = Object.freeze({ slot: 'rails', version: '1.0.0' });
