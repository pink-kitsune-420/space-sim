import type { Controls, State, SurfaceContactEvent } from './state';

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

/** Authoritative event emitted during a fixed world step: surface contact, SOI transition, per-ship motion fault, or world rule fault. */
export type WorldEvent =
  | { readonly type: 'world-fault'; readonly message: string }
  | { readonly type: 'contact'; readonly shipId: string; readonly contact: SurfaceContactEvent; readonly status: State['status'] }
  | { readonly type: 'soi'; readonly shipId: string; readonly from: string; readonly to: string }
  | { readonly type: 'fault'; readonly shipId: string; readonly message: string };

