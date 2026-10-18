import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WEBSOCKET_TRANSPORT, type ManifestV2, type ModuleProfileV2, type RegisteredModuleV2 } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleRuntimeV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import initialize, { createWebSocketTransport } from '../../modules/net-websocket/src/index';
import { connectWebSocket } from '../../modules/net-websocket/src/connection';
import descriptor from '../../modules/net-websocket/module.json';
import guide from '../../modules/net-websocket/docs/creators/usage.json';

class Socket {
  static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0; bufferedAmount = 0; closes = 0; sent: string[] = []; closeReason = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
  send(text: string) { this.sent.push(text); }
  close(_code?: number, reason = '') { this.closes++; this.closeReason = reason; this.readyState = Socket.CLOSING; }
  ended(reason = '', wasClean = true) { this.readyState = Socket.CLOSED; this.onclose?.({ reason, wasClean }); }
  message(data: unknown) { this.onmessage?.({ data }); }
}
const manifest = descriptor.manifest as ManifestV2, temporary: string[] = [];
const profile = (modules: readonly RegisteredModuleV2[], provider = manifest.id): ModuleProfileV2 => ({
  format: 'space-sim-profile/2', id: 'fixture.websocket',
  modules: modules.map(module => ({ id: module.manifest.id, version: module.manifest.version })),
  providers: modules.some(module => module.manifest.id === provider) ? { 'net.websocket': provider } : {}, capabilities: {}, settings: {},
});
const shipped: RegisteredModuleV2 = { manifest, initialize };
function registry() {
  const registry = new ModuleRegistryV2();
  registry.register(shipped, moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]])));
  return registry;
}
beforeEach(() => { Socket.instances = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('editable WebSocket transport lifecycle', () => {
  it('passes ordered text and backpressure without knowing session or flight state', async () => {
    const transport = createWebSocketTransport(), connected = transport.connect('localhost', new AbortController().signal);
    const socket = Socket.instances[0]!; expect(socket.url).toBe('ws://localhost:6464/ws'); socket.open();
    const peer = await connected, messages: string[] = [], closed: string[] = [];
    peer.onmessage = text => messages.push(text); peer.onclose = reason => closed.push(reason);
    socket.message('survey:1'); socket.message('survey:2'); peer.send('command:3'); socket.bufferedAmount = 23;
    expect(messages).toEqual(['survey:1', 'survey:2']); expect(socket.sent).toEqual(['command:3']); expect(peer.bufferedAmount).toBe(23);
    socket.ended('host stopped'); expect(closed).toEqual(['host stopped']); transport.dispose(); expect(socket.closes).toBe(0);
  });
  it('cancels before opening, after opening and during provider disposal, with immediate listener cleanup', async () => {
    const cancelled = new AbortController(); cancelled.abort(); const transport = createWebSocketTransport();
    await expect(transport.connect('localhost', cancelled.signal)).rejects.toThrow('cancelled'); expect(Socket.instances).toHaveLength(0);
    const pendingSignal = new AbortController(), removePending = vi.spyOn(pendingSignal.signal, 'removeEventListener');
    const pending = transport.connect('localhost', pendingSignal.signal), rejected = expect(pending).rejects.toThrow('cancelled');
    pendingSignal.abort(); await rejected; expect(Socket.instances[0]!.closes).toBe(1); expect(removePending).toHaveBeenCalled();
    const activeSignal = new AbortController(), removeActive = vi.spyOn(activeSignal.signal, 'removeEventListener');
    const active = transport.connect('localhost', activeSignal.signal); Socket.instances[1]!.open(); const peer = await active;
    const messages = vi.fn(); peer.onmessage = messages; activeSignal.abort();
    Socket.instances[1]!.message('late'); peer.send('late'); expect(messages).not.toHaveBeenCalled();
    expect(Socket.instances[1]!.sent).toEqual([]); expect(Socket.instances[1]!.closes).toBe(1); expect(removeActive).toHaveBeenCalled();
    const opening = transport.connect('localhost', new AbortController().signal), stopped = expect(opening).rejects.toThrow('cancelled');
    const established = transport.connect('localhost', new AbortController().signal); Socket.instances[3]!.open(); await established;
    transport.dispose(); transport.dispose(); await stopped;
    expect(Socket.instances.map(socket => socket.closes)).toEqual([1, 1, 1, 1]);
    await expect(transport.connect('localhost', new AbortController().signal)).rejects.toThrow('disposed');
  });
  it('retains an immediate greeting until the async consumer attaches its handler', async () => {
    const provider = createWebSocketTransport(), opening = provider.connect('localhost', new AbortController().signal);
    const socket = Socket.instances[0]!; socket.open(); socket.message('survey greeting');
    const peer = await opening, messages: string[] = []; peer.onmessage = text => messages.push(text);
    await Promise.resolve(); expect(messages).toEqual(['survey greeting']); provider.dispose();
  });
  it('times out pending sockets, reports failed opens and ignores a late open', async () => {
    vi.useFakeTimers();
    const opening = connectWebSocket('ws://local', 50), rejected = expect(opening).rejects.toThrow('No answer');
    await vi.advanceTimersByTimeAsync(50); await rejected;
    expect(Socket.instances[0]!.closes).toBe(1); Socket.instances[0]!.open(); expect(vi.getTimerCount()).toBe(0);
    const failing = connectWebSocket('ws://missing'), failed = expect(failing).rejects.toThrow('Could not connect');
    Socket.instances[1]!.ended('', false); await failed; expect(vi.getTimerCount()).toBe(0);
  });
  it('closes on non-text or oversized input and bounds UTF-8 close reasons', async () => {
    for (const invalid of [new Uint8Array([1]), '12345']) {
      const opening = connectWebSocket('ws://local', 100, { maxTextLength: 4 }); const socket = Socket.instances.at(-1)!;
      socket.open(); const peer = await opening; const received = vi.fn(); peer.onmessage = received;
      socket.message(invalid); socket.message('late'); expect(socket.closeReason).toBe('Unexpected data.'); expect(received).not.toHaveBeenCalled();
      peer.close(); expect(socket.closes).toBe(1);
    }
    const opening = connectWebSocket('ws://local'); const socket = Socket.instances.at(-1)!; socket.open(); const peer = await opening;
    peer.close('🌌'.repeat(100)); expect(new TextEncoder().encode(socket.closeReason).length).toBeLessThanOrEqual(123);
    expect(socket.closeReason).not.toContain('�');
  });
  it('rejects invalid settings and aborts without requiring a native device at import time', async () => {
    expect(() => createWebSocketTransport(NaN)).toThrow('Invalid'); expect(() => createWebSocketTransport(1, 1.5)).toThrow('Invalid');
    await expect(connectWebSocket('ws://local', Infinity)).rejects.toThrow('finite');
    await expect(connectWebSocket('ws://local', 1, { maxTextLength: 0 })).rejects.toThrow('safe integer');
    vi.stubGlobal('WebSocket', undefined); const candidate = registry().prepare(profile([shipped]), 'node');
    expect(candidate.contributions('transport')).toHaveLength(1); expect(candidate.contributions('guide')).toHaveLength(1);
    const transport = candidate.providedService(WEBSOCKET_TRANSPORT);
    await expect(transport.connect('localhost', new AbortController().signal)).rejects.toThrow(); candidate.dispose();
    expect(Socket.instances).toHaveLength(0);
  });
  it('keeps cancellation connected through the runtime transport contribution after opening', async () => {
    const candidate = registry().prepare(profile([shipped]), 'node'), signal = new AbortController();
    const opening = candidate.contributions('transport')[0]!.value.connect('localhost', signal.signal);
    Socket.instances[0]!.open(); const peer = await opening;
    signal.abort(); expect(Socket.instances[0]!.closes).toBe(1);
    expect(() => peer.send('after cancellation')).toThrow('closed'); candidate.dispose();
  });
  it('rejects missing required providers, recovers through substitution and closes the old graph', async () => {
    const graph = registry(), runtime = new ModuleRuntimeV2(graph, 'node'); let observed = '';
    const consumer: RegisteredModuleV2 = { manifest: { ...manifest, id: 'fixture.consumer', slots: [], provides: [], requires: [{ name: 'net.websocket', version: '^1.0.0' }] },
      initialize(context) { observed = context.use(WEBSOCKET_TRANSPORT).name; } };
    graph.register(consumer); expect(() => graph.prepare(profile([consumer]), 'node')).toThrow('needs net.websocket');
    const original = graph.prepare(profile([shipped, consumer]), 'node'); runtime.activate(original); expect(observed).toBe('websocket');
    const opening = original.providedService(WEBSOCKET_TRANSPORT).connect('localhost', new AbortController().signal);
    Socket.instances[0]!.open(); await opening;
    const substitute: RegisteredModuleV2 = { manifest: { ...manifest, id: 'fixture.websocket' }, initialize(context) {
      const provider = context.own(createWebSocketTransport()); context.provide(WEBSOCKET_TRANSPORT, { ...provider, name: 'replacement' });
    } };
    graph.register(substitute); const replacement = graph.prepare(profile([substitute, consumer], substitute.manifest.id), 'node'); runtime.activate(replacement);
    expect(observed).toBe('replacement'); expect(Socket.instances[0]!.closes).toBe(1);
    runtime.activate(graph.prepare(profile([]), 'node')); expect(runtime.active!.contributions('transport')).toEqual([]); runtime.dispose();
  });
  it('builds and imports the actual package through consent on a headless graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-websocket-')); temporary.push(root);
    const folder = join(root, 'source'), output = join(root, 'websocket.spacemod'); await cp(resolve('modules/net-websocket'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const registration = imported.register({ environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) });
    const graph = new ModuleRegistryV2(); graph.register(registration.module, registration.assets);
    vi.stubGlobal('WebSocket', undefined); const candidate = graph.prepare(profile([registration.module]), 'node');
    expect(candidate.providedService(WEBSOCKET_TRANSPORT).schemes).toEqual(['ws', 'wss']);
    expect(candidate.guideDocuments.get(`${manifest.id}/usage`)).toContain('session semantics'); candidate.dispose();
  }, 60000);
});
