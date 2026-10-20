import type { ModuleValue } from './motion';
import type { Controls, State, SurfaceContactEvent, Vec } from './state';

/** One independently controlled vessel. `state` is relative to `bodyId`'s non-rotating frame. */
export interface Ship {
  /** Absent only on the legacy trainer path. Stable across respawn, replay and ownership. */
  readonly vehicleId?: string;
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly bodyId: string;
  readonly state: State;
  /** Held controls applied at every step until replaced. */
  readonly controls: Controls;
  /** Motion failed validation; the ship holds its last verified state until the fault is
   * cleared or it respawns. */
  readonly fault?: string;
}

/** Mode of locomotion or containment for an avatar. */
export type AvatarMode = 'surface' | 'eva' | 'boarded';

/** Lightweight physical human/creature entity on foot or EVA.
 * Coordinate frame: Inertial body-centered frame (matching State.position / State.velocity). */
export interface AvatarState {
  readonly id: string;
  readonly ownerId: string;
  readonly parentBodyId: string;
  readonly position: Vec;
  readonly velocity: Vec;
  /** Heading angle in radians (counter-clockwise from +x in body-centered frame). */
  readonly heading: number;
  readonly mode: AvatarMode;
  /** If mode === 'boarded', the ship ID holding the avatar. */
  readonly mountedShipId?: string;
  readonly revision: number;
}

/** Controls input for advancing an avatar. */
export interface AvatarControls {
  /** Desired walking or thrust direction [-1..1] along tangent (surface) or forward/reverse (eva). */
  readonly move: number;
  /** Vertical thrust / jump [0..1]. */
  readonly jump: number;
  /** Turn input [-1..1]. */
  readonly turn: number;
}

/** Authoritative event emitted during a fixed world step: surface contact, SOI transition, per-ship motion fault, world rule fault, or module domain event. */
export type WorldEvent =
  | { readonly type: 'world-fault'; readonly message: string }
  | { readonly type: 'contact'; readonly shipId: string; readonly contact: SurfaceContactEvent; readonly status: State['status'] }
  | { readonly type: 'soi'; readonly shipId: string; readonly from: string; readonly to: string }
  | { readonly type: 'fault'; readonly shipId: string; readonly message: string }
  | { readonly type: 'module'; readonly shipId: string; readonly moduleEvent: { readonly type: string; readonly payload: ModuleValue }; readonly event: { readonly type: string; readonly payload: ModuleValue } }
  | { readonly type: 'avatar-contact'; readonly avatarId: string; readonly bodyId: string; readonly fraction: number }
  | { readonly type: 'avatar-board'; readonly avatarId: string; readonly shipId: string }
  | { readonly type: 'avatar-exit'; readonly avatarId: string; readonly shipId: string };


