import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryPackageStore } from '../../packages/game-runtime/src/package-store';
import { prepareGame, validateDataModule } from '../../packages/modules/src/index';
import { preparePeerWorld } from '../../packages/modules/src/installed';
import { validatePackage, encodePackage, type GamePackage } from '../../packages/game-library/src/archive';
import { encodeJoinPack, inspectJoinPack } from '../../packages/game-library/src/join-pack';
import { createOffer } from '../../modules/session-join/src/offer';
import { createJoinPacks } from '../../modules/session-join/src/index';
import { installGamePackages } from '../../packages/game-library/src/runtime-selection';
import { artifactModules } from '../../packages/game-runtime/src/loader';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { HostSession } from '../../packages/net/src/host';
import { ClientSession } from '../../packages/net/src/client';
import { loopback } from '../../packages/net/src/connection';
import { startServer } from '../../apps/server/src/server';
import { connectWebSocket } from '../../packages/net/src/websocket';
import builtin from '../../games/space-sim/game.json';
import gentle from '../../examples/modules/gentle-flight.json';
import type { JoinClientPort, JoinOffer, JoinStage } from '../../packages/game-api/src/index';
const cleanup: (() => unknown)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
function game() {
  const data = validateDataModule(gentle), prepared = prepareGame({ environment: 'node', data: [data] }); cleanup.push(() => prepared.candidate.dispose());
  const base = validatePackage(builtin) as GamePackage;
  const game: GamePackage = { ...base, info: { ...base.info, id: 'fixture.gentle', name: 'Gentle server' },
    bundle: { ...base.bundle, profile: prepared.profile, modules: [data], selection: { universe: `builtin.content/${prepared.world.universe.id}`, system: prepared.world.systemId } } };
  return { game, prepared };
}
async function stage(offer: JoinOffer, bytes: Uint8Array): Promise<JoinStage> {
  const checked = await inspectJoinPack(bytes, offer), store = new MemoryPackageStore();
  await installGamePackages(checked.game, store, { environment: 'node', allowRuntimeCode: true }, 'Test server');
  return preparePeerWorld(undefined, store, { environment: 'node', allowRuntimeCode: true, approvedDigests: new Set() }, {
    profile: checked.game.bundle.profile, data: checked.game.bundle.modules, code: artifactModules(checked.game.plugins, 'node'),
    universe: checked.universe, systemId: checked.systemId, hostServices: [], inspect: inspectRuntimePackage,
  }, offer, new AbortController().signal);
}
function port() {
  const value: JoinClientPort = { allowRuntimeCode: true, approved: async () => false, review: async () => true,
    cached: async () => undefined, stage, remember: async () => {} }; return value;
}
describe('verified server pack composition', () => {
  it('inspects real data packages inertly and reproduces the exact offered flight authority before joining', async () => {
    const fixture = game(), pack = await encodeJoinPack(fixture.game, fixture.prepared.world);
    expect(pack.offer.packages.map(item => [item.id, item.containsCode])).toEqual([['example.gentle-flight', false]]);
    const prepared = await stage(pack.offer, pack.bytes); cleanup.push(() => prepared.dispose());
    expect(prepared.options.simulationFingerprint).toBe(fixture.prepared.world.simulationFingerprint);
    expect(prepared.options.lock).toEqual(fixture.prepared.world.lock);
    const factory = createJoinPacks(), host = new HostSession(fixture.prepared.world), [server, client] = loopback();
    cleanup.push(() => factory.dispose(), () => host.dispose());
    const hosting = factory.host(server, { current: async () => pack }, peer => host.accept(peer), new AbortController().signal);
    const joined = await factory.client(client, port(), new AbortController().signal); await hosting; cleanup.push(() => joined.stage!.dispose());
    const remote = new ClientSession(joined.peer, { ...joined.stage!.options, name: 'Ada' }); cleanup.push(() => remote.leave());
    await new Promise<void>((resolve, reject) => { remote.onjoined = resolve; remote.onclose = reason => reject(new Error(reason)); });
    expect(remote.world!.context.vehicle.acceleration).toBe(75); expect(remote.world!.simulationFingerprint).toBe(fixture.prepared.world.simulationFingerprint);
  });
  it('compares exact embedded byte sizes without depending on the inspecting browser compressor', async () => {
    const fixture = game(), pack = await encodeJoinPack(fixture.game, fixture.prepared.world);
    vi.stubGlobal('CompressionStream', undefined);
    const inspected = await inspectJoinPack(pack.bytes, pack.offer);
    expect(inspected.inventory).toEqual(pack.offer.packages);
  });
  it('rejects dishonest code/source/license inventory and mismatched authority before publication', async () => {
    const fixture = game(), pack = await encodeJoinPack(fixture.game, fixture.prepared.world);
    for (const change of [{ containsCode: true }, { license: 'Other' }, { sourceIncluded: false }]) {
      const lie = createOffer({ ...pack.offer, packages: pack.offer.packages.map(item => ({ ...item, ...change })) });
      await expect(inspectJoinPack(pack.bytes, lie)).rejects.toThrow('inventory differs');
    }
    await expect(stage(createOffer({ ...pack.offer, fingerprint: 'e'.repeat(64) }), pack.bytes)).rejects.toThrow('cannot reproduce');
    const tampered = pack.bytes.slice(); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    await expect(inspectJoinPack(tampered, pack.offer)).rejects.toThrow('digest');
  });
  it('dedicated servers opt in through an explicit prejoin route while preserving legacy discovery', async () => {
    const fixture = game(), directory = await mkdtemp(join(tmpdir(), 'server-pack-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'game.spacegame'); await writeFile(path, await encodePackage(fixture.game));
    const server = await startServer({ dataDir: directory, overrides: { gameFile: path, offerGamePack: true, host: '127.0.0.1', port: 0 }, log() {} }); cleanup.push(() => server.stop());
    const legacy = await connectWebSocket(`ws://127.0.0.1:${server.port}/ws`); cleanup.push(() => legacy.close());
    const greeting = await new Promise<string>(resolve => { legacy.onmessage = resolve; }); expect(JSON.parse(greeting).t).toBe('info');
    const factory = createJoinPacks(); cleanup.push(() => factory.dispose());
    const peer = await connectWebSocket(`ws://127.0.0.1:${server.port}/ws?prejoin=1`);
    const joined = await factory.client(peer, port(), new AbortController().signal); cleanup.push(() => joined.peer.close(), () => joined.stage!.dispose());
    const client = new ClientSession(joined.peer, { ...joined.stage!.options, name: 'Remote' }); cleanup.push(() => client.leave());
    await new Promise<void>((resolve, reject) => { client.onjoined = resolve; client.onclose = reason => reject(new Error(reason)); });
    expect(client.world!.simulationFingerprint).toBe(server.host.world.simulationFingerprint); expect(client.ownShips()).toHaveLength(1);
  });
});
