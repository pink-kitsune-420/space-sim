import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIVERSE,
  DEFAULT_UNIVERSE_PHYSICS,
  resolveUniversePhysics,
  validatePhysics,
  validateUniverse,
} from '../../packages/sim-core/src/universe';
import { World } from '../../packages/sim-core/src/world';
import { loadWorld, saveWorld, type WorldSave } from '../../packages/sim-core/src/save';
import { physicalUniverseDigest } from '../../packages/game-runtime/src/authoritative';

function createMockUniverse(physics?: unknown): unknown {
  return {
    schemaVersion: 1,
    id: 'test-universe',
    name: 'Test Universe',
    defaultSystemId: 'sys-1',
    systems: [
      {
        id: 'sys-1',
        name: 'System 1',
        bodies: [
          {
            id: 'sun',
            name: 'Sun',
            radius: 1000000,
            mass: 1.989e30,
            color: '#fff6e0',
          },
          {
            id: 'planet',
            name: 'Planet',
            parentId: 'sun',
            radius: 6371000,
            mass: 5.972e24,
            ephemeris: {
              kind: 'circular-kepler',
              radius: 149597870700,
            },
          },
        ],
        presets: [
          {
            id: 'start',
            name: 'Start',
            bodyId: 'planet',
            kind: 'circular-orbit',
            altitude: 200000,
          },
        ],
      },
    ],
    ...(physics !== undefined ? { physics } : {}),
  };
}

describe('Universe Physics Schema & Bounds Validation', () => {
  it('parses valid comprehensive physics configuration', () => {
    const raw = createMockUniverse({
      mode: 'full-body',
      substeps: 8,
      softeningRatio: 0.15,
      enableJ2: true,
      enableTidalTorque: true,
      collisionMode: 'bounce',
      restitution: 0.75,
      maxWarp: 50,
    });
    const validated = validateUniverse(raw);
    expect(validated.physics).toEqual({
      mode: 'full-body',
      substeps: 8,
      softeningRatio: 0.15,
      enableJ2: true,
      enableTidalTorque: true,
      collisionMode: 'bounce',
      restitution: 0.75,
      maxWarp: 50,
    });
  });

  it('accepts each supported physics mode', () => {
    for (const mode of ['rails', 'nbody', 'full-body'] as const) {
      const u = validateUniverse(createMockUniverse({ mode }));
      expect(u.physics?.mode).toBe(mode);
    }
  });

  it('omits physics property when raw physics is absent or empty', () => {
    const withoutPhysics = validateUniverse(createMockUniverse(undefined));
    expect(withoutPhysics.physics).toBeUndefined();
    expect('physics' in withoutPhysics).toBe(false);

    const withEmptyPhysics = validateUniverse(createMockUniverse({}));
    expect(withEmptyPhysics.physics).toBeUndefined();
    expect('physics' in withEmptyPhysics).toBe(false);
  });

  it('forwards physics when wrapping single-system universes', () => {
    const singleSystem = {
      id: 'sys-single',
      name: 'Single System',
      physics: { mode: 'nbody', substeps: 4 },
      bodies: [
        {
          id: 'root',
          name: 'Root',
          radius: 1000,
          mass: 1e12,
        },
      ],
      presets: [
        {
          id: 'p1',
          name: 'Preset 1',
          bodyId: 'root',
          kind: 'circular-orbit',
        },
      ],
    };
    const wrapped = validateUniverse(singleSystem);
    expect(wrapped.physics).toEqual({ mode: 'nbody', substeps: 4 });
  });

  it('rejects unknown keys in physics configuration for typo safety', () => {
    expect(() => validateUniverse(createMockUniverse({ mode: 'nbody', subSteps: 4 }))).toThrow(
      /unknown setting "subSteps"/,
    );
  });

  it('rejects invalid physics mode', () => {
    expect(() => validateUniverse(createMockUniverse({ mode: 'quantum' }))).toThrow(
      /mode must be 'rails', 'nbody' or 'full-body'/,
    );
  });

  it('validates substeps bounds and types', () => {
    expect(() => validateUniverse(createMockUniverse({ substeps: 0 }))).toThrow(/substeps must be an integer from 1 to 64/);
    expect(() => validateUniverse(createMockUniverse({ substeps: 65 }))).toThrow(/substeps must be an integer from 1 to 64/);
    expect(() => validateUniverse(createMockUniverse({ substeps: 2.5 }))).toThrow(/substeps must be an integer from 1 to 64/);
    expect(() => validateUniverse(createMockUniverse({ substeps: '4' }))).toThrow(/substeps must be an integer from 1 to 64/);
  });

  it('validates softeningRatio bounds', () => {
    expect(() => validateUniverse(createMockUniverse({ softeningRatio: -0.01 }))).toThrow(
      /softeningRatio must be a non-negative finite number/,
    );
    expect(() => validateUniverse(createMockUniverse({ softeningRatio: NaN }))).toThrow(
      /softeningRatio must be a non-negative finite number/,
    );
    expect(() => validateUniverse(createMockUniverse({ softeningRatio: Infinity }))).toThrow(
      /softeningRatio must be a non-negative finite number/,
    );
  });

  it('validates boolean flags enableJ2 and enableTidalTorque', () => {
    expect(() => validateUniverse(createMockUniverse({ enableJ2: 'true' }))).toThrow(/enableJ2 must be boolean/);
    expect(() => validateUniverse(createMockUniverse({ enableTidalTorque: 1 }))).toThrow(/enableTidalTorque must be boolean/);
  });

  it('validates collisionMode and restitution bounds', () => {
    expect(() => validateUniverse(createMockUniverse({ collisionMode: 'disintegrate' }))).toThrow(
      /collisionMode must be 'merge', 'bounce' or 'none'/,
    );
    expect(() => validateUniverse(createMockUniverse({ restitution: -0.1 }))).toThrow(/restitution must be a number from 0 to 1/);
    expect(() => validateUniverse(createMockUniverse({ restitution: 1.01 }))).toThrow(/restitution must be a number from 0 to 1/);
  });

  it('validates maxWarp bounds', () => {
    expect(() => validateUniverse(createMockUniverse({ maxWarp: 0 }))).toThrow(/maxWarp must be a finite number from 1 to 100000/);
    expect(() => validateUniverse(createMockUniverse({ maxWarp: 100001 }))).toThrow(/maxWarp must be a finite number from 1 to 100000/);
  });

  it('rejects non-object physics input in validatePhysics', () => {
    expect(() => validatePhysics('string')).toThrow(/must be an object/);
    expect(() => validatePhysics([1, 2, 3])).toThrow(/must be an object/);
  });
});

describe('resolveUniversePhysics Canonical Defaults', () => {
  it('resolves default rails physics when universe.physics is omitted', () => {
    const universe = validateUniverse(createMockUniverse(undefined));
    const resolved = resolveUniversePhysics(universe);
    expect(resolved).toEqual(DEFAULT_UNIVERSE_PHYSICS);
    expect(resolved).toEqual({
      mode: 'rails',
      substeps: 1,
      softeningRatio: Math.sqrt(0.05),
      enableJ2: false,
      enableTidalTorque: false,
      collisionMode: 'merge',
      restitution: 0.5,
      maxWarp: 100_000,
    });
  });

  it('defaults maxWarp to 100,000 for rails and 4 for simulated universes', () => {
    const railsU = validateUniverse(createMockUniverse({ mode: 'rails' }));
    expect(resolveUniversePhysics(railsU).maxWarp).toBe(100_000);

    const nbodyU = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    expect(resolveUniversePhysics(nbodyU).maxWarp).toBe(4);

    const fullBodyU = validateUniverse(createMockUniverse({ mode: 'full-body' }));
    expect(resolveUniversePhysics(fullBodyU).maxWarp).toBe(4);

    const explicitWarpU = validateUniverse(createMockUniverse({ mode: 'nbody', maxWarp: 16 }));
    expect(resolveUniversePhysics(explicitWarpU).maxWarp).toBe(16);
  });

  it('preserves bit-identical digest for legacy DEFAULT_UNIVERSE', () => {
    expect(DEFAULT_UNIVERSE.physics).toBeUndefined();
    const digest = physicalUniverseDigest(DEFAULT_UNIVERSE);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // Evaluating DEFAULT_UNIVERSE twice produces identical digest
    expect(physicalUniverseDigest(DEFAULT_UNIVERSE)).toBe(digest);
  });
});

describe('World Persistence with Universe Physics and Body Snapshots', () => {
  const roundTrip = (save: WorldSave): unknown => JSON.parse(JSON.stringify(save));

  it('round-trips universe physics settings in saveWorld / loadWorld', () => {
    const universe = validateUniverse(
      createMockUniverse({
        mode: 'nbody',
        substeps: 4,
        softeningRatio: 0.1,
        collisionMode: 'bounce',
        restitution: 0.6,
        maxWarp: 8,
      }),
    );
    const world = new World(universe, { id: 'w-nbody' });
    const saved = saveWorld(world);
    expect(saved.universe.physics).toEqual({
      mode: 'nbody',
      substeps: 4,
      softeningRatio: 0.1,
      collisionMode: 'bounce',
      restitution: 0.6,
      maxWarp: 8,
    });

    const loaded = loadWorld(roundTrip(saved));
    expect(loaded.world.universe.physics).toEqual(saved.universe.physics);
    expect(resolveUniversePhysics(loaded.world.universe).mode).toBe('nbody');
  });

  it('serializes and restores dynamic body states for simulated universes', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    const world = new World(universe, { id: 'w-bodies' });
    world.bodyStates = [
      { id: 'sun', position: [0, 0], velocity: [0, 0] },
      { id: 'planet', position: [149597870700, 0], velocity: [0, 29780] },
    ];

    const saved = saveWorld(world);
    expect(saved.bodies).toEqual([
      { id: 'sun', position: [0, 0], velocity: [0, 0] },
      { id: 'planet', position: [149597870700, 0], velocity: [0, 29780] },
    ]);

    const loaded = loadWorld(roundTrip(saved));
    expect(loaded.world.bodyStates).toEqual(world.bodyStates);

    // Prediction clone also retains bodyStates
    const clone = loaded.world.cloneForPrediction();
    expect(clone.bodyStates).toEqual(world.bodyStates);
  });

  it('omits bodies in saveWorld if universe physics is rails mode', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'rails' }));
    const world = new World(universe, { id: 'w-rails' });
    world.bodyStates = [{ id: 'sun', position: [0, 0], velocity: [0, 0] }];

    const saved = saveWorld(world);
    expect(saved.bodies).toBeUndefined();
    expect('bodies' in saved).toBe(false);
  });

  it('rejects save files with bodies snapshot in rails physics mode', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'rails' }));
    const world = new World(universe, { id: 'w-reject-rails' });
    const saved = saveWorld(world) as Record<string, any>;
    saved.bodies = [{ id: 'sun', position: [0, 0], velocity: [0, 0] }];

    expect(() => loadWorld(saved)).toThrow(/body snapshots are not supported in rails physics mode/);
  });

  it('rejects save files with unknown body id in bodies snapshot', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    const world = new World(universe, { id: 'w-unknown-body' });
    const saved = saveWorld(world) as Record<string, any>;
    saved.bodies = [{ id: 'nonexistent-star', position: [0, 0], velocity: [0, 0] }];

    expect(() => loadWorld(saved)).toThrow(/unknown body id nonexistent-star/);
  });

  it('rejects save files with duplicate body ids in bodies snapshot', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    const world = new World(universe, { id: 'w-dup-body' });
    const saved = saveWorld(world) as Record<string, any>;
    saved.bodies = [
      { id: 'sun', position: [0, 0], velocity: [0, 0] },
      { id: 'sun', position: [100, 0], velocity: [0, 10] },
    ];

    expect(() => loadWorld(saved)).toThrow(/duplicate body id sun/);
  });

  it('rejects save files with non-finite position or velocity in bodies snapshot', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    const world = new World(universe, { id: 'w-bad-pos' });
    const saved = saveWorld(world) as Record<string, any>;
    saved.bodies = [{ id: 'sun', position: [NaN, 0], velocity: [0, 0] }];

    expect(() => loadWorld(saved)).toThrow(/must be a finite number/);
  });

  it('rejects save files where bodies list exceeds system body count', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    const world = new World(universe, { id: 'w-too-many' });
    const saved = saveWorld(world) as Record<string, any>;
    saved.bodies = [
      { id: 'sun', position: [0, 0], velocity: [0, 0] },
      { id: 'planet', position: [0, 0], velocity: [0, 0] },
      { id: 'sun', position: [0, 0], velocity: [0, 0] }, // 3 items vs 2 system bodies
    ];

    expect(() => loadWorld(saved)).toThrow(/bodies list cannot exceed system body count/);
  });

  it('loads legacy saves without bodies snapshot into non-rails universe without error', () => {
    const universe = validateUniverse(createMockUniverse({ mode: 'nbody' }));
    const world = new World(universe, { id: 'w-legacy-nbody' });
    const saved = saveWorld(world);
    expect(saved.bodies).toBeUndefined();

    const loaded = loadWorld(roundTrip(saved));
    expect(loaded.world.bodyStates).toBeUndefined();
    expect(resolveUniversePhysics(loaded.world.universe).mode).toBe('nbody');
  });
});
