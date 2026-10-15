import legacy from '../../scenarios/legacy-c64.json';

export interface Vec { readonly x: number; readonly y: number }
export interface Body { readonly id: string; readonly radius: number; readonly mu: number }
export interface State {
  readonly time: number;
  readonly position: Vec;
  readonly velocity: Vec;
  readonly heading: number;
  readonly throttle: number;
  readonly status: 'landed' | 'flying' | 'crashed';
  readonly revision: number;
}
export interface Controls { readonly turn: number; readonly throttle: number; readonly engine: boolean }
export type Preset = 'pad' | 'planet-orbit';
export const STEP = 0.01;
export const MODEL = 'm1-single-body-kdk-v1';
const data = legacy.bodies.find(b => b.id === 'planet')!;
export const planet: Body = Object.freeze({ id: data.id, radius: data.radiusMetres, mu: data.mu });
export const vehicle = Object.freeze({
  acceleration: legacy.vehicleDefaults.fullThrottleAccelerationMetresPerSecondSquared,
  turnRate: legacy.vehicleDefaults.turnRateRadiansPerSecond,
});
export const IDLE: Controls = Object.freeze({ turn: 0, throttle: 0, engine: false });
export const magnitude = (v: Vec): number => Math.hypot(v.x, v.y);
export const normalizeAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
export const legacyHeading = (byte: number): number => Math.PI / 2 - 2 * Math.PI * byte / 256;

export function initialState(preset: Preset = 'pad'): State {
  const p = legacy.presets.find(p => p.id === preset)!;
  const radius = p.radiusMetres ?? planet.radius;
  return {
    time: 0, position: { x: 0, y: radius },
    velocity: { x: preset === 'pad' ? 0 : Math.sqrt(planet.mu / radius), y: 0 },
    heading: p.headingRadians, throttle: legacy.vehicleDefaults.initialThrottle,
    status: preset === 'pad' ? 'landed' : 'flying', revision: 0,
  };
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

/** Full-step KDK velocity. Controls apply at the start of this bounded step. */
export function step(state: State, controls: Controls = IDLE, dt = STEP, body = planet): State {
  if (!(dt > 0 && dt <= STEP) || !Number.isFinite(dt)) throw new Error('Step must be in (0, 0.01] seconds');
  if (!(body.mu > 0 && body.radius > 0) || !Number.isFinite(body.mu + body.radius)) throw new Error('Invalid body');
  if (![state.time, state.position.x, state.position.y, state.velocity.x, state.velocity.y,
    state.heading, state.throttle, controls.turn, controls.throttle].every(Number.isFinite)
    || magnitude(state.position) < body.radius - 1e-7) throw new Error('Invalid state or controls');
  if (state.status === 'crashed') return { ...state, time: state.time + dt };
  const turn = Math.max(-1, Math.min(1, controls.turn)) * vehicle.turnRate;
  const heading = normalizeAngle(state.heading + turn * dt);
  const throttle = Math.max(0, Math.min(1, state.throttle + controls.throttle * dt * 0.78125));
  const thrust = controls.engine ? throttle * vehicle.acceleration : 0;
  const midHeading = state.heading + turn * dt / 2;
  const engine = { x: Math.cos(midHeading) * thrust, y: Math.sin(midHeading) * thrust };
  const g0 = gravity(state.position, body);
  const radius = magnitude(state.position);
  const radialAcceleration = (engine.x * state.position.x + engine.y * state.position.y) / radius;
  const next = { ...state, heading, throttle, time: state.time + dt, revision: state.revision + 1 };
  if (state.status === 'landed' && radialAcceleration <= body.mu / radius ** 2) return next;
  const halfV = {
    x: state.velocity.x + (g0.x + engine.x) * dt / 2,
    y: state.velocity.y + (g0.y + engine.y) * dt / 2,
  };
  const position = { x: state.position.x + halfV.x * dt, y: state.position.y + halfV.y * dt };
  const hit = contactFraction(state.position, position, body.radius);
  if (hit !== undefined) {
    const point = {
      x: state.position.x + (position.x - state.position.x) * hit,
      y: state.position.y + (position.y - state.position.y) * hit,
    };
    const r = magnitude(point);
    const contact = { x: point.x * body.radius / r, y: point.y * body.radius / r };
    const gHit = gravity(contact, body);
    const impactV = {
      x: state.velocity.x + (g0.x + gHit.x + 2 * engine.x) * dt * hit / 2,
      y: state.velocity.y + (g0.y + gHit.y + 2 * engine.y) * dt * hit / 2,
    };
    const upright = Math.abs(normalizeAngle(heading - Math.atan2(point.y, point.x))) <= Math.PI / 9;
    return { ...next, position: contact, velocity: { x: 0, y: 0 },
      status: magnitude(impactV) <= 5 && upright ? 'landed' : 'crashed' };
  }
  const g1 = gravity(position, body);
  return { ...next, position, velocity: {
    x: halfV.x + (g1.x + engine.x) * dt / 2,
    y: halfV.y + (g1.y + engine.y) * dt / 2,
  }, status: 'flying' };
}

export interface Sample { readonly time: number; readonly position: Vec }
/** Bounded iterator: the application decides how much prediction work to do per frame. */
export function* predict(start: State, horizon = 60): Generator<Sample> {
  let state = start;
  yield { time: state.time, position: state.position };
  const count = Math.min(6000, Math.max(0, Math.floor(horizon / STEP)));
  for (let i = 0; i < count && state.status === 'flying'; i++) {
    state = step(state);
    // Yield every step so callers can enforce a work budget; renderer may decimate.
    yield { time: state.time, position: state.position };
  }
}

/** Fixed-step scheduler; stalled frames drop excess wall time and report it. */
export class Clock {
  private accumulator = 0;
  droppedSeconds = 0;
  lastSteps = 0;
  reset(): void { this.accumulator = 0; this.lastSteps = 0; }
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
