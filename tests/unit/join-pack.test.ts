import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JOIN_PACKS, type JoinClientPort, type JoinOffer, type ModuleProfileV2, type TextConnection } from '../../packages/game-api/src/index';
import { loopback } from '../../packages/net/src/connection';
import { createJoinPacks } from '../../modules/session-join/src/index';
import { createOffer, validateOffer } from '../../modules/session-join/src/offer';
import { sha256Bytes } from '../../modules/session-join/src/sha256';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
const temporary: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
const bytes = Uint8Array.from({ length: 120000 }, (_, index) => index & 255);
function offer(containsCode = false): JoinOffer {
  return createOffer({ sessionId: 'survey', name: 'Survey host', protocol: 'survey/1', entitySchema: 'survey-state/1', model: 'bounded/1',
    fingerprint: 'a'.repeat(64), lockDigest: 'b'.repeat(64), packDigest: sha256Bytes(bytes), packBytes: bytes.length,
    packages: [{ id: 'fixture.survey', version: '1.0.0', digest: 'c'.repeat(64), bytes: bytes.length, license: 'MIT', containsCode, sourceIncluded: true, required: true, tier: 'authoritative' }] });
}
function clientPort(overrides: Partial<JoinClientPort> = {}) {
  const dispose = vi.fn(), activate = vi.fn();
  const port: JoinClientPort = { allowRuntimeCode: true, approved: vi.fn(async () => false), review: vi.fn(async () => true), cached: vi.fn(async () => undefined),
    stage: vi.fn(async (_offer, received) => { expect(received).toEqual(bytes); return { options: { name: 'Surveyor' }, dispose, activate }; }), remember: vi.fn(async () => {}), progress: vi.fn(), ...overrides };
  return { port, dispose, activate };
}
function negotiating(value = offer(), port = clientPort().port, clientWrap: (peer: TextConnection) => TextConnection = value => value) {
  const factory = createJoinPacks(), [server, client] = loopback(), accept = vi.fn();
  const source = { current: vi.fn(async () => ({ offer: value, bytes })) };
  const host = factory.host(server, source, accept, new AbortController().signal);
  const joining = factory.client(clientWrap(client), port, new AbortController().signal);
  return { factory, source, accept, host, joining };
}
describe('bounded install-on-join negotiation', () => {
  it('transfers a bounded non-flight pack after consent, stages before installation and hands off ordered text', async () => {
    const { port, activate } = clientPort(), context = negotiating(offer(), port);
    const joined = await context.joining; await context.host;
    expect(port.review).toHaveBeenCalledTimes(1); expect(port.stage).toHaveBeenCalledTimes(1); expect(port.remember).toHaveBeenCalledTimes(1);
    expect(port.progress).toHaveBeenLastCalledWith(bytes.length, bytes.length); expect(activate).not.toHaveBeenCalled();
    expect(context.accept).toHaveBeenCalledTimes(1);
    const received: string[] = []; joined.peer.onmessage = text => received.push(text);
    context.accept.mock.calls[0]![0].send('survey snapshot'); await Promise.resolve(); expect(received).toEqual(['survey snapshot']);
    joined.stage!.dispose(); joined.peer.close(); context.factory.dispose();
  });
  it('uses approved cached bytes without prompting or downloading again, but never treats cache possession as consent', async () => {
    const { port } = clientPort({ approved: vi.fn(async () => true), cached: vi.fn(async () => bytes) });
    const context = negotiating(offer(), port); const joined = await context.joining; await context.host;
    expect(port.review).not.toHaveBeenCalled(); expect(port.progress).not.toHaveBeenCalled();
    joined.stage!.dispose(); joined.peer.close(); context.factory.dispose();
    const unapproved = clientPort({ cached: vi.fn(async () => bytes) }); const next = negotiating(offer(), unapproved.port);
    (await next.joining).stage!.dispose(); await next.host; expect(unapproved.port.review).toHaveBeenCalledTimes(1); next.factory.dispose();
  });
  it('declines or blocks code before downloading, staging or installing', async () => {
    for (const codePolicy of [false, true]) {
      const { port } = clientPort({ allowRuntimeCode: !codePolicy, review: vi.fn(async () => false) });
      const context = negotiating(offer(codePolicy), port), results = await Promise.allSettled([context.host, context.joining]);
      expect(results.every(value => value.status === 'rejected')).toBe(true);
      expect(port.cached).not.toHaveBeenCalled(); expect(port.stage).not.toHaveBeenCalled(); expect(port.remember).not.toHaveBeenCalled();
      expect(context.accept).not.toHaveBeenCalled(); context.factory.dispose();
    }
  });
  it('rejects tampered chunks before staging and discards candidates when the host changes its offer', async () => {
    const { port } = clientPort(), changed = negotiating(offer(), port, peer => ({ ...peer,
      send(text) { peer.send(text); },
      get onmessage() { return peer.onmessage; }, set onmessage(receive) { peer.onmessage = text => receive?.(text.includes('"t":"chunk"') ? text.replace('"seq":0', '"seq":9') : text); },
      get onclose() { return peer.onclose; }, set onclose(close) { peer.onclose = close; },
    }));
    expect((await Promise.allSettled([changed.host, changed.joining])).every(value => value.status === 'rejected')).toBe(true);
    expect(port.stage).not.toHaveBeenCalled(); changed.factory.dispose();
    const next = clientPort(), context = negotiating(offer(), next.port);
    context.source.current.mockImplementation(async () => ({ offer: createOffer({ ...offer(), fingerprint: 'd'.repeat(64) }), bytes }));
    expect((await Promise.allSettled([context.host, context.joining])).every(value => value.status === 'rejected')).toBe(true);
    expect(next.dispose).toHaveBeenCalledTimes(1); expect(next.port.remember).not.toHaveBeenCalled(); context.factory.dispose();
  });
  it('cancels outstanding review and transfer during provider removal without publishing a session', async () => {
    const { port } = clientPort({ review: vi.fn((_offer, signal) => new Promise<boolean>(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }))) });
    const context = negotiating(offer(), port);
    const completion = Promise.allSettled([context.host, context.joining]);
    for (let index = 0; index < 10; index++) await Promise.resolve(); context.factory.dispose();
    expect((await completion).every(value => value.status === 'rejected')).toBe(true); expect(context.accept).not.toHaveBeenCalled(); expect(port.remember).not.toHaveBeenCalled();
  });
  it('preserves a legacy greeting before the ordinary authenticated flight codec attaches', async () => {
    const factory = createJoinPacks(), [server, client] = loopback(), { port } = clientPort();
    const pending = factory.client(client, port, new AbortController().signal), greeting = JSON.stringify({ t: 'info', protocol: 'space-sim-net/5' }); server.send(greeting);
    const joined = await pending, received: string[] = []; joined.peer.onmessage = text => received.push(text);
    await Promise.resolve(); expect(received).toEqual([greeting]); expect(port.review).not.toHaveBeenCalled(); expect(joined.stage).toBeUndefined(); joined.peer.close(); factory.dispose();
  });
  it('pins all metadata and matches standard byte SHA-256 while bounding inventory and message size', () => {
    expect(sha256Bytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    const value = offer(); expect(validateOffer(value)).toEqual(value);
    for (const invalid of [{ ...value, name: 'Changed' }, { ...value, packBytes: 64 * 1024 * 1024 }, { ...value, extra: true },
      { ...value, packages: [...value.packages, ...value.packages] }]) expect(() => validateOffer(invalid)).toThrow();
  });
  it('builds/imports the actual package through code consent on a headless graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-join-')); temporary.push(root);
    const folder = join(root, 'source'), output = join(root, 'join.spacemod'); await cp(resolve('modules/session-join'), folder, { recursive: true });
    await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
    const inspected = await inspectRuntimePackage(new Uint8Array(await readFile(output))), registration = inspected.register({ environment: 'node', allowRuntimeCode: true, approvedDigests: new Set([inspected.digest]) });
    const graph = new ModuleRegistryV2(); graph.register(registration.module, registration.assets);
    const profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'fixture.join', modules: [{ id: inspected.id, version: inspected.version }], providers: { 'session.join-pack': inspected.id }, capabilities: {}, settings: {} };
    const candidate = graph.prepare(profile, 'node'); expect(candidate.providedService(JOIN_PACKS).client).toBeTypeOf('function'); candidate.dispose();
  }, 60000);
});
