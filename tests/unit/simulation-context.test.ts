import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Controls, GhostEnd, GhostSample, SimulationContext, UniverseDefinition, VehicleDefaults } from '../../packages/game-api/src/index';
import { createSimulationContext, initialState, planet } from '../../packages/sim-core/src/context';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';
import { predict, setVehicle } from '../../packages/sim-core/src/index';
import { DEFAULT_UNIVERSE, validateUniverse } from '../../packages/sim-core/src/universe';
import { loadWorld, saveWorld } from '../../packages/sim-core/src/save';
import { World } from '../../packages/sim-core/src/world';
import { OCEAN_UNIVERSE } from '../../packages/scenarios/builtin';
import { LocalSession } from '../../apps/web/src/session';
import { Prediction } from '../../apps/web/src/prediction';
import { Game } from '../helpers/net-harness';

const slow = { acceleration: 150, turnRate: .3, initialThrottle: .4 };
const fast = { acceleration: 420, turnRate: 1.7, initialThrottle: .8 };
// Keep universe/body IDs identical: identity alone cannot distinguish these settings.
function configured(vehicleDefaults: VehicleDefaults, base = DEFAULT_UNIVERSE): UniverseDefinition {
  return validateUniverse({ ...base, systems: base.systems.map(system => ({ ...system, vehicleDefaults })) });
}
function world(settings: VehicleDefaults, rails = true): World {
  const w = new World(configured(settings));
  w.rails = rails;
  w.spawn({ ownerId: 'pilot', presetId: 'pad', godMode: true });
  w.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
  w.spawn({ ownerId: 'pilot', presetId: 'moon-orbit' });
  return w;
}
function controls(tick: number): Controls {
  if (tick < 80) return { turn: 0, throttle: .2, engine: true };
  if (tick < 130) return { turn: .4, throttle: 0, engine: true };
  if (tick < 160) return { turn: -.3, throttle: -.2, engine: false };
  return IDLE;
}
function advance(w: World, tick: number) {
  w.setControls('ship-1', controls(tick));
  const events = w.step();
  return { tick: w.tick, time: w.time, ships: w.ships(), events };
}
function collect(job: Generator<GhostSample, GhostEnd>) {
  const samples: GhostSample[] = [];
  for (;;) {
    const result = job.next();
    if (result.done) return { samples, end: result.value };
    samples.push(result.value);
  }
}

afterEach(() => setVehicle({}));

describe('independent simulation contexts', () => {
  it('detaches and freezes settings, rejects invalid values, and clones without sharing caches', () => {
    const settings = { ...slow };
    const context = createSimulationContext(settings);
    settings.acceleration = 900;
    expect(context.vehicle).toEqual(slow);
    expect(Object.isFrozen(context.vehicle)).toBe(true);
    const clone = context.cloneForPrediction();
    expect(clone.modelIdentity).toBe(context.modelIdentity);
    expect(clone.vehicle).not.toBe(context.vehicle);
    expect(createSimulationContext(fast).modelIdentity).not.toBe(context.modelIdentity);
    for (const bad of [{ acceleration: NaN }, { turnRate: Infinity }, { acceleration: -1 }, { initialThrottle: 1.1 }]) {
      expect(() => createSimulationContext(bad)).toThrow('Invalid simulation vehicle settings');
    }
    const state = context.advance(initialState('planet-orbit'), IDLE, STEP, planet);
    const coast = state.coast!;
    context.coastAt(coast, 1, planet);
    expect(context.coastCacheStats(coast).samples).toBe(1);
    expect(clone.coastCacheStats(coast).samples).toBe(0);
    clone.coastAt(coast, 2, planet);
    clone.dispose(); clone.dispose();
    expect(clone.coastCacheStats(coast).samples).toBe(0);
    expect(context.coastCacheStats(coast).samples).toBe(1);
    context.dispose();
    expect(context.coastCacheStats(coast).samples).toBe(0);
  });

  for (const rails of [false, true]) it(`matches isolated worlds at every tick with rails ${rails ? 'on' : 'off'}`, () => {
    const run = (settings: VehicleDefaults) => {
      const w = world(settings, rails);
      return Array.from({ length: 350 }, (_, tick) => advance(w, tick));
    };
    const expectedSlow = run(slow), expectedFast = run(fast);
    const a = world(slow, rails), b = world(fast, rails);
    for (let tick = 0; tick < 350; tick++) {
      // Poison the legacy adapter too: explicit worlds must never read it.
      setVehicle({ acceleration: 1, turnRate: 9 });
      expect(advance(a, tick)).toEqual(expectedSlow[tick]);
      setVehicle({ acceleration: 1000, turnRate: .001 });
      expect(advance(b, tick)).toEqual(expectedFast[tick]);
    }
    expect(a.ship('ship-1')!.state.position).not.toEqual(b.ship('ship-1')!.state.position);
  });

  it('restores and validates with the candidate context, then resumes both worlds exactly', () => {
    const a = world(slow), b = world(fast);
    for (let tick = 0; tick < 190; tick++) { advance(a, tick); advance(b, tick); }
    const trial = vi.fn();
    const restore = (w: World) => loadWorld(JSON.parse(JSON.stringify(saveWorld(w))), {
      createContext(settings) {
        const context = createSimulationContext(settings);
        return { ...context, advance(...args) { trial(settings, args[0].time); return context.advance(...args); } };
      },
    }).world;
    setVehicle({ acceleration: 0, turnRate: 0 });
    const restoredA = restore(a), restoredB = restore(b);
    expect(trial.mock.calls.map(call => call[0])).toEqual([slow, slow, slow, fast, fast, fast]);
    expect(restoredA.context).not.toBe(a.context);
    for (let tick = 190; tick < 350; tick++) {
      expect(advance(restoredA, tick)).toEqual(advance(a, tick));
      expect(advance(restoredB, tick)).toEqual(advance(b, tick));
    }
    const dispose = vi.fn();
    const invalid = structuredClone(saveWorld(a));
    (invalid.ships as unknown as { heading: number }[])[0]!.heading = NaN;
    expect(() => loadWorld(invalid, { createContext(settings) {
      return { ...createSimulationContext(settings), dispose };
    } })).toThrow('heading');
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('interleaves suspended predictions, live motion and a restored ocean world without changing samples', () => {
    const a = new World(configured(slow, OCEAN_UNIVERSE));
    const b = new World(configured(fast, OCEAN_UNIVERSE));
    const makeJob = (w: World, preset: string) => {
      const start = w.presetState(preset), body = w.body(start.bodyId);
      const context = w.context.cloneForPrediction();
      return { context, job: context.predict(start.state, false, body, w.surface(body.id)) };
    };
    const expectedA = collect(makeJob(a, 'splash').job), expectedB = collect(makeJob(b, 'heavy').job);
    const jobA = makeJob(a, 'splash'), jobB = makeJob(b, 'heavy');
    const restored = loadWorld(saveWorld(b)).world;
    const live = a.spawn({ ownerId: 'pilot', presetId: 'orbit' });
    a.setControls(live.id, { turn: 1, throttle: 0, engine: true });
    const actual = [[], []] as [GhostSample[], GhostSample[]];
    const ends: Array<GhostEnd | undefined> = [];
    for (let i = 0; ends[0] === undefined || ends[1] === undefined; i++) {
      expect(i).toBeLessThan(9000);
      a.step(); restored.step();
      setVehicle(i % 2 ? slow : fast);
      for (const [index, item] of [jobA, jobB].entries()) if (ends[index] === undefined) {
        const result = item.job.next();
        if (result.done) ends[index] = result.value;
        else actual[index]!.push(result.value);
      }
    }
    expect({ samples: actual[0], end: ends[0] }).toEqual(expectedA);
    expect({ samples: actual[1], end: ends[1] }).toEqual(expectedB);
    expect(ends).toEqual(['floating', 'impact']);
    jobA.context.dispose(); jobB.context.dispose();
    // Legacy iterators also bind settings when created, before any call to next().
    setVehicle(slow);
    const legacy = predict(initialState('planet-orbit'), .02);
    setVehicle(fast);
    const reference = createSimulationContext(slow);
    const start = initialState('planet-orbit');
    legacy.next();
    expect(legacy.next().value?.position).toEqual(reference.advance(start, IDLE, STEP, planet).position);
  });

  it('keeps local sessions and two host/client pairs independent across replay and saves', () => {
    const localA = new LocalSession(world(slow), { name: 'A' });
    const localB = new LocalSession(world(fast), { name: 'B' });
    const isolatedA = loadWorld(saveWorld(localA.world)).world;
    const isolatedB = loadWorld(saveWorld(localB.world)).world;
    // Command a newly owned ship; the pre-existing fleet belongs to another pilot.
    const idA = localA.spawn('pad', true)!, idB = localB.spawn('pad', true)!;
    isolatedA.put(localA.world.ship(idA)!); isolatedB.put(localB.world.ship(idB)!);
    for (let tick = 0; tick < 200; tick++) {
      localA.update(STEP, idA, controls(tick));
      localB.update(STEP, idB, controls(tick));
      isolatedA.setControls(idA, controls(tick)); isolatedA.step();
      isolatedB.setControls(idB, controls(tick)); isolatedB.step();
      expect(localA.world.ship(idA)!.state).toEqual(isolatedA.ship(idA)!.state);
      expect(localB.world.ship(idB)!.state).toEqual(isolatedB.ship(idB)!.state);
    }
    const games = [new Game({}, new World(configured(slow))), new Game({}, new World(configured(fast)))];
    const pilots = games.map(g => g.join('pilot'));
    for (let ms = 0; ms < 2500; ms++) {
      for (const [index, game] of games.entries()) {
        pilots[index]!.controls = controls(Math.floor(Math.max(0, ms - 500) / 10));
        game.run(1, true);
      }
    }
    for (const [index, game] of games.entries()) {
      const client = pilots[index]!.client, mirror = client.world!;
      expect(client.phase).toBe('joined');
      expect(mirror.context.vehicle).toEqual(game.host.world.context.vehicle);
      expect(mirror.context).not.toBe(game.host.world.context);
      const id = client.ownShips()[0]!.id, tick = mirror.tick, state = mirror.ship(id)!.state;
      game.run(500, true);
      expect(state).toEqual(game.hostTicks.get(tick)!.get(id));
    }
  });

  it('cancels and disposes a web prediction clone when the world changes or the preview is invalidated', () => {
    const a = world(slow), b = world(slow);
    const disposed: ReturnType<typeof vi.fn>[] = [];
    const instrument = (context: SimulationContext): SimulationContext => ({ ...context,
      cloneForPrediction() {
        const clone = context.cloneForPrediction(), dispose = vi.fn(() => clone.dispose());
        disposed.push(dispose);
        return { ...clone, dispose };
      },
    });
    const preview = new Prediction(() => {});
    const start = a.presetState('planet-orbit'), body = a.body(start.bodyId);
    preview.update(instrument(a.context), start.state, body, undefined, 'ship-1', 0, false);
    expect(preview.pass).toBeDefined();
    preview.update(instrument(b.context), start.state, body, undefined, 'ship-1', 0, false);
    expect(disposed[0]).toHaveBeenCalledOnce();
    expect(disposed[1]).not.toHaveBeenCalled();
    preview.invalidate();
    expect(disposed[1]).toHaveBeenCalledOnce();
    expect(preview.path).toEqual([]);
  });
});
