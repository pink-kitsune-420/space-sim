import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TAB_TRANSPORT, type ModuleProfileV2, type RegisteredModuleV2, type TabAdvert, type TabChannel, type TabLocks, type TextConnection } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleRuntimeV2 } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { createTabNetwork } from '../../modules/net-tab/src/index';

class Bus {
  readonly channels = new Map<TabChannel, string>();
  channel = (name: string): TabChannel => {
    const bus = this;
    const channel: TabChannel = { onmessage: null, close() { bus.channels.delete(channel); }, postMessage(message) {
      const data = structuredClone(message);
      for (const [other, group] of bus.channels) if (other !== channel && group === name)
        queueMicrotask(() => { if (bus.channels.has(other)) other.onmessage?.({ data }); });
    } };
    this.channels.set(channel, name); return channel;
  };
}
const controller = () => new AbortController();
const description = () => ({ name: 'Survey', sessionId: 'survey-session', players: 1, maxPlayers: 4 });
const temporary: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
function options(bus: Bus, scope = 'fixture.survey', protocolId = 'survey/1') { return { scope, protocolId, channel: bus.channel, locks: null, timeoutMs: 100 } as const; }
function profile(modules: readonly RegisteredModuleV2[]): ModuleProfileV2 { return {
  format: 'space-sim-profile/2', id: 'fixture.tab', modules: modules.map(module => ({ id: module.manifest.id, version: module.manifest.version })),
  providers: modules.length > 1 ? { 'net.tab': modules[0]!.manifest.id } : {}, capabilities: {}, settings: {},
}; }

describe('scoped reusable tab transport', () => {
  it('connects over native Node BroadcastChannel without browser or flight wiring', async () => {
    const scope = `fixture.native-${crypto.randomUUID()}`;
    const owner = createTabNetwork({ scope, protocolId: 'survey/1', locks: null });
    const guest = createTabNetwork({ scope, protocolId: 'survey/1', locks: null });
    try {
      const host = owner.host(description, peer => { peer.onmessage = text => peer.send(`native:${text}`); }, controller().signal);
      const peer = await guest.connect(host.key, controller().signal);
      const answer = new Promise<string>(resolve => { peer.onmessage = resolve; });
      peer.send('survey:2'); expect(await answer).toBe('native:survey:2');
    } finally { owner.dispose(); guest.dispose(); }
  });
  it('isolates scope and protocol, preserves early greetings and exchanges non-flight text', async () => {
    vi.useFakeTimers(); const bus = new Bus(), owner = createTabNetwork(options(bus)), guest = createTabNetwork(options(bus));
    const other = createTabNetwork(options(bus, 'other.game')), incompatible = createTabNetwork(options(bus, 'fixture.survey', 'survey/2'));
    const hosts: TextConnection[] = [];
    const host = owner.host(description, peer => { hosts.push(peer); peer.send('hello survey'); peer.onmessage = text => peer.send(`observed:${text}`); }, controller().signal);
    const seen: TabAdvert[] = []; const watching = guest.watch(adverts => { seen.splice(0, seen.length, ...adverts); }, controller().signal);
    other.watch(() => { throw new Error('Wrong game discovered'); }, controller().signal);
    incompatible.watch(() => { throw new Error('Wrong protocol discovered'); }, controller().signal);
    const peer = await guest.connect(`tab://${host.key}`, controller().signal), messages: string[] = [];
    peer.onmessage = text => messages.push(text); expect(messages).toEqual(['hello survey']);
    peer.send('sample:3'); await vi.waitFor(() => expect(messages).toEqual(['hello survey', 'observed:sample:3']));
    expect(seen.map(value => value.sessionId)).toEqual(['survey-session']); expect(watching.adverts()).toEqual(seen);
    const rejected = expect(other.connect(host.key, controller().signal)).rejects.toThrow('did not answer');
    await vi.advanceTimersByTimeAsync(100); await rejected; expect(hosts).toHaveLength(1);
    expect(new Set(bus.channels.values()).size).toBe(3);
    owner.dispose(); guest.dispose(); other.dispose(); incompatible.dispose();
    expect(bus.channels.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the channel scope for pending Web Locks and cancels before a delayed grant', async () => {
    vi.useFakeTimers(); const bus = new Bus(), requests: { name: string; signal?: AbortSignal; grant: () => void }[] = [];
    const locks: TabLocks = { request(name, options, callback) { return new Promise((resolve, reject) => {
      requests.push({ name, signal: options.signal, grant: () => { if (!options.signal?.aborted) void callback().then(resolve, reject); } });
      options.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }); } };
    const network = createTabNetwork({ ...options(bus, 'a/b', 'proto/1'), locks });
    const pending = network.connect('a'.repeat(32), controller().signal), rejected = expect(pending).rejects.toThrow('cancelled');
    const channel = [...bus.channels.values()][0]!; expect(requests[0]!.name.startsWith(`${channel}/`)).toBe(true);
    expect(channel).toBe('spacelab-tab/1/a%2Fb/proto%2F1'); network.dispose(); await rejected;
    expect(requests[0]!.signal!.aborted).toBe(true); requests[0]!.grant(); await vi.advanceTimersByTimeAsync(1000);
    expect(bus.channels.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts established connections and discovery and disposes all host peers after a callback fault', async () => {
    vi.useFakeTimers(); const bus = new Bus(), owner = createTabNetwork(options(bus)), guest = createTabNetwork(options(bus));
    const accepted: TextConnection[] = []; const host = owner.host(description, peer => accepted.push(peer), controller().signal);
    const signal = controller(), first = await guest.connect(host.key, signal.signal);
    let reason = ''; first.onclose = value => { reason = value; }; signal.abort(); expect(reason).toContain('cancelled');
    const second = await guest.connect(host.key, controller().signal), third = await guest.connect(host.key, controller().signal);
    accepted[1]!.onclose = () => { throw new Error('Broken consumer'); }; let thirdClosed = false; third.onclose = () => { thirdClosed = true; };
    expect(() => host.dispose()).toThrow('cleanup'); await vi.waitFor(() => expect(thirdClosed).toBe(true));
    second.close();
    const scanSignal = controller(), scan = guest.discovery.scan(() => {}, scanSignal.signal); scanSignal.abort(); await scan;
    const stopWithProvider = guest.discovery.scan(() => {}, controller().signal); guest.dispose(); await stopWithProvider;
    owner.dispose(); expect(bus.channels.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects missing/broken IO, invalid addresses and oversized messages without leaking resources', async () => {
    vi.useFakeTimers(); const bus = new Bus();
    expect(() => createTabNetwork({ ...options(bus), scope: '' })).toThrow('explicit scope');
    expect(() => createTabNetwork({ ...options(bus), locks: {} as TabLocks })).toThrow('IO provider');
    const network = createTabNetwork({ ...options(bus), maxTextLength: 4 });
    await expect(network.connect('bad host', controller().signal)).rejects.toThrow('address');
    const cancelled = controller(); cancelled.abort(); await expect(network.connect('b'.repeat(32), cancelled.signal)).rejects.toThrow('cancelled');
    const host = network.host(description, () => {}, controller().signal), peer = await network.connect(host.key, controller().signal);
    let reason = ''; peer.onclose = value => { reason = value; }; peer.send('12345'); expect(reason).toContain('large');
    network.dispose(); expect(bus.channels.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('imports editable packages, rejects a missing provider and replaces a live graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-tab-')); temporary.push(root);
    const folder = join(root, 'source'); await cp(resolve('modules/net-tab'), folder, { recursive: true });
    const load = async (name: string) => {
      const output = join(root, `${name}.spacemod`); await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
      const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
      return imported.register({ environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) });
    };
    const original = await load('original'), descriptorPath = join(folder, 'module.json'), descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    descriptor.manifest.id = 'fixture.tab-replacement'; delete descriptor.build; await writeFile(descriptorPath, JSON.stringify(descriptor));
    const entry = join(folder, 'src/index.ts'); await writeFile(entry, (await readFile(entry, 'utf8')).replaceAll("name: 'tab'", "name: 'edited-tab'"));
    const replacement = await load('replacement'), graph = new ModuleRegistryV2();
    graph.register(original.module, original.assets); graph.register(replacement.module, replacement.assets);
    const consumer: RegisteredModuleV2 = { manifest: { ...original.module.manifest, id: 'fixture.tab-user', slots: [], provides: [], requires: [{ name: 'net.tab', version: '^1.0.0' }] },
      initialize(context) { context.use(TAB_TRANSPORT); } };
    graph.register(consumer); expect(() => graph.prepare(profile([consumer]), 'node')).toThrow('net.tab');
    vi.stubGlobal('BroadcastChannel', undefined); const runtime = new ModuleRuntimeV2(graph, 'node'); runtime.activate(graph.prepare(profile([original.module, consumer]), 'node'));
    const bus = new Bus(), oldFactory = runtime.active!.providedService(TAB_TRANSPORT), network = oldFactory.create(options(bus));
    const host = network.host(description, peer => { peer.onmessage = text => peer.send(text); }, controller().signal);
    const peer = await network.connect(host.key, controller().signal); let closed = false; peer.onclose = () => { closed = true; };
    runtime.activate(graph.prepare(profile([replacement.module, consumer]), 'node')); expect(closed).toBe(true); expect(bus.channels.size).toBe(0);
    expect(() => oldFactory.create(options(bus))).toThrow('disposed');
    const edited = runtime.active!.providedService(TAB_TRANSPORT).create(options(bus)); expect(edited.name).toBe('edited-tab');
    runtime.activate(graph.prepare(profile([]), 'node')); expect(() => edited.host(description, () => {}, controller().signal)).toThrow('disposed'); runtime.dispose();
  }, 60000);
});
