import { describe, expect, it } from 'vitest';
import { advance, setVehicle, step, type Controls, type State } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { OCEAN_UNIVERSE, TERRAIN_UNIVERSE } from '../../packages/scenarios/builtin';
import * as reference from '../helpers/reference-advance';

/** Deterministic xorshift32 in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

type Outcome = { ok: true; state: State } | { ok: false; error: string };
function run(fn: () => State): Outcome {
  try { return { ok: true, state: fn() }; } catch (error) { return { ok: false, error: (error as Error).message }; }
}

/** Optimized motion must equal the original implementation exactly, for every path. */
describe('motion matches the original implementation bit for bit', () => {
  for (const [label, universe, systemId] of [
    ['circular bodies', DEFAULT_UNIVERSE, 'solar-system'],
    ['legacy planet', DEFAULT_UNIVERSE, 'primus-system'],
    ['terrain', TERRAIN_UNIVERSE, undefined],
    ['ocean', OCEAN_UNIVERSE, undefined],
  ] as const) {
    it(label, () => {
      const world = new World(universe, systemId ? { systemId } : {});
      const random = rng(label.length * 977);
      const defaults = world.system.vehicleDefaults;
      setVehicle(defaults);
      reference.setVehicle(defaults);
      let compared = 0, burning = 0, contacts = 0;
      for (const body of world.system.getAllBodies()) {
        if (body.surfaceFeatures === 'star') continue;
        const surface = world.surface(body.id);
        const top = surface?.bounds.maxRadius ?? body.radius;
        for (let i = 0; i < 300; i++) {
          // Altitudes from just above the highest ground (or inside a sea) to orbital.
          const r = random() < 0.5 ? top + random() * 30 : top * (1.05 + random() * 3);
          const angle = random() * 2 * Math.PI;
          const speed = Math.sqrt(body.mu / r) * random() * 1.6;
          const direction = random() * 2 * Math.PI;
          let state: State = {
            time: random() * 100, heading: random() * 2 * Math.PI - Math.PI, throttle: random(),
            status: 'flying', revision: Math.floor(random() * 1000),
            position: { x: r * Math.cos(angle), y: r * Math.sin(angle) },
            velocity: { x: speed * Math.cos(direction), y: speed * Math.sin(direction) },
            ...(random() < 0.2 ? { godMode: true } : {}),
          };
          if (surface?.seaRadiusMetres && r < surface.seaRadiusMetres) state = { ...state, water: 'submerged' };
          const controls: Controls = { turn: Math.floor(random() * 3) - 1, throttle: Math.floor(random() * 3) - 1,
            engine: random() < 0.6 };
          // Twenty steps along each path: burns, coasting, contact, landing, floating.
          let ours: State = state, theirs = state as unknown as reference.State;
          for (let k = 0; k < 20; k++) {
            const a = run(() => advance(ours, controls, 0.01, body, surface));
            const b = run(() => reference.advance(theirs, controls, 0.01, body, surface) as unknown as State);
            expect(a.ok).toBe(b.ok);
            if (!a.ok || !b.ok) { expect(a).toEqual(b); break; }
            expect(a.state).toEqual(b.state);
            const s = run(() => step(ours, controls, 0.01, body, surface));
            const t = run(() => reference.step(theirs, controls, 0.01, body, surface) as unknown as State);
            expect(s).toEqual(t);
            compared++;
            if (controls.engine && a.state.dynamics === 'numerical') burning++;
            if (a.state.status !== 'flying' || a.state.contact) contacts++;
            ours = a.state; theirs = b.state as unknown as reference.State;
          }
        }
      }
      expect(compared).toBeGreaterThan(1000);
      expect(burning).toBeGreaterThan(100);
      expect(contacts).toBeGreaterThan(10);
      // About a second alone; the full suite's parallel workers can stretch it past 5 s.
    }, 20_000);
  }
});
