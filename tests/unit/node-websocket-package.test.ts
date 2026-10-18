import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NODE_WEBSOCKET_CODECS, NODE_WEBSOCKET_TRANSPORT, type HostServiceAccess, type ModuleProfileV2, type RegisteredModuleV2, type ServerTextConnection } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleRuntimeV2 } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { nativeWebSocketCodecs } from '../../apps/server/src/websocket';
import { createNodeWebSocketProvider } from '../../modules/net-node-ws/src/index';

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
const host: HostServiceAccess = { key: NODE_WEBSOCKET_CODECS, service: nativeWebSocketCodecs, tiers: ['network'], environments: ['node'] };
const profile = (modules: readonly RegisteredModuleV2[]): ModuleProfileV2 => ({
  format: 'space-sim-profile/2', id: 'fixture.node-ws', modules: modules.map(module => ({ id: module.manifest.id, version: module.manifest.version })),
  providers: modules.length ? { 'net.node-ws': modules[0]!.manifest.id } : {}, capabilities: {}, settings: {},
});
const opened = (socket: WebSocket): Promise<void> => new Promise((resolve, reject) => {
  socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', () => reject(new Error('Socket failed')), { once: true });
});
const closed = (socket: WebSocket): Promise<string> => new Promise(resolve => socket.addEventListener('close', event => resolve(event.reason), { once: true }));
const message = (socket: WebSocket): Promise<string> => new Promise(resolve => socket.addEventListener('message', event => resolve(String(event.data)), { once: true }));

describe('editable Node WebSocket package', () => {
  it('builds through public contracts, recovers missing host services and replaces active connections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-node-ws-')); temporary.push(root);
    const folder = join(root, 'source'), output = join(root, 'node-ws.spacemod'); await cp(resolve('modules/net-node-ws'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const imported = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    const registration = imported.register({ environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([imported.digest]) });
    const missing = new ModuleRegistryV2(); missing.register(registration.module, registration.assets);
    expect(() => missing.prepare(profile([registration.module]), 'node')).toThrow('core.websocket-codecs');
    const graph = new ModuleRegistryV2([host]); graph.register(registration.module, registration.assets);
    expect(() => graph.prepare(profile([registration.module]), 'browser')).toThrow('cannot run');
    const runtime = new ModuleRuntimeV2(graph, 'node'); runtime.activate(graph.prepare(profile([registration.module]), 'node'));
    const connections: ServerTextConnection[] = [], server = createServer();
    server.on('upgrade', (request, stream, head) => {
      const peer = runtime.active!.providedService(NODE_WEBSOCKET_TRANSPORT).accept(request, stream, head,
        { maxMessageBytes: 16384, pingIntervalMs: 15000, label: 'bounded survey peer' });
      if (peer) { connections.push(peer); peer.onmessage = text => peer.send(`survey:${text}`); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test listener');
    try {
      const first = new WebSocket(`ws://127.0.0.1:${address.port}/ws`); await opened(first);
      const response = message(first); first.send('observe:3'); expect(await response).toBe('survey:observe:3');
      const firstClosed = closed(first);
      const replacement: RegisteredModuleV2 = { manifest: { ...registration.module.manifest, id: 'fixture.node-ws' }, initialize(context) {
        context.provide(NODE_WEBSOCKET_TRANSPORT, context.own(createNodeWebSocketProvider(context.use(NODE_WEBSOCKET_CODECS))));
      } };
      graph.register(replacement); runtime.activate(graph.prepare(profile([replacement]), 'node'));
      expect(await firstClosed).toBe('Module disposed'); await connections[0]!.closed;
      const second = new WebSocket(`ws://127.0.0.1:${address.port}/ws`); await opened(second);
      const next = message(second); second.send('observe:4'); expect(await next).toBe('survey:observe:4');
      const secondClosed = closed(second); runtime.activate(graph.prepare(profile([]), 'node'));
      expect(await secondClosed).toBe('Module disposed'); await connections[1]!.closed;
      expect(connections).toHaveLength(2); expect(runtime.active!.lock.modules).toEqual([]);
    } finally {
      runtime.dispose(); for (const connection of connections) connection.close('Test ended');
      await Promise.all(connections.map(connection => connection.closed)); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 60000);
  it('rejects broken primitive providers and invalid connection limits before touching IO', () => {
    expect(() => createNodeWebSocketProvider({ ...nativeWebSocketCodecs, deflate: undefined } as never)).toThrow('native codecs');
    const provider = createNodeWebSocketProvider(nativeWebSocketCodecs);
    expect(() => provider.accept({ headers: {} }, {} as never, new Uint8Array(), { maxMessageBytes: NaN, pingIntervalMs: 1, label: '' })).toThrow('limits');
    provider.dispose(); expect(() => provider.accept({ headers: {} }, {} as never, new Uint8Array(), { maxMessageBytes: 1, pingIntervalMs: 1, label: '' })).toThrow('disposed');
  });
});
