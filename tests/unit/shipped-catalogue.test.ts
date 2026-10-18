import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLIGHT_ACTIONS, type ModuleProfileV2 } from '../../packages/game-api/src/index';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { ShippedModuleCatalogue, decodeModulePackage, parseShippedCatalogue } from '../../packages/game-library/src/portable';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule, forkModule } from '../../packages/module-tools/package.mjs';
import { validatePackage } from '../../packages/game-library/src/archive';
import { decodeGamePackage, encodeGamePackage } from '../../packages/game-library/src/game-package';
import { attachRuntimeFiles, type RuntimeSelection } from '../../packages/game-library/src/runtime-selection';
import builtin from '../../games/space-sim/game.json';

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
async function shippedSource() {
  const root = await mkdtemp(join(tmpdir(), 'shipped-module-')); temporary.push(root);
  const folder = join(root, 'source'); await cp(resolve('modules/input-actions'), folder, { recursive: true });
  const path = join(folder, 'module.json'), raw = JSON.parse(await readFile(path, 'utf8'));
  raw.manifest.id = 'builtin.catalogue-test'; await writeFile(path, JSON.stringify(raw));
  const entry = join(folder, 'src/index.ts'); await writeFile(entry, (await readFile(entry, 'utf8')).replaceAll('spacelab.input-actions/', 'builtin.catalogue-test/'));
  return { root, path, entry, raw, output: join(root, 'original.spacemod') };
}
describe('explicit shipped module catalogue', () => {
  it('recognizes exact shipped bytes without granting execution consent or bypassing build restrictions', async () => {
    const source = await shippedSource();
    await expect(buildPortableModule(source.path, source.output, { typecheck: false })).rejects.toThrow('explicit shipped build');
    const built = await buildPortableModule(source.path, source.output, { typecheck: false, shippedBuild: true });
    const bytes = new Uint8Array(await readFile(source.output));
    await expect(decodeModulePackage(bytes)).rejects.toThrow('exact shipped catalogue pin');
    const entries = [{ id: built.descriptor.manifest.id, version: built.descriptor.manifest.version, digest: built.integrity.digest }];
    const shipped = new ShippedModuleCatalogue(entries);
    entries[0]!.digest = '0'.repeat(64); // Caller mutation cannot change a captured build inventory.
    const inspected = await inspectRuntimePackage(bytes, { shipped });
    const profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'fixture.shipped', modules: [{ id: inspected.id, version: inspected.version }],
      providers: { 'input.flight-actions': inspected.id }, capabilities: {}, settings: {} };
    const prepare = (allowRuntimeCode: boolean, approved: boolean) => {
      const registry = new ModuleRegistryV2(), registered = inspected.register({ environment: 'offline', allowRuntimeCode,
        approvedDigests: new Set(approved ? [inspected.digest] : []) });
      registry.register(registered.module, registered.assets); return registry.prepare(profile, 'offline');
    };
    expect(() => prepare(false, true)).toThrow('does not allow imported code');
    expect(() => prepare(true, false)).toThrow('approve this exact code digest');
    const candidate = prepare(true, true);
    expect(candidate.providedService(FLIGHT_ACTIONS).definitions[0]!.id).toBe('builtin.catalogue-test/engine'); candidate.dispose();
    const selection: RuntimeSelection = { format: 'spacelab-runtime-selection/2', plans: { offline: {
      profile, packages: [{ id: inspected.id, version: inspected.version, digest: inspected.digest }], requiredSlots: [],
    } } };
    attachRuntimeFiles(selection, new Map([[`modules/${inspected.id}.spacemod`, bytes]]));
    const game = validatePackage({ ...builtin, runtime: selection }), archive = await encodeGamePackage(game, { shipped });
    await expect(decodeGamePackage(archive, validatePackage)).rejects.toThrow('exact shipped catalogue pin');
    const importedGame = await decodeGamePackage(archive, validatePackage, { shipped });
    expect(importedGame.modules.find(module => module.descriptor.manifest.id === inspected.id)?.integrity.digest).toBe(inspected.digest);
    const wrongVersion = new ShippedModuleCatalogue([{ id: inspected.id, version: '2.0.0', digest: inspected.digest }]);
    await expect(decodeModulePackage(bytes, { shipped: wrongVersion })).rejects.toThrow('exact shipped catalogue pin');
    await writeFile(source.entry, (await readFile(source.entry, 'utf8')) + '\n// Edited source changes the exact package identity.\n');
    await buildPortableModule(source.path, join(source.root, 'edited.spacemod'), { typecheck: false, shippedBuild: true });
    await expect(inspectRuntimePackage(new Uint8Array(await readFile(join(source.root, 'edited.spacemod'))), { shipped })).rejects.toThrow('exact shipped catalogue pin');
  }, 60000);
  it('rejects invalid, duplicated and engine-identity catalogue claims', () => {
    const pin = { id: 'builtin.fixture', version: '1.0.0', digest: 'a'.repeat(64) };
    expect(() => new ShippedModuleCatalogue([pin, pin])).toThrow('Duplicate');
    expect(() => new ShippedModuleCatalogue([{ ...pin, id: 'builtin.engine' }])).toThrow('builtin module identity');
    expect(() => new ShippedModuleCatalogue([{ ...pin, id: 'creator.fixture' }])).toThrow('builtin module identity');
    expect(() => new ShippedModuleCatalogue([{ ...pin, digest: 'not-a-digest' }])).toThrow('exact digest');
    expect(() => parseShippedCatalogue({ format: 'unrecognized', modules: [pin] })).toThrow('Unsupported');
    expect(parseShippedCatalogue({ format: 'spacelab-shipped-modules/1', modules: [pin] }).recognizes(pin.id, pin.version, pin.digest)).toBe(true);
  });
  it('forks editable builtin source into a creator namespace and requires rebuilding before import', async () => {
    const source = await shippedSource();
    const original = await buildPortableModule(source.path, source.output, { typecheck: false, shippedBuild: true });
    const folder = join(source.root, 'creator-fork');
    await forkModule(source.output, 'creator.flight-actions', folder);
    const raw = JSON.parse(await readFile(join(folder, 'module.json'), 'utf8'));
    expect(raw.manifest.id).toBe('creator.flight-actions'); expect(raw.build).toBeUndefined();
    expect(await readFile(join(folder, 'NOTICE'), 'utf8')).toContain(original.integrity.digest);
    await expect(readFile(join(folder, 'dist/module.js'))).rejects.toThrow();
    await expect(forkModule(source.output, 'builtin.counterfeit', join(source.root, 'bad'))).rejects.toThrow('creator namespace');
    await expect(forkModule(source.output, 'creator.another', folder)).rejects.toThrow('new or empty');
    const output = join(source.root, 'fork.spacemod'); await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const inspected = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const r = inspected.register({ environment: 'offline', allowRuntimeCode: true, approvedDigests: new Set([inspected.digest]) }), registry = new ModuleRegistryV2();
    registry.register(r.module, r.assets);
    const candidate = registry.prepare({ format: 'space-sim-profile/2', id: 'fixture.fork', modules: [{ id: inspected.id, version: inspected.version }],
      providers: { 'input.flight-actions': inspected.id }, capabilities: {}, settings: {} }, 'offline');
    expect(candidate.providedService(FLIGHT_ACTIONS).definitions[0]!.id).toBe('creator.flight-actions/engine'); candidate.dispose();
  }, 60000);
});
