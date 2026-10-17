import type { SolverDiagnostics } from './orbit';
import type { SurfaceDefinition, SurfaceSweepDiagnostics } from './surface';
import type { ModuleState } from './motion';

export interface Vec { readonly x: number; readonly y: number }
export interface Body {
  readonly id: string;
  readonly radius: number;
  readonly mu: number;
  readonly surface?: SurfaceDefinition;
}
export interface State {
  readonly moduleState?: Readonly<Record<string, ModuleState>>;
  readonly time: number;
  readonly position: Vec;
  readonly velocity: Vec;
  readonly heading: number;
  readonly throttle: number;
  readonly status: 'landed' | 'flying' | 'crashed';
  readonly revision: number;
  readonly godMode?: boolean;
  readonly coast?: Coast;
  readonly dynamics?: 'kepler' | 'numerical';
  readonly solver?: SolverDiagnostics;
  /** Terrain event epoch lies within this completed scheduler step. */
  readonly contact?: SurfaceContactEvent;
  readonly water?: 'submerged' | 'floating';
  /** Split drift vertex retained for prediction of a gentle sea entry. */
  readonly waterEntry?: GhostSample;
}
export interface SurfaceContactEvent {
  readonly material?: 'rock' | 'water';
  readonly time: number;
  readonly fraction: number;
  readonly surfaceIdentity: string;
  readonly impactVelocity: Vec;
  readonly diagnostics: SurfaceSweepDiagnostics;
}
export interface Coast {
  readonly modelIdentity?: string;
  readonly bodyId: string;
  readonly epochSeconds: number;
  readonly position: Vec;
  readonly velocity: Vec;
  readonly mu: number;
  readonly revision: number;
  readonly surfaceRadius: number;
  readonly surfaceIdentity: string;
  /** Absent for the circular preview contact model, even on configured bodies. */
  readonly contactSurfaceIdentity?: string;
}

export interface Controls { readonly turn: number; readonly throttle: number; readonly engine: boolean }
export type Preset = 'pad' | 'planet-orbit' | 'moon-orbit';

export interface Sample { readonly time: number; readonly position: Vec }

export interface GhostSample extends Sample {
  readonly velocity: Vec;
  /** Segment ending here is a verified numerical drift, not a conic/Hermite arc. */
  readonly linear?: boolean;
  readonly contactMaterial?: 'water';
}
/** Why an orbital ghost projection pass ended. */
export type GhostEnd = 'closed' | 'impact' | 'escape' | 'open' | 'grounded' | 'floating' | 'failed';
