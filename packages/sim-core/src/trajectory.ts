import type { GhostEnd, GhostSample, LoadedSystem, ResolvedBody, SimulationContext, State, SurfaceProfile } from '../../game-api/src/index';
import { MAX_FLIGHT_PLAN_SECONDS } from '../../game-api/src/index';
import { IDLE, STEP } from './constants';
import * as dm from './dmath';
import { contactFraction, ghostSample } from './context';

/** Display work bounds, independent of live physics. Numerical contact retains STEP. */
export const TRAJECTORY_MAX_SAMPLES = 16384;
export const TRAJECTORY_MAX_TRANSITIONS = 16;
export const TRAJECTORY_MAX_SECONDS = 365.25 * 86400;

/** Timed frame conversion shared by analytic and fleet/rule forecasts. */
export function frameSample(sample: GhostSample, bodyId: string, frameId: string, system: LoadedSystem,
  encounter?: GhostSample['encounter']): GhostSample {
  if (bodyId === frameId && !encounter) return { ...sample, bodyId, frameId };
  const origin = system.getBodyPosition(frameId, sample.time);
  let encounterBody: GhostSample['encounterBody'];
  if (encounter) {
    const target = system.getResolvedBody(encounter.to), at = system.getBodyPosition(target.id, sample.time);
    encounterBody = { position: { x: at.x - origin.x, y: at.y - origin.y }, radius: target.radius, name: target.name };
  }
  const metadata = { bodyId, frameId, ...(encounter ? { encounter, encounterBody } : {}) };
  if (bodyId === frameId) return { ...sample, ...metadata };
  const at = system.getBodyPosition(bodyId, sample.time);
  const velocity = system.getBodyVelocity(bodyId, sample.time), base = system.getBodyVelocity(frameId, sample.time);
  return { ...sample, ...metadata,
    position: { x: sample.position.x + (at.x - origin.x), y: sample.position.y + (at.y - origin.y) },
    velocity: { x: sample.velocity.x + (velocity.x - base.x), y: sample.velocity.y + (velocity.y - base.y) } };
}

/** Patched conics use the SAME conservative rails horizon and fixed-grid SOI checks as
 * live flight. Outside a verified analytic interval, one yield performs one live step.
 * No renderer, browser, wall clock or authority writes. The caller owns this context. */
export function* predictTrajectory(context: SimulationContext, initial: State, initialBody: ResolvedBody,
  system: LoadedSystem, surfaces: ReadonlyMap<string, SurfaceProfile>, coarse = false, endTime?: number): Generator<GhostSample, GhostEnd> {
  if (initial.status !== 'flying') return 'grounded';
  if (endTime !== undefined && (!Number.isFinite(endTime) || endTime < initial.time || endTime > initial.time + MAX_FLIGHT_PLAN_SECONDS)) return 'failed';
  let state = initial, body = initialBody, transitions = 0;
  const frameId = initialBody.id, orbits = context.services.orbits;
  const initialOrbit = orbits.elements(initial, body.mu);
  // Two starting periods for encounters, at least an hour, at most a Julian year.
  // A verified unobstructed single-body orbit below closes at its full period instead.
  const duration = Math.min(TRAJECTORY_MAX_SECONDS, Math.max(3600, 2 * (initialOrbit.period ?? 1800)));
  const until = endTime ?? initial.time + duration;
  const initialTop = surfaces.get(body.id)?.bounds.maxRadius ?? body.radius;
  const singlePeriod = endTime === undefined && initialOrbit.period !== null && initialOrbit.periapsis > initialTop + .01
    ? initial.time + initialOrbit.period : undefined;
  const firstCoast = context.capabilities.rails ? context.keplerCoast(initial, body, surfaces.get(body.id)) : undefined;
  if (firstCoast && singlePeriod !== undefined
    && context.services.rails.horizon(system, body, initial, firstCoast, initial.time, initialTop) >= singlePeriod - initial.time) {
    return yield* context.predict(initial, coarse, initialBody, surfaces.get(body.id));
  }
  let numericalSteps = 0;
  yield frameSample(ghostSample(state, body), body.id, frameId, system);
  for (let count = 1; count < TRAJECTORY_MAX_SAMPLES; count++) {
    if (state.time >= until) return 'horizon';
    const surface = surfaces.get(body.id), top = surface?.bounds.maxRadius ?? body.radius;
    const coast = context.capabilities.rails ? context.keplerCoast(state, body, surface) : undefined;
    let horizon = 0;
    if (coast) {
      const value = context.services.rails.horizon(system, body, state, coast, state.time, top);
      if (value >= 0) horizon = value;
    }
    let dt = Math.min(STEP, until - state.time);
    if (coast && horizon > dt && (horizon > STEP * 2 || dt < STEP)) {
      const r = dm.hypot(state.position.x, state.position.y), speed = dm.hypot(state.velocity.x, state.velocity.y);
      const fall = body.mu / (2 * r * r), reach = r * (coarse ? .25 : .125);
      // Stay at least a tick short of the conservative event bound. Check that tick
      // normally, including moving moons. No root-finding on unchecked chords.
      const limit = Math.min(horizon - STEP, until - state.time, transitions === 0 && singlePeriod !== undefined ? singlePeriod - state.time : Infinity);
      while (dt * 2 <= limit && speed * dt * 2 + fall * (dt * 2) ** 2 <= reach) dt *= 2;
      if (endTime !== undefined && until - state.time < STEP * 2 && horizon >= until - state.time) dt = until - state.time;
      const result = context.coastAt(coast, state.time + dt, body, surface, { cache: false });
      if (!result.ok) return 'failed';
      // Keep the hot sample record's shape stable. Repeated spreads of evolving
      // numerical/coast states make every following orbital read polymorphic.
      const next: { -readonly [K in keyof State]: State[K] } = {
        time: state.time + dt, position: result.state.position, velocity: result.state.velocity,
        heading: state.heading, throttle: state.throttle, status: state.status,
        revision: state.revision, coast, dynamics: 'kepler',
      };
      if (state.godMode !== undefined) next.godMode = state.godMode;
      if (state.solver !== undefined) next.solver = state.solver;
      if (state.moduleState !== undefined) next.moduleState = state.moduleState;
      if (state.contact !== undefined) next.contact = state.contact;
      if (state.water !== undefined) next.water = state.water;
      if (state.waterEntry !== undefined) next.waterEntry = state.waterEntry;
      state = next;
    } else {
      const previous = state;
      state = context.advance(state, IDLE, dt, body, surface);
      if (!surface && state.status !== 'flying') {
        // Legacy circle motion stores resting velocity, without a terrain contact
        // record. Reconstruct its VERIFIED KDK drift event for display only.
        const p = previous.position, v = previous.velocity, r = dm.hypot(p.x, p.y), g = -body.mu / (r*r*r);
        const drift = { x: p.x + (v.x + p.x*g*dt/2)*dt, y: p.y + (v.y + p.y*g*dt/2)*dt };
        const fraction = contactFraction(p, drift, body.radius);
        if (fraction !== undefined) {
          const x = p.x + (drift.x-p.x)*fraction, y = p.y + (drift.y-p.y)*fraction, length = dm.hypot(x,y);
          const position = { x: x*body.radius/length, y: y*body.radius/length }, half = dt*fraction/2;
          const at = -body.mu/(body.radius*body.radius*body.radius);
          yield frameSample({time:previous.time+dt*fraction,position,
            velocity:{x:v.x+(p.x*g+position.x*at)*half,y:v.y+(p.y*g+position.y*at)*half},linear:true},body.id,frameId,system);
          return 'impact';
        }
        yield frameSample(ghostSample(state,body),body.id,frameId,system);return 'impact';
      }
      if (++numericalSteps >= 8192) {
        yield frameSample(ghostSample(state, body), body.id, frameId, system);
        return state.contact ? 'impact' : 'open';
      }
    }
    if (state.waterEntry) yield frameSample(state.waterEntry, body.id, frameId, system);
    if (state.contact || state.status !== 'flying') {
      yield frameSample(ghostSample(state, body), body.id, frameId, system);
      return state.contact ? 'impact' : state.water === 'floating' ? 'floating' : 'grounded';
    }
    const before = body.id, soi = system.checkSOI(state, body.id, state.time);
    if (soi.switched) {
      body = soi.newBody; state = soi.newState;
      transitions++;
    }
    yield frameSample({ time: state.time, position: state.position, velocity: state.velocity,
      ...(dt === STEP ? { linear: true } : {}) }, body.id, frameId, system,
      soi.switched ? { from: before, to: body.id } : undefined);
    if (transitions === 0 && singlePeriod !== undefined && state.time >= singlePeriod) return 'closed';
    if (transitions >= TRAJECTORY_MAX_TRANSITIONS) return 'open';
    if (state.time >= until) return 'horizon';
  }
  return 'open';
}
