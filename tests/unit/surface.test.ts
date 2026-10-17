import { describe, expect, it } from 'vitest';
import defaultJson from '../../games/space-sim/universes/sandbox/default/universe.json';
import solarJson from '../../games/space-sim/universes/astronomy/solar-system/universe.json';
import {
  advance, coastAt, initialState, loadSystem, planet, STEP, surfaceIdentity,
  validateSurfaceDefinition, validateUniverse, type SurfaceDefinition,
} from '../../packages/sim-core/src/index';

const surface: SurfaceDefinition = {
  kind: 'radial', generatorVersion: 1, seed: 12345, sampleCount: 2048,
  maxReliefMetres: 24, minFeatureWidthMetres: 16, orientationRadians: 0,
  mountainRangeCount: 3, craterCount: 12,
};

function universeWithSurface(settings: unknown = surface) {
  return {
    schemaVersion: 1, id: 'terrain', name: 'Terrain', defaultSystemId: 'system',
    systems: [{ id: 'system', name: 'System', bodies: [
      { id: 'rock', name: 'Rock', parentId: null, radius: 512, mu: planet.mu,
        surfaceFeatures: 'craters', surface: settings },
    ], presets: [{ id: 'pad', name: 'Pad', bodyId: 'rock', kind: 'landed' }] }],
  };
}

describe('Phase 1 surface contract and compatibility', () => {
  it.each([defaultJson, solarJson])('preserves circular universe meaning through JSON round trips ($id)', raw => {
    const before = validateUniverse(raw);
    const exported = JSON.stringify(before);
    expect(exported).not.toContain('"surface":');
    const after = validateUniverse(JSON.parse(exported));
    expect(after).toEqual(before);
    for (const system of before.systems) {
      const a = loadSystem(before, system.id), b = loadSystem(after, system.id);
      expect(b.getAllBodies()).toEqual(a.getAllBodies());
      for (const body of b.getAllBodies()) {
        expect(body.surface).toBeUndefined();
        expect(body.surfaceIdentity).toBe(surfaceIdentity({ radius: body.radius }));
      }
      for (const preset of system.presets) expect(b.initialState(preset.id)).toEqual(a.initialState(preset.id));
    }
  });

  it('round-trips settings through universe and single-system imports, detaching active configuration', () => {
    const raw = universeWithSurface();
    const imported = validateUniverse(raw);
    const exported = JSON.stringify(imported);
    expect(validateUniverse(JSON.parse(exported))).toEqual(imported);
    expect(validateUniverse(raw.systems[0]).systems[0]!.bodies[0]!.surface).toEqual(surface);
    expect(imported.systems[0]!.bodies[0]!.surface).toEqual(surface);
    expect(JSON.parse(exported).systems[0].bodies[0].surfaceIdentity).toBeUndefined();
    const loaded = loadSystem(imported);
    const body = loaded.rootBody;
    expect(body.surface).toEqual(surface);
    expect(body.surfaceFeatures).toBe('craters');
    expect(Object.isFrozen(body.surface)).toBe(true);
    expect(Object.isFrozen(imported.systems[0]!.bodies[0]!.surface)).toBe(true);
    raw.systems[0]!.bodies[0]!.surface = { ...surface, seed: 999 };
    expect(body.surface!.seed).toBe(12345);
    expect(body.surfaceIdentity).toBe(surfaceIdentity(body));
    // Headless preset callers opt into physical placement by supplying a profile.
    expect(loaded.initialState('pad').state.position).toEqual({ x: 0, y: 512 });
  });

  it('accepts exact field limits, flat relief and either radius alias', () => {
    expect(validateSurfaceDefinition({ ...surface, seed: 0, maxReliefMetres: 0,
      sampleCount: 32, minFeatureWidthMetres: 2 * Math.PI * 512,
      mountainRangeCount: 0, craterCount: 0 }, 512).seed).toBe(0);
    expect(validateSurfaceDefinition({ ...surface, seed: 0xffff_ffff, sampleCount: 65536,
      mountainRangeCount: 256, craterCount: 4096 }, 512).seed).toBe(0xffff_ffff);
    expect(validateSurfaceDefinition({ ...surface, minFeatureWidthMetres: 4 * (2 * Math.PI * 512 / 2048) }, 512))
      .toEqual({ ...surface, minFeatureWidthMetres: 4 * (2 * Math.PI * 512 / 2048) });
    const raw = universeWithSurface();
    const body = raw.systems[0]!.bodies[0]!;
    const alias = { ...body, radius: undefined, radiusMetres: body.radius };
    const imported = validateUniverse({ ...raw, systems: [{ ...raw.systems[0], bodies: [alias] }] });
    expect(loadSystem(imported).rootBody.surfaceIdentity).toBe(surfaceIdentity({ radius: 512, surface }));
  });

  const invalid: Array<[unknown, string]> = [
    [null, 'must be an object'], [[], 'must be an object'], ['radial', 'must be an object'],
    [{ ...surface, kind: 'mesh' }, 'kind'],
    [{ ...surface, generatorVersion: 2 }, 'generatorVersion'],
    [{ ...surface, generatorVersion: '1' }, 'generatorVersion'],
    [{ ...surface, seed: -1 }, 'seed'], [{ ...surface, seed: 4294967296 }, 'seed'],
    [{ ...surface, seed: 1.5 }, 'seed'], [{ ...surface, seed: '123' }, 'seed'],
    [{ ...surface, sampleCount: 31 }, 'sampleCount'], [{ ...surface, sampleCount: 65537 }, 'sampleCount'],
    [{ ...surface, sampleCount: 32.5 }, 'sampleCount'],
    [{ ...surface, maxReliefMetres: -1 }, 'maxReliefMetres'],
    [{ ...surface, maxReliefMetres: 512 }, 'positive radii'],
    [{ ...surface, maxReliefMetres: 513 }, 'positive radii'],
    [{ ...surface, minFeatureWidthMetres: 0 }, 'minFeatureWidthMetres'],
    [{ ...surface, minFeatureWidthMetres: 1 }, '4 sample intervals'],
    [{ ...surface, minFeatureWidthMetres: 4000 }, 'reference circumference'],
    [{ ...surface, orientationRadians: -0.01 }, 'orientationRadians'],
    [{ ...surface, orientationRadians: 2 * Math.PI }, 'orientationRadians'],
    [{ ...surface, mountainRangeCount: 257 }, 'mountainRangeCount'],
    [{ ...surface, craterCount: 4097 }, 'craterCount'],
    [{ ...surface, craterCount: -1 }, 'craterCount'],
    [{ ...surface, craterCount: .5 }, 'craterCount'],
    [{ ...surface, seaRadius: 512 }, 'unknown setting seaRadius'],
    [{}, 'kind'],
  ];
  it.each(invalid)('rejects malformed or oversized settings %#', (settings, message) => {
    expect(() => validateUniverse(universeWithSurface(settings))).toThrow(new RegExp(`Body rock surface: .*${message}`));
  });

  it('rejects missing or nonfinite numeric fields without coercion', () => {
    for (const key of Object.keys(surface).filter(k => k !== 'kind')) {
      for (const value of [undefined, null, NaN, Infinity, -Infinity, true, '1']) {
        expect(() => validateUniverse(universeWithSurface({ ...surface, [key]: value }))).toThrow(key);
      }
    }
  });

  it('rejects nonfinite radius envelopes and slope bounds', () => {
    expect(() => validateSurfaceDefinition(surface, Infinity)).toThrow('positive radii');
    expect(() => validateSurfaceDefinition({ ...surface, maxReliefMetres: 1e308 }, 1.5e308)).toThrow('positive radii');
    expect(() => validateSurfaceDefinition({ ...surface, sampleCount: 65536,
      maxReliefMetres: 1e304, minFeatureWidthMetres: 1e305 }, 1e306)).toThrow('finite conservative slope bound');
  });

  it.each([
    { id: 'star', name: 'Primary', surfaceFeatures: 'star' },
    { id: 'sun', name: 'Primary', surfaceFeatures: undefined },
    { id: 'primary', name: 'Distant Star', surfaceFeatures: undefined },
  ])('keeps explicit and implicitly styled stars on their existing path ($id, $name)', star => {
    const raw = universeWithSurface();
    const original = raw.systems[0]!.bodies[0]!;
    const body = { ...original, ...star };
    const system = { ...raw.systems[0], bodies: [body], presets: [{ id: 'p', bodyId: body.id, kind: 'landed' }] };
    expect(() => validateUniverse({ ...raw, systems: [system] })).toThrow('terrain settings are not supported on stars');
    const noTerrain = { ...system, bodies: [{ ...body, surface: undefined }] };
    expect(loadSystem(validateUniverse({ ...raw, systems: [noTerrain] })).rootBody.surfaceFeatures).toBe('star');
  });

  it('enforces aggregate budgets across bodies and inactive systems', () => {
    const raw = universeWithSurface();
    const base = raw.systems[0]!.bodies[0]!;
    const system = raw.systems[0]!;
    const many = (count: number, settings: SurfaceDefinition) => ({ ...raw, systems: [{ ...system,
      bodies: Array.from({ length: count }, (_, i) => ({ ...base, id: `rock${i}`, surface: settings })),
      presets: [{ ...system.presets[0], bodyId: 'rock0' }],
    }] });
    const maxSamples = { ...surface, sampleCount: 65536 };
    expect(() => validateUniverse(many(16, maxSamples))).not.toThrow();
    expect(() => validateUniverse(many(17, maxSamples))).toThrow('Universe surface budget exceeded');
    const maxFeatures = { ...surface, mountainRangeCount: 0, craterCount: 4096 };
    expect(() => validateUniverse(many(4, maxFeatures))).not.toThrow();
    expect(() => validateUniverse(many(5, maxFeatures))).toThrow('Universe surface budget exceeded');
    const first = many(16, maxSamples);
    expect(() => validateUniverse({ ...first, systems: [...first.systems, { ...system, id: 'inactive' }] }))
      .toThrow('Universe surface budget exceeded');
  });

  it('keys every physical setting and reference radius, independent of JSON property order and appearance', () => {
    const body = loadSystem(validateUniverse(universeWithSurface())).rootBody;
    const identity = surfaceIdentity(body);
    const reversed = Object.fromEntries(Object.entries(surface).reverse());
    expect(surfaceIdentity({ ...body, surface: validateSurfaceDefinition(reversed, body.radius) })).toBe(identity);
    const changes: SurfaceDefinition = { ...surface, seed: 12346, sampleCount: 4096,
      maxReliefMetres: 25, minFeatureWidthMetres: 17, orientationRadians: .1, mountainRangeCount: 4, craterCount: 13 };
    for (const key of ['seed', 'sampleCount', 'maxReliefMetres', 'minFeatureWidthMetres',
      'orientationRadians', 'mountainRangeCount', 'craterCount'] as const) {
      expect(surfaceIdentity({ ...body, surface: { ...surface, [key]: changes[key] } })).not.toBe(identity);
    }
    expect(surfaceIdentity({ ...body, radius: 513 })).not.toBe(identity);
    expect(surfaceIdentity({ ...body, surface: undefined })).not.toBe(identity);
    expect(surfaceIdentity({ ...body, color: '#ffffff', surfaceFeatures: 'smooth', mu: 1 } as typeof body)).toBe(identity);
  });

  it('invalidates cached coast epochs when settings change with the same body ID, mu and radius', () => {
    const body = { ...planet, surface };
    const state = advance(initialState('planet-orbit'), undefined, STEP, body);
    const coast = state.coast!;
    expect(coast.surfaceIdentity).toBe(surfaceIdentity(body));
    expect(coastAt(coast, .5, body).ok).toBe(true);
    const changed = { ...body, surface: { ...surface, seed: surface.seed + 1 } };
    expect(coastAt(coast, .5, changed).ok).toBe(false);
    const next = advance(state, undefined, STEP, changed);
    expect(next.coast).not.toBe(coast);
    expect(next.coast!.epochSeconds).toBe(state.time);
    expect(next.coast!.surfaceIdentity).toBe(surfaceIdentity(changed));
    expect(coastAt(next.coast!, .5, body).ok).toBe(false);
    expect(coastAt(coast, .5, planet).ok).toBe(false);
  });
});
