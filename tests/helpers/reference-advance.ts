// Frozen copy of the original sim-core motion logic (commit 3afcd8f), kept as a differential
// oracle: optimized code paths must reproduce its results bit for bit. Its library calls use
// the deterministic math the core switched to (dmath), so it checks logic, not libm.
import * as dm from '../../packages/sim-core/src/dmath';
import { elements, propagate, timeToRadius, type Propagation, type SolverDiagnostics } from '../../packages/sim-core/src/orbit';
import { querySurface, surfaceIdentity, type SurfaceDefinition, type SurfaceProfile } from '../../packages/sim-core/src/surface';
import { surfaceContactTolerance, sweepGroundSurface, sweepSurface, type SurfaceSweepDiagnostics } from '../../packages/sim-core/src/surface-contact';
import { safeSurfaceLanding, surfaceSupport, SurfaceContactError, validateMotionSurface } from '../../packages/sim-core/src/surface-flight';
import { dampedKick, WATER_CRASH_SPEED, waterFloatRadius, waterForces } from '../../packages/sim-core/src/water';

export interface Vec { readonly x: number; readonly y: number }
export interface Body {
  readonly id: string;
  readonly radius: number;
  readonly mu: number;
  readonly surface?: SurfaceDefinition;
}
export interface State {
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
export const COAST_CACHE_CAPACITY = 8192;
interface CoastCache { readonly samples: Map<number, Propagation>; hits: number; misses: number }
const COAST_CACHE = new WeakMap<Coast, CoastCache>();
export function coastCacheStats(coast: Coast | undefined): { samples: number; hits: number; misses: number; capacity: number } {
  const cache = coast && COAST_CACHE.get(coast);
  return { samples: cache?.samples.size ?? 0, hits: cache?.hits ?? 0, misses: cache?.misses ?? 0, capacity: COAST_CACHE_CAPACITY };
}
export interface Controls { readonly turn: number; readonly throttle: number; readonly engine: boolean }
export type Preset = 'pad' | 'planet-orbit' | 'moon-orbit';
export const STEP = 0.01;
export const MODEL = 'm2-two-body-kepler-kdk-v1';
const DEFAULT_PLANET: Body = Object.freeze({ id: 'planet', radius: 512, mu: 13107200 });
const DEFAULT_MOON: Body = Object.freeze({ id: 'moon', radius: 128, mu: 204800 });
export const planet: Body = DEFAULT_PLANET;
export let vehicle = {
  acceleration: 125,
  turnRate: 1.227184630308513,
};
export function setVehicle(defaults: Partial<{ acceleration: number; turnRate: number }>): void {
  vehicle = {
    acceleration: defaults.acceleration ?? 125,
    turnRate: defaults.turnRate ?? 1.227184630308513,
  };
}
export const IDLE: Controls = Object.freeze({ turn: 0, throttle: 0, engine: false });
export const magnitude = (v: Vec): number => dm.hypot(v.x, v.y);
export const normalizeAngle = dm.normalizeAngle;
export const legacyHeading = (byte: number): number => Math.PI / 2 - 2 * Math.PI * byte / 256;

export function initialState(preset: Preset | string = 'pad'): State {
  if (preset === 'moon-orbit') {
    return {
      time: 0, position: { x: 0, y: 256 },
      velocity: { x: Math.sqrt(DEFAULT_MOON.mu / 256), y: 0 },
      heading: 0,
      throttle: 0.5,
      status: 'flying', revision: 0,
    };
  }
  if (preset === 'planet-orbit') {
    return {
      time: 0, position: { x: 0, y: 640 },
      velocity: { x: Math.sqrt(DEFAULT_PLANET.mu / 640), y: 0 },
      heading: 0,
      throttle: 0.5,
      status: 'flying', revision: 0,
    };
  }
  return {
    time: 0, position: { x: 0, y: DEFAULT_PLANET.radius },
    velocity: { x: 0, y: 0 },
    heading: Math.PI / 2,
    throttle: 0.5,
    status: 'landed', revision: 0,
  };
}

export function setGodMode(state: State, enabled: boolean): State {
  return { ...state, godMode: enabled, revision: state.revision + 1,
    status: enabled && state.status === 'crashed' ? state.water ? 'flying' : 'landed' : state.status,
    water: enabled && state.status === 'crashed' && state.water ? 'submerged' : state.water };
}

function gravity(p: Vec, body: Body): Vec {
  const r = magnitude(p);
  const scale = -body.mu / (r * r * r);
  return { x: p.x * scale, y: p.y * scale };
}

/** First intersection of the drift chord with the surface, including an interior fly-through. */
function contactFraction(p: Vec, end: Vec, radius: number): number | undefined {
  const dx = end.x - p.x, dy = end.y - p.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (p.x * dx + p.y * dy);
  const c = p.x * p.x + p.y * p.y - radius * radius;
  if (c <= 1e-8 && b < 0) return 0;
  if (a === 0) return undefined;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : undefined;
}

/** Full-step KDK velocity. Controls apply at the start of this bounded step.
 * Supplying an explicit surface opts into shared terrain motion. */
export function step(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
  validateStep(state, controls, dt, body, surface);
  // This separately retained numerical integrator must never carry a stale coast epoch.
  const { coast: _coast, solver: _solver, contact: _contact, waterEntry: _entry, ...numerical } = state;
  state = { ...numerical, dynamics: 'numerical' };
  return numericalStep(state, controls, dt, body, surface);
}

function validateStep(state: State, controls: Controls, dt: number, body: Body, surface?: SurfaceProfile): void {
  if (!(dt > 0 && dt <= STEP) || !Number.isFinite(dt)) throw new Error('Step must be in (0, 0.01] seconds');
  if (!(body.mu > 0 && body.radius > 0) || !Number.isFinite(body.mu + body.radius)) throw new Error('Invalid body');
  if (![state.time, state.position.x, state.position.y, state.velocity.x, state.velocity.y,
    state.heading, state.throttle, controls.turn, controls.throttle].every(Number.isFinite)) throw new Error('Invalid state or controls');
  if (!['landed', 'flying', 'crashed'].includes(state.status)) throw new Error('Invalid flight status');
  if (surface) validateMotionSurface(body, surface);
  if (state.water !== undefined && (!surface?.seaRadiusMetres || !['submerged', 'floating'].includes(state.water))) {
    throw new Error('Invalid water state: requires an ocean surface');
  }
  const radius = magnitude(state.position);
  const ground = surface ? querySurface(surface, dm.atan2(state.position.y, state.position.x)).groundRadius : body.radius;
  const tolerance = surface ? surfaceContactTolerance(surface) : 1e-7;
  if (state.water && (radius > surface!.seaRadiusMetres! + tolerance
    || (state.water === 'submerged') !== (state.status === 'flying'))) {
    throw new Error('Invalid water state: medium, support and position disagree');
  }
  if (radius < ground - tolerance) throw new Error('Invalid state: inside ground');
  const supportRadius = surface && state.water === 'floating'
    ? state.status === 'crashed' ? surface.seaRadiusMetres ?? ground : waterFloatRadius(surface, dm.atan2(state.position.y, state.position.x)) : ground;
  if (surface && state.status !== 'flying' && (Math.abs(radius - supportRadius) > tolerance || magnitude(state.velocity) !== 0)) {
    throw new Error('Invalid terrain support state: must rest on ground with zero velocity');
  }
}

function numericalStep(state: State, controls: Controls, dt: number, body: Body, surface?: SurfaceProfile): State {
  if (state.status === 'crashed') return { ...state, time: state.time + dt };
  const turn = Math.max(-1, Math.min(1, controls.turn)) * vehicle.turnRate;
  const heading = normalizeAngle(state.heading + turn * dt);
  const throttle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * 0.78125));
  const midThrottle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * .78125 / 2));
  const thrust = controls.engine ? midThrottle * vehicle.acceleration : 0;
  const midHeading = state.heading + turn * dt / 2;
  const engine = { x: dm.cos(midHeading) * thrust, y: dm.sin(midHeading) * thrust };
  const g0 = gravity(state.position, body);
  const radius = magnitude(state.position);
  const sea = surface?.seaRadiusMetres;
  const inWater = sea !== undefined && (radius < sea || state.water !== undefined);
  const f0 = surface && inWater ? waterForces(surface, state.position) : { gravityFactor: 1, drag: 0 };
  const radialAcceleration = (engine.x * state.position.x + engine.y * state.position.y) / radius;
  const next = { ...state, heading, throttle, time: state.time + dt, revision: state.revision + 1 };
  if (state.status === 'landed') {
    // A point vessel resting on a very shallow seabed can already lie inside
    // the floating support tolerance. Settle before buoyancy can kick it out
    // across a basin narrower than one normal 10-ms drift.
    if (surface && inWater && thrust === 0) {
      const angle = dm.atan2(state.position.y, state.position.x), equilibrium = waterFloatRadius(surface, angle);
      if (querySurface(surface, angle).waterDepth > 0 && Math.abs(radius - equilibrium) < 1e-4) {
        return { ...next, position: { x: equilibrium * dm.cos(angle), y: equilibrium * dm.sin(angle) }, water: 'floating' };
      }
    }
    if (state.water === 'floating') {
      if (thrust === 0) return next;
    } else if (surface) {
      const support = surfaceSupport(surface, dm.atan2(state.position.y, state.position.x));
      // Static friction holds tangent forces. Liftoff requires positive net
      // acceleration out of every incident support face; sweep checks recontact.
      if (!support.normals.every(n => (engine.x + g0.x * f0.gravityFactor) * n.x + (engine.y + g0.y * f0.gravityFactor) * n.y > 0)) return next;
    } else if (radialAcceleration <= body.mu / (radius * radius)) return next;
  }
  const halfV = {
    x: dampedKick(state.velocity.x, g0.x * f0.gravityFactor + engine.x, f0.drag, dt / 2),
    y: dampedKick(state.velocity.y, g0.y * f0.gravityFactor + engine.y, f0.drag, dt / 2),
  };
  const position = { x: state.position.x + halfV.x * dt, y: state.position.y + halfV.y * dt };
  const sweep = surface ? (inWater ? sweepGroundSurface : sweepSurface)(surface, state.position, position) : undefined;
  if (sweep?.status === 'failed') throw new SurfaceContactError(sweep);
  const terrainHit = sweep?.status === 'hit' ? sweep : undefined;
  const hit = surface ? terrainHit?.fraction : contactFraction(state.position, position, body.radius);
  if (hit !== undefined) {
    const point = {
      x: state.position.x + (position.x - state.position.x) * hit,
      y: state.position.y + (position.y - state.position.y) * hit,
    };
    const r = magnitude(point);
    const waterHit = terrainHit?.surface.material === 'water' && !inWater;
    const groundRadius = (waterHit ? terrainHit.surface.firstContactRadius : terrainHit?.surface.groundRadius) ?? body.radius;
    const contact = { x: point.x * groundRadius / r, y: point.y * groundRadius / r };
    const gHit = gravity(contact, body);
    const fHit = surface && inWater ? waterForces(surface, contact) : { gravityFactor: 1, drag: 0 };
    const impactV = {
      x: dampedKick(dampedKick(state.velocity.x, g0.x * f0.gravityFactor + engine.x, f0.drag, dt * hit / 2),
        gHit.x * fHit.gravityFactor + engine.x, fHit.drag, dt * hit / 2),
      y: dampedKick(dampedKick(state.velocity.y, g0.y * f0.gravityFactor + engine.y, f0.drag, dt * hit / 2),
        gHit.y * fHit.gravityFactor + engine.y, fHit.drag, dt * hit / 2),
    };
    const angle = dm.atan2(point.y, point.x);
    if (waterHit && (state.godMode || Math.max(0, -(impactV.x * dm.cos(angle) + impactV.y * dm.sin(angle))) <= WATER_CRASH_SPEED)) {
      // Enter once, then sweep only seabed. Retain the fractional sea vertex so
      // the predictor draws the same two drifts as live motion.
      const entry: GhostSample = { time: state.time + dt * hit, position: contact, velocity: impactV, linear: true };
      const entered: State = { ...next, time: entry.time, heading: normalizeAngle(state.heading + turn * dt * hit),
        throttle: Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * hit * .78125)),
        position: contact, velocity: impactV, status: 'flying', water: 'submerged' };
      const remainder = dt * (1 - hit);
      const result = remainder > 0 ? numericalStep(entered, controls, remainder, body, surface) : entered;
      return { ...result, time: next.time, revision: next.revision, waterEntry: entry,
        ...(result.contact ? { contact: { ...result.contact, fraction: (result.contact.time - state.time) / dt } } : {}) };
    }
    const safe = surface ? safeSurfaceLanding(surfaceSupport(surface, angle),
      state.heading + turn * dt * hit, magnitude(impactV))
      : magnitude(impactV) <= 5 && Math.abs(normalizeAngle(heading - angle)) <= Math.PI / 9;
    return { ...next, position: contact, velocity: { x: 0, y: 0 },
      status: state.godMode || (!waterHit && safe) ? 'landed' : 'crashed',
      water: waterHit ? 'floating' : undefined,
      ...(terrainHit ? { contact: { time: state.time + dt * hit, fraction: hit,
        material: waterHit ? 'water' : 'rock',
        surfaceIdentity: terrainHit.surfaceIdentity, impactVelocity: impactV, diagnostics: terrainHit.diagnostics } } : {}) };
  }
  const g1 = gravity(position, body);
  const f1 = surface && sea !== undefined ? waterForces(surface, position) : { gravityFactor: 1, drag: 0 };
  const velocity = {
    x: dampedKick(halfV.x, g1.x * f1.gravityFactor + engine.x, f1.drag, dt / 2),
    y: dampedKick(halfV.y, g1.y * f1.gravityFactor + engine.y, f1.drag, dt / 2),
  };
  const wet = sea !== undefined && magnitude(position) <= sea;
  if (surface && wet && thrust === 0) {
    const angle = dm.atan2(position.y, position.x), equilibrium = waterFloatRadius(surface, angle);
    if (querySurface(surface, angle).waterDepth > 0 && Math.abs(magnitude(position) - equilibrium) < 1e-4 && magnitude(velocity) < .01) {
      return { ...next, position: { x: equilibrium * dm.cos(angle), y: equilibrium * dm.sin(angle) },
        velocity: { x: 0, y: 0 }, status: 'landed', water: 'floating' };
    }
  }
  return { ...next, position, velocity, status: 'flying', water: wet ? 'submerged' : undefined };
}

/** Controls apply at this exact simulation epoch; the returned velocity is synchronized.
 * Safe unpowered orbits evaluate from one immutable epoch. Surface-crossing/radial
 * motion stays on bounded numerical dynamics until the M3 event system exists. */
export function advance(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
  validateStep(state, controls, dt, body, surface);
  if (state.status !== 'flying' || (controls.engine && (state.throttle > 0 || controls.throttle > 0))) {
    return step(state, controls, dt, body, surface);
  }
  const identity = surfaceIdentity(body);
  const top = surface?.bounds.maxRadius ?? body.radius;
  // Model v2 (intentional change): impact arcs coast while no step can reach the ground.
  const clear = (s: State): boolean => magnitude(s.position) - top > 2 * magnitude(s.velocity) * dt + 1;
  let coast = state.coast?.bodyId === body.id && state.coast.mu === body.mu
    && state.coast.surfaceRadius === body.radius && state.coast.surfaceIdentity === identity
    && state.coast.contactSurfaceIdentity === surface?.identity ? state.coast : undefined;
  if (coast && elements(coast, body.mu).periapsis <= top + .01 && !clear(state)) return step(state, controls, dt, body, surface);
  if (!coast) {
    const orbit = elements(state, body.mu);
    if (orbit.radial || (orbit.periapsis <= top + .01 && !clear(state))) return step(state, controls, dt, body, surface);
    coast = Object.freeze({ bodyId: body.id, epochSeconds: state.time,
      position: Object.freeze({ ...state.position }), velocity: Object.freeze({ ...state.velocity }),
      mu: body.mu, revision: state.revision, surfaceRadius: body.radius, surfaceIdentity: identity,
      ...(surface ? { contactSurfaceIdentity: surface.identity } : {}) });
  }
  const time = state.time + dt;
  const result = coastAt(coast, time, body, surface);
  if (!result.ok) return { ...step(state, controls, dt, body, surface), solver: result.diagnostics };
  return { ...state, ...result.state, time, coast, contact: undefined, waterEntry: undefined, water: undefined,
    dynamics: 'kepler', solver: result.diagnostics,
    heading: normalizeAngle(state.heading + Math.max(-1, Math.min(1, controls.turn)) * vehicle.turnRate * dt),
    throttle: Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * .78125)), revision: state.revision + 1 };
}

/** Resolve an epoch record in a known frame; raw kernel propagation has no frame registry. */
export function coastAt(coast: Coast, time: number, body = planet, surface?: SurfaceProfile): Propagation {
  if (surface) validateMotionSurface(body, surface);
  if (coast.bodyId !== body.id || coast.mu !== body.mu || coast.surfaceRadius !== body.radius
    || coast.surfaceIdentity !== surfaceIdentity(body) || coast.contactSurfaceIdentity !== surface?.identity
    || !Number.isFinite(coast.epochSeconds)
    || !Number.isFinite(time) || !Number.isSafeInteger(coast.revision) || coast.revision < 0
    || !(body.radius > 0) || !Number.isFinite(body.radius)
    || magnitude(coast.position) < (surface?.bounds.maxRadius ?? body.radius)) {
    return { ok: false, diagnostics: { converged: false, iterations: 0, bracketIterations: 0,
      residualSeconds: null, usedBisection: false, reason: 'Invalid coast epoch, surface state or body frame' } };
  }
  // Model v2: radial records are rejected; an arc reaching the ground is valid only between
  // its crossings of the highest ground, and only above it.
  try { if (elements(coast, body.mu).radial) throw new Error('Radial coast'); } catch {
    return { ok: false, diagnostics: { converged: false, iterations: 0, bracketIterations: 0,
      residualSeconds: null, usedBisection: false, reason: 'Coast is radial or invalid' } };
  }
  const top = surface?.bounds.maxRadius ?? body.radius;
  let after = Infinity, before = Infinity;
  try {
    const orbit = elements(coast, body.mu);
    if (orbit.periapsis <= top + .01) {
      // No crossing that way (an escaping arc, or a periapsis just clear of the ground) is
      // unbounded; near-circular event angles are undefined.
      const never = orbit.eccentricity >= 1e-8 ? Infinity : 0;
      after = timeToRadius(coast, coast.mu, top, 'inbound') ?? never;
      before = timeToRadius({ position: coast.position, velocity: { x: -coast.velocity.x, y: -coast.velocity.y } }, coast.mu, top, 'inbound') ?? never;
    }
  } catch { after = before = 0; }
  const elapsed = time - coast.epochSeconds;
  if (elapsed > after || -elapsed > before) {
    return { ok: false, diagnostics: { converged: false, iterations: 0, bracketIterations: 0,
      residualSeconds: null, usedBisection: false, reason: 'Coast reaches the ground before this time' } };
  }
  const above = (r: Propagation): Propagation => !r.ok || magnitude(r.state.position) >= top ? r
    : { ok: false, diagnostics: { ...r.diagnostics, converged: false, reason: 'Coast reached the ground envelope' } };
  const immutable = Object.isFrozen(coast) && Object.isFrozen(coast.position) && Object.isFrozen(coast.velocity);
  if (!immutable) return above(propagate(coast, coast.mu, time - coast.epochSeconds));
  let cache = COAST_CACHE.get(coast);
  if (!cache) { cache = { samples: new Map(), hits: 0, misses: 0 }; COAST_CACHE.set(coast, cache); }
  const cached = cache.samples.get(time);
  if (cached) { cache.hits++; return cached; }
  cache.misses++;
  const result = above(propagate(coast, coast.mu, time - coast.epochSeconds));
  if (!result.ok) return result;
  const stored: Propagation = Object.freeze({ ...result, diagnostics: Object.freeze(result.diagnostics),
    state: Object.freeze({ position: Object.freeze({ ...result.state.position }), velocity: Object.freeze({ ...result.state.velocity }) }) });
  if (cache.samples.size >= COAST_CACHE_CAPACITY) cache.samples.delete(cache.samples.keys().next().value!);
  cache.samples.set(time, stored);
  return stored;
}

export interface Sample { readonly time: number; readonly position: Vec }
/** Exact 10-ms reference iterator, retained for verification; the live preview uses `ghost`.
 * Bounded: the caller decides how much prediction work to do per frame. */
export function* predict(start: State, horizon = 60): Generator<Sample> {
  let state = start;
  yield { time: state.time, position: state.position };
  const count = Math.min(6000, Math.max(0, Math.floor(horizon / STEP)));
  for (let i = 0; i < count && state.status === 'flying'; i++) {
    state = advance(state);
    // Yield every step so callers can enforce a work budget; renderer may decimate.
    yield { time: state.time, position: state.position };
  }
}

export interface GhostSample extends Sample {
  readonly velocity: Vec;
  /** Segment ending here is a verified numerical drift, not a conic/Hermite arc. */
  readonly linear?: boolean;
  readonly contactMaterial?: 'water';
}
/** Why a ghost pass ended. */
export type GhostEnd = 'closed' | 'impact' | 'escape' | 'open' | 'grounded' | 'floating' | 'failed';
export const GHOST_MAX_SAMPLES = 256;
/** Near terrain, at most 81.92 s of shared 10-ms motion per pass. */
export const GHOST_TERRAIN_MAX_STEPS = 8192;
/** Longest ghost step is STEP * 2^15 (about 5.5 minutes). */
export const GHOST_MAX_K = 15;
/** A pass beyond this many surface radii is reported as escaping the planet. */
export const GHOST_ESCAPE_RADII = 32;

/** Quantized "if you coast now" ghost. Sample times are quantized to STEP * 2^k, the
 * largest step that moves at most 1/8 of the radius (1/4 when `coarse`, used during
 * burns), so every orbit costs about the same number of samples at any altitude.
 * Each sample is an exact two-body state solved from one frozen epoch, so the
 * quantization never accumulates error. A pass ends after one revolution, at
 * surface contact, beyond the escape radius or at the sample cap. Near terrain,
 * shared live steps replace the conic path; each yield verifies one 10-ms step.
 * Display-only: the live flight never reads these samples. */
export function* ghost(start: State, coarse = false, body = planet, surface?: SurfaceProfile): Generator<GhostSample, GhostEnd> {
  if (start.status !== 'flying') return 'grounded';
  if (surface) {
    try {
      validateStep(start, IDLE, STEP, body, surface);
      const orbit = elements(start, body.mu);
      if (orbit.radial || orbit.periapsis <= surface.bounds.maxRadius + .01) {
        return yield* terrainGhost(start, body, surface);
      }
    } catch { return 'failed'; }
  }
  const epoch = Object.freeze({
    position: Object.isFrozen(start.position) ? start.position : Object.freeze({ ...start.position }),
    velocity: Object.isFrozen(start.velocity) ? start.velocity : Object.freeze({ ...start.velocity }),
  });
  const escape = body.radius * GHOST_ESCAPE_RADII;
  let impact: number | null = null, period: number | null = null;
  try {
    const orbit = elements(epoch, body.mu);
    const descending = epoch.position.x * epoch.velocity.x + epoch.position.y * epoch.velocity.y < 0;
    // Already at the surface and descending: contact is now, not one revolution later.
    if (!surface && descending && magnitude(epoch.position) <= body.radius) impact = 0;
    else if (!surface && orbit.periapsis < body.radius) impact = timeToRadius(epoch, body.mu, body.radius, 'inbound');
    if (impact === null && orbit.apoapsis !== null && orbit.apoapsis < escape) period = orbit.period;
  } catch { return 'failed'; }
  const end = impact ?? period ?? Infinity;
  yield { time: start.time, position: epoch.position, velocity: epoch.velocity };
  const reach = coarse ? 1 / 4 : 1 / 8;
  let elapsed = 0, position: Vec = epoch.position, velocity: Vec = epoch.velocity;
  for (let n = 1; n < GHOST_MAX_SAMPLES; n++) {
    // Bound the drift plus gravity's fall, so slow apoapsis arcs still take bounded steps.
    const r = magnitude(position), speed = magnitude(velocity), fall = body.mu / (2 * r * r);
    const budget = r * reach;
    let dt = STEP;
    for (let k = 0; k < GHOST_MAX_K; k++) {
      const nextDt = dt * 2;
      if (speed * nextDt + fall * nextDt * nextDt > budget) break;
      dt = nextDt;
    }
    const last = elapsed + dt >= end;
    elapsed = last ? end : elapsed + dt;
    const result = propagate(epoch, body.mu, elapsed);
    if (!result.ok) return 'failed';
    ({ position, velocity } = result.state);
    yield { time: start.time + elapsed, position, velocity };
    if (last) return impact !== null ? 'impact' : 'closed';
    if (magnitude(position) > escape) return 'escape';
  }
  return 'open';
}

/** Every yield performs at most one live motion step. No unverified conic chords,
 * enlarged numerical dt, or coarse-mode collision shortcuts near terrain. */
function* terrainGhost(start: State, body: Body, surface: SurfaceProfile): Generator<GhostSample, GhostEnd> {
  let state = start;
  yield { time: state.time, position: state.position, velocity: state.velocity, linear: true };
  for (let i = 0; i < GHOST_TERRAIN_MAX_STEPS; i++) {
    state = advance(state, IDLE, STEP, body, surface);
    if (state.waterEntry) yield state.waterEntry;
    yield { time: state.contact?.time ?? state.time, position: state.position,
      velocity: state.contact?.impactVelocity ?? state.velocity, linear: state.dynamics === 'numerical',
      ...(state.contact?.material === 'water' ? { contactMaterial: 'water' as const } : {}) };
    if (state.contact) return 'impact';
    if (state.status === 'landed') return state.water === 'floating' ? 'floating' : 'grounded';
    if (magnitude(state.position) > body.radius * GHOST_ESCAPE_RADII) return 'escape';
  }
  return 'open';
}

/** Fixed-step scheduler; stalled frames drop excess wall time and report it. */
export class Clock {
  private accumulator = 0;
  droppedSeconds = 0;
  lastSteps = 0;
  reset(): void { this.accumulator = 0; this.lastSteps = 0; }
  /** Elapsed fraction of the next step, for presentation interpolation only. */
  get alpha(): number { return Math.max(0, Math.min(1, this.accumulator / STEP)); }
  advance(seconds: number, tick: () => void): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
    const accepted = Math.min(seconds, 0.2);
    this.droppedSeconds += seconds - accepted;
    this.accumulator += accepted;
    this.lastSteps = 0;
    while (this.accumulator + 1e-12 >= STEP && this.lastSteps < 20) {
      tick();
      this.accumulator -= STEP;
      this.lastSteps++;
    }
  }
}
