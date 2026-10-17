/** First-party library module: flight quantities derived from a presentation snapshot, for
 * other presentation modules to share. It draws nothing itself; dependents declare
 * `builtin.flight-data` and call `context.dependency('builtin.flight-data')`. Public API only. */
import type { ModuleManifest, PresentationSnapshot, RegisteredModule, Vec } from '../../../../game-api/src/index';

export interface OrbitData {
  readonly kind: 'elliptic' | 'parabolic' | 'hyperbolic';
  readonly eccentricity: number;
  /** Radii from the body's centre in metres. Apoapsis is null on open orbits. */
  readonly periapsis: number;
  readonly apoapsis: number | null;
  /** Seconds; null on open orbits. */
  readonly period: number | null;
  /** Apsides in system coordinates; absent for circular and radial orbits. */
  readonly periapsisPoint?: Vec;
  readonly apoapsisPoint?: Vec;
  /** Seconds until the next pass, or null when there is none (or the orbit is circular/radial). */
  readonly timeToPeriapsis: number | null;
  readonly timeToApoapsis: number | null;
}
export interface FlightData {
  /** Metres from the body's centre. */
  readonly radius: number;
  /** m/s: total, outward along the local vertical, and counter-clockwise along the horizon. */
  readonly speed: number;
  readonly radial: number;
  readonly tangential: number;
  /** Degrees above the local horizon. */
  readonly pathAngle: number;
  /** m/s² and J/kg (two-body point mass). */
  readonly gravity: number;
  readonly energy: number;
  /** Engine acceleration at the current throttle over local gravity. */
  readonly thrustToWeight: number;
  /** Unit vectors in system orientation: local vertical and direction of motion. */
  readonly up?: Vec;
  readonly prograde?: Vec;
  /** Present when the active motion model provides analytic orbital elements. */
  readonly orbit?: OrbitData;
}
export interface FlightDataApi {
  read(view: PresentationSnapshot): FlightData | undefined;
  readonly format: {
    duration(seconds: number): string;
    distance(metres: number): string;
    number(value: number, digits?: number): string;
  };
}

const TAU = 2 * Math.PI;
const wrap = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const unit = (v: Vec): Vec | undefined => {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-9 ? { x: v.x / length, y: v.y / length } : undefined;
};

/** Times to the apsides from the true anomaly (two-body, sense of motion from h). */
function apsisTimes(view: PresentationSnapshot, p: Vec, v: Vec): Pick<OrbitData, 'timeToPeriapsis' | 'timeToApoapsis'> {
  const o = view.orbit!, mu = view.body.mu, e = o.eccentricity;
  const h = p.x * v.y - p.y * v.x;
  if (o.periapsisAngle === null || !h) return { timeToPeriapsis: null, timeToApoapsis: null };
  const nu = wrap((Math.atan2(p.y, p.x) - o.periapsisAngle) * Math.sign(h));
  if (o.kind === 'elliptic' && o.period) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = wrap(E - e * Math.sin(E)), n = TAU / o.period;
    return { timeToPeriapsis: M ? (TAU - M) / n : 0, timeToApoapsis: (M <= Math.PI ? Math.PI - M : 3 * Math.PI - M) / n };
  }
  const signed = nu > Math.PI ? nu - TAU : nu;
  if (signed >= 0) return { timeToPeriapsis: null, timeToApoapsis: null };
  if (o.kind === 'hyperbolic') {
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(signed / 2));
    const a = mu / (2 * o.energy);
    return { timeToPeriapsis: -(e * Math.sinh(F) - F) / Math.sqrt(mu / (a * a * a)), timeToApoapsis: null };
  }
  // Barker's equation for the parabola.
  const D = Math.tan(signed / 2), semilatus = h * h / mu;
  return { timeToPeriapsis: -Math.sqrt(semilatus ** 3 / mu) / 2 * (D + D ** 3 / 3), timeToApoapsis: null };
}

export function readFlightData(view: PresentationSnapshot): FlightData | undefined {
  const ship = view.ship;
  if (!ship) return undefined;
  const { position: p, velocity: v } = ship.state;
  const radius = Math.hypot(p.x, p.y), speed = Math.hypot(v.x, v.y);
  const radial = radius > 0 ? (p.x * v.x + p.y * v.y) / radius : 0;
  const tangential = radius > 0 ? (p.x * v.y - p.y * v.x) / radius : 0;
  const gravity = radius > 0 ? view.body.mu / (radius * radius) : 0;
  const up = unit(p), prograde = speed > .05 ? unit(v) : undefined;
  const o = view.orbit;
  let orbit: OrbitData | undefined;
  if (o) {
    const angle = o.periapsisAngle, b = view.body.position;
    orbit = { kind: o.kind, eccentricity: o.eccentricity, periapsis: o.periapsis, apoapsis: o.apoapsis, period: o.period,
      ...(angle !== null ? { periapsisPoint: { x: b.x + o.periapsis * Math.cos(angle), y: b.y + o.periapsis * Math.sin(angle) } } : {}),
      ...(angle !== null && o.apoapsis !== null ? { apoapsisPoint: { x: b.x - o.apoapsis * Math.cos(angle), y: b.y - o.apoapsis * Math.sin(angle) } } : {}),
      ...apsisTimes(view, p, v) };
  }
  return { radius, speed, radial, tangential, pathAngle: Math.atan2(radial, Math.abs(tangential)) * 180 / Math.PI,
    gravity, energy: speed * speed / 2 - (radius > 0 ? view.body.mu / radius : 0),
    thrustToWeight: gravity > 0 ? view.vehicle.acceleration * ship.state.throttle / gravity : 0,
    ...(up ? { up } : {}), ...(prograde ? { prograde } : {}), ...(orbit ? { orbit } : {}) };
}

const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0');
export const format: FlightDataApi['format'] = Object.freeze({
  duration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 100) return `${seconds.toFixed(1)} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${pad(seconds % 60)} s`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${pad(seconds / 60 % 60)} min`;
    return `${Math.floor(seconds / 86400)} d ${pad(seconds / 3600 % 24)} h`;
  },
  distance(metres: number): string {
    if (!Number.isFinite(metres)) return '—';
    return Math.abs(metres) < 1e4 ? `${metres.toFixed(1)} m`
      : Math.abs(metres) < 1e7 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres / 1000).toLocaleString('en-US')} km`;
  },
  number(value: number, digits = 0): string {
    return Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  },
});

const manifest: ModuleManifest = {
  format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.flight-data', name: 'Flight data',
  version: '0.1.0', kind: 'provider', authority: 'presentation', environments: ['browser', 'offline'],
  dependencies: [], provides: ['builtin.flight-data/v1'], requires: [], slots: [], before: [], after: [], settings: {},
  license: 'LicenseRef-Project',
};
export const flightData: RegisteredModule = {
  manifest,
  initialize(context) { context.expose({ read: readFlightData, format } satisfies FlightDataApi); },
};
