import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CORE_MODULE_DATA } from '../../packages/game-api/src/index';
import type { ModuleDataFactory } from '../../packages/game-api/src/index';
import { engineModuleServices } from '../../packages/sim-core/src/module-services';
import type { ManifestV2, ModuleDataAdapter, ModuleProfileV2 } from '../../packages/game-api/src/index';
import { ModuleDataStore, captureDataAdapter } from '../../packages/game-runtime/src/module-data';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { prepareInstalledGame } from '../../packages/game-runtime/src/game-loader';
import { installPackage, MemoryPackageStore } from '../../packages/game-runtime/src/package-store';
import { createModuleWorld } from '../../packages/sim-core/src/module-world';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { encodeUniverseSave, decodeUniverseSave, createSaveFiles } from '../../packages/game-library/src/save-package';
import { saveWorld, loadWorld } from '../../packages/sim-core/src/save';
import { createFlightSessions } from '../../modules/session-flight/src/index';
import { flightSessionServices } from '../../packages/net/src/session-services';
import { loopback } from '../../packages/net/src/connection';
import descriptor from '../../examples/packages/inventory/module.json';
import initialize, { inventory } from '../../examples/packages/inventory/src/index';

const extension = captureDataAdapter('example.inventory', inventory), target = { adapter: extension.id, id: 'ada' };
const profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'fixture.inventory',
  modules: [{ id: 'example.inventory', version: '0.1.0' }], providers: {}, capabilities: {}, settings: {} };
const clean: (() => unknown)[] = [];
afterEach(async () => { for (const dispose of clean.splice(0).reverse()) await dispose(); });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('versioned module-owned session data', () => {
  it('replicates changed records, recovers deletions with a full snapshot and rejects stale or partial invalid updates atomically', () => {
    const host = new ModuleDataStore([extension]), peer = new ModuleDataStore([extension]);
    host.set(target, { count: 10 }); peer.apply(host.snapshot()); const since = peer.revision;
    host.set({ ...target, id: 'bob' }, { count: 20 }); const delta = host.delta(since);
    expect(delta.since).toBe(since); expect(delta.records).toHaveLength(1); peer.apply(delta); expect(peer.snapshot()).toEqual(host.snapshot());
    expect(() => peer.apply(delta)).toThrow('order');
    const before = peer.snapshot();
    expect(() => peer.apply({ ...host.snapshot(), records: [{ ...target, value: { count: 3 } }, { ...target, id: 'bob', value: { count: -1 } }] })).toThrow('Invalid data');
    expect(peer.snapshot()).toEqual(before);
    host.remove(target); expect(host.delta(peer.revision).since).toBeUndefined(); peer.apply(host.delta(peer.revision));
    expect(peer.get(target.adapter, target.id)).toBeUndefined(); expect(peer.snapshot()).toEqual(host.snapshot());
  });
  it('owns frozen copies, bounds JSON/state and stages authorization/reducer failures without writes', () => {
    const store = new ModuleDataStore([extension]), initial = { count: 10 }; store.set(target, initial); initial.count = 99;
    expect(store.get(target.adapter, target.id)).toEqual({ count: 10 }); const before = store.snapshot();
    expect(Object.isFrozen(store.get(target.adapter, target.id))).toBe(true);
    for (const args of [NaN, Infinity, 'x'.repeat(20000), { count: undefined }]) expect(() => store.set(target, args as never)).toThrow();
    expect(() => store.set({ ...target, id: undefined as never }, { count: 1 })).toThrow('target');
    expect(() => store.command({ ...target, command: 'discard', args: 2 }, { playerId: 'bob', ownerId: 'ada', tick: 0 })).toThrow('denied');
    expect(() => store.command({ ...target, command: 'discard', args: 11 }, { playerId: 'ada', ownerId: 'ada', tick: 0 })).toThrow('Invalid data');
    expect(store.snapshot()).toEqual(before);
    store.command({ ...target, command: 'discard', args: 2 }, { playerId: 'ada', ownerId: 'ada', tick: 0 });
    expect(store.get(target.adapter, target.id)).toEqual({ count: 8 });
  });
  it('requires exact network schemas, migrates save data one version at a time and refuses missing adapters', () => {
    const store = new ModuleDataStore([extension]), old = { ...store.snapshot(), schemas: [{ id: extension.id, scope: 'player', version: 1 }], records: [{ ...target, value: 7 }] };
    expect(() => store.apply(old)).toThrow('Incompatible'); store.restore(old); expect(store.get(target.adapter, target.id)).toEqual({ count: 7 });
    expect(() => new ModuleDataStore().restore(old)).toThrow('Missing required');
    const missing = new ModuleDataStore([captureDataAdapter('example.inventory', { ...inventory, migrations: {} })]);
    expect(() => missing.restore(old)).toThrow('migration'); expect(missing.revision).toBe(0);
    expect(() => store.apply({ ...store.snapshot(), schemas: [] })).toThrow('Missing required');
  });
  it('keeps world/player/entity schemas independent and allows only authoritative initialization contributions', () => {
    const adapters = (['world', 'player', 'entity'] as const).map(scope => captureDataAdapter('fixture.data', { ...inventory, name: scope, scope }));
    const store = new ModuleDataStore(adapters);
    for (const adapter of adapters) store.set({ adapter: adapter.id, id: adapter.scope === 'world' ? 'world' : 'same-id' }, { count: 1 });
    expect(store.snapshot().records).toHaveLength(3);
    expect(() => store.set({ adapter: adapters[0]!.id, id: 'other-world' }, { count: 1 })).toThrow('target');
    const graph = new ModuleRegistryV2(); graph.register({ manifest: { ...descriptor.manifest, tier: 'presentation' } as ManifestV2, initialize });
    expect(() => graph.prepare(profile, 'node')).toThrow('unavailable');
    const valid = new ModuleRegistryV2(); let contribute: ((adapter: ModuleDataAdapter) => void) | undefined;
    valid.register({ manifest: descriptor.manifest as ManifestV2, supportsMultiplayer: true, initialize(context) { contribute = context.contributeData; initialize(context); } });
    const candidate = valid.prepare(profile, 'node'); clean.push(() => candidate.dispose());
    expect(candidate.contributions('data')[0]!.value.id).toBe(extension.id); expect(() => contribute!(inventory)).toThrow('sealed');
  });
  it('saves new records with version 3, restores with active adapters and leaves legacy save versions and physics unchanged', async () => {
    const world = new World(DEFAULT_UNIVERSE, { dataAdapters: [extension], soloPreview: false }); clean.push(() => world.dispose());
    world.data.set(target, { count: 12 }); const saved = saveWorld(world);
    expect(await decodeUniverseSave(await encodeUniverseSave(saved))).toEqual(saved);
    expect(saved.version).toBe(3); expect(() => saveWorld(world, { version: 2 })).toThrow('version 3');
    expect(() => loadWorld(saved)).toThrow('Missing required');
    const restored = loadWorld(saved, { dataAdapters: [extension], soloPreview: false }).world; clean.push(() => restored.dispose());
    expect(saveWorld(restored)).toEqual(saved); const clone = world.cloneForPrediction(); clean.push(() => clone.dispose());
    expect(clone.data.snapshot()).toEqual(world.data.snapshot()); clone.data.set(target, { count: 1 }); expect(world.data.get(target.adapter, target.id)).toEqual({ count: 12 });
    const plain = new World(DEFAULT_UNIVERSE); clean.push(() => plain.dispose()); expect(saveWorld(plain).version).toBe(2); expect(saveWorld(plain).data).toBeUndefined();
    expect(world.tick).toBe(0); expect(world.ships()).toEqual(plain.ships());
  });
  it('chunks large module-data saves below file limits and preserves exact records', async () => {
    const text = captureDataAdapter('fixture.text', { ...inventory, scope: 'entity', initial: '', validate: value => typeof value === 'string' });
    const world = new World(DEFAULT_UNIVERSE, { dataAdapters: [text], soloPreview: false }); clean.push(() => world.dispose());
    for (let i = 0; i < 150; i++) world.data.set({ adapter: text.id, id: `record-${i}` }, 'x'.repeat(9000));
    const saved = saveWorld(world), files = createSaveFiles(saved);
    expect([...files.keys()].filter(path => path.startsWith('state/data/'))).toHaveLength(2);
    expect([...files.values()].every(bytes => bytes.length <= 1024 * 1024)).toBe(true);
    expect(await decodeUniverseSave(await encodeUniverseSave(saved))).toEqual(saved);
  });
  it('reads and writes over an actual session, validates real player/entity ownership, replicates while paused and reconnects', async () => {
    const entityAdapter = captureDataAdapter('fixture.cargo', { ...inventory, scope: 'entity' });
    const dataAdapters = [extension, entityAdapter], world = new World(DEFAULT_UNIVERSE, { dataAdapters, soloPreview: false });
    const factory = createFlightSessions(flightSessionServices()), host = factory.host(world); clean.push(() => world.dispose(), () => factory.dispose());
    let savedToken = '';
    const connect = async (name: string, adapters = dataAdapters, token?: string) => {
      const [server, client] = loopback(); const joining = factory.join(client, { name, dataAdapters: adapters, token: () => token,
        saveToken: (_world, value) => { if (name === 'Ada') savedToken = value; } }, new AbortController().signal);
      host.accept(server); return joining;
    };
    const ada = await connect('Ada'), bob = await connect('Bob'); host.setPaused(true); await flush();
    const own = { adapter: extension.id, id: ada.playerId }; world.data.set(own, { count: 8 }); host.service(); await flush();
    expect(ada.world.data.get(own.adapter, own.id)).toEqual({ count: 8 }); expect('set' in ada.world.data).toBe(false);
    bob.dataCommand({ ...own, command: 'discard', args: 2 }); await flush(); host.service(); await flush();
    expect(world.data.get(own.adapter, own.id)).toEqual({ count: 8 });
    ada.dataCommand({ ...own, command: 'discard', args: 2 }); await flush(); host.service(); await flush();
    expect(bob.world.data.get(own.adapter, own.id)).toEqual({ count: 6 });
    const ship = world.ships().find(s => s.ownerId === ada.playerId)!;
    const cargo = { adapter: entityAdapter.id, id: ship.id }; world.data.set(cargo, { count: 4 });
    bob.dataCommand({ ...cargo, command: 'discard', args: 1 }); await flush(); expect(world.data.get(cargo.adapter, cargo.id)).toEqual({ count: 4 });
    ada.dataCommand({ ...cargo, command: 'discard', args: 1 }); await flush(); host.service(); await flush();
    expect(bob.world.data.get(cargo.adapter, cargo.id)).toEqual({ count: 3 });
    ada.dispose(); await flush(); const again = await connect('Ada', dataAdapters, savedToken);
    expect(again.playerId).toBe(own.id); expect(again.world.data.get(own.adapter, own.id)).toEqual({ count: 6 });
    const missing = connect('Missing', []); await expect(missing).rejects.toThrow('module-data');
    bob.dispose(); again.dispose();
  });
  it('lets a non-flight session borrow the public headless data factory without importing a ship or flight world', () => {
    let factory!: ModuleDataFactory;
    const registry = new ModuleRegistryV2(engineModuleServices());
    registry.register({manifest:{...descriptor.manifest,id:'fixture.survey-session',tier:'network',requires:[{name:'core.module-data',version:'^1.0.0'}]} as ManifestV2,
      initialize(context) { factory = context.use(CORE_MODULE_DATA); } });
    const candidate = registry.prepare({...profile,modules:[{id:'fixture.survey-session',version:'0.1.0'}]},'node');clean.push(() => candidate.dispose());
    const owners = new Map([['probe-a','ada'],['probe-b','bob']]);
    const observations = captureDataAdapter('fixture.survey', {...inventory,scope:'entity'}), store=factory.create([observations]), replica=factory.create([observations]);
    const target={adapter:observations.id,id:'probe-a'};
    store.set(target,{count:4});replica.apply(store.snapshot());
    const command=(playerId:string,args:number) => store.command({...target,command:'discard',args},{playerId,ownerId:owners.get(target.id),tick:20});
    expect(() => command('bob',1)).toThrow('denied');command('ada',1);replica.apply(store.delta(replica.revision));
    expect(replica.get(observations.id,'probe-a')).toEqual({count:3});
    const restored=factory.create([observations]);restored.restore(store.snapshot());expect(restored.snapshot()).toEqual(replica.snapshot());
  });
  it('builds and imports an actual editable data adapter, binds it to game identity and refuses its removal on load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'module-data-')); clean.push(() => rm(root, { recursive: true, force: true }));
    const folder = join(root, 'source'), output = join(root, 'inventory.spacemod'); await cp(resolve('examples/packages/inventory'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const store = new MemoryPackageStore(), policy = { environment: 'node' as const, allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) };
    const entry = await installPackage(new Uint8Array(await readFile(output)), store, inspectRuntimePackage,
      { source: 'Inventory fixture', installedAt: '2026-10-18T00:00:00Z' }, policy);
    let world!: World;
    const candidate = await prepareInstalledGame({ profile, packages: [{ id: entry.id, version: entry.version, digest: entry.digest }], requiredSlots: [] },
      store, policy, { hostServices: [], staticModules: [], inspect: inspectRuntimePackage, construct(modules, identity) {
        world = createModuleWorld(modules, identity); return { async start() {}, dispose() { world.dispose(); } };
      } }, new AbortController().signal);
    clean.push(() => candidate.dispose());
    world.data.set(target, { count: 5 }); expect(world.lock!.modules.some(m => m.id === 'example.inventory')).toBe(true);
    const saved = saveWorld(world); expect(saved.data!.schemas).toEqual([expect.objectContaining({ id: 'example.inventory/items', version: 2 })]);
    expect(() => loadWorld(saved)).toThrow('Missing required');
  }, 60000);
});
