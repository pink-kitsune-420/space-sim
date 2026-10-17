import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { HostSession } from '../../packages/net/src/host';
import { ClientSession } from '../../packages/net/src/client';
import type { Connection } from '../../packages/net/src/connection';
import { LocalDiscovery, LocalHost, connectLocal, type ChannelLike, type LocalAdvert, type LocksLike } from '../../packages/net/src/broadcast';
import { lanCandidates, probeServer, scanServers } from '../../packages/net/src/discovery';
import { DEFAULT_PORT } from '../../packages/net/src/websocket';
import { startServer } from '../../apps/server/src/server';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });
const wait = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));
async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await wait(5);
  }
}

/** A BroadcastChannel stand-in whose delivery can be cut, like a tab that froze. */
class Hub {
  cut = false;
  private readonly members = new Set<ChannelLike>();
  channel = (): ChannelLike => {
    const hub = this;
    const member: ChannelLike = {
      onmessage: null,
      postMessage(message) {
        if (hub.cut) return;
        const data = structuredClone(message);
        for (const other of hub.members) if (other !== member) queueMicrotask(() => other.onmessage?.({ data }));
      },
      close() { hub.members.delete(member); },
    };
    this.members.add(member);
    return member;
  };
}

/** Web Locks with the one behaviour used: a waiting request is granted when the holder lets go. */
class FakeLocks implements LocksLike {
  private readonly queues = new Map<string, Array<{ grant: () => void; signal?: AbortSignal }>>();
  private readonly releases = new Map<string, () => void>();
  request(name: string, options: { readonly signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const entry = { signal: options.signal, grant: () => {
        let finish!: () => void;
        const released = new Promise<void>(done => { finish = done; });
        this.releases.set(name, finish);
        void callback().then(finish, finish);
        void released.then(() => {
          this.releases.delete(name);
          const queue = this.queues.get(name)!;
          queue.shift();
          resolve(undefined);
          queue[0]?.grant();
        });
      } };
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      queue.push(entry);
      options.signal?.addEventListener('abort', () => {
        const i = queue.indexOf(entry);
        if (i > 0) { queue.splice(i, 1); reject(new Error('AbortError')); }
      });
      if (queue.length === 1) queueMicrotask(entry.grant);
    });
  }
  /** A tab vanished: everything it held is released without a word. */
  crash(match: string): void { for (const [name, release] of [...this.releases]) if (name.endsWith(match)) release(); }
}

function hostWorld(): { host: HostSession; local: (options: ConstructorParameters<typeof LocalHost>[2]) => LocalHost } {
  const world = new World(DEFAULT_UNIVERSE, { id: 'w-local' });
  const host = new HostSession(world);
  host.seatHost('Hana', 'b'.repeat(32));
  world.spawn({ ownerId: host.hostId! });
  const timer = setInterval(() => { host.step(); host.service(); }, 10);
  cleanup.push(() => clearInterval(timer), () => host.close());
  return { host, local: options => {
    const advertised = new LocalHost(() => ({ name: 'Hana · Primus', worldId: world.id, players: host.connectedCount(),
      maxPlayers: host.settings.maxPlayers }), connection => host.accept(connection), options);
    cleanup.push(() => advertised.close());
    return advertised;
  } };
}
function pilot(connection: Connection, name: string): ClientSession {
  const client = new ClientSession(connection, { name });
  const timer = setInterval(() => client.update(), 16);
  cleanup.push(() => clearInterval(timer));
  return client;
}

describe('same-browser tabs', () => {
  it('lists a hosting tab, joins it in one click and leaves when the host stops', async () => {
    const { host, local } = hostWorld();
    const advertised = local({ locks: null });
    let worlds: readonly LocalAdvert[] = [];
    const discovery = new LocalDiscovery(list => { worlds = list; }, { locks: null });
    cleanup.push(() => discovery.close());
    await until(() => worlds.length === 1);
    expect(worlds[0]).toMatchObject({ host: advertised.key, name: 'Hana · Primus', worldId: 'w-local', players: 1, maxPlayers: 8 });

    const client = pilot(await connectLocal(advertised.key, { locks: null }), 'Gus');
    await until(() => client.phase === 'joined');
    expect(client.players.map(p => p.name).sort()).toEqual(['Gus', 'Hana']);
    expect(client.hostSeat).toBe(host.hostId);
    const heard: string[] = [];
    client.onchat = line => heard.push(`${line.name}: ${line.text}`);
    host.chat(host.hostId, 'welcome aboard');
    await until(() => heard.length === 1);
    expect(heard).toEqual(['Hana: welcome aboard']);

    let reason = '';
    client.onclose = text => { reason = text; };
    host.close('The host stopped hosting.');
    advertised.close();
    await until(() => client.phase === 'closed');
    expect(reason).toBe('The host stopped hosting.');
    await until(() => worlds.length === 0);
  });

  it('refuses quietly when nobody hosts under that key', async () => {
    await expect(connectLocal('c'.repeat(32), { locks: null, timeoutMs: 100 })).rejects.toThrow(/did not answer/);
  });

  it('drops a link that stops hearing from the other tab', async () => {
    const hub = new Hub();
    const { host, local } = hostWorld();
    const advertised = local({ channel: hub.channel, locks: null, beatMs: 20, timeoutMs: 200 });
    const client = pilot(await connectLocal(advertised.key, { channel: hub.channel, locks: null, beatMs: 20, timeoutMs: 200 }), 'Gus');
    await until(() => client.phase === 'joined');
    // Quiet but alive: heartbeats keep it open past the timeout.
    await wait(400);
    expect(client.phase).toBe('joined');
    hub.cut = true;
    await until(() => client.phase === 'closed', 2000);
    expect(client.closeReason).toBe('Connection lost.');
    await until(() => host.remoteCount() === 0, 2000);
  });

  it('notices at once when the other tab vanishes, through its lock', async () => {
    const hub = new Hub();
    const locks = new FakeLocks();
    const { host, local } = hostWorld();
    const advertised = local({ channel: hub.channel, locks });
    const client = pilot(await connectLocal(advertised.key, { channel: hub.channel, locks }), 'Gus');
    await until(() => client.phase === 'joined');
    expect(host.remoteCount()).toBe(1);
    // The guest's tab crashes: no goodbye, only its lock goes.
    hub.cut = true;
    locks.crash('/guest');
    await until(() => host.remoteCount() === 0, 2000);
  });

  it('ignores connections meant for another hosting tab', async () => {
    const hub = new Hub();
    const first = hostWorld(), second = hostWorld();
    const a = first.local({ channel: hub.channel, locks: null });
    second.local({ channel: hub.channel, locks: null });
    const client = pilot(await connectLocal(a.key, { channel: hub.channel, locks: null }), 'Gus');
    await until(() => client.phase === 'joined');
    expect(first.host.remoteCount()).toBe(1);
    expect(second.host.remoteCount()).toBe(0);
  });
});

describe('LAN scan', () => {
  it('tries hinted subnets first, then the usual ones', () => {
    const list = lanCandidates(['http://192.168.5.20:6464/', 'game.example.com', '10.0.0.7']);
    expect(list[0]).toBe(`localhost:${DEFAULT_PORT}`);
    expect(list[1]).toBe(`192.168.5.1:${DEFAULT_PORT}`);
    expect(list[255]).toBe(`10.0.0.1:${DEFAULT_PORT}`);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toHaveLength(1 + 254 * 5);
    expect(lanCandidates(['8.8.8.8'])).toHaveLength(1 + 254 * 4);
  });

  it('finds a running server and skips addresses where nothing answers', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'space-sim-scan-'));
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
    const running = await startServer({ dataDir, overrides: { port: 0, host: '127.0.0.1', name: 'Scan Me' }, log: () => {} });
    cleanup.push(() => running.stop());
    const found = await probeServer(`127.0.0.1:${running.port}`, 2000);
    expect(found).toMatchObject({ name: 'Scan Me', players: 0, password: false, compatible: true });
    const results = await scanServers([`127.0.0.1:${running.port}`, '127.0.0.1:1'], { timeoutMs: 2000 });
    expect(results.map(s => s.address)).toEqual([`127.0.0.1:${running.port}`]);
    // A probe is not a player.
    expect(running.host.playerList()).toEqual([]);
  });
});
