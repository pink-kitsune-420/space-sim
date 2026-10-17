import { IDLE, dmath, type State, type Vec } from '../sim-core/src/index';
import type { ResolvedBody } from '../sim-core/src/universe';
import type { World } from '../sim-core/src/world';

/** Owner of generated asteroids; never a real pilot. */
export const STRESS_OWNER = 'stress';
export const STRESS_ROCK_PREFIX = 'rock-';

export type AsteroidKind = 'belt' | 'crosser' | 'local-bound' | 'local-escape' | 'local-impact' | 'near-parabolic'
  | 'near-radial' | 'moon-crosser';

export interface StressOptions {
  /** Ships to launch, spread over every scenario of the system. */
  readonly ships?: number;
  readonly asteroids?: number;
  readonly seed?: number;
  /** Owner of the launched ships (asteroids belong to STRESS_OWNER). */
  readonly shipOwner?: string;
  /** Fire every launched ship's engine at full throttle. */
  readonly burn?: boolean;
}

export interface StressResult {
  readonly ships: readonly string[];
  readonly asteroids: number;
  readonly kinds: Readonly<Record<string, number>>;
}

/** Deterministic xorshift32 in [0, 1). */
export function random32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const unit = (angle: number): Vec => ({ x: dmath.cos(angle), y: dmath.sin(angle) });

/** Position and velocity on the conic with this periapsis and eccentricity (any e >= 0),
 * at a true anomaly, rotated, prograde (counter-clockwise) or retrograde. */
export function conicState(mu: number, periapsis: number, eccentricity: number, trueAnomaly: number,
  rotation: number, retrograde = false): { readonly position: Vec; readonly velocity: Vec } {
  const p = periapsis * (1 + eccentricity);
  const r = p / (1 + eccentricity * dmath.cos(trueAnomaly));
  const h = Math.sqrt(mu * p) * (retrograde ? -1 : 1);
  const u = unit(trueAnomaly * (retrograde ? -1 : 1) + rotation), t = { x: -u.y, y: u.x };
  const radial = mu / Math.abs(h) * eccentricity * dmath.sin(trueAnomaly), tangential = h / r;
  return { position: { x: u.x * r, y: u.y * r },
    velocity: { x: u.x * radial + t.x * tangential, y: u.y * radial + t.y * tangential } };
}

const orbitRadius = (b: ResolvedBody): number =>
  b.ephemeris.kind === 'circular-kepler' ? Math.abs(b.ephemeris.radius ?? b.ephemeris.radiusMetres ?? 0) : 0;

/** Fill a world for stress testing: ships on every preset (optionally burning) and asteroids
 * on orbits that exercise the mechanics: heliocentric belts, planet crossers that change
 * sphere of influence, bound/escaping/impacting swarms around planets, near-parabolic and
 * near-radial paths, and moon crossers. Deterministic for a seed. */
export function populateStress(world: World, options: StressOptions = {}): StressResult {
  const random = random32(options.seed ?? 1);
  const between = (a: number, b: number): number => a + (b - a) * random();
  const system = world.system;
  const ships: string[] = [];
  for (let i = 0; i < (options.ships ?? 0); i++) {
    const preset = system.presets[i % system.presets.length]!;
    const ship = world.spawn({ ownerId: options.shipOwner ?? STRESS_OWNER, presetId: preset.id });
    ships.push(ship.id);
    if (options.burn) {
      world.setThrottle(ship.id, 1);
      world.setControls(ship.id, { turn: (i % 3) - 1, throttle: 0, engine: true });
    }
  }

  const root = system.rootBody;
  // Major planets only: dwarf planets such as Ceres must not count as the fifth planet.
  const planets = system.getMoonsOf(root.id)
    .filter(b => b.ephemeris.kind === 'circular-kepler' && b.mu > root.mu * 1e-8)
    .sort((a, b) => orbitRadius(a) - orbitRadius(b));
  // Bodies with room for a swarm inside their sphere of influence, and those of them with
  // moons to cross (few bodies have moons, so crossers pick among these directly).
  const hosts = system.getAllBodies().filter(b => b !== root && b.surfaceFeatures !== 'star'
    && Number.isFinite(b.soi.radius) && b.soi.radius > b.radius * 4);
  const families = hosts.filter(b => system.getMoonsOf(b.id).some(m => orbitRadius(m) > 0));
  const kinds: Record<string, number> = {};
  let next = 0;
  while (world.has(`${STRESS_ROCK_PREFIX}${next}`)) next++;
  let made = 0;
  for (let attempt = 0; made < (options.asteroids ?? 0) && attempt < (options.asteroids ?? 0) * 4; attempt++) {
    const roll = random();
    let body: ResolvedBody, kind: AsteroidKind, state: { readonly position: Vec; readonly velocity: Vec };
    if (roll < 0.35 || !hosts.length) {
      body = root; kind = 'belt';
      // Between the 4th and 5th planets when there are that many (the main belt), else a
      // wide band around the system's root.
      const inner = planets.length >= 5 ? orbitRadius(planets[3]!) * 1.2 : root.radius * 4;
      const outer = planets.length >= 5 ? orbitRadius(planets[4]!) * 0.75 : root.radius * 12;
      const a = between(inner, outer), e = between(0, 0.25);
      state = conicState(body.mu, a * (1 - e), e, between(0, 2 * Math.PI), between(0, 2 * Math.PI), random() < 0.02);
    } else if (roll < 0.6 && planets.length) {
      body = root; kind = 'crosser';
      const target = planets[Math.floor(random() * planets.length)]!;
      const q = orbitRadius(target) * between(0.3, 0.98), Q = orbitRadius(target) * between(1.02, 3);
      state = conicState(body.mu, q, (Q - q) / (Q + q), between(0, 2 * Math.PI), between(0, 2 * Math.PI), random() < 0.05);
    } else {
      body = hosts[Math.floor(random() * hosts.length)]!;
      const soi = body.soi.radius, sub = random();
      if (sub < 0.45) {
        kind = 'local-bound';
        const rp = between(body.radius * 1.05, Math.min(soi * 0.5, body.radius * 60));
        state = conicState(body.mu, rp, between(0, 0.6), between(0, 2 * Math.PI), between(0, 2 * Math.PI), random() < 0.2);
      } else if (sub < 0.6) {
        kind = 'local-escape';
        const rp = between(body.radius * 1.5, soi * 0.3);
        state = conicState(body.mu, rp, between(1.05, 3), between(-1.5, 1.5), between(0, 2 * Math.PI), random() < 0.5);
      } else if (sub < 0.72) {
        kind = 'local-impact';
        const q = between(body.radius * 0.2, body.radius * 0.95), e = between(0.5, 0.95);
        // Half fall from near apoapsis; half are already low on the way down, so they reach
        // the ground within minutes (final approach, impact, wreck).
        const r = body.radius * between(1.01, 1.3), cos = (q * (1 + e) / r - 1) / e;
        const anomaly = random() < 0.5 || !(cos <= 1) ? Math.PI * between(0.8, 1) : -Math.acos(Math.max(-1, cos));
        state = conicState(body.mu, q, e, anomaly, between(0, 2 * Math.PI));
      } else if (sub < 0.8) {
        kind = 'near-parabolic';
        state = conicState(body.mu, between(body.radius * 2, body.radius * 20), 1 + between(-1e-9, 1e-9),
          between(-1, 1), between(0, 2 * Math.PI));
      } else if (sub < 0.86) {
        kind = 'near-radial';
        const r = between(body.radius * 3, Math.min(soi * 0.5, body.radius * 50));
        const u = unit(between(0, 2 * Math.PI));
        const v = Math.sqrt(body.mu / r) * between(0.1, 0.9) * (random() < 0.5 ? 1 : -1), side = between(-1e-6, 1e-6);
        state = { position: { x: u.x * r, y: u.y * r }, velocity: { x: u.x * v - u.y * side, y: u.y * v + u.x * side } };
      } else if (families.length) {
        kind = 'moon-crosser';
        body = families[Math.floor(random() * families.length)]!;
        const moons = system.getMoonsOf(body.id).filter(m => orbitRadius(m) > 0);
        const moon = moons[Math.floor(random() * moons.length)]!;
        const q = Math.max(body.radius * 1.2, orbitRadius(moon) * between(0.5, 0.97)), Q = orbitRadius(moon) * between(1.03, 2);
        state = conicState(body.mu, q, (Q - q) / (Q + q), between(0, 2 * Math.PI), between(0, 2 * Math.PI), random() < 0.3);
      } else {
        kind = 'local-bound';
        const rp = between(body.radius * 1.05, Math.min(soi * 0.5, body.radius * 60));
        state = conicState(body.mu, rp, between(0, 0.3), between(0, 2 * Math.PI), between(0, 2 * Math.PI));
      }
    }
    const r = dmath.hypot(state.position.x, state.position.y);
    // Keep every start valid: above the ground and inside the body's sphere of influence.
    const ground = world.surface(body.id)?.bounds.maxRadius ?? body.radius;
    if (!(r > ground * 1.0001) || (body !== root && !(r < body.soi.entryMetres))) continue;
    if (!Number.isFinite(state.velocity.x + state.velocity.y)) continue;
    const start: State = { time: world.time, position: state.position, velocity: state.velocity,
      heading: dmath.atan2(state.velocity.y, state.velocity.x), throttle: 0, status: 'flying', revision: 0 };
    world.put({ id: `${STRESS_ROCK_PREFIX}${next}`, name: `Rock ${next}`, ownerId: STRESS_OWNER, bodyId: body.id,
      state: start, controls: IDLE });
    next++; made++;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return { ships, asteroids: made, kinds };
}

/** Remove everything `populateStress` added (asteroids and ships owned by STRESS_OWNER). */
export function clearStress(world: World): number {
  let removed = 0;
  for (const ship of [...world.records()]) {
    if (ship.ownerId === STRESS_OWNER && world.remove(ship.id)) removed++;
  }
  return removed;
}
