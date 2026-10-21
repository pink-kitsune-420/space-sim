/** Host-only (`packages/sim-core`) compatibility entry point. `packages/module-tools/check-boundaries.mjs` rejects direct module imports from `packages/sim-core`; modules access simulation primitives through `@space-sim/game-api` (`CORE_MOTION`, `CORE_ROTATION`, `CORE_WORLD`, `CORE_CLOCK`, `CORE_SAVE`, `CORE_COMMANDS`, `CORE_MODULE_DATA`). New world/session code owns a `SimulationContext` instead. */
import type { Body, Coast, Controls, State, SurfaceProfile } from '../../game-api/src/index';
import { createSimulationContext } from './context';
import { IDLE, STEP } from './constants';
import { planet } from './context';
export type * from '../../game-api/src/index';
export * from './context';
export * from './constants';
export * from './clock';
export * from './orbit';
export * from './universe';
export * from './surface';
export * from './surface-contact';
export * from './surface-flight';
export * from './water';
export * from './spin';
export * from './warp';
export * from './physics/index';
export * as dmath from './dmath';

let legacyContext = createSimulationContext();
/** @deprecated Use `context.vehicle` on a `SimulationContext`. Only configures the host-only legacy free functions. */
export let vehicle = legacyContext.vehicle;
/** @deprecated Create an immutable per-world `SimulationContext` (via `CORE_MOTION.createContext`) instead. Existing iterators keep
 * their original settings; this never changes a `World`'s context. Host-only (`packages/sim-core`). */
export function setVehicle(defaults: Partial<{ acceleration: number; turnRate: number }>): void {
  const next = createSimulationContext(defaults);
  legacyContext.dispose();
  legacyContext = next;
  vehicle = next.vehicle;
}
/** Advances `state` by one bounded numerical KDK step of `dt` seconds (`(0, 0.01]` `s`) using the shared legacy `SimulationContext`. Prefer `SimulationContext.step` via `CORE_MOTION`. Host-only (`packages/sim-core`). */
export function step(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
  return legacyContext.step(state, controls, dt, body, surface);
}
/** Advances `state` by `dt` seconds (`(0, 0.01]` `s`) using analytic Kepler coast when unpowered and clear of terrain, or numerical KDK integration otherwise, on the shared legacy `SimulationContext`. Prefer `SimulationContext.advance` via `CORE_MOTION`. Host-only (`packages/sim-core`). */
export function advance(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
  return legacyContext.advance(state, controls, dt, body, surface);
}
/** Returns the frozen two-body `Coast` epoch for an unpowered flying `state` clear of `surface` on the shared legacy `SimulationContext`, or `undefined` when numerical integration is required. Prefer `SimulationContext.keplerCoast` via `CORE_MOTION`. Host-only (`packages/sim-core`). */
export function keplerCoast(state: State, body: Body, surface?: SurfaceProfile, dt = STEP): Coast | undefined {
  return legacyContext.keplerCoast(state, body, surface, dt);
}
/** Evaluates a frozen `Coast` epoch at simulation `time` (`s`) around `body` on the shared legacy `SimulationContext`. Prefer `SimulationContext.coastAt` via `CORE_MOTION`. Host-only (`packages/sim-core`). */
export function coastAt(coast: Coast, time: number, body = planet, surface?: SurfaceProfile,
  options: { readonly cache?: boolean } = {}) {
  return legacyContext.coastAt(coast, time, body, surface, options);
}
/** Returns cache occupancy and hit/miss counters for `coast` on the shared legacy `SimulationContext`. Prefer `SimulationContext.coastCacheStats` via `CORE_MOTION`. Host-only (`packages/sim-core`). */
export function coastCacheStats(coast: Coast | undefined) { return legacyContext.coastCacheStats(coast); }
/** Yields an adaptive single-body trajectory prediction (`GhostSample` generator) from `start` on the shared legacy `SimulationContext`. Prefer `SimulationContext.predict` or `WorldRead.predictShip`. Host-only (`packages/sim-core`). */
export function ghost(start: State, coarse = false, body = planet, surface?: SurfaceProfile) {
  return legacyContext.predict(start, coarse, body, surface);
}
/** Exact 10-ms legacy reference iterator (`horizon` in `s`); captures its context before the first yield. Host-only (`packages/sim-core`). */
export function predict(start: State, horizon = 60) {
  const context = legacyContext;
  return (function* () {
    let state = start;
    yield { time: state.time, position: state.position };
    const count = Math.min(6000, Math.max(0, Math.floor(horizon / STEP)));
    for (let i = 0; i < count && state.status === 'flying'; i++) {
      state = context.advance(state, IDLE, STEP, planet);
      yield { time: state.time, position: state.position };
    }
  })();
}
