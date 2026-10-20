/** Host-only analytic rails horizon and wake-up min-heap (`packages/sim-core`). Modules access the conservative SOI/surface horizon through `@space-sim/game-api` `CORE_MOTION` (`CoreMotion.services.rails.horizon`) and `RAILS_POLICY` (`RailsProvider.horizon`). */
import { elements, timeToRadius, type Elements, type OrbitalState } from './orbit';
import { contactMargin, STEP } from './constants';
import type { LoadedSystem, ResolvedBody } from './universe';
import * as dm from './dmath';

/** Relative safety factor on analytic event times (their solver error is far smaller). */
const TIME_MARGIN = 1e-6;

/** Earliest simulation time, in seconds (`s`) from `time` (`s`), at which a ship coasting on the given
 * two-body orbit about `body` (in `body`'s primary-body-centred inertial frame, with `position` in `m`, `velocity` in `m/s`, and `mu` in `m³/s²`) could change sphere of influence (reach the body's exit
 * radius, or come within entry radius of one of its moons) or leave Kepler motion for the
 * numerical final approach of an arc that hits the ground (`top`: highest ground radius in `m`).
 * Infinity when that can never happen; 0 when it cannot be bounded.
 *
 * Every bound is conservative, so skipping the per-step SOI test before this time cannot
 * miss a transition:
 * - exit: an ellipse whose apoapsis is inside the exit radius never leaves; otherwise the
 *   two-body time to the exit radius is exact.
 * - moons: a moon on a circular orbit of radius a can only be entered while the ship's
 *   radius is within the entry radius of a (triangle inequality). Until the ship's radius
 *   reaches that band (exact two-body time) and until the gap to the moon could close at
 *   the largest possible relative speed (periapsis speed plus the moon's orbital speed),
 *   the moon is out of reach.
 * Exposed via `CORE_MOTION.services.rails.horizon` and `RAILS_POLICY`. Host-only (`packages/sim-core`). */
export function soiHorizon(system: LoadedSystem, body: ResolvedBody, state: OrbitalState, epoch: OrbitalState,
  time: number, top = body.radius): number {
  let orbit: Elements;
  try { orbit = elements(epoch, body.mu); } catch { return 0; }
  if (orbit.radial) return 0;
  const r = dm.hypot(state.position.x, state.position.y);
  const periapsis = orbit.periapsis;
  const apoapsis = orbit.apoapsis ?? Infinity;
  // Seconds until the radius reaches `radius` in `direction`. Null from the solver means
  // never on this conic, except near-circular orbits whose event angles it leaves undefined.
  const definite = orbit.eccentricity >= 1e-8;
  // The current state's elements, computed on first use and shared by every radius.
  let now: Elements | undefined;
  const until = (radius: number, direction: 'inbound' | 'outbound'): number => {
    try {
      now ??= elements(state, body.mu);
      const t = timeToRadius(state, body.mu, radius, direction, now);
      return t === null ? (definite ? Infinity : 0) : t;
    } catch { return 0; }
  };
  let horizon = Infinity;

  if (periapsis <= top + .01) {
    // The step switches to numerical motion once within one step's reach of the ground;
    // speed only grows on the way down, so the band at the ground's speed is conservative.
    const ground = Math.sqrt(Math.max(0, 2 * (orbit.energy + body.mu / top)));
    const band = top + contactMargin(ground, STEP) + 1;
    if (r <= band) return 0;
    horizon = until(band, 'inbound') * (1 - TIME_MARGIN);
  }

  if (body.parentId && Number.isFinite(body.soi.exitMetres)) {
    const exit = body.soi.exitMetres;
    if (r >= exit) return 0;
    if (!(apoapsis < exit * (1 - 1e-9))) horizon = Math.min(horizon, until(exit, 'outbound') * (1 - TIME_MARGIN));
  }

  const moons = system.getMoonsOf(body.id);
  if (moons.length) {
    // Fastest the ship can move anywhere on this conic: its periapsis speed.
    const vMax = Math.sqrt(Math.max(0, 2 * (orbit.energy + body.mu / periapsis)));
    let parent: { readonly x: number; readonly y: number } | undefined;
    for (const moon of moons) {
      const entry = moon.soi.entryMetres;
      if (!(entry > 0) || !Number.isFinite(entry)) continue;
      const e = moon.ephemeris;
      const a = e.kind === 'circular-kepler' ? Math.abs(e.radius ?? e.radiusMetres ?? 10000) : undefined;
      // Slack covers rounding in absolute body positions.
      const slack = 1 + (a ?? 0) * 1e-9;
      if (a !== undefined && (apoapsis < a - entry - slack || periapsis > a + entry + slack)) continue;
      parent ??= system.getBodyPosition(body.id, time);
      const at = system.getBodyPosition(moon.id, time);
      const dx = state.position.x - (at.x - parent.x), dy = state.position.y - (at.y - parent.y);
      const gap = dm.hypot(dx, dy) - entry - slack;
      if (gap <= 0) return 0;
      const moonSpeed = a !== undefined ? Math.abs(Math.sqrt(body.mu / (a * a * a)) * a) : Infinity;
      let reach = gap / (vMax + moonSpeed);
      if (a !== undefined) {
        // Time for the ship's radius to reach the moon's band, when it is outside it now.
        const lo = a - entry - slack, hi = a + entry + slack;
        const radial = r < lo ? until(lo, 'outbound') : r > hi ? until(hi, 'inbound') : 0;
        reach = Math.max(reach, radial * (1 - TIME_MARGIN));
      }
      horizon = Math.min(horizon, reach);
      if (horizon <= 0) return 0;
    }
  }
  return horizon;
}

/** Binary min-heap of `(tick, id, generation)` wake-up entries backed by flat `Float64Array` buffers for zero-allocation hot-path scheduling. Stale entries are skipped by
 * the owner (`World`) when popped (generation mismatch). Host-only (`packages/sim-core`). */
export class WakeQueue {
  private ticks = new Float64Array(64);
  private gens = new Float64Array(64);
  private ids: string[] = [];
  private count = 0;

  get size(): number { return this.count; }
  peekTick(): number { return this.count ? this.ticks[0]! : Infinity; }

  push(tick: number, id: string, generation: number): void {
    if (this.count === this.ticks.length) {
      const ticks = new Float64Array(this.count * 2); ticks.set(this.ticks); this.ticks = ticks;
      const gens = new Float64Array(this.count * 2); gens.set(this.gens); this.gens = gens;
    }
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.ticks[parent]! <= tick) break;
      this.ticks[i] = this.ticks[parent]!; this.gens[i] = this.gens[parent]!; this.ids[i] = this.ids[parent]!;
      i = parent;
    }
    this.ticks[i] = tick; this.gens[i] = generation; this.ids[i] = id;
  }

  /** Remove the earliest entry, returning its id and generation. */
  pop(): { readonly id: string; readonly generation: number } | undefined {
    if (!this.count) return undefined;
    const id = this.ids[0]!, generation = this.gens[0]!;
    const last = --this.count;
    const tick = this.ticks[last]!, gen = this.gens[last]!, lastId = this.ids[last]!;
    if (last > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= last) break;
        const right = left + 1;
        const child = right < last && this.ticks[right]! < this.ticks[left]! ? right : left;
        if (this.ticks[child]! >= tick) break;
        this.ticks[i] = this.ticks[child]!; this.gens[i] = this.gens[child]!; this.ids[i] = this.ids[child]!;
        i = child;
      }
      this.ticks[i] = tick; this.gens[i] = gen; this.ids[i] = lastId;
    }
    this.ids.length = last;
    return { id, generation };
  }

  clear(): void { this.count = 0; this.ids = []; }
}
