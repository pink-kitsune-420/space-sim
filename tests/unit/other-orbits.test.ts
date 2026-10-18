import { describe, expect, it, vi } from 'vitest';
import { OtherOrbits, showOtherOrbits, OTHER_ORBIT_PATH_LIMIT } from '../../apps/web/src/other-orbits';
import { createSimulationContext, DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { saveWorld } from '../../packages/sim-core/src/save';

const isPilot = (id: string) => id !== 'debris';
const camera = { center: { x: 0, y: 0 }, rotation: 0, scale: .1 };
const atBody = (world: World) => ({ ...camera, center: world.system.getBodyPosition(world.records().next().value!.bodyId, world.time) });
function finish(orbits: OtherOrbits, world: World, now = 0): void {
  orbits.maxMs = 100;
  for (let i = 0; i < 8; i++) orbits.update(world, 'me', isPilot, now + i, true);
}

describe('other pilots coast previews', () => {
  it('uses Auto only for small groups, while Always and Off remain explicit choices', () => {
    expect(showOtherOrbits('auto', 0)).toBe(false);
    expect(showOtherOrbits('auto', 8)).toBe(true);
    expect(showOtherOrbits('auto', 9)).toBe(false);
    expect(showOtherOrbits('always', 100)).toBe(true);
    expect(showOtherOrbits('off', 1)).toBe(false);
  });

  it('predicts other flying pilots at a slower cadence without changing the world', () => {
    const world = new World(DEFAULT_UNIVERSE);
    world.spawn({ ownerId: 'me', presetId: 'planet-orbit' });
    world.spawn({ ownerId: 'other', presetId: 'planet-orbit' });
    world.spawn({ ownerId: 'debris', presetId: 'planet-orbit' });
    world.spawn({ ownerId: 'landed', presetId: 'pad' });
    const before = saveWorld(world), orbits = new OtherOrbits();
    finish(orbits, world);
    expect(orbits.stats.paths).toBe(1);
    expect(orbits.stats.starts).toBe(1);
    expect(saveWorld(world)).toEqual(before);
    for (let i = 20; i < 990; i += 16) orbits.update(world, 'me', isPilot, i, true);
    expect(orbits.stats.starts).toBe(1);
    finish(orbits, world, 1000);
    expect(orbits.stats.starts).toBe(2);
    const overlays = orbits.overlays(world, world.time, 'me', atBody(world), 800, 600);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ kind: 'line', color: '#efb66b66' });
    expect(orbits.overlays(world, world.time, 'other', atBody(world), 800, 600)).toHaveLength(0);
    orbits.clear(); world.dispose();
  });

  it('drops previews on landing, disconnection and world replacement', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const ship = world.spawn({ ownerId: 'other', presetId: 'planet-orbit' });
    const orbits = new OtherOrbits();
    finish(orbits, world);
    world.respawn(ship.id, 'pad');
    orbits.update(world, 'me', isPilot, 10, true);
    expect(orbits.stats.paths).toBe(0);
    world.respawn(ship.id, 'planet-orbit'); finish(orbits, world, 2000);
    expect(orbits.stats.paths).toBe(1);
    orbits.update(world, 'me', () => false, 2010, true);
    expect(orbits.stats.paths).toBe(0);
    const next = new World(DEFAULT_UNIVERSE);
    orbits.update(next, 'me', isPilot, 2020, true);
    expect(orbits.stats.paths).toBe(0);
    orbits.clear(); world.dispose(); next.dispose();
  });

  it('caps work and gives each pilot a vessel before filling the spare slots', () => {
    const world = new World(DEFAULT_UNIVERSE);
    for (let i = 0; i < 20; i++) world.spawn({ ownerId: i < 18 ? 'fleet' : `pilot-${i}`, presetId: 'planet-orbit' });
    const orbits = new OtherOrbits(); orbits.maxMs = 100;
    for (let i = 0; i < 160; i++) orbits.update(world, 'me', isPilot, i, true);
    expect(orbits.stats.starts).toBe(OTHER_ORBIT_PATH_LIMIT);
    expect(orbits.stats.paths).toBe(OTHER_ORBIT_PATH_LIMIT);
    expect(orbits.overlays(world, 0, 'fleet', atBody(world), 800, 600)).toHaveLength(2);
    orbits.clear(); world.dispose();
  });

  it('disposes a pending isolated context when previews are disabled', () => {
    const disposals: ReturnType<typeof vi.fn>[] = [];
    const world = new World(DEFAULT_UNIVERSE, { createContext: () => {
      const context = createSimulationContext();
      return { ...context, cloneForPrediction() {
        const clone = context.cloneForPrediction();
        const dispose = vi.fn(() => clone.dispose()); disposals.push(dispose);
        return { ...clone, dispose };
      } };
    } });
    world.spawn({ ownerId: 'other', presetId: 'planet-orbit' });
    const orbits = new OtherOrbits(); orbits.maxMs = 0;
    orbits.update(world, 'me', isPilot, 0, true);
    expect(disposals).toHaveLength(1);
    orbits.update(world, 'me', isPilot, 1, false);
    expect(disposals[0]).toHaveBeenCalledTimes(1);
    expect(orbits.stats.paths).toBe(0);
    world.dispose();
  });

  it('disposes a clone when a provider refuses to create its forecast', () => {
    const dispose = vi.fn();
    const world = new World(DEFAULT_UNIVERSE, { createContext: () => {
      const context = createSimulationContext();
      return { ...context, cloneForPrediction() {
        const clone = context.cloneForPrediction();
        return { ...clone, predict() { throw new Error('provider failure'); },
          dispose() { dispose(); clone.dispose(); } };
      } };
    } });
    world.spawn({ ownerId: 'other', presetId: 'planet-orbit' });
    const orbits = new OtherOrbits();
    expect(() => orbits.update(world, 'me', isPilot, 0, true)).not.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
    expect(orbits.stats.paths).toBe(0);
    orbits.clear(); world.dispose();
  });
});
