import type { Body, State, Vec } from './state';
import type { SurfaceDefinition, SurfaceProfile } from './surface';

/** Sphere-of-influence radii in metres (`radius`, optional hysteresis `entryMetres` and `exitMetres`) for gravitational handoffs. */
export interface SOI {
  readonly radius: number;
  readonly entryMetres?: number;
  readonly exitMetres?: number;
}

/** Prescribed celestial body trajectory relative to its parent body: fixed inertial coordinates (`m`, `m/s`) or circular Keplerian orbit (`m`, `rad`, `s`). */
export type Ephemeris =
  | {
      readonly kind: 'fixed-inertial';
      readonly position?: readonly [number, number];
      readonly velocity?: readonly [number, number];
    }
  | {
      readonly kind: 'circular-kepler';
      readonly radius?: number;
      readonly radiusMetres?: number;
      readonly phaseRadiansAtEpoch?: number;
      readonly direction?: number;
      readonly period?: number;
    };

/** Authored celestial body definition with SI physical parameters (`radius`/`radiusMetres` in `m`, `mass` in `kg`, `mu` in `m³/s²`), ephemeris, terrain, and appearance. */
export interface CelestialBodyDefinition {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string | null;
  readonly radius?: number;
  readonly radiusMetres?: number;
  readonly mass?: number; // kg
  readonly mu?: number; // m^3 / s^2
  readonly soi?: SOI;
  readonly color?: string;
  readonly accentColor?: string;
  readonly atmosphereColor?: string;
  readonly horizonColor?: string;
  readonly skyColor?: string;
  readonly surfaceFeatures?: 'globe-lines' | 'craters' | 'smooth' | 'star';
  readonly surface?: SurfaceDefinition;
  readonly ephemeris?: Ephemeris;
  /** Sidereal spin; absent bodies do not rotate. */
  readonly rotation?: RotationDefinition;
  /** How the body is drawn; derived from `surfaceFeatures` and its colours when absent. */
  readonly appearance?: BodyAppearance;
}

/** Procedural look of a body. Presentation only: it never changes the physical outline. */
export type AppearanceStyle = 'rocky' | 'arid' | 'oceanic' | 'banded' | 'icy' | 'hazy' | 'volcanic' | 'star';

/** Presentation-only procedural shader appearance parameters for a celestial body (style, `#rrggbb` palette, seed in `[0, 1000]`, and `[0, 1]` tuning sliders). */
export interface BodyAppearance {
  readonly style: AppearanceStyle;
  /** Up to four '#rrggbb' colours. Their roles depend on the style:
   * rocky [ground, dark lava seas, bright highlands, polar frost], arid [sand, rock, salt flats, polar ice],
   * oceanic [ocean, vegetation, desert, ice and cloud],
   * banded [band, dark band, light band, storms], icy [ice, cracks, frost, tint], hazy [cloud, dark cloud, light cloud, tint],
   * volcanic [rock, dark crust, lava, sulfur], star [core, surface, limb, spots]. */
  readonly colors?: readonly string[];
  /** Pattern seed, 0 to 1000; derived from the body id when absent. */
  readonly seed?: number;
  /** Tuning from 0 to 1, 0.5 by default: sea level (or dry basins), cloud cover, polar ice,
   * crater density, turbulence of bands and clouds, and volcanic glow. */
  readonly water?: number;
  readonly clouds?: number;
  readonly ice?: number;
  readonly craters?: number;
  readonly turbulence?: number;
  readonly glow?: number;
}

/** Tunable appearance settings. */
export type AppearanceTuning = 'water' | 'clouds' | 'ice' | 'craters' | 'turbulence' | 'glow';
/** Presentation tuning fields in shader order. */
export const APPEARANCE_TUNING: readonly AppearanceTuning[] = Object.freeze(['water', 'clouds', 'ice', 'craters', 'turbulence', 'glow']);

/** Authored sidereal rotation specification for a celestial body (`period` in `s`, `direction` `-1` CW or `1` CCW, `phaseRadiansAtEpoch` in `rad`). */
export interface RotationDefinition {
  /** Seconds per turn. */
  readonly period: number;
  /** -1 (default) turns clockwise like default orbits, so a prograde launch gains the spin. */
  readonly direction?: number;
  readonly phaseRadiansAtEpoch?: number;
}

/** Authored ship spawn preset definition relative to `bodyId` (`'landed'`, `'circular-orbit'`, or explicit body-relative SI `'state'`). */
export interface PresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly bodyId: string;
  readonly kind: 'landed' | 'circular-orbit' | 'state';
  readonly radius?: number;
  readonly radiusMetres?: number;
  readonly altitude?: number;
  readonly phaseRadians?: number;
  readonly direction?: number;
  readonly headingRadians?: number;
  readonly zoom?: number;
  readonly position?: readonly [number, number];
  readonly velocity?: readonly [number, number];
}

/** Authoritative spacecraft handling parameters in SI units: full-thrust `acceleration` (`m/s²`), `turnRate` (`rad/s`), and `initialThrottle` (`[0, 1]`). */
export interface VehicleDefaults {
  readonly acceleration: number;
  readonly turnRate: number;
  readonly initialThrottle: number;
  /** Optional circular hull radius in metres, [0, 32]; absent/zero retains legacy point contact.
   * The state position is the hull centre. Dry terrain and smooth bodies are supported;
   * finite hulls on ocean terrain are rejected rather than reinterpreted as point vessels. */
  readonly contactRadiusMetres?: number;
}

/** Authored star or planetary system definition containing hierarchical bodies, default vehicle handling, and spawn presets. */
export interface SystemDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly centralBodyId?: string;
  readonly bodies: readonly CelestialBodyDefinition[];
  readonly vehicleDefaults?: Partial<VehicleDefaults>;
  readonly presets: readonly PresetDefinition[];
}

/** Celestial body motion model: analytic Keplerian `'rails'` (default), numerical mutual-gravity `'nbody'`, or `'full-body'` (N-body plus optional J2, tides and collisions). */
export type PhysicsMode = 'rails' | 'nbody' | 'full-body';

/** How touching celestial bodies interact in simulated universes: inelastic `'merge'`, impulse `'bounce'` (see `restitution`), or `'none'` (pass through). */
export type CollisionMode = 'merge' | 'bounce' | 'none';

/** Authored, optional universe physics settings. Omitted fields resolve to defaults
 * (`resolveUniversePhysics` in `packages/sim-core`); an omitted or empty config means analytic rails,
 * and is left out of the validated universe so legacy digests are unchanged. Settings other than
 * `mode` and `maxWarp` are inert in `'rails'` mode. */
export interface UniversePhysicsConfig {
  /** Body motion model; `'rails'` when absent. */
  readonly mode?: PhysicsMode;
  /** Integrator substeps per fixed simulation step, integer in `[1, 64]`. */
  readonly substeps?: number;
  /** Gravitational softening length as a fraction of the attracting body's radius (dimensionless, `>= 0`). */
  readonly softeningRatio?: number;
  /** Apply J2 oblateness of spinning bodies (`'full-body'` only). */
  readonly enableJ2?: boolean;
  /** Apply tidal spin dissipation (`'full-body'` only). */
  readonly enableTidalTorque?: boolean;
  /** Body–body contact response (`'full-body'` only). */
  readonly collisionMode?: CollisionMode;
  /** Coefficient of restitution for `'bounce'` collisions, in `[0, 1]`. */
  readonly restitution?: number;
  /** Highest permitted time-warp factor, in `[1, 100000]`. */
  readonly maxWarp?: number;
}

/** Universe physics settings with every default applied. */
export type ResolvedUniversePhysics = Required<UniversePhysicsConfig>;

/** Portable multi-system universe definition (`schemaVersion`, metadata, `defaultSystemId`, `systems`, and optional `physics`). */
export interface UniverseDefinition {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  readonly defaultSystemId: string;
  readonly systems: readonly SystemDefinition[];
  /** Body motion settings; absent means analytic Keplerian rails. */
  readonly physics?: UniversePhysicsConfig;
}

/** Fully validated celestial body with resolved SI physical constants (`radius` in `m`, `mass` in `kg`, `mu` in `m³/s²`), SOI hysteresis radii, surface identity, and 4-color appearance. */
export interface ResolvedBody extends Body {
  readonly surfaceIdentity: string;
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly radius: number;
  readonly mass: number;
  readonly mu: number;
  readonly soi: {
    readonly radius: number;
    readonly entryMetres: number;
    readonly exitMetres: number;
  };
  readonly color: string;
  readonly accentColor: string;
  readonly atmosphereColor?: string;
  readonly horizonColor?: string;
  readonly skyColor?: string;
  readonly surfaceFeatures: 'globe-lines' | 'craters' | 'smooth' | 'star';
  readonly ephemeris: Ephemeris;
  /** Always four colours once resolved. */
  readonly appearance: BodyAppearance & { readonly colors: readonly [string, string, string, string] };
}

/** Resolved planetary system instance providing ephemeris queries (`getBodyPosition` in `m`, `getBodyVelocity` in `m/s` at simulation `time` in `s`), preset placement, and SOI transitions. */
export interface LoadedSystem {
  readonly universeId: string;
  readonly universeName: string;
  readonly system: SystemDefinition;
  readonly rootBody: ResolvedBody;
  readonly vehicleDefaults: VehicleDefaults;
  readonly presets: readonly PresetDefinition[];
  getResolvedBody(id: string): ResolvedBody;
  getAllBodies(): readonly ResolvedBody[];
  getMoonsOf(parentId: string): readonly ResolvedBody[];
  getBodyPosition(bodyId: string, time: number): Vec;
  getBodyVelocity(bodyId: string, time: number): Vec;
  initialState(presetId?: string, surface?: SurfaceProfile): { state: State; body: ResolvedBody };
  checkSOI(state: State, currentBodyId: string, time: number): {
    switched: boolean;
    newBody: ResolvedBody;
    newState: State;
  };
}
