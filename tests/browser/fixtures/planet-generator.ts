import { PLANET_GENERATOR, type PlanetGenerator, type PlanetBake, type ManifestV2, type ModuleProfileV2,
  type ModuleEnvironment, type PlanetFieldDefinition } from '../../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleRuntimeV2, moduleAssets } from '../../../packages/game-runtime/src/modules-v2';
import { loadCodeModuleV2 } from '../../../packages/game-runtime/src/loader';
import { decodeModulePackage, requiredFile } from '../../../packages/game-library/src/portable';

declare const __PLANET_PACKAGE_BASE64__: string;
const definition: PlanetFieldDefinition = { generatorVersion: 2, seed: 741, recipe: 'oceanic', radiusMetres: 2048,
  maxReliefMetres: 48, continentWavelengthMetres: 1100, rangeWavelengthMetres: 280, hillWavelengthMetres: 80, octaves: 4 };

/** Actual independently built, integrity-checked archive through the public code
 * loader and module runtime. Approval is scoped to this test's first-party digest. */
export async function run(environment: ModuleEnvironment) {
  const pkg = await decodeModulePackage(Uint8Array.from(atob(__PLANET_PACKAGE_BASE64__), c => c.charCodeAt(0)));
  if (!pkg.codeV2 || pkg.descriptor.manifest.format !== 'space-sim-module/2') throw Error('Expected verified v2 archive');
  const manifest = pkg.descriptor.manifest, digest = pkg.codeV2.digest;
  const executable = { manifest, digest, source: pkg.codeV2.source, supportsMultiplayer: pkg.descriptor.compatibility.multiplayer };
  const assets = moduleAssets(new Map(pkg.descriptor.guides.map(path => [path, requiredFile(pkg.files, path)])));
  const registry = new ModuleRegistryV2();
  registry.register(loadCodeModuleV2(executable, { environment, allowRuntimeCode: true, approvedDigests: new Set([digest]) }), assets);
  const consumer: ManifestV2 = { ...manifest, id: 'test.planet-consumer', slots: [], provides: [],
    requires: [{ name: 'planet.generator', version: '^1.0.0', optional: true }] };
  let current: PlanetGenerator | undefined, failedJob: PlanetBake | undefined;
  registry.register({ manifest: consumer, initialize(c) { current = c.tryUse(PLANET_GENERATOR); } });
  registry.register({ manifest: { ...consumer, id: 'test.failed-consumer' }, initialize(c) {
    failedJob = c.use(PLANET_GENERATOR).bake(definition, { columns: 32, rows: 16, equatorSamples: 128 });
    throw Error('Deliberate failed candidate');
  } });
  const profile = (enabled: boolean, failed = false): ModuleProfileV2 => ({ format: 'space-sim-profile/2', id: 'test.planets',
    modules: ['test.planet-consumer', ...enabled ? [manifest.id] : [], ...failed ? ['test.failed-consumer'] : []].map(id => ({ id, version: manifest.version })),
    providers: enabled ? { 'planet.generator': manifest.id } : {}, capabilities: {}, settings: {} });
  const runtime = new ModuleRuntimeV2(registry, environment);
  runtime.activate(runtime.prepare(profile(false))); const absent = current === undefined;
  runtime.activate(runtime.prepare(profile(true))); const original = current!;
  const pure = original.create(definition), out = new Float64Array(8); pure.evaluate(1, 0, 0, out);
  const values = Array.from(out), job = original.bake(definition, { columns: 32, rows: 16, equatorSamples: 128 });
  for (let i = 0; job.status === 'pending' && i < 100; i++) job.step(256);
  const result = job.takeResult(), transferred = job.storageBytes === 0;
  const pending = original.bake(definition, { columns: 32, rows: 16, equatorSamples: 128 });
  const active = runtime.active;
  let rollbackError = '';
  try { runtime.prepare(profile(true, true)); } catch (e) { rollbackError = String(e); }
  const rollback = rollbackError.includes('Deliberate failed candidate') && runtime.active === active
    && pending.status === 'pending' && failedJob?.status === 'cancelled';
  runtime.activate(runtime.prepare(profile(false)));
  const cancelled = pending.status === 'cancelled' && pending.storageBytes === 0;
  let disposed = false; try { original.create(definition); } catch { disposed = true; }
  runtime.activate(runtime.prepare(profile(true))); const fresh = current !== original;
  const paddedDefinition = { ...definition, pads: [{ id: 'launch', angleRadians: 0, widthMetres: 48, elevationMetres: 24 }], padShoulderMetres: 40 };
  const paddedField = current!.create(paddedDefinition), paddedValues = new Float64Array(8);
  paddedField.evaluate(1, 0, 0, paddedValues);
  const paddedJob = current!.bake(paddedDefinition, { columns: 32, rows: 16, equatorSamples: 128 });
  while (paddedJob.status === 'pending') paddedJob.step(256);
  const paddedResult = paddedJob.takeResult();
  runtime.dispose(); pure.evaluate(1, 0, 0, out);

  const deniedRegistry = new ModuleRegistryV2();
  deniedRegistry.register(loadCodeModuleV2(executable, { environment, allowRuntimeCode: true, approvedDigests: new Set() }), assets);
  let denied = false;
  try { deniedRegistry.prepare({ ...profile(true), modules: [{ id: manifest.id, version: manifest.version }] }, environment); }
  catch (e) { denied = String(e).includes('approve this exact code digest'); }
  return { environment, id: manifest.id, digest, absent, transferred, rollback, cancelled, disposed, fresh, denied,
    values, afterDisposeValues: Array.from(out), equatorSamples: result.equator.length, mapSamples: result.map.elevations.length,
    firstEquator: result.equator[0], storageBytes: result.storageBytes, guides: pkg.descriptor.guides,
    paddedValues: Array.from(paddedValues), paddedFirstEquator: paddedResult.equator[0], paddedFieldBytes: paddedField.storageBytes };
}
