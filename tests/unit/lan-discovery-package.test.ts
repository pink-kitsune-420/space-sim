import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LAN_DISCOVERY, type ManifestV2, type ModuleProfileV2, type TextConnection, type TransportProvider } from '../../packages/game-api/src/index';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { createLanDiscovery, createLanDiscoveryFactory } from '../../modules/discovery-lan/src/index';
const temporary: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
function transport() {
  const connections: TextConnection[] = [], signals: AbortSignal[] = [];
  const provider: TransportProvider = { name: 'fixture', schemes: ['survey'], async connect(address, signal) {
    const peer: TextConnection = { label: address, bufferedAmount: 0, send() {}, close: vi.fn(), onclose: null, onmessage: null };
    connections.push(peer); signals.push(signal); return peer;
  } };
  return { provider, connections, signals };
}
const greeting = JSON.stringify({ name: 'Survey', players: 1, maxPlayers: 4, password: false, protocol: 'survey/1' });

describe('portable LAN discovery', () => {
  it('uses an explicit non-flight greeting adapter and releases each probe', async () => {
    const io = transport(), factory = createLanDiscoveryFactory();
    const discovery = factory.create({ transport: io.provider, protocolId: 'survey/1', greeting: JSON.parse });
    const found = discovery.probe('survey://first'); await Promise.resolve(); io.connections[0]!.onmessage!(greeting);
    expect(await found).toEqual({ address: 'survey://first', name: 'Survey', players: 1, maxPlayers: 4, password: false, compatible: true });
    expect(io.signals[0]!.aborted).toBe(true); expect(io.connections[0]!.close).toHaveBeenCalledTimes(1);
    const mismatch = discovery.probe('survey://old'); await Promise.resolve(); io.connections[1]!.onmessage!(greeting.replace('survey/1', 'survey/2'));
    expect((await mismatch)!.compatible).toBe(false);
    factory.dispose(); await expect(discovery.probe('late')).rejects.toThrow('disposed');
    expect(() => factory.create({ transport: io.provider, protocolId: 'survey/1', greeting: JSON.parse })).toThrow('disposed');
  });
  it('bounds concurrency and cancels in-flight probes without late reports or timers', async () => {
    vi.useFakeTimers(); const io = transport(), found = vi.fn(), progress = vi.fn();
    const discovery = createLanDiscovery({ transport: io.provider, protocolId: 'survey/1', greeting: JSON.parse });
    const signal = new AbortController(), scan = discovery.scan(['a', 'b', 'c'], { concurrency: 2, signal: signal.signal, onfound: found, onprogress: progress });
    await Promise.resolve(); expect(io.connections).toHaveLength(2); signal.abort(); await scan;
    expect(io.signals.every(signal => signal.aborted)).toBe(true); expect(found).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const timeout = discovery.probe('timeout', 10); await vi.advanceTimersByTimeAsync(10); expect(await timeout).toBeUndefined();
    for (const concurrency of [NaN, 0, -1, 65, Infinity]) await expect(discovery.scan([], { concurrency })).rejects.toThrow('concurrency');
    const pending = discovery.probe('pending'); discovery.dispose(); expect(await pending).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses malformed/oversized greetings and preserves candidate ordering', async () => {
    const io = transport(), factory = createLanDiscoveryFactory(), discovery = factory.create({ transport: io.provider, protocolId: 'survey/1', greeting: JSON.parse });
    for (const text of ['invalid', greeting.replace('"players":1', '"players":-1'), 'x'.repeat(16385)]) {
      const probe = discovery.probe('a'); await Promise.resolve(); io.connections.at(-1)!.onmessage!(text); expect(await probe).toBeUndefined();
    }
    expect(factory.candidates(['http://172.20.3.7:6464'], 6464).slice(0, 3)).toEqual(['localhost:6464', '172.20.3.1:6464', '172.20.3.2:6464']);
    expect(() => factory.candidates([], 0)).toThrow('port'); factory.dispose();
  });
  it('builds, imports and removes the real package without native network IO', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-discovery-')); temporary.push(root);
    const folder = join(root, 'source'), output = join(root, 'discovery.spacemod'); await cp(resolve('modules/discovery-lan'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const registration = imported.register({ environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) });
    const graph = new ModuleRegistryV2(); graph.register(registration.module, registration.assets);
    const manifest = registration.module.manifest as ManifestV2, profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'fixture.discovery',
      modules: [{ id: manifest.id, version: manifest.version }], providers: { 'net.lan-discovery': manifest.id }, capabilities: {}, settings: {} };
    const candidate = graph.prepare(profile, 'node'); const io = transport();
    const discovery = candidate.providedService(LAN_DISCOVERY).create({ transport: io.provider, protocolId: 'survey/1', greeting: JSON.parse });
    const pending = discovery.probe('survey'); candidate.dispose(); expect(await pending).toBeUndefined(); expect(io.signals[0]!.aborted).toBe(true);
    graph.prepare({ ...profile, modules: [], providers: {} }, 'node').dispose();
  }, 60000);
});
