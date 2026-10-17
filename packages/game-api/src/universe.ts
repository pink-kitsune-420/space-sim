import type { Body, State, Vec } from './state';
import type { SurfaceDefinition, SurfaceProfile } from './surface';

export interface SOI {
  readonly radius: number;
  readonly entryMetres?: number;
  readonly exitMetres?: number;
}

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
}

export interface RotationDefinition {
  /** Seconds per turn. */
  readonly period: number;
  /** -1 (default) turns clockwise like default orbits, so a prograde launch gains the spin. */
  readonly direction?: number;
  readonly phaseRadiansAtEpoch?: number;
}

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

export interface VehicleDefaults {
  readonly acceleration: number;
  readonly turnRate: number;
  readonly initialThrottle: number;
}

export interface SystemDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly centralBodyId?: string;
  readonly bodies: readonly CelestialBodyDefinition[];
  readonly vehicleDefaults?: Partial<VehicleDefaults>;
  readonly presets: readonly PresetDefinition[];
}

export interface UniverseDefinition {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  readonly defaultSystemId: string;
  readonly systems: readonly SystemDefinition[];
}

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
}

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
