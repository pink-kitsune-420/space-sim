/** Compatibility entry point. New world/session code owns a SimulationContext instead. */
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
export * as dmath from './dmath';

let legacyContext = createSimulationContext();
/** @deprecated Use context.vehicle. Only configures the legacy free functions. */
export let vehicle = legacyContext.vehicle;
/** @deprecated Create an immutable per-world context instead. Existing iterators keep
 * their original settings; this never changes a World's context. */
export function setVehicle(defaults: Partial<{ acceleration: number; turnRate: number }>): void {
  const next = createSimulationContext(defaults);
  legacyContext.dispose();
  legacyContext = next;
  vehicle = next.vehicle;
}
export function step(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
  return legacyContext.step(state, controls, dt, body, surface);
}
export function advance(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
  return legacyContext.advance(state, controls, dt, body, surface);
}
export function keplerCoast(state: State, body: Body, surface?: SurfaceProfile, dt = STEP): Coast | undefined {
  return legacyContext.keplerCoast(state, body, surface, dt);
}
export function coastAt(coast: Coast, time: number, body = planet, surface?: SurfaceProfile,
  options: { readonly cache?: boolean } = {}) {
  return legacyContext.coastAt(coast, time, body, surface, options);
}
export function coastCacheStats(coast: Coast | undefined) { return legacyContext.coastCacheStats(coast); }
export function ghost(start: State, coarse = false, body = planet, surface?: SurfaceProfile) {
  return legacyContext.predict(start, coarse, body, surface);
}
/** Exact 10-ms legacy reference iterator; captures its context before the first yield. */
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
