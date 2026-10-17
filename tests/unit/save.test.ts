import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE, MODEL, createSimulationContext, validateUniverse } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { MAX_SAVE_SHIPS, SAVE_FORMAT, loadWorld, saveWorld, type WorldSave } from '../../packages/sim-core/src/save';
import { registerModuleMigration, clearModuleMigrations } from '../../packages/game-runtime/src/authoritative';
import fixture from '../fixtures/world-save-v1.json';
import oceanWorld from '../../games/space-sim/universes/sandbox/ocean/universe.json';

function flownWorld(): World {
  const world = new World(DEFAULT_UNIVERSE, { id: 'w-test' });
  world.spawn({ ownerId: 'p-a', presetId: 'pad', godMode: true });
  world.spawn({ ownerId: 'p-a', presetId: 'planet-orbit' });
  world.spawn({ ownerId: 'p-b', presetId: 'moon-orbit' });
  const climber = world.spawn({ ownerId: 'p-b', presetId: 'pad' });
  world.setControls(climber.id, { turn: 0.5, throttle: 1, engine: true });
  for (let i = 0; i < 250; i++) world.step();
  return world;
}
const roundTrip = (save: WorldSave): unknown => JSON.parse(JSON.stringify(save));
function mutate(edit: (save: Record<string, any>) => void): unknown {
  const save = structuredClone(fixture) as Record<string, any>;
  edit(save);
  return save;
}

describe('complete-world saves', () => {
  it('restore every ship exactly and resume identically, including exact coasts', () => {
    const world = flownWorld();
    const loaded = loadWorld(roundTrip(saveWorld(world, { players: [{ id: 'p-a', name: 'A' }, { id: 'p-b', name: 'B' }] })));
    const copy = loaded.world;
    expect([copy.id, copy.tick, copy.time, copy.nextShipNumber]).toEqual([world.id, world.tick, world.time, world.nextShipNumber]);
    expect(loaded.players.map(p => p.id)).toEqual(['p-a', 'p-b']);
    for (const ship of world.ships()) {
      const restored = copy.ship(ship.id)!;
      expect(restored.state.position).toEqual(ship.state.position);
      expect(restored.state.coast?.epochSeconds).toEqual(ship.state.coast?.epochSeconds);
    }
    // Held commands are cleared on load; release them in the original too, then compare.
    for (const ship of world.ships()) world.setControls(ship.id, { turn: 0, throttle: 0, engine: false });
    for (let i = 0; i < 500; i++) { world.step(); copy.step(); }
    for (const ship of world.ships()) {
      expect(copy.ship(ship.id)!.state.position).toEqual(ship.state.position);
      expect(copy.ship(ship.id)!.state.velocity).toEqual(ship.state.velocity);
      expect(copy.ship(ship.id)!.bodyId).toBe(ship.bodyId);
    }
  });

  it('keeps water and terrain support states', () => {
    const world = new World(validateUniverse(oceanWorld), { id: 'w-ocean' });
    const ship = world.spawn({ ownerId: 'p', presetId: 'splash' });
    for (let i = 0; i < 2000 && world.ship(ship.id)!.state.water !== 'floating'; i++) world.step();
    const copy = loadWorld(roundTrip(saveWorld(world))).world;
    expect(copy.ship(ship.id)!.state).toMatchObject({ water: 'floating', status: 'landed' });
    expect(copy.surfaces.size).toBe(world.surfaces.size);
  });

  it('reads the version 1 fixture and writes it back unchanged', () => {
    const loaded = loadWorld(fixture);
    expect(loaded.world.size).toBe(4);
    expect(loaded.hostId).toBe('p-alpha');
    expect(loaded.world.ship('ship-2')!.state.dynamics).toBe('kepler');
    const again = saveWorld(loaded.world, { players: loaded.players, hostId: loaded.hostId, paused: false,
      savedAt: fixture.savedAt });
    // A version 1 save from model v1 loads unchanged; writing it records the current model.
    expect(again.model).toBe(MODEL);
    expect({ ...(roundTrip(again) as object), model: fixture.model }).toEqual(fixture);
    for (let i = 0; i < 100; i++) loaded.world.step();
    expect(loaded.world.ships().every(s => !s.fault)).toBe(true);
    expect(loaded.world.spawn({ ownerId: 'p-alpha' }).id).toBe('ship-5');
  });

  it.each<[string, (save: Record<string, any>) => void, string]>([
    ['another format', s => { s.format = 'space-sim-shaders/1'; }, `not a ${SAVE_FORMAT} file`],
    ['a newer version', s => { s.version = 3; }, 'Unsupported save version 3'],
    ['another physics model', s => { s.model = 'other'; }, `physics model other differs from ${MODEL}`],
    ['other units', s => { s.units.length = 'foot'; }, 'units must be metre'],
    ['an unknown system', s => { s.systemId = 'nowhere'; }, 'unknown system nowhere'],
    ['a clock mismatch', s => { s.time = 99; }, 'time and tick disagree'],
    ['a non-finite value', s => { s.ships[1].velocity[0] = null; }, 'Ship ship-2 velocity: must be a finite number'],
    ['an unknown body', s => { s.ships[0].bodyId = 'pluto'; }, 'unknown body pluto'],
    ['a duplicate ship', s => { s.ships[1].id = 'ship-1'; }, 'duplicate ship id ship-1'],
    ['a moved coasting ship', s => { s.ships[1].position[0] += 1; }, 'coast epoch disagrees'],
    ['a ship inside the planet', s => { s.ships[3].position = [0, 400]; }, 'inside ground'],
    ['a hovering landed ship', s => { s.ships[0].position = [0, 600]; }, 'Ship ship-1'],
    ['a bad throttle', s => { s.ships[0].throttle = 2; }, 'throttle must be in [0, 1]'],
    ['a bad token hash', s => { s.players[0].tokenHash = 'secret'; }, 'tokenHash must be 64 lowercase hex digits'],
    ['an unknown host', s => { s.hostId = 'p-zulu'; }, 'hostId is not a listed player'],
    ['an invalid universe', s => { s.universe.systems = []; }, 'Universe must contain at least one system'],
  ])('rejects %s with a clear message', (_name, edit, message) => {
    expect(() => loadWorld(mutate(edit))).toThrow(message);
  });

  it('rejects oversized saves before building anything', () => {
    expect(() => loadWorld(mutate(s => { s.ships = Array.from({ length: MAX_SAVE_SHIPS + 1 }, () => s.ships[0]); })))
      .toThrow(`at most ${MAX_SAVE_SHIPS}`);
    expect(() => loadWorld('nonsense')).toThrow('Save: must be an object');
  });

  it('round-trips an empty world with its universe embedded', () => {
    const save = saveWorld(new World(DEFAULT_UNIVERSE, { id: 'w-empty' }));
    expect(save.universe.id).toBe(DEFAULT_UNIVERSE.id);
    expect(loadWorld(roundTrip(save)).world.size).toBe(0);
  });

  it('migrates a version 1 save to version 2 with default lock and empty module state', () => {
    const loaded = loadWorld(fixture);
    expect(loaded.world.lock?.profileId).toBe('builtin.default');
    expect(loaded.world.simulationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.world.moduleState).toEqual({});
  });

  it('saves and restores version 2 modular worlds with per-ship and rule moduleState', () => {
    const ruleHook = {
      modelIdentity: 'test-rule/v1',
      seed: 42,
      initialState: { version: 1, value: 10 },
      evaluate: ({ state, random }: any) => ({
        state: { version: 1, value: (state.value as number) + 5 + Math.floor(random() * 5) },
      }),
    };
    const forceHook = {
      modelIdentity: 'test-force/v1',
      initialState: { version: 1, value: 5 },
      evaluate: () => ({ x: 0, y: 1 }),
      commit: ({ moduleState }: any) => ({ version: 1, value: (moduleState.value as number) + 1 }),
    };

    const world = new World(DEFAULT_UNIVERSE, {
      id: 'w-modular',
      soloPreview: false,
      rules: [{ moduleId: 'test.rule', version: '0.1.0', hook: ruleHook }],
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces: [{ moduleId: 'test.force', version: '0.1.0', hook: forceHook }],
      }),
    });

    const ship = world.spawn({ ownerId: 'p-1', presetId: 'pad' });
    world.step();
    expect(world.moduleState['test.rule']?.state.value).toBeGreaterThan(10);
    expect(world.ship(ship.id)!.state.moduleState?.['test.force']?.value).toBe(6);

    const saved = saveWorld(world, { players: [{ id: 'p-1', name: 'Pilot' }] });
    expect(saved.version).toBe(2);
    expect(saved.simulationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.moduleState?.['test.rule']?.state.value).toBe(world.moduleState['test.rule']?.state.value);
    expect(saved.ships[0]?.moduleState?.['test.force']?.value).toBe(6);

    const loaded = loadWorld(roundTrip(saved), {
      soloPreview: false,
      rules: [{ moduleId: 'test.rule', version: '0.1.0', hook: ruleHook }],
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces: [{ moduleId: 'test.force', version: '0.1.0', hook: forceHook }],
      }),
    });

    expect(loaded.world.moduleState['test.rule']?.state.value).toBe(world.moduleState['test.rule']?.state.value);
    expect(loaded.world.ship(ship.id)!.state.moduleState?.['test.force']?.value).toBe(6);

    world.dispose();
    loaded.world.dispose();
  });

  it('migrates module state when newer version is registered', () => {
    registerModuleMigration('test.evolving-force', 1, 2, value => ({
      thrustMultiplier: (value as { legacyThrust: number }).legacyThrust * 2,
    }));
    registerModuleMigration('test.evolving-rule', 1, 2, value => ({
      threshold: (value as { limit: number }).limit + 100,
    }));

    const rawSave: any = {
      format: SAVE_FORMAT,
      version: 2,
      model: MODEL,
      units: { length: 'metre', time: 'second', angle: 'radian' },
      worldId: 'w-migrate',
      universe: DEFAULT_UNIVERSE,
      systemId: 'primus-system',
      tick: 0,
      time: 0,
      nextShipNumber: 2,
      players: [{ id: 'p-1', name: 'Pilot' }],
      ships: [{
        id: 'ship-1',
        name: 'Vessel 01',
        ownerId: 'p-1',
        bodyId: 'planet',
        position: [0, 512],
        velocity: [0, 0],
        heading: 1.5707963267948966,
        throttle: 0.5,
        status: 'landed',
        revision: 0,
        godMode: true,
        moduleState: {
          'test.evolving-force': {
            version: 1,
            value: { legacyThrust: 50 },
          },
        },
      }],
      moduleState: {
        'test.evolving-rule': {
          randomState: 12345,
          state: {
            version: 1,
            value: { limit: 25 },
          },
        },
      },
    };

    const forceHook = {
      modelIdentity: 'test-evolving-force/v2',
      initialState: { version: 2, value: { thrustMultiplier: 100 } },
      evaluate: () => ({ x: 0, y: 0 }),
      commit: ({ moduleState }: any) => moduleState,
    };
    const ruleHook = {
      modelIdentity: 'test-evolving-rule/v2',
      seed: 99,
      initialState: { version: 2, value: { threshold: 125 } },
      evaluate: ({ state }: any) => ({ state }),
    };

    const loaded = loadWorld(rawSave, {
      soloPreview: false,
      forces: [{ moduleId: 'test.evolving-force', version: '0.2.0', hook: forceHook }],
      rules: [{ moduleId: 'test.evolving-rule', version: '0.2.0', hook: ruleHook }],
    });

    expect(loaded.world.ship('ship-1')?.state.moduleState?.['test.evolving-force']).toEqual({
      version: 2,
      value: { thrustMultiplier: 100 },
    });
    expect(loaded.world.moduleState['test.evolving-rule']?.state).toEqual({
      version: 2,
      value: { threshold: 125 },
    });

    loaded.world.dispose();
    clearModuleMigrations();
  });
});
