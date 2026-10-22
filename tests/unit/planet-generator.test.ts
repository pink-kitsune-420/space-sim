import { describe, expect, it } from 'vitest';
import { createPlanetBake, createPlanetField, deterministicMath as dm, PLANET_BAKE_MAX_BYTES, PLANET_GENERATOR,
  type PlanetBake, type PlanetFieldDefinition, type PlanetGenerator, type ManifestV2, type ModuleProfileV2 } from '../../packages/game-api/src/index';
import { createPlanetGenerator } from '../../modules/planet-generator/src/factory';
import initialize from '../../modules/planet-generator/src/index';
import descriptor from '../../modules/planet-generator/module.json';
import guide from '../../modules/planet-generator/docs/creators/usage.json';
import { ModuleRegistryV2, ModuleRuntimeV2, moduleAssets } from '../../packages/game-runtime/src/index';
import previewInitialize, { PLANET_PREVIEW } from '../../examples/modules/planet-generator/src/main';
import previewDescriptor from '../../examples/modules/planet-generator/module.json';

const definition: PlanetFieldDefinition = { generatorVersion: 2, seed: 741, recipe: 'oceanic', radiusMetres: 2048,
  maxReliefMetres: 48, continentWavelengthMetres: 1100, rangeWavelengthMetres: 280, hillWavelengthMetres: 80, octaves: 4 };
const options = { columns: 32, rows: 16, equatorSamples: 128 };
function finish(job: PlanetBake, budget = 1024) {
  let calls = 0, previous = 0;
  while (job.status === 'pending') {
    job.step(budget); if (++calls > 10000) throw Error('Bake failed to finish within its operation count');
    expect(job.progress).toBeGreaterThanOrEqual(previous); previous = job.progress;
  }
  return job.takeResult();
}

describe('reusable bounded planet generator', () => {
  it('runs the actual creator preview example against the selected reusable generator', () => {
    const registry = new ModuleRegistryV2();
    registry.register({ manifest: descriptor.manifest as ManifestV2, initialize },
      moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]])));
    registry.register({ manifest: previewDescriptor.manifest as ManifestV2, initialize: previewInitialize });
    const profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'test.preview',
      modules: [descriptor, previewDescriptor].map(d => ({ id: d.manifest.id, version: d.manifest.version })),
      providers: { 'planet.generator': descriptor.manifest.id, 'example.planet-preview': previewDescriptor.manifest.id }, capabilities: {}, settings: {} };
    const candidate = registry.prepare(profile, 'node');
    try {
      const preview = candidate.providedService(PLANET_PREVIEW), result = finish(preview.begin(definition));
      expect(result.equator.length).toBe(128); expect(result.map.elevations.length).toBe(512);
    } finally { candidate.dispose(); }
  });

  it('bakes identical products independent of scheduling, including global water quantile', () => {
    const d = { ...definition, waterCoverage: .7 };
    const a = finish(createPlanetBake(d, options), 1), b = finish(createPlanetBake(d, options), 1024);
    expect(a).toEqual(b); expect(a.sampledWaterCoverage).toBeGreaterThanOrEqual(.7);
    expect(a.sampledWaterCoverage - .7).toBeLessThanOrEqual(a.coverageBinFraction);
    expect(a.map.waterMask.reduce((sum, n) => sum + n, 0) / (32 * 16)).toBe(a.sampledWaterCoverage);
    expect(a.storageBytes).toBe(32 * 16 * 11 + 128 * 8);
  });

  it('derives map and equatorial heights from the same independent point evaluator', () => {
    const baked = finish(createPlanetBake({ ...definition, seaRadiusMetres: 2048 }, { ...options, orientationRadians: .7 }));
    const field = createPlanetField(definition), out = new Float64Array(8);
    for (let i = 0; i < 128; i++) {
      const a = .7 + i * Math.PI * 2 / 128; field.evaluate(dm.cos(a), dm.sin(a), 0, out);
      expect(baked.equator[i]).toBe(out[0]);
    }
    for (let i = 0; i < 512; i++) {
      const z = 2 * (Math.floor(i / 32) + .5) / 16 - 1, r = Math.sqrt(1 - z * z), a = (i % 32 + .5) * Math.PI * 2 / 32;
      field.evaluate(r * dm.cos(a), r * dm.sin(a), z, out);
      expect(baked.map.elevations[i]).toBe(out[0]);
      expect(baked.map.attributes[i * 2]).toBe(Math.round(out[7]! * 255));
      expect(baked.map.waterMask[i]).toBe(2048 + out[0]! < baked.seaRadiusMetres! ? 1 : 0);
    }
  });

  it('reports dry/full/degenerate coverage without inventing a fractional ocean on flat ground', () => {
    const dry = finish(createPlanetBake({ ...definition, waterCoverage: 0 }, options));
    expect(dry.seaRadiusMetres).toBeUndefined(); expect(dry.sampledWaterCoverage).toBe(0);
    const full = finish(createPlanetBake({ ...definition, waterCoverage: 1 }, options));
    expect(full.sampledWaterCoverage).toBe(1);
    const flat = finish(createPlanetBake({ ...definition, maxReliefMetres: 0, waterCoverage: .7 }, options));
    expect(flat.sampledWaterCoverage).toBe(0); expect(flat.coverageBinFraction).toBe(1);
  });

  it('bounds maximal allocation, releases cancelled/transferred buffers and transfers only once', () => {
    const job = createPlanetBake({ ...definition, waterCoverage: .7 }, { columns: 512, rows: 256, equatorSamples: 65536 });
    expect(job.storageBytes).toBe(512 * 256 * 11 + 65536 * 8 + 8192 + 96);
    expect(job.storageBytes).toBeLessThanOrEqual(PLANET_BAKE_MAX_BYTES);
    job.step(1); expect(job.progress).toBeLessThan(.001); job.cancel(); job.cancel(); job.step();
    expect(job.status).toBe('cancelled'); expect(job.storageBytes).toBe(0); expect(() => job.takeResult()).toThrow();
    const done = createPlanetBake(definition, options); const result = finish(done);
    expect(done.status).toBe('transferred'); expect(done.storageBytes).toBe(0);
    expect(result.equator.length).toBe(128); expect(() => done.takeResult()).toThrow(); done.cancel();
    expect(done.status).toBe('transferred');
  });

  it('rejects excessive dimensions and work budgets before generating data', () => {
    for (const bad of [{ ...options, columns: 1024 }, { ...options, rows: 17 }, { ...options, equatorSamples: 131072 },
      { ...options, orientationRadians: -1 }, { ...options, extra: 1 }]) expect(() => createPlanetBake(definition, bad)).toThrow();
    const job = createPlanetBake(definition, options);
    for (const budget of [0, 1025, NaN, 1.5]) expect(() => job.step(budget)).toThrow(); job.cancel();
  });

  it('caps factory-owned jobs, cancels on disposal and preserves transferred data and pure fields', () => {
    const generator = createPlanetGenerator(), field = generator.create(definition), out = new Float64Array(8);
    const a = generator.bake(definition, options), b = generator.bake(definition, options);
    expect(() => generator.bake(definition, options)).toThrow('two');
    const result = finish(a); const c = generator.bake(definition, options);
    generator.dispose(); generator.dispose(); expect(b.status).toBe('cancelled'); expect(c.status).toBe('cancelled');
    expect(b.storageBytes + c.storageBytes).toBe(0); expect(result.map.elevations.length).toBe(512);
    expect(() => generator.create(definition)).toThrow('disposed'); expect(() => generator.bake(definition, options)).toThrow('disposed');
    field.evaluate(1, 0, 0, out); expect(Number.isFinite(out[0])).toBe(true);
  });

  it.each(['node', 'browser', 'offline'] as const)('uses the public module runtime with optional omission, replacement and disposal (%s)', environment => {
    const registry = new ModuleRegistryV2();
    const m = descriptor.manifest as ManifestV2;
    const assets = moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]]));
    registry.register({ manifest: m, initialize }, assets);
    registry.register({ manifest: { ...m, id: 'test.replacement' }, initialize }, assets);
    let service: PlanetGenerator | undefined;
    const consumer: ManifestV2 = { ...m, id: 'test.consumer', provides: [], slots: [],
      requires: [{ name: 'planet.generator', version: '^1.0.0', optional: true }] };
    registry.register({ manifest: consumer, initialize(c) { service = c.tryUse(PLANET_GENERATOR); } });
    const runtime = new ModuleRuntimeV2(registry, environment);
    const profile = (provider?: string): ModuleProfileV2 => ({ format: 'space-sim-profile/2', id: 'test.planets',
      modules: ['test.consumer', ...provider ? [provider] : []].map(id => ({ id, version: '0.1.0' })),
      providers: provider ? { 'planet.generator': provider } : {}, capabilities: {}, settings: {} });
    runtime.activate(runtime.prepare(profile())); expect(service).toBeUndefined();
    runtime.activate(runtime.prepare(profile(m.id))); const old = service!, pending = old.bake(definition, options);
    runtime.activate(runtime.prepare(profile('test.replacement'))); expect(pending.status).toBe('cancelled');
    expect(() => old.create(definition)).toThrow('disposed'); expect(service).not.toBe(old);
    expect(finish(service!.bake(definition, options)).equator.length).toBe(128);
    runtime.dispose(); expect(() => service!.create(definition)).toThrow('disposed');
  });
});
