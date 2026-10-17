import type { OrbitalState, Elements, SolverDiagnostics, Propagation, SolverOptions } from '../../game-api/src/index';
export type { OrbitalState, Elements, SolverDiagnostics, Propagation, SolverOptions } from '../../game-api/src/index';
import type { Vec } from '../../game-api/src/index';
import * as dm from './dmath';

const TAU = 2 * Math.PI;
// 320-byte physics lookup table. Store the recurrence's fixed rational factors,
// not sampled orbit states or approximate transcendental function values.
const STUMPFF_FACTORS = new Float64Array(40);
for (let k = 1; k <= 20; k++) {
  STUMPFF_FACTORS[2 * (k - 1)] = -1 / ((2 * k + 1) * (2 * k + 2));
  STUMPFF_FACTORS[2 * (k - 1) + 1] = -1 / ((2 * k + 2) * (2 * k + 3));
}
const norm = (v: Vec): number => dm.hypot(v.x, v.y);
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;

interface EpochConstants {
  mu: number; orbit: Elements; L: number; V: number; T: number; p: Vec; v: Vec; alpha: number;
}
const EPOCH_CONSTANTS = new WeakMap<OrbitalState, EpochConstants>();
function epochConstants(s: OrbitalState, mu: number): EpochConstants {
  const cached = EPOCH_CONSTANTS.get(s);
  if (cached?.mu === mu) return cached;
  validate(s, mu);
  const L = norm(s.position), V = Math.sqrt(mu / L), T = L / V;
  const p = { x: s.position.x / L, y: s.position.y / L };
  const v = { x: s.velocity.x / V, y: s.velocity.y / V };
  const constants = { mu, orbit: computeElements(s, mu, L), L, V, T, p, v, alpha: 2 - dot(v, v) };
  // Cache only genuinely immutable records; callers may pass mutable raw states.
  if (Object.isFrozen(s) && Object.isFrozen(s.position) && Object.isFrozen(s.velocity)) EPOCH_CONSTANTS.set(s, constants);
  return constants;
}

function validate(s: OrbitalState, mu: number): void {
  if (![s.position.x, s.position.y, s.velocity.x, s.velocity.y, mu].every(Number.isFinite)
    || mu <= 0 || norm(s.position) === 0) throw new Error('Invalid orbital state or mu');
}

function computeElements(s: OrbitalState, mu: number, r: number): Elements {
  const v2 = dot(s.velocity, s.velocity), rv = dot(s.position, s.velocity);
  const h = s.position.x * s.velocity.y - s.position.y * s.velocity.x;
  const energy = v2 / 2 - mu / r;
  const eccentricityVector = {
    x: ((v2 - mu / r) * s.position.x - rv * s.velocity.x) / mu,
    y: ((v2 - mu / r) * s.position.y - rv * s.velocity.y) / mu,
  };
  const e = norm(eccentricityVector), p = h * h / mu;
  // Dimensionless energy avoids imposing one SI-sized threshold on every system.
  const conditioning = energy * r / mu;
  const kind = Math.abs(conditioning) <= 32 * Number.EPSILON ? 'parabolic'
    : energy < 0 ? 'elliptic' : 'hyperbolic';
  const a = kind === 'parabolic' ? null : -mu / (2 * energy);
  const radial = Math.abs(h) / Math.sqrt(mu * r) <= 1e-12;
  const result: Elements = {
    energy, angularMomentum: h, eccentricityVector, eccentricity: e,
    semilatusRectum: p, periapsis: p / (1 + e),
    apoapsis: kind === 'elliptic' ? a! * (1 + e) : null,
    semiMajorAxis: a, period: kind === 'elliptic' ? TAU * a! * Math.sqrt(a! / mu) : null,
    periapsisAngle: e < 1e-8 || radial ? null : dm.atan2(eccentricityVector.y, eccentricityVector.x),
    kind, radial,
  };
  if (![energy, h, e, p, result.periapsis, result.apoapsis ?? 0, a ?? 0, result.period ?? 0]
    .every(Number.isFinite)) throw new Error('Orbital element overflow');
  return result;
}

/** Signed 2D elements. Undefined circular/radial orientation is explicitly absent. */
export function elements(s: OrbitalState, mu: number): Elements {
  const cached = EPOCH_CONSTANTS.get(s);
  if (cached?.mu === mu) return cached.orbit;
  if (Object.isFrozen(s) && Object.isFrozen(s.position) && Object.isFrozen(s.velocity)) {
    return epochConstants(s, mu).orbit;
  }
  validate(s, mu);
  return computeElements(s, mu, norm(s.position));
}

/** Time from periapsis at a given radius. Half-angle inversion and universal time
 * avoid the E-e*sin(E) cancellation on either side of parabolic energy. */
function periapsisTime(radius: number, mu: number, e: Elements, sign: number): number {
  const distance = Math.max(0, radius - e.periapsis);
  const alpha = e.kind === 'parabolic' ? 0 : -2 * e.energy / mu;
  let chi: number;
  if (alpha > 0) chi = 2 / Math.sqrt(alpha) * Math.asin(Math.sqrt(Math.min(1, distance * alpha / (2 * e.eccentricity))));
  else if (alpha < 0) chi = 2 / Math.sqrt(-alpha) * Math.asinh(Math.sqrt(distance * -alpha / (2 * e.eccentricity)));
  else chi = Math.sqrt(2 * distance / e.eccentricity);
  chi *= sign;
  return (e.periapsis * chi + e.eccentricity * chi * chi * chi * stumpff(alpha * chi * chi).s) / Math.sqrt(mu);
}

/** Earliest nonnegative directed radius crossing. Null means unreachable on the future branch.
 * Radial states are supported up to the central singularity. This is a two-body primitive,
 * not a moving-body encounter detector. `orbit` may pass `elements(s, mu)` when the caller
 * already has them (several radii of one state). */
export function timeToRadius(s: OrbitalState, mu: number, radius: number,
  direction: 'inbound' | 'outbound' = 'inbound', orbit?: Elements): number | null {
  const e = orbit ?? elements(s, mu);
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid event radius');
  if (radius < e.periapsis * (1 - 1e-13) || (e.apoapsis !== null && radius > e.apoapsis * (1 + 1e-13))) return null;
  if (e.eccentricity < 1e-8) return null; // Near-circular event angles are ambiguous.
  const sign = direction === 'inbound' ? -1 : 1;
  const current = periapsisTime(norm(s.position), mu, e, dot(s.position, s.velocity) < 0 ? -1 : 1);
  const target = periapsisTime(radius, mu, e, sign);
  let dt = target - current;
  if (e.period !== null && dt < 0) dt += e.period;
  // An outward radial branch cannot pass through the singularity to an inward branch.
  if (e.period === null && e.radial && dot(s.position, s.velocity) >= 0 && direction === 'inbound') return null;
  return dt >= 0 ? dt : null;
}

export function timeToApsis(s: OrbitalState, mu: number, apsis: 'periapsis' | 'apoapsis'): number | null {
  const e = elements(s, mu);
  if (e.eccentricity < 1e-8 || e.radial || (apsis === 'apoapsis' && e.apoapsis === null)) return null;
  const current = periapsisTime(norm(s.position), mu, e, dot(s.position, s.velocity) < 0 ? -1 : 1);
  const target = apsis === 'apoapsis' ? e.period! / 2 : 0;
  let dt = target - current;
  if (e.period !== null && dt < 0) dt += e.period;
  return dt >= 0 ? dt : null;
}

/** Stable small-argument series followed by double-angle reconstruction. */
export function stumpff(z: number): { c: number; s: number } {
  if (!Number.isFinite(z)) throw new Error('Stumpff overflow');
  let reduced = z, levels = 0;
  while (Math.abs(reduced) > .5 && levels < 32) { reduced /= 4; levels++; }
  if (Math.abs(reduced) > .5) throw new Error('Stumpff range exceeded');
  let c = .5, s = 1 / 6, tc = c, ts = s;
  for (let k = 0; k < 20; k++) {
    tc *= reduced * STUMPFF_FACTORS[2 * k]!;
    ts *= reduced * STUMPFF_FACTORS[2 * k + 1]!;
    c += tc; s += ts;
    if (Math.abs(tc) + Math.abs(ts) < Number.EPSILON * (Math.abs(c) + Math.abs(s))) break;
  }
  for (let k = 0; k < levels; k++) {
    const nextC = .5 * ((1 - reduced * s) * (1 - reduced * s));
    s = (s + c - reduced * s * c) / 4;
    c = nextC; reduced *= 4;
  }
  if (!Number.isFinite(c + s)) throw new Error('Stumpff overflow');
  return { c, s };
}

/** Universal-variable f/g propagation, normalized to initial L,V,T for conditioning.
 * Every solve has bounded bracketing and guarded Newton/bisection work; it converges on a
 * residual tolerance or, when roundoff floors the residual, on chi reaching double precision. */
export function propagate(s: OrbitalState, mu: number, seconds: number, options: SolverOptions = {}): Propagation {
  let iterations = 0, bracketIterations = 0, usedBisection = false, residualSeconds: number | null = null;
  const diagnostics = (converged: boolean, reason: string | null): SolverDiagnostics =>
    ({ converged, iterations, bracketIterations,
      residualSeconds: residualSeconds !== null && Number.isFinite(residualSeconds) ? residualSeconds : null,
      usedBisection, reason });
  const fail = (reason: string): Propagation => ({ ok: false, diagnostics: diagnostics(false, reason) });
  try {
    if (!Number.isFinite(seconds)) return fail('Invalid elapsed time');
    const constants = epochConstants(s, mu);
    const limit = options.maxIterations ?? 96, bracketLimit = options.maxBracketIterations ?? 96;
    const newtonLimit = options.maxNewtonIterations ?? limit;
    if (![limit, bracketLimit, newtonLimit].every(v => Number.isInteger(v) && v >= 0 && v <= 256)) return fail('Invalid solver limits');
    if (seconds === 0) {
      residualSeconds = 0;
      return { ok: true, state: { position: { ...s.position }, velocity: { ...s.velocity } }, diagnostics: diagnostics(true, null) };
    }
    const { orbit: e, L, V, T, p, alpha } = constants;
    const direction = Math.sign(seconds);
    const forward = { position: s.position, velocity: { x: direction * s.velocity.x, y: direction * s.velocity.y } };
    if (e.radial) {
      const collision = timeToRadius(forward, mu, 0);
      if (collision !== null && Math.abs(seconds) >= collision) return fail('Radial interval reaches the central singularity');
    }
    let dt = Math.abs(seconds) / T;
    const v = { x: direction * constants.v.x, y: direction * constants.v.y };
    const d = dot(p, v);
    if (alpha > 0 && !e.radial) {
      const period = TAU / (alpha * Math.sqrt(alpha));
      dt %= period; // Only state evaluation; event queries retain elapsed revolutions.
      if (dt > period / 2) dt -= period;
    }
    if (!Number.isFinite(dt + T + V)) return fail('Normalization overflow');
    if (dt === 0) { residualSeconds = 0; return { ok: true, state: s, diagnostics: diagnostics(true, null) }; }
    type EvalResult = { f: number; derivative: number; c: number; s: number };
    const evaluate = (chi: number): EvalResult => {
      if (chi === 0) return { f: -dt, derivative: 1, c: .5, s: 1 / 6 };
      const { c, s: st } = stumpff(alpha * chi * chi);
      return { f: d * chi * chi * c + (1 - alpha) * (chi * chi * chi) * st + chi - dt,
        derivative: d * chi * (1 - alpha * chi * chi * st) + (1 - alpha) * chi * chi * c + 1, c, s: st };
    };
    let lo = dt < 0 ? -Math.min(1, Math.abs(dt)) : 0;
    let hi = dt > 0 ? Math.min(1, dt) : 0;
    let qLo: EvalResult | undefined;
    let qHi: EvalResult | undefined;
    let bracketed = false;
    for (; bracketIterations < bracketLimit; bracketIterations++) {
      qLo = evaluate(lo);
      if (qLo.f <= 0) {
        qHi = evaluate(hi);
        if (qHi.f >= 0) { bracketed = true; break; }
      }
      if (dt > 0) hi *= 2; else lo *= 2;
    }
    if (!bracketed || !qLo || !qHi) return fail('Bracket limit reached');
    // A circular/small-dt root often lies exactly on a bracket endpoint.
    const startAtLo = Math.abs(qLo.f) < Math.abs(qHi.f);
    let chi = startAtLo ? lo : hi;
    let q: EvalResult = startAtLo ? qLo : qHi;
    const solution = (): Propagation => {
      const f = 1 - chi * chi * q.c;
      const g = dt - chi * chi * chi * q.s;
      const r = { x: f * p.x + g * v.x, y: f * p.y + g * v.y };
      const radius = norm(r);
      const fdot = (alpha * (chi * chi * chi) * q.s - chi) / radius;
      const gdot = 1 - chi * chi * q.c / radius;
      const state = { position: { x: r.x * L, y: r.y * L }, velocity: {
        x: direction * V * (fdot * p.x + gdot * v.x), y: direction * V * (fdot * p.y + gdot * v.y),
      } };
      validate(state, mu);
      return { ok: true, state, diagnostics: diagnostics(true, null) };
    };
    for (; iterations < limit; iterations++) {
      if (iterations > 0) q = evaluate(chi);
      residualSeconds = q.f * T;
      if (!Number.isFinite(q.f + q.derivative)) return fail('Equation overflow');
      if (Math.abs(q.f) <= 8e-15 * Math.max(Math.abs(dt), 1e-12)) return solution();
      if (q.f > 0) hi = chi; else lo = chi;
      const candidate = chi - q.f / q.derivative;
      let next: number;
      if (iterations < newtonLimit && q.derivative > 0 && candidate > lo && candidate < hi) next = candidate;
      else { next = (lo + hi) / 2; usedBisection = true; }
      // On hyperbolic arcs the Kepler terms can nearly cancel, so the residual floor can sit
      // above the tolerance. A midpoint that rounds onto an end
      // means the bracket is two adjacent doubles: chi is already the root to full precision.
      if (next === lo || next === hi) return solution();
      chi = next;
    }
    return fail('Iteration limit reached');
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Propagation failure');
  }
}
