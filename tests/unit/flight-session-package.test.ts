import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLIGHT_SESSIONS, type ManifestV2, type ModuleProfileV2, type RegisteredModuleV2 } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleRuntimeV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { engineModuleServices } from '../../packages/sim-core/src/module-services';
import { DEFAULT_UNIVERSE, IDLE } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { saveWorld, loadWorld } from '../../packages/sim-core/src/save';
import { flightSessionServices } from '../../packages/net/src/session-services';
import { loopback } from '../../packages/net/src/connection';
import initialize, { createFlightSessions } from '../../modules/session-flight/src/index';
import descriptor from '../../modules/session-flight/module.json';
import guide from '../../modules/session-flight/docs/creators/usage.json';

const manifest = descriptor.manifest as ManifestV2, temporary: string[] = [];
const shipped: RegisteredModuleV2 = { manifest, initialize };
const profile = (modules: readonly RegisteredModuleV2[], provider = manifest.id): ModuleProfileV2 => ({
  format: 'space-sim-profile/2', id: 'fixture.flight', modules: modules.map(module => ({ id: module.manifest.id, version: module.manifest.version })),
  providers: modules.some(module => module.manifest.id === provider) ? { 'session.flight': provider } : {}, capabilities: {}, settings: {},
});
function registry() {
  const graph = new ModuleRegistryV2(engineModuleServices());
  graph.register(shipped, moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]]))); return graph;
}
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('portable explicit flight session', () => {
  it('hosts and joins through public services, preserving ownership, replayed flight and saves', async () => {
    const provider = createFlightSessions(flightSessionServices()), world = new World(DEFAULT_UNIVERSE);
    const host = provider.host(world), [server, client] = loopback();
    let token = '';
    const joining = provider.join(client, { name: 'Ada', saveToken: (_id, value) => { token = value; } }, new AbortController().signal);
    host.accept(server); const remote = await joining;
    expect(provider.protocol).toBe('space-sim-net/5'); expect(provider.entitySchema).toBe('space-sim-ships/1');
    const ship = world.ships()[0]!; expect(ship.ownerId).toBe(remote.playerId); expect(token).toMatch(/^[0-9a-f]{32}$/);
    remote.update(0.01, ship.id, { turn: 0, throttle: 0, engine: true });
    for (let tick = 0; tick < 150; tick++) { await Promise.resolve(); host.step(); host.service(); remote.update(0.01, ship.id, { turn: 0, throttle: 0, engine: true }); }
    expect(world.ship(ship.id)!.state.status).toBe('flying');
    expect(() => host.setControls('foreign-player', ship.id, IDLE)).toThrow();
    const saved = saveWorld(world, { players: host.roster() });
    const restored = loadWorld(saved); expect(saveWorld(restored.world, { players: restored.players })).toEqual(saved);
    restored.world.dispose(); remote.dispose(); host.dispose(); provider.dispose(); world.dispose();
  });

  it('disposes pending joins and established local/client worlds, while hosts only borrow their worlds', async () => {
    const provider = createFlightSessions(flightSessionServices()), [server, client] = loopback();
    const closed = vi.fn(); server.onclose = closed;
    const waiting = provider.join(client, { name: 'Pending' }, new AbortController().signal), failure = expect(waiting).rejects.toThrow();
    provider.dispose(); await failure; expect(closed).toHaveBeenCalledTimes(1);
    const next = createFlightSessions(flightSessionServices()), world = new World(DEFAULT_UNIVERSE), disposed = vi.spyOn(world, 'dispose');
    const local = next.local(world, { name: 'Local' }); local.dispose(); next.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    const borrowed = new World(DEFAULT_UNIVERSE), disposeBorrowed = vi.spyOn(borrowed, 'dispose');
    const other = createFlightSessions(flightSessionServices()); other.host(borrowed); other.dispose(); expect(disposeBorrowed).not.toHaveBeenCalled();
    const recovered = createFlightSessions(flightSessionServices()); recovered.host(borrowed); recovered.dispose(); borrowed.dispose();
    await expect(other.join(loopback()[0], { name: 'late' }, new AbortController().signal)).rejects.toThrow('disposed');
  });

  it('continues cleanup after one peer throws and prevents stepping a disposed borrowed host', () => {
    const provider = createFlightSessions(flightSessionServices()), world = new World(DEFAULT_UNIVERSE), host = provider.host(world);
    const [first] = loopback(), [second] = loopback(); let closed = 0;
    first.close = () => { throw new Error('Consumer close failed'); }; second.close = () => { closed++; };
    host.accept(first); host.accept(second);
    expect(() => provider.dispose()).toThrow('Flight session cleanup'); expect(closed).toBe(1);
    expect(() => host.step()).toThrow('disposed'); expect(world.tick).toBe(0);
    const replacement = createFlightSessions(flightSessionServices()); expect(() => replacement.host(world)).not.toThrow(); replacement.dispose(); world.dispose();
  });
  it('keeps the caller abort attached after join and releases listeners on disposal', async () => {
    let disposeCalls = 0;
    const services = flightSessionServices(), provider = createFlightSessions({ ...services, world: { create(universe, options) {
      const mirror = new World(universe, options), dispose = mirror.dispose.bind(mirror);
      mirror.dispose = () => { disposeCalls++; dispose(); }; return mirror;
    } } }), world = new World(DEFAULT_UNIVERSE), host = provider.host(world);
    const [server, client] = loopback(), signal = new AbortController(), removed = vi.spyOn(signal.signal, 'removeEventListener');
    const joining = provider.join(client, { name: 'Ada' }, signal.signal); host.accept(server); const session = await joining;
    signal.abort(); await Promise.resolve();
    expect(disposeCalls).toBe(1); session.dispose(); expect(removed).toHaveBeenCalled();
    provider.dispose(); world.dispose();
  });

  it('rejects missing requirements and releases old subscriptions during graph replacement', () => {
    const graph = registry(), runtime = new ModuleRuntimeV2(graph, 'node');
    const consumer: RegisteredModuleV2 = { manifest: { ...manifest, id: 'fixture.consumer', slots: [], provides: [], requires: [{ name: 'session.flight', version: '^1.0.0' }] }, initialize(context) { context.use(FLIGHT_SESSIONS); } };
    graph.register(consumer); expect(() => graph.prepare(profile([consumer]), 'node')).toThrow('needs session.flight');
    const candidate = graph.prepare(profile([shipped, consumer]), 'node'); runtime.activate(candidate);
    const world = new World(DEFAULT_UNIVERSE); candidate.providedService(FLIGHT_SESSIONS).host(world);
    runtime.activate(graph.prepare(profile([]), 'node'));
    const provider = createFlightSessions(flightSessionServices()); expect(() => provider.host(world)).not.toThrow(); provider.dispose(); runtime.dispose(); world.dispose();
  });

  it('builds the actual editable package, imports with consent and runs on a headless graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-flight-')); temporary.push(root);
    const folder = join(root, 'source'), output = join(root, 'flight.spacemod'); await cp(resolve('modules/session-flight'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const registration = imported.register({ environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) });
    const graph = new ModuleRegistryV2(engineModuleServices()); graph.register(registration.module, registration.assets);
    const candidate = graph.prepare(profile([registration.module]), 'node'), provider = candidate.providedService(FLIGHT_SESSIONS);
    const world = new World(DEFAULT_UNIVERSE), host = provider.host(world); expect(host.world.id).toBe(world.id);
    expect(candidate.guideDocuments.get(`${manifest.id}/usage`)).toContain('space-sim-net/5'); candidate.dispose(); world.dispose();
  }, 60000);
});
