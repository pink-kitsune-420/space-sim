/** Host-only single-ship KDK/Kepler simulation context (`packages/sim-core`). Modules create and use simulation contexts through `@space-sim/game-api` `CORE_MOTION` (`CoreMotion.createContext`), `MOTION_CONTEXTS` (`SimulationContextFactory`), and `WorldRead.context` / `WorldRead.contextFor`.
 * Operates on fixed `0.01` s (`STEP`) boundaries with IEEE-754 float64 deterministic math (`dmath`), SI units (`position` in `m`, `velocity` in `m/s`, `acceleration` in `m/s²`, `heading` in `rad`, `turnRate` in `rad/s`, `mu` in `m³/s²`, `time` in `s`), and zero-allocation inner loops. */
import type { Body, Coast, Controls, GhostEnd, GhostSample, MotionContextOptions, MotionStep, Preset, SimulationContext, State, Vec, VehicleDefaults } from '../../game-api/src/index';
import { captureMotionOptions, ForceTransaction, motionCopy, runDynamics } from '../../game-runtime/src/motion';
import { IDLE, MODEL, STEP, contactMargin } from './constants';
import type { Propagation } from './orbit';
import { BUILTIN_SERVICES } from './services';
import type { SurfaceProfile } from './surface';
import { surfaceContactTolerance } from './surface-contact';
import { safeSurfaceLanding, SurfaceContactError } from './surface-flight';
import { dampedKick, WATER_CRASH_SPEED, waterFloatRadius, waterForces } from './water';
import * as dm from './dmath';
import { bodyFixed, groundVelocity, inertialState, rotate, spinAngle, spinRate } from './spin';

/** Maximum number of cached timestamp evaluations (`8,192`) retained per frozen `Coast` epoch inside one `SimulationContext`. Host-only (`packages/sim-core`). */
export const COAST_CACHE_CAPACITY = 8192;
/** Timestamp results kept across every coast together (`32,768`; each is a few hundred bytes).
 * Without a shared bound, every coasting ship of a large fleet fills its own 8,192 entries
 * within 82 s: about 3 MB per ship. Host-only (`packages/sim-core`). */
export const COAST_CACHE_BUDGET = 32_768;

/** Maximum number of quantized conic samples (`256`) yielded by a single-body `ghost` trajectory prediction pass. Host-only (`packages/sim-core`). */
export const GHOST_MAX_SAMPLES = 256;
/** Near terrain, at most 81.92 s (`8,192` steps) of shared 10-ms motion per pass. Host-only (`packages/sim-core`). */
export const GHOST_TERRAIN_MAX_STEPS = 8192;
/** Quantized steps (`STEP * 2^k`, `k <= 50`) span astronomical orbits; geometric error, not a fixed dt, limits sampling. Host-only (`packages/sim-core`). */
export const GHOST_MAX_K = 50;
/** A pass beyond this many surface radii (`32`) is reported as escaping the planet. Host-only (`packages/sim-core`). */
export const GHOST_ESCAPE_RADII = 32;

const DEFAULT_PLANET: Body = Object.freeze({ id: 'planet', radius: 512, mu: 13107200 });
const DEFAULT_MOON: Body = Object.freeze({ id: 'moon', radius: 128, mu: 204800 });
const MOTION_STATE_FIELDS = new Set(['time', 'position', 'velocity', 'heading', 'throttle', 'status', 'revision',
  'godMode', 'coast', 'dynamics', 'solver', 'contact', 'water', 'waterEntry', 'moduleState']);
/** Default headless reference planet (`id: 'planet'`, `radius: 512` `m`, `mu: 13,107,200` `m³/s²`). Host-only (`packages/sim-core`). */
export const planet: Body = DEFAULT_PLANET;
/** Frozen default vehicle handling parameters (`acceleration: 125` `m/s²`, `turnRate: 25π/64 ≈ 1.2272` `rad/s`, `initialThrottle: 0.5`). Host-only (`packages/sim-core`). */
export const DEFAULT_VEHICLE: Readonly<VehicleDefaults> = Object.freeze({
  acceleration: 125,
  turnRate: 1.227184630308513,
  initialThrottle: 0.5,
});
/** Euclidean 2D vector norm $\sqrt{x^2 + y^2}$ using deterministic IEEE-754 float64 `dmath.hypot` (preserves input SI unit: `m`, `m/s`, or `m/s²`). Exposed to modules via `CORE_MOTION.magnitude`. Host-only (`packages/sim-core`). */
export const magnitude = (v: Vec): number => dm.hypot(v.x, v.y);
/** Wrap an angle in `rad` into $(-\pi, \pi]$ exactly (see `dmath`); an angle already in range is unchanged. Exposed to modules via `CORE_MOTION.normalizeAngle` and `deterministicMath.normalizeAngle`. Host-only (`packages/sim-core`). */
export const normalizeAngle = dm.normalizeAngle;
/** Converts a legacy 8-bit compass heading byte (`0..255`, clockwise from north) into a standard counter-clockwise angle in `rad` from $+x$. Host-only (`packages/sim-core`). */
export const legacyHeading = (byte: number): number => Math.PI / 2 - 2 * Math.PI * byte / 256;

/** Returns a fresh `State` at `time = 0` `s` for a built-in headless `preset` (`'pad'`, `'planet-orbit'`, or `'moon-orbit'`) in SI units (`position` in `m`, `velocity` in `m/s`, `heading` in `rad`). Host-only (`packages/sim-core`). */
export function initialState(preset: Preset | string = 'pad'): State {
  if (preset === 'moon-orbit') {
    return {
      time: 0, position: { x: 0, y: 256 },
      velocity: { x: Math.sqrt(DEFAULT_MOON.mu / 256), y: 0 },
      heading: 0,
      throttle: DEFAULT_VEHICLE.initialThrottle,
      status: 'flying', revision: 0,
    };
  }
  if (preset === 'planet-orbit') {
    return {
      time: 0, position: { x: 0, y: 640 },
      velocity: { x: Math.sqrt(DEFAULT_PLANET.mu / 640), y: 0 },
      heading: 0,
      throttle: DEFAULT_VEHICLE.initialThrottle,
      status: 'flying', revision: 0,
    };
  }
  return {
    time: 0, position: { x: 0, y: DEFAULT_PLANET.radius },
    velocity: { x: 0, y: 0 },
    heading: Math.PI / 2,
    throttle: DEFAULT_VEHICLE.initialThrottle,
    status: 'landed', revision: 0,
  };
}

/** Returns a new `State` with `godMode` set to `enabled` and `revision` incremented by `1`, recovering a `'crashed'` state when enabled: to `'landed'` on ground, or to `'flying'` with `water: 'submerged'` in water. Host-only (`packages/sim-core`; worlds expose `WorldControl.setGodMode`). */
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

/** First intersection fraction (`[0, 1]`) of the straight drift chord from `p` to `end` (in `m`) with a circular surface of `radius` (`m`), including an interior fly-through. Host-only (`packages/sim-core`). */
export function contactFraction(p: Vec, end: Vec, radius: number): number | undefined {
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

/** The prediction sample for a state after one step, in the primary-body-centred inertial frame (`time` in `s`, `position` in `m`, `velocity` in `m/s`): a contact is drawn
 * where and as fast as it struck, a resting state where the turning ground carries it. Host-only (`packages/sim-core`). */
export function ghostSample(state: State, body: Body): GhostSample {
  const time = state.contact?.time ?? state.time;
  let position = state.position, velocity = state.contact?.impactVelocity ?? state.velocity;
  if (bodyFixed(state, body)) {
    const angle = spinAngle(body, time);
    position = rotate(position, angle);
    velocity = rotate(velocity, angle);
    const ground = groundVelocity(spinRate(body), position);
    velocity = { x: velocity.x + ground.x, y: velocity.y + ground.y };
  }
  return { time, position, velocity, linear: true, ...(state.contact?.material === 'water' ? { contactMaterial: 'water' as const } : {}) };
}

/** `dampedKick` of the velocity relative to a medium moving at `medium` (rotating water). */
function relativeKick(velocity: number, acceleration: number, drag: number, seconds: number, medium: number): number {
  return drag === 0 || medium === 0 ? dampedKick(velocity, acceleration, drag, seconds)
    : dampedKick(velocity - medium, acceleration, drag, seconds) + medium;
}

/** The built-in motion bundle (`SimulationContextFactory`). Settings are detached; all model-dependent caches (`COAST_CACHE_CAPACITY` per coast, `COAST_CACHE_BUDGET` total) and
 * timestamp accounting belong to this context. Disposal drops derived data only.
 * Exposed to modules via `CORE_MOTION.createContext` and `MOTION_CONTEXTS`. Host-only (`packages/sim-core`). */
export function createSimulationContext(settings: Partial<VehicleDefaults> = {}, motion: MotionContextOptions = {}): SimulationContext {
  const options = captureMotionOptions(motion);
  const forces = options.forces!;
  const services = Object.freeze({ ...BUILTIN_SERVICES, ...options.services });
  const { elements, propagate, timeToRadius } = services.orbits;
  const { query: querySurface, identity: surfaceIdentity, support: surfaceSupport,
    validate: validateMotionSurface, sweep: sweepSurface, sweepGround: sweepGroundSurface } = services.surfaces;
  for (const [slot, service] of Object.entries(services)) {
    if (!service.id || !service.version || !service.modelIdentity) throw new Error(`Invalid ${slot} provider identity`);
  }
  const customServices = Object.keys(options.services ?? {}).length > 0;
  const customMotion = !!options.dynamics || forces.length > 0;
  const analytic = !customMotion && !options.worldRules && services.orbits.analytic;
  const binding = { dynamics: 'builtin.kdk/v1', orbits: services.orbits.modelIdentity,
    bodies: services.bodies.modelIdentity, surfaces: services.surfaces.modelIdentity };
  const capabilities = Object.freeze({ analyticCoast: analytic,
    rails: analytic && services.rails.compatible.some(b => b.dynamics === binding.dynamics && b.orbits === binding.orbits
      && b.bodies === binding.bodies && b.surfaces === binding.surfaces),
    orbitalDiagnostics: analytic, legacyCompatible: !customMotion && !customServices && !options.worldRules });
  const vehicle = Object.freeze({
    acceleration: settings.acceleration ?? DEFAULT_VEHICLE.acceleration,
    turnRate: settings.turnRate ?? DEFAULT_VEHICLE.turnRate,
    initialThrottle: settings.initialThrottle ?? DEFAULT_VEHICLE.initialThrottle,
  });
  if (!Number.isFinite(vehicle.acceleration) || vehicle.acceleration < 0
    || !Number.isFinite(vehicle.turnRate) || vehicle.turnRate < 0
    || !Number.isFinite(vehicle.initialThrottle) || vehicle.initialThrottle < 0 || vehicle.initialThrottle > 1) {
    throw new Error('Invalid simulation vehicle settings');
  }

  const modelIdentity = JSON.stringify([MODEL, vehicle.acceleration, vehicle.turnRate, vehicle.initialThrottle,
      ...(customMotion ? [options.dynamics ? [options.dynamics.id, options.dynamics.version, options.dynamics.modelIdentity, options.dynamics.supportsForces] : null,
        forces.map(f => [f.moduleId, f.version, f.hook.modelIdentity, f.hook.initialState])] : []),
      ...(customServices || options.worldRules ? [Object.entries(services).map(([slot, s]) => [slot, s.id, s.version, s.modelIdentity]), options.worldRuleIdentity ?? !!options.worldRules] : [])]);

  interface CoastCache { readonly samples: Map<number, Propagation>; hits: number; misses: number }
  let COAST_CACHE = new WeakMap<Coast, CoastCache>();
  /** Insertion order over all coasts; the oldest entry is evicted once the budget is reached. */
  let budgetCaches: Array<CoastCache | undefined> = [];
  let budgetTimes: Float64Array | undefined;
  let budgetNext = 0;
  function coastCacheStats(coast: Coast | undefined): { samples: number; hits: number; misses: number; capacity: number } {
    const cache = coast && COAST_CACHE.get(coast);
    return { samples: cache?.samples.size ?? 0, hits: cache?.hits ?? 0, misses: cache?.misses ?? 0, capacity: COAST_CACHE_CAPACITY };
  }
  /** Full-step KDK velocity. Controls apply at the start of this bounded step.
   * Supplying an explicit surface opts into shared terrain motion. */
  function step(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
    validateStep(state, controls, dt, body, surface);
    if (customMotion) return customAdvance(state, controls, dt, body, surface);
    return numericalAdvance(state, controls, dt, body, surface);
  }

  function customAdvance(state: State, controls: Controls, seconds: number, body: Body, surface?: SurfaceProfile): State {
    const transaction = new ForceTransaction(forces, { state, controls, seconds, body, surface });
    const input = transaction.input;
    const numerical = (request: MotionStep): State => {
      // The supplied kernel is valid only for this boundary and its selected services.
      if (request !== input) throw new Error('Numerical kernel requires the current motion request');
      return numericalAdvance(input.state, input.controls, seconds, input.body, surface, transaction);
    };
    const provider = options.dynamics;
    const next = runDynamics(provider?.id ?? 'builtin.motion', transaction.tick, () => {
      const proposed = provider ? provider.step(input, Object.freeze({ numerical,
        acceleration: (time: number, position: Vec, velocity: Vec) => transaction.acceleration(time, position, velocity) })) : numerical(input);
      if (!proposed || proposed.time !== state.time + seconds || !Number.isSafeInteger(proposed.revision)
        || proposed.revision !== state.revision + (state.status === 'crashed' ? 0 : 1)) throw new Error('Invalid motion epoch or revision');
      for (const key of Object.keys(proposed)) if (!MOTION_STATE_FIELDS.has(key)) throw new Error(`Invalid motion state field ${key}; use namespaced module state`);
      // Never accept cached analytic data from an incompatible model.
      const { coast: _coast, solver: _solver, moduleState: _moduleState, ...fields } = proposed;
      const verified: State = motionCopy({ ...fields, dynamics: 'numerical' });
      validateStep(verified, IDLE, STEP, body, surface);
      if (verified.throttle < 0 || verified.throttle > 1) throw new Error('Invalid motion throttle');
      if (verified.contact && (!Number.isFinite(verified.contact.time) || verified.contact.time < state.time
        || verified.contact.time > verified.time || !Number.isFinite(verified.contact.fraction)
        || verified.contact.fraction < 0 || verified.contact.fraction > 1
        || !Number.isFinite(verified.contact.impactVelocity.x) || !Number.isFinite(verified.contact.impactVelocity.y)
        || verified.contact.surfaceIdentity !== surface?.identity)) throw new Error('Invalid motion contact event');
      if (verified.waterEntry && (!Number.isFinite(verified.waterEntry.time) || verified.waterEntry.time < state.time
        || verified.waterEntry.time > verified.time || !Number.isFinite(verified.waterEntry.position.x)
        || !Number.isFinite(verified.waterEntry.position.y) || !Number.isFinite(verified.waterEntry.velocity.x)
        || !Number.isFinite(verified.waterEntry.velocity.y) || !surface?.hasWater)) throw new Error('Invalid motion water entry');
      return verified;
    });
    return transaction.commit(next);
  }

  /** `step` for an already validated state. */
  function numericalAdvance(state: State, controls: Controls, dt: number, body: Body, surface?: SurfaceProfile, transaction?: ForceTransaction): State {
    if (!transaction && !surface && state.status === 'flying') {
      const fast = freeFlightStep(state, controls, dt, body);
      if (fast) return fast;
    }
    // This separately retained numerical integrator must never carry a stale coast epoch.
    // (Listed field by field: a rest spread is the slowest way to drop four keys.)
    const numerical: { -readonly [K in keyof State]: State[K] } = { time: state.time, position: state.position,
      velocity: state.velocity, heading: state.heading, throttle: state.throttle, status: state.status,
      revision: state.revision, dynamics: 'numerical' };
    if (state.godMode !== undefined) numerical.godMode = state.godMode;
    if (state.water !== undefined) numerical.water = state.water;
    const result = numericalStep(numerical, controls, dt, body, surface, transaction);
    if (customServices) validateStep(result, IDLE, STEP, body, surface);
    return result;
  }

  /** `numericalStep` for flight around a circular body, the case every burning ship of a big
   * fleet takes each step: the same expressions in the same order, so the result is identical
   * bit for bit, without the general path's temporary objects. Returns undefined when the
   * drift touches the surface, which the general path resolves. */
  function freeFlightStep(state: State, controls: Controls, dt: number, body: Body): State | undefined {
    const turn = Math.max(-1, Math.min(1, controls.turn)) * vehicle.turnRate;
    const heading = normalizeAngle(state.heading + turn * dt);
    const throttle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * 0.78125));
    const midThrottle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * .78125 / 2));
    const thrust = controls.engine ? midThrottle * vehicle.acceleration : 0;
    const midHeading = state.heading + turn * dt / 2;
    const ex = dm.cos(midHeading) * thrust, ey = dm.sin(midHeading) * thrust;
    const px = state.position.x, py = state.position.y, half = dt / 2;
    const r0 = dm.hypot(px, py), s0 = -body.mu / (r0 * r0 * r0);
    // dampedKick without drag: v + a * dt/2, with the gravity factor of 1 dry flight uses.
    const hvx = state.velocity.x + (px * s0 * 1 + ex) * half;
    const hvy = state.velocity.y + (py * s0 * 1 + ey) * half;
    const position = { x: px + hvx * dt, y: py + hvy * dt };
    if (contactFraction(state.position, position, body.radius) !== undefined) return undefined;
    const r1 = dm.hypot(position.x, position.y), s1 = -body.mu / (r1 * r1 * r1);
    const next: { -readonly [K in keyof State]: State[K] } = { time: state.time + dt, position,
      velocity: { x: hvx + (position.x * s1 * 1 + ex) * half, y: hvy + (position.y * s1 * 1 + ey) * half },
      heading, throttle, status: 'flying', revision: state.revision + 1, dynamics: 'numerical' };
    if (state.godMode !== undefined) next.godMode = state.godMode;
    return next;
  }

  function validateStep(state: State, controls: Controls, dt: number, body: Body, surface?: SurfaceProfile): void {
    if (!(dt > 0 && dt <= STEP) || !Number.isFinite(dt)) throw new Error('Step must be in (0, 0.01] seconds');
    if (!(body.mu > 0 && body.radius > 0) || !Number.isFinite(body.mu + body.radius)) throw new Error('Invalid body');
    // Runs for every ship on every step: plain comparisons, no temporary arrays.
    if (!Number.isFinite(state.time) || !Number.isFinite(state.position.x) || !Number.isFinite(state.position.y)
      || !Number.isFinite(state.velocity.x) || !Number.isFinite(state.velocity.y) || !Number.isFinite(state.heading)
      || !Number.isFinite(state.throttle) || !Number.isFinite(controls.turn) || !Number.isFinite(controls.throttle)) {
      throw new Error('Invalid state or controls');
    }
    if (state.status !== 'landed' && state.status !== 'flying' && state.status !== 'crashed') throw new Error('Invalid flight status');
    if (surface) validateMotionSurface(body, surface);
    if (state.water !== undefined && (!surface?.seaRadiusMetres || (state.water !== 'submerged' && state.water !== 'floating'))) {
      throw new Error('Invalid water state: requires an ocean surface');
    }
    const radius = magnitude(state.position);
    const tolerance = surface ? surfaceContactTolerance(surface) : 1e-7;
    // Free flight above the highest terrain cannot be inside ground: skip the profile query.
    const clear = surface !== undefined && state.status === 'flying' && state.water === undefined
      && radius >= surface.bounds.maxRadius + tolerance;
    // Terrain is body-fixed; a flying state is inertial, so find its point on the turning ground.
    const local = state.status === 'flying' ? rotate(state.position, -spinAngle(body, state.time)) : state.position;
    const ground = !surface ? body.radius : clear ? surface.bounds.maxRadius
      : querySurface(surface, dm.atan2(local.y, local.x)).groundRadius;
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

  function numericalStep(state: State, controls: Controls, dt: number, body: Body, surface?: SurfaceProfile, transaction?: ForceTransaction): State {
    if (state.status === 'crashed') return { ...state, time: state.time + dt };
    // On a rotating body a landed state is body-fixed (see State) and flight is inertial: the
    // ground, its terrain and its water turn underneath at omega. Without spin every
    // rotation below is the identity and every ground velocity is zero.
    const omega = spinRate(body), fixed = omega !== 0 && state.status === 'landed';
    const theta0 = spinAngle(body, state.time);
    const turn = Math.max(-1, Math.min(1, controls.turn)) * vehicle.turnRate;
    const heading = normalizeAngle(state.heading + turn * dt);
    const throttle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * 0.78125));
    const midThrottle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * .78125 / 2));
    const thrust = controls.engine ? midThrottle * vehicle.acceleration : 0;
    const midHeading = state.heading + turn * dt / 2;
    const engine = { x: dm.cos(midHeading) * thrust, y: dm.sin(midHeading) * thrust };
    // Force modules always see the inertial frame.
    const a0 = !transaction ? undefined : !fixed ? transaction.acceleration(state.time, state.position, state.velocity)
      : rotate(transaction.acceleration(state.time, rotate(state.position, theta0),
        groundVelocity(omega, rotate(state.position, theta0))), -theta0);
    const engine0 = a0 ? { x: engine.x + a0.x, y: engine.y + a0.y } : engine;
    const g0 = gravity(state.position, body);
    const radius = magnitude(state.position);
    const sea = surface?.seaRadiusMetres;
    const inWater = sea !== undefined && (radius < sea || state.water !== undefined);
    const f0 = surface && inWater ? waterForces(surface, fixed ? state.position : rotate(state.position, -theta0), querySurface) : { gravityFactor: 1, drag: 0 };
    const radialAcceleration = (engine0.x * state.position.x + engine0.y * state.position.y) / radius;
    const next = { ...state, heading, throttle, time: state.time + dt, revision: state.revision + 1 };
    if (state.status === 'landed') {
      // A point vessel resting on a very shallow seabed can already lie inside
      // the floating support tolerance. Settle before buoyancy can kick it out
      // across a basin narrower than one normal 10-ms drift.
      if (surface && inWater && thrust === 0 && !a0?.x && !a0?.y) {
        const angle = dm.atan2(state.position.y, state.position.x), equilibrium = waterFloatRadius(surface, angle, querySurface);
        if (querySurface(surface, angle).waterDepth > 0 && Math.abs(radius - equilibrium) < 1e-4) {
          return { ...next, position: { x: equilibrium * dm.cos(angle), y: equilibrium * dm.sin(angle) }, water: 'floating' };
        }
      }
      // The rotating frame adds centrifugal acceleration omega^2 r outward.
      const spin = omega * omega;
      if (state.water === 'floating') {
        if (thrust === 0 && !a0?.x && !a0?.y) return next;
      } else if (surface) {
        const support = surfaceSupport(surface, dm.atan2(state.position.y, state.position.x));
        // Static friction holds tangent forces. Liftoff requires positive net
        // acceleration out of every incident support face; sweep checks recontact.
        if (!support.normals.every(n => (engine0.x + g0.x * f0.gravityFactor + spin * state.position.x) * n.x
          + (engine0.y + g0.y * f0.gravityFactor + spin * state.position.y) * n.y > 0)) return next;
      } else if (radialAcceleration <= body.mu / (radius * radius) - spin * radius) return next;
      // Lift off from the turning ground: fly on in the inertial frame with its velocity.
      if (fixed) return numericalStep({ ...inertialState(state, body), status: 'flying' }, controls, dt, body, surface, transaction);
    }
    // Water drag acts on velocity relative to the water, which turns with the body.
    const u0 = groundVelocity(omega, state.position);
    const halfV = {
      x: relativeKick(state.velocity.x, g0.x * f0.gravityFactor + engine0.x, f0.drag, dt / 2, u0.x),
      y: relativeKick(state.velocity.y, g0.y * f0.gravityFactor + engine0.y, f0.drag, dt / 2, u0.y),
    };
    const position = { x: state.position.x + halfV.x * dt, y: state.position.y + halfV.y * dt };
    const theta1 = spinAngle(body, state.time + dt);
    // Terrain is swept in the body-fixed frame, from where the ground was to where it is.
    const local0 = rotate(state.position, -theta0), local1 = rotate(position, -theta1);
    const sweep = surface ? (inWater ? sweepGroundSurface : sweepSurface)(surface, local0, local1) : undefined;
    if (sweep?.status === 'failed') throw new SurfaceContactError(sweep);
    const terrainHit = sweep?.status === 'hit' ? sweep : undefined;
    const hit = surface ? terrainHit?.fraction : contactFraction(state.position, position, body.radius);
    if (hit !== undefined) {
      const thetaHit = omega === 0 ? 0 : spinAngle(body, state.time + dt * hit);
      const point = surface ? {
        x: local0.x + (local1.x - local0.x) * hit,
        y: local0.y + (local1.y - local0.y) * hit,
      } : rotate({
        x: state.position.x + (position.x - state.position.x) * hit,
        y: state.position.y + (position.y - state.position.y) * hit,
      }, -thetaHit);
      const r = magnitude(point);
      const waterHit = terrainHit?.surface.material === 'water' && !inWater;
      const groundRadius = (waterHit ? terrainHit.surface.firstContactRadius : terrainHit?.surface.groundRadius) ?? body.radius;
      // Body-fixed contact point, and where it is in the inertial frame at the contact epoch.
      const local = { x: point.x * groundRadius / r, y: point.y * groundRadius / r };
      const contact = rotate(local, thetaHit);
      const gHit = gravity(contact, body);
      const fHit = surface && inWater ? waterForces(surface, local, querySurface) : { gravityFactor: 1, drag: 0 };
      const aHit = transaction?.acceleration(state.time + dt * hit, contact, halfV);
      const engineHit = aHit ? { x: engine.x + aHit.x, y: engine.y + aHit.y } : engine;
      const uHit = groundVelocity(omega, contact);
      const impactV = {
        x: relativeKick(relativeKick(state.velocity.x, g0.x * f0.gravityFactor + engine0.x, f0.drag, dt * hit / 2, u0.x),
          gHit.x * fHit.gravityFactor + engineHit.x, fHit.drag, dt * hit / 2, uHit.x),
        y: relativeKick(relativeKick(state.velocity.y, g0.y * f0.gravityFactor + engine0.y, f0.drag, dt * hit / 2, u0.y),
          gHit.y * fHit.gravityFactor + engineHit.y, fHit.drag, dt * hit / 2, uHit.y),
      };
      // Landing is judged against the ground, in its own frame.
      const groundImpact = omega === 0 ? impactV : rotate({ x: impactV.x - uHit.x, y: impactV.y - uHit.y }, -thetaHit);
      const angle = dm.atan2(point.y, point.x);
      if (waterHit && (state.godMode || Math.max(0, -(groundImpact.x * dm.cos(angle) + groundImpact.y * dm.sin(angle))) <= WATER_CRASH_SPEED)) {
        // Enter once, then sweep only seabed. Retain the fractional sea vertex so
        // the predictor draws the same two drifts as live motion.
        const entry: GhostSample = { time: state.time + dt * hit, position: contact, velocity: impactV, linear: true };
        const entered: State = { ...next, time: entry.time, heading: normalizeAngle(state.heading + turn * dt * hit),
          throttle: Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * hit * .78125)),
          position: contact, velocity: impactV, status: 'flying', water: 'submerged' };
        const remainder = dt * (1 - hit);
        const result = remainder > 0 ? numericalStep(entered, controls, remainder, body, surface, transaction) : entered;
        return { ...result, time: next.time, revision: next.revision, waterEntry: entry,
          ...(result.contact ? { contact: { ...result.contact, fraction: (result.contact.time - state.time) / dt } } : {}) };
      }
      const safe = surface ? safeSurfaceLanding(surfaceSupport(surface, angle),
        state.heading + turn * dt * hit - thetaHit, magnitude(groundImpact))
        : magnitude(groundImpact) <= 5 && Math.abs(normalizeAngle(heading - thetaHit - angle)) <= Math.PI / 9;
      return { ...next, position: local, velocity: { x: 0, y: 0 },
        ...(omega === 0 ? {} : { heading: normalizeAngle(heading - thetaHit) }),
        status: state.godMode || (!waterHit && safe) ? 'landed' : 'crashed',
        water: waterHit ? 'floating' : undefined,
        ...(terrainHit ? { contact: { time: state.time + dt * hit, fraction: hit,
          material: waterHit ? 'water' : 'rock',
          surfaceIdentity: terrainHit.surfaceIdentity, impactVelocity: groundImpact, diagnostics: terrainHit.diagnostics } } : {}) };
    }
    const g1 = gravity(position, body);
    const f1 = surface && sea !== undefined ? waterForces(surface, local1, querySurface) : { gravityFactor: 1, drag: 0 };
    const a1 = transaction?.acceleration(state.time + dt, position, halfV);
    const engine1 = a1 ? { x: engine.x + a1.x, y: engine.y + a1.y } : engine;
    const u1 = groundVelocity(omega, position);
    const velocity = {
      x: relativeKick(halfV.x, g1.x * f1.gravityFactor + engine1.x, f1.drag, dt / 2, u1.x),
      y: relativeKick(halfV.y, g1.y * f1.gravityFactor + engine1.y, f1.drag, dt / 2, u1.y),
    };
    const wet = sea !== undefined && magnitude(position) <= sea;
    if (surface && wet && thrust === 0 && !a1?.x && !a1?.y) {
      const angle = dm.atan2(local1.y, local1.x), equilibrium = waterFloatRadius(surface, angle, querySurface);
      if (querySurface(surface, angle).waterDepth > 0 && Math.abs(magnitude(position) - equilibrium) < 1e-4
        && dm.hypot(velocity.x - u1.x, velocity.y - u1.y) < .01) {
        return { ...next, position: { x: equilibrium * dm.cos(angle), y: equilibrium * dm.sin(angle) },
          velocity: { x: 0, y: 0 }, status: 'landed', water: 'floating',
          ...(omega === 0 ? {} : { heading: normalizeAngle(heading - theta1) }) };
      }
    }
    return { ...next, position, velocity, status: 'flying', water: wet ? 'submerged' : undefined };
  }

  /** Height above the highest ground (terrain envelope or sea, else the reference radius)
   * that one free step of `dt` cannot cross: more than twice the distance flown, plus a metre
   * for gravity's fall. Above it Kepler motion is exact and cannot touch ground; closer in,
   * numerical steps resolve contact. */
  const clearOfGround = (state: State, top: number, dt: number): boolean =>
    magnitude(state.position) - top > contactMargin(magnitude(state.velocity), dt);

  /** Controls apply at this exact simulation epoch; the returned velocity is synchronized.
   * Safe unpowered orbits evaluate from one immutable epoch. Surface-crossing/radial
   * motion stays on bounded numerical dynamics until the M3 event system exists. */
  function advance(state: State, controls: Controls = IDLE, dt = STEP, body = planet, surface?: SurfaceProfile): State {
    validateStep(state, controls, dt, body, surface);
    if (customMotion) return customAdvance(state, controls, dt, body, surface);
    if (state.status !== 'flying' || (controls.engine && (state.throttle > 0 || controls.throttle > 0))) {
      return numericalAdvance(state, controls, dt, body, surface);
    }
    const coast = keplerCoast(state, body, surface, dt);
    if (!coast) return numericalAdvance(state, controls, dt, body, surface);
    const time = state.time + dt;
    // The live step asks for a new timestamp every time; storing it would only cost work and RAM.
    const result = evaluateCoast(coast, time, body, surface, false);
    if (!result.ok) return { ...numericalAdvance(state, controls, dt, body, surface), solver: result.diagnostics };
    // Built field by field: a spread of the previous state costs more than the solve it wraps.
    const next: { -readonly [K in keyof State]: State[K] } = { time, position: result.state.position,
      velocity: result.state.velocity,
      heading: normalizeAngle(state.heading + Math.max(-1, Math.min(1, controls.turn)) * vehicle.turnRate * dt),
      throttle: Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * .78125)),
      status: state.status, revision: state.revision + 1, coast, dynamics: 'kepler', solver: result.diagnostics };
    if (state.godMode !== undefined) next.godMode = state.godMode;
    return next;
  }

  /** The frozen two-body epoch an unpowered step from this flying state evaluates: the state's
   * own coast when it belongs to this body, otherwise a new one at this instant. Undefined when
   * the step is numerical instead: a radial path, or an arc within one step's reach of the
   * ground (its final approach). */
  function keplerCoast(state: State, body: Body, surface?: SurfaceProfile, dt = STEP): Coast | undefined {
    if (!capabilities.analyticCoast) return undefined;
    const top = surface?.bounds.maxRadius ?? body.radius;
    // At/below the highest terrain, periapsis cannot clear that envelope and
    // clearOfGround is always false. Reject before allocating a frozen epoch
    // and solving elements on every numerical terrain tick (live and preview).
    if (surface && magnitude(state.position) <= top) return undefined;
    const identity = surfaceIdentity(body);
    const own = state.coast;
    if (own?.bodyId === body.id && own.mu === body.mu && own.surfaceRadius === body.radius
      && own.modelIdentity === (customServices ? modelIdentity : undefined)
      && own.surfaceIdentity === identity && own.contactSurfaceIdentity === surface?.identity) {
      return elements(own, body.mu).periapsis <= top + .01 && !clearOfGround(state, top, dt) ? undefined : own;
    }
    const coast: Coast = Object.freeze({ bodyId: body.id, epochSeconds: state.time,
      position: Object.freeze({ ...state.position }), velocity: Object.freeze({ ...state.velocity }),
      mu: body.mu, revision: state.revision, surfaceRadius: body.radius, surfaceIdentity: identity,
      ...(surface ? { contactSurfaceIdentity: surface.identity } : {}),
      ...(customServices ? { modelIdentity } : {}) });
    // The state's own elements, computed once and cached with the frozen epoch for its evaluation.
    const orbit = elements(coast, body.mu);
    // An arc that reaches the ground coasts only while no step can touch it.
    if (orbit.radial || (orbit.periapsis <= top + .01 && !clearOfGround(state, top, dt))) return undefined;
    return coast;
  }

  /** Resolve an epoch record in a known frame; raw kernel propagation has no frame registry.
   * Results for frozen epochs are cached by exact timestamp, for previews and other readers
   * that ask for the same times repeatedly; one-off readers pass `cache: false`. */
  function coastAt(coast: Coast, time: number, body = planet, surface?: SurfaceProfile,
    options: { readonly cache?: boolean } = {}): Propagation {
    if (!capabilities.analyticCoast) return { ok: false, diagnostics: { converged: false, iterations: 0,
      bracketIterations: 0, residualSeconds: null, usedBisection: false, reason: 'Analytic coast unavailable for the selected motion model' } };
    return evaluateCoast(coast, time, body, surface, options.cache ?? true);
  }

  function evaluateCoast(coast: Coast, time: number, body: Body, surface: SurfaceProfile | undefined, store: boolean): Propagation {
    if (surface) validateMotionSurface(body, surface);
    if (coast.modelIdentity !== (customServices ? modelIdentity : undefined) || coast.bodyId !== body.id || coast.mu !== body.mu || coast.surfaceRadius !== body.radius
      || coast.surfaceIdentity !== surfaceIdentity(body) || coast.contactSurfaceIdentity !== surface?.identity
      || !Number.isFinite(coast.epochSeconds)
      || !Number.isFinite(time) || !Number.isSafeInteger(coast.revision) || coast.revision < 0
      || !(body.radius > 0) || !Number.isFinite(body.radius)
      || magnitude(coast.position) < (surface?.bounds.maxRadius ?? body.radius)) {
      return { ok: false, diagnostics: { converged: false, iterations: 0, bracketIterations: 0,
        residualSeconds: null, usedBisection: false, reason: 'Invalid coast epoch, surface state or body frame' } };
    }
    // Public epoch evaluation also rejects forged/old unsafe records.
    try {
      if (elements(coast, body.mu).radial) throw new Error('Radial coast');
    } catch {
      return { ok: false, diagnostics: { converged: false, iterations: 0, bracketIterations: 0,
        residualSeconds: null, usedBisection: false, reason: 'Coast is radial or invalid' } };
    }
    const top = surface?.bounds.maxRadius ?? body.radius;
    // An arc that reaches the ground is valid only between its crossings of the highest ground.
    const window = groundWindow(coast, top), elapsed = time - coast.epochSeconds;
    if (elapsed > window.after || -elapsed > window.before) {
      return { ok: false, diagnostics: { converged: false, iterations: 0, bracketIterations: 0,
        residualSeconds: null, usedBisection: false, reason: 'Coast reaches the ground before this time' } };
    }
    const immutable = Object.isFrozen(coast) && Object.isFrozen(coast.position) && Object.isFrozen(coast.velocity);
    if (!immutable) return aboveGround(propagate(coast, coast.mu, time - coast.epochSeconds), top);
    if (!store) {
      const cached = COAST_CACHE.get(coast)?.samples.get(time);
      return cached ?? aboveGround(propagate(coast, coast.mu, time - coast.epochSeconds), top);
    }
    let cache = COAST_CACHE.get(coast);
    if (!cache) { cache = { samples: new Map(), hits: 0, misses: 0 }; COAST_CACHE.set(coast, cache); }
    const cached = cache.samples.get(time);
    if (cached) { cache.hits++; return cached; }
    cache.misses++;
    const result = aboveGround(propagate(coast, coast.mu, time - coast.epochSeconds), top);
    if (!result.ok) return result;
    const stored: Propagation = Object.freeze({ ...result, diagnostics: Object.freeze(result.diagnostics),
      state: Object.freeze({ position: Object.freeze({ ...result.state.position }), velocity: Object.freeze({ ...result.state.velocity }) }) });
    if (cache.samples.size >= COAST_CACHE_CAPACITY) cache.samples.delete(cache.samples.keys().next().value!);
    cache.samples.set(time, stored);
    budgetTimes ??= new Float64Array(COAST_CACHE_BUDGET);
    const evicted = budgetCaches[budgetNext];
    if (evicted) evicted.samples.delete(budgetTimes[budgetNext]!);
    budgetCaches[budgetNext] = cache;
    budgetTimes[budgetNext] = time;
    budgetNext = (budgetNext + 1) % COAST_CACHE_BUDGET;
    return stored;
  }

  let GROUND_WINDOWS = new WeakMap<Coast, { readonly top: number; readonly before: number; readonly after: number }>();
  /** Seconds from a coast's epoch back to and on to its crossings of radius `top` (Infinity
   * when it never crosses that way: its periapsis clears it, or it escapes). */
  function groundWindow(coast: Coast, top: number): { readonly before: number; readonly after: number } {
    const cached = GROUND_WINDOWS.get(coast);
    if (cached?.top === top) return cached;
    let window = { top, before: Infinity, after: Infinity };
    try {
      const orbit = elements(coast, coast.mu);
      if (orbit.periapsis <= top + .01) {
        // Near-circular event angles are undefined: no window.
        const never = orbit.eccentricity >= 1e-8 ? Infinity : 0;
        const back = { position: coast.position, velocity: { x: -coast.velocity.x, y: -coast.velocity.y } };
        window = { top, after: timeToRadius(coast, coast.mu, top, 'inbound') ?? never,
          before: timeToRadius(back, coast.mu, top, 'inbound') ?? never };
      }
    } catch { window = { top, before: 0, after: 0 }; }
    if (Object.isFrozen(coast)) GROUND_WINDOWS.set(coast, window);
    return window;
  }

  /** A coast is only valid above the highest ground: an impact arc evaluated at or past its
   * contact time fails instead of returning a point inside the body. */
  function aboveGround(result: Propagation, top: number): Propagation {
    if (!result.ok || magnitude(result.state.position) >= top) return result;
    return { ok: false, diagnostics: { ...result.diagnostics, converged: false, reason: 'Coast reached the ground envelope' } };
  }

  /** Adaptive "if you coast now" ghost trajectory predictor. Sample times are quantized to STEP * 2^k, the
   * largest step that moves at most 1/8 of the radius (1/4 when `coarse`, used during
   * burns), so every orbit costs about the same number of samples at any altitude.
   * Each sample is an exact two-body state solved from one frozen epoch, so the
   * quantization never accumulates error. A pass ends after one revolution, at
   * surface contact, beyond the escape radius or at the sample cap. Near terrain,
   * shared live steps replace the conic path; each yield verifies one 10-ms step.
   * Display-only: the live flight never reads these samples. */
  function* ghost(start: State, coarse = false, body = planet, surface?: SurfaceProfile): Generator<GhostSample, GhostEnd> {
    // A shared rule needs the whole fleet and its RNG, supplied by World.predictShip.
    if (options.worldRules) return 'failed';
    if (start.status !== 'flying') return 'grounded';
    if (!capabilities.analyticCoast) return yield* numericalGhost(start, body, surface);
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
      if (impact === null && orbit.apoapsis !== null) period = orbit.period;
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
      if (period === null && magnitude(position) > escape) return 'escape';
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
      yield { ...ghostSample(state, body), linear: state.dynamics === 'numerical' };
      if (state.contact) return 'impact';
      if (state.status === 'landed') return state.water === 'floating' ? 'floating' : 'grounded';
      if (magnitude(state.position) > body.radius * GHOST_ESCAPE_RADII) return 'escape';
    }
    return 'open';
  }

  function* numericalGhost(start: State, body: Body, surface?: SurfaceProfile): Generator<GhostSample, GhostEnd> {
    let state = start;
    yield { time: state.time, position: state.position, velocity: state.velocity, linear: true };
    try {
      for (let i = 0; i < GHOST_TERRAIN_MAX_STEPS; i++) {
        state = advance(state, IDLE, STEP, body, surface);
        if (state.waterEntry) yield state.waterEntry;
        yield ghostSample(state, body);
        if (state.contact) return 'impact';
        if (state.status !== 'flying') return state.water === 'floating' ? 'floating' : 'grounded';
        if (magnitude(state.position) > body.radius * GHOST_ESCAPE_RADII) return 'escape';
      }
    } catch { return 'failed'; }
    return 'open';
  }

  return Object.freeze({
    modelIdentity,
    stepSeconds: STEP, vehicle, capabilities, services,
    validateState: (state: State, body: Body, surface?: SurfaceProfile) => validateStep(state, IDLE, STEP, body, surface),
    step, advance, predict: ghost, keplerCoast, coastAt, coastCacheStats,
    cloneForPrediction: () => createSimulationContext(vehicle, options),
    dispose(): void {
      COAST_CACHE = new WeakMap(); GROUND_WINDOWS = new WeakMap();
      budgetCaches = []; budgetTimes = undefined; budgetNext = 0;
    },
  });
}
