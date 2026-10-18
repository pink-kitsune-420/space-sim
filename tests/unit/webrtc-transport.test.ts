import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WEBRTC_SIGNALING, type ManifestV2, type ModuleProfileV2, type RegisteredModuleV2 } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleRuntimeV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import initialize, { createManualSignaling } from '../../modules/net-webrtc/src/index';
import { PUBLIC_STUN } from '../../modules/net-webrtc/src/connection';
import descriptor from '../../modules/net-webrtc/module.json';
import guide from '../../modules/net-webrtc/docs/creators/usage.json';
import { Peer, code } from '../helpers/webrtc';

const manifest = descriptor.manifest as ManifestV2, temporary: string[] = [];
const shipped: RegisteredModuleV2 = { manifest, initialize };
const profile = (modules: readonly RegisteredModuleV2[], provider = manifest.id): ModuleProfileV2 => ({
  format: 'space-sim-profile/2', id: 'fixture.webrtc', modules: modules.map(module => ({ id: module.manifest.id, version: module.manifest.version })),
  providers: modules.some(module => module.manifest.id === provider) ? { 'net.webrtc-signaling': provider } : {}, capabilities: {}, settings: {},
});
function registry() {
  const graph = new ModuleRegistryV2();
  graph.register(shipped, moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]])));
  return graph;
}
beforeEach(() => {
  Peer.all = []; Peer.gathering = 'complete'; Peer.offerFails = false;
  vi.stubGlobal('RTCPeerConnection', Peer); vi.stubGlobal('CompressionStream', undefined);
});
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('editable manual WebRTC transport', () => {
  it('returns reply before connection and exchanges non-flight text with explicit STUN and private diagnostics', async () => {
    const provider = createManualSignaling(), host = await provider.create(true, new AbortController().signal);
    expect(Peer.all[0]!.configuration!.iceServers).toEqual([{ urls: PUBLIC_STUN }]);
    const reply = await provider.answer(host.code, new AbortController().signal);
    expect(Peer.all[1]!.configuration!.iceServers).toEqual([{ urls: PUBLIC_STUN }]);
    expect(provider.isInviteCode(host.code)).toBe(true); expect(provider.isReplyCode(reply.code)).toBe(true);
    let connected = false; void reply.connection.then(() => { connected = true; }); await Promise.resolve(); expect(connected).toBe(false);
    const joined = await host.accept(reply.code);
    Peer.all[1]!.ondatachannel?.({ channel: Peer.all[1]!.channel });
    const remote = await reply.connection; expect(connected).toBe(true);
    let received = ''; remote.onmessage = value => { received = value; };
    joined.send('survey:observation:1');
    for (const data of Peer.all[0]!.channel.sent) Peer.all[1]!.channel.onmessage?.({ data });
    expect(received).toBe('survey:observation:1');
    expect(Object.keys(reply.diagnostics()).sort()).toEqual(['candidates', 'connection', 'errors', 'gathering']);
    provider.dispose(); expect(Peer.all.every(peer => peer.signalingState === 'closed')).toBe(true);
  });

  it('cancels gathering for either role and removes timers and signal listeners', async () => {
    vi.useFakeTimers(); Peer.gathering = 'gathering';
    const provider = createManualSignaling();
    for (const answer of [false, true]) {
      const signal = new AbortController(), removed = vi.spyOn(signal.signal, 'removeEventListener');
      const opening = answer ? provider.answer(code('offer'), signal.signal) : provider.create(false, signal.signal);
      const rejected = expect(opening).rejects.toThrow('Cancelled');
      await vi.advanceTimersByTimeAsync(1); signal.abort(); await rejected;
      expect(Peer.all.at(-1)!.signalingState).toBe('closed'); expect(removed).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    }
    provider.dispose();
  });

  it('owns pending replies and established links until abort, natural close or provider disposal', async () => {
    vi.useFakeTimers();
    const provider = createManualSignaling(), hostSignal = new AbortController();
    const host = await provider.create(false, hostSignal.signal);
    expect(Peer.all[0]!.configuration!.iceServers).toEqual([]);
    const peer = await host.accept(code('answer')); const closed = vi.fn(); peer.onclose = closed;
    hostSignal.abort(); peer.send('late'); expect(closed).toHaveBeenCalledTimes(1); expect(Peer.all[0]!.channel.sent).toEqual([]);
    const signal = new AbortController(), removed = vi.spyOn(signal.signal, 'removeEventListener');
    const reply = await provider.answer(code('offer'), signal.signal), rejected = expect(reply.connection).rejects.toThrow('Cancelled');
    provider.dispose(); provider.dispose(); await rejected; expect(removed).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    await expect(provider.create(false, new AbortController().signal)).rejects.toThrow('disposed');
    const next = createManualSignaling(), natural = new AbortController(), removeNatural = vi.spyOn(natural.signal, 'removeEventListener');
    const invite = await next.create(false, natural.signal), connected = await invite.accept(code('answer'));
    connected.close(); expect(removeNatural).toHaveBeenCalled(); next.dispose();
  });

  it('prevents cancelled setup and late signaling from reopening a peer', async () => {
    const provider = createManualSignaling(), signal = new AbortController(); signal.abort();
    await expect(provider.create(false, signal.signal)).rejects.toThrow('Cancelled');
    await expect(provider.answer(code('offer'), signal.signal)).rejects.toThrow('Cancelled'); expect(Peer.all).toHaveLength(0);
    const host = await provider.create(false, new AbortController().signal); host.dispose();
    await expect(host.accept(code('answer'))).rejects.toThrow('Cancelled');
    expect(Peer.all[0]!.signalingState).toBe('closed'); provider.dispose();
  });

  it('rejects a missing provider and recovers by replacement, disposing the prior graph', async () => {
    const graph = registry(), runtime = new ModuleRuntimeV2(graph, 'browser'); let observed = false;
    const consumer: RegisteredModuleV2 = { manifest: { ...manifest, id: 'fixture.consumer', slots: [], provides: [], requires: [{ name: 'net.webrtc-signaling', version: '^1.0.0' }] },
      initialize(context) { observed = !!context.use(WEBRTC_SIGNALING); } };
    graph.register(consumer); expect(() => graph.prepare(profile([consumer]), 'browser')).toThrow('needs net.webrtc-signaling');
    const original = graph.prepare(profile([shipped, consumer]), 'browser'); runtime.activate(original); expect(observed).toBe(true);
    const invite = await original.providedService(WEBRTC_SIGNALING).create(false, new AbortController().signal); await invite.accept(code('answer'));
    const substitute: RegisteredModuleV2 = { manifest: { ...manifest, id: 'fixture.webrtc' }, initialize(context) {
      context.provide(WEBRTC_SIGNALING, context.own(createManualSignaling()));
    } };
    graph.register(substitute); runtime.activate(graph.prepare(profile([substitute, consumer], substitute.manifest.id), 'browser'));
    expect(Peer.all[0]!.signalingState).toBe('closed');
    runtime.activate(graph.prepare(profile([]), 'browser')); runtime.dispose();
  });

  it('builds and imports the real package through code consent without opening a native device', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-webrtc-')); temporary.push(root);
    const folder = join(root, 'source'), output = join(root, 'webrtc.spacemod'); await cp(resolve('modules/net-webrtc'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const unapproved = imported.register({ environment: 'browser', allowRuntimeCode: true, approvedDigests: new Set() });
    const rejected = new ModuleRegistryV2(); rejected.register(unapproved.module, unapproved.assets);
    expect(() => rejected.prepare(profile([unapproved.module]), 'browser')).toThrow();
    const registration = imported.register({ environment: 'browser', allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) });
    const graph = new ModuleRegistryV2(); graph.register(registration.module, registration.assets);
    vi.stubGlobal('RTCPeerConnection', undefined); const candidate = graph.prepare(profile([registration.module]), 'browser');
    expect(candidate.guideDocuments.get(`${manifest.id}/usage`)).toContain('connection Promise'); expect(Peer.all).toHaveLength(0);
    await expect(candidate.providedService(WEBRTC_SIGNALING).create(false, new AbortController().signal)).rejects.toThrow(); candidate.dispose();
    expect(() => graph.prepare(profile([registration.module]), 'node')).toThrow();
  }, 60000);
});
