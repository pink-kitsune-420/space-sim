import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, deflateRawSync, inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { saveWorld } from '../../packages/sim-core/src/save';
import { ClientSession } from '../../packages/net/src/client';
import { connectWebSocket } from '../../packages/net/src/websocket';
import { startServer, type RunningServer } from '../../apps/server/src/server';
import { WorldStore } from '../../apps/server/src/store';
import { DEFAULT_CONFIG, loadConfig, parseCommandLine } from '../../apps/server/src/config';
import fixture from '../fixtures/world-save-v1.json';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'space-sim-server-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function server(dataDir: string, extra: Partial<Parameters<typeof startServer>[0]> = {}): Promise<RunningServer> {
  const running = await startServer({ dataDir, overrides: { port: 0, host: '127.0.0.1', ...extra.overrides }, log: () => {}, ...extra });
  cleanup.push(() => running.stop());
  return running;
}
const wait = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));
async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await wait(10);
  }
}
async function player(port: number, name: string, tokens = new Map<string, string>(), password?: string): Promise<ClientSession> {
  const connection = await connectWebSocket(`ws://127.0.0.1:${port}/ws`);
  const client = new ClientSession(connection, { name, token: id => tokens.get(id), saveToken: (id, token) => tokens.set(id, token),
    ...(password ? { password } : {}) });
  const timer = setInterval(() => client.update(), 16);
  cleanup.push(async () => { clearInterval(timer); client.leave(); });
  return client;
}

/** A raw TCP client that speaks just enough WebSocket to send hand-made frames. */
async function rawSocket(port: number, path = '/ws', key = 'dGhlIHNhbXBsZSBub25jZQ==', extensions = ''): Promise<{ socket: Socket; head: string; data: () => Buffer }> {
  const socket = connect(port, '127.0.0.1');
  cleanup.push(async () => { socket.destroy(); });
  let received = Buffer.alloc(0);
  socket.on('data', chunk => { received = Buffer.concat([received, chunk]); });
  socket.on('error', () => {});
  await new Promise(done => socket.once('connect', done));
  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${extensions ? `Sec-WebSocket-Extensions: ${extensions}\r\n` : ''}\r\n`);
  await until(() => received.includes('\r\n\r\n'));
  const end = received.indexOf('\r\n\r\n') + 4;
  const head = received.subarray(0, end).toString();
  received = received.subarray(end);
  return { socket, head, data: () => received };
}
function frame(opcode: number, payload: Buffer, { fin = true, mask = true, rsv1 = false } = {}): Buffer {
  const key = Buffer.from([1, 2, 3, 4]);
  const length = payload.length, first = (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | opcode;
  const header = length < 126 ? Buffer.from([first, (mask ? 0x80 : 0) | length])
    : Buffer.from([first, (mask ? 0x80 : 0) | 126, length >> 8, length & 255]);
  const body = mask ? Buffer.from(payload.map((b, i) => b ^ key[i & 3]!)) : payload;
  return Buffer.concat([header, ...(mask ? [key] : []), body]);
}
/** Server frames: [opcode, payload] pairs, compressed payloads inflated. */
function frames(buffer: Buffer): Array<[number, Buffer, boolean]> {
  const out: Array<[number, Buffer, boolean]> = [];
  for (let i = 0; i + 2 <= buffer.length;) {
    let length = buffer[i + 1]! & 0x7f, offset = i + 2;
    if (length === 126) { length = buffer.readUInt16BE(i + 2); offset += 2; }
    else if (length === 127) { length = buffer.readUInt32BE(i + 6); offset += 8; }
    if (offset + length > buffer.length) break;
    const compressed = (buffer[i]! & 0x40) !== 0, payload = buffer.subarray(offset, offset + length);
    out.push([buffer[i]! & 0x0f, compressed ? inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])]), { finishFlush: constants.Z_SYNC_FLUSH }) : payload, compressed]);
    i = offset + length;
  }
  return out;
}

describe('dedicated server', () => {
  it('serves players over WebSocket, saves automatically and restores after a restart', async () => {
    const dir = await folder();
    const first = await server(dir);
    expect(first.host.paused).toBe(true);
    const tokens = new Map<string, string>();
    const ada = await player(first.port, 'Ada', tokens);
    const bo = await player(first.port, 'Bo');
    await until(() => ada.phase === 'joined' && bo.phase === 'joined' && ada.players.length === 2);
    expect(first.host.paused).toBe(false);
    const ship = ada.ownShips()[0]!.id;
    const burn = setInterval(() => ada.control(ship, { turn: 0, throttle: 0, engine: true }), 16);
    cleanup.push(async () => clearInterval(burn));
    await until(() => first.host.world.ship(ship)!.state.status === 'flying');
    await until(() => bo.world!.ship(ship)?.state.status === 'flying');
    clearInterval(burn);
    ada.spawn('planet-orbit');
    await until(() => first.host.world.size === 3);
    expect(await first.command('players')).toContain('● Ada');
    await first.stop();
    await until(() => ada.phase === 'closed');
    expect(ada.closeReason).toBe('The server is shutting down.');

    const saved = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8')) as { ships: unknown[]; players: Array<{ name: string; tokenHash: string }> };
    expect(saved.ships).toHaveLength(3);
    expect(saved.players.map(p => p.name).sort()).toEqual(['Ada', 'Bo']);
    expect(JSON.stringify(saved)).not.toContain(tokens.values().next().value!);

    const second = await server(dir);
    expect(second.host.world.size).toBe(3);
    expect(second.host.world.tick).toBe(first.host.world.tick);
    const back = await player(second.port, 'Ada', tokens);
    await until(() => back.phase === 'joined');
    expect(back.playerId).toBe(ada.playerId);
    expect(back.ownShips().map(s => s.id).sort()).toEqual([ship, 'ship-3']);
    expect((await readdir(join(dir, 'backups'))).length).toBeGreaterThan(0);
  });

  it('serves the embedded game page with the server marker, and status', async () => {
    const dir = await folder();
    const html = Buffer.from('<!doctype html><html><head><title>Space Sim</title></head><body></body></html>').toString('base64');
    const running = await server(dir, { assets: { '/index.html': { type: 'text/html; charset=utf-8', data: html },
      '/assets/app.js': { type: 'text/javascript', data: Buffer.from('1').toString('base64') } } });
    const page = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await page.text()).toContain('<meta name="space-sim-server" content="1" />');
    expect((await fetch(`http://127.0.0.1:${running.port}/assets/app.js`)).headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`http://127.0.0.1:${running.port}/../server.json`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${running.port}/`, { method: 'POST' })).status).toBe(405);
    const status = await (await fetch(`http://127.0.0.1:${running.port}/status`)).json() as Record<string, unknown>;
    expect(status).toMatchObject({ protocol: 'space-sim-net/5', paused: true, ships: 0, players: [] });
  });

  it('speaks WebSocket correctly: fragments, pings and closing', async () => {
    const running = await server(await folder());
    const { socket, head, data } = await rawSocket(running.port);
    expect(head).toContain('101 Switching Protocols');
    expect(head).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    await until(() => frames(data()).length === 1);
    expect(JSON.parse(frames(data())[0]![1].toString()).t).toBe('info');
    const join = Buffer.from(JSON.stringify({ t: 'join', name: 'Raw' }));
    socket.write(Buffer.concat([frame(1, join.subarray(0, 5), { fin: false }), frame(9, Buffer.from('hi')), frame(0, join.subarray(5))]));
    await until(() => frames(data()).some(([op, p]) => op === 1 && p.toString().includes('"welcome"')));
    expect(frames(data()).some(([op, p]) => op === 0xa && p.toString() === 'hi')).toBe(true);
    socket.write(frame(8, Buffer.from([0x03, 0xe8])));
    await until(() => frames(data()).some(([op]) => op === 8));
    await until(() => running.host.connectedCount() === 0);
  });

  it('compresses with permessage-deflate when offered, both ways, and refuses inflation bombs', async () => {
    const running = await server(await folder());
    const { socket, head, data } = await rawSocket(running.port, '/ws', undefined, 'permessage-deflate; client_max_window_bits');
    expect(head).toContain('Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover');
    await until(() => frames(data()).length === 1);
    const pack = (text: string): Buffer => {
      const packed = deflateRawSync(Buffer.from(text), { finishFlush: constants.Z_SYNC_FLUSH });
      return packed.subarray(0, packed.length - 4);
    };
    socket.write(frame(1, pack(JSON.stringify({ t: 'join', name: 'Packed' })), { rsv1: true }));
    await until(() => frames(data()).some(([, p]) => p.toString().includes('"welcome"')));
    const welcome = frames(data()).find(([, p]) => p.toString().includes('"welcome"'))!;
    // The welcome carries the whole universe: large, so it travels compressed.
    expect(welcome[2]).toBe(true);
    expect(JSON.parse(welcome[1].toString()).universe.id).toBe('default-universe');
    // 16 KiB is the client message limit; this inflates far beyond it from a few bytes.
    socket.write(frame(1, pack(' '.repeat(200_000)), { rsv1: true }));
    await until(() => frames(data()).some(([op]) => op === 8));
    expect(frames(data()).find(([op]) => op === 8)![1].readUInt16BE(0)).toBe(1009);
  });

  it('refuses compressed frames when no compression was negotiated', async () => {
    const running = await server(await folder());
    const { socket, head, data } = await rawSocket(running.port);
    expect(head).not.toContain('Sec-WebSocket-Extensions');
    socket.write(frame(1, Buffer.from('{}'), { rsv1: true }));
    await until(() => frames(data()).some(([op]) => op === 8));
    expect(frames(data()).find(([op]) => op === 8)![1].readUInt16BE(0)).toBe(1002);
  });

  it.each<[string, Buffer, number]>([
    ['unmasked frames', frame(1, Buffer.from('{}'), { mask: false }), 1002],
    ['binary messages', frame(2, Buffer.from([1, 2, 3])), 1003],
    ['invalid UTF-8', frame(1, Buffer.from([0xc3, 0x28])), 1007],
    ['oversized messages', frame(1, Buffer.alloc(20000, 32)), 1009],
    ['stray continuation frames', frame(0, Buffer.from('x')), 1002],
  ])('closes the connection on %s', async (_name, bytes, code) => {
    const running = await server(await folder());
    const { socket, data } = await rawSocket(running.port);
    socket.write(bytes);
    await until(() => frames(data()).some(([op]) => op === 8));
    expect(frames(data()).find(([op]) => op === 8)![1].readUInt16BE(0)).toBe(code);
  });

  it('refuses bad upgrades', async () => {
    const running = await server(await folder());
    expect((await rawSocket(running.port, '/elsewhere')).head).toContain('404 Not Found');
    expect((await rawSocket(running.port, '/ws', 'short')).head).toContain('400 Bad Request');
  });

  it('scatters and clears asteroids from the console, saving and restoring them', async () => {
    const dir = await folder();
    const running = await server(dir);
    expect(await running.command('asteroids 0')).toContain('Usage');
    expect(await running.command('asteroids 600')).toMatch(/^Added 600 asteroids \(/);
    expect(running.host.world.size).toBe(600);
    expect(await running.command('ships')).toContain('600 other objects');
    // Asteroids do not count against the pilots' ship limit.
    const ada = await player(running.port, 'Ada');
    await until(() => ada.phase === 'joined' && ada.ownShips().length === 1);
    await running.stop();
    const again = await server(dir);
    expect(again.host.world.size).toBe(601);
    expect(await again.command('asteroids clear')).toBe('Removed 600 objects.');
    expect(again.host.world.size).toBe(1);
  });

  it('keeps a console pause when players come and go', async () => {
    const running = await server(await folder());
    expect(await running.command('pause')).toBe('Paused.');
    const ada = await player(running.port, 'Ada');
    await until(() => ada.phase === 'joined');
    await wait(100);
    expect(running.host.paused).toBe(true);
    expect(ada.pauseReason).toBe('Paused by the server');
    expect(await running.command('resume')).toBe('Resumed.');
    await until(() => !ada.paused);
    expect(await running.command('status')).toContain('1/16 players');
    expect(await running.command('bogus')).toBe('Unknown command "bogus". Type help.');
  });

  it('controls time warp from the server console', async () => {
    const running = await server(await folder());
    expect(await running.command('warp')).toBe('Current warp: 1x (requested: 1x)');
    expect(await running.command('warp 10')).toContain('Warp set to 10x');
    expect(running.host.warp).toBe(10);
    expect(await running.command('warp')).toContain('Current warp: 10x');
    expect(await running.command('warp invalid')).toBe('Usage: warp [1-100000]');
    expect(await running.command('warp 1')).toContain('Warp set to 1x');
    expect(running.host.warp).toBe(1);
  });

  it('requires the configured password', async () => {
    const dir = await folder();
    const running = await server(dir, { overrides: { password: 'orbit' } });
    const intruder = await player(running.port, 'Eve', new Map(), 'guess');
    const friend = await player(running.port, 'Ada', new Map(), 'orbit');
    await until(() => intruder.phase === 'closed' && friend.phase === 'joined');
    expect(intruder.closeReason).toBe('Wrong password.');
  });

  it('imports a save from the game, backing up the previous world first', async () => {
    const dir = await folder();
    const original = await server(dir);
    await original.stop();
    const path = join(dir, 'export.json');
    await writeFile(path, JSON.stringify(fixture));
    const imported = await server(dir, { importSave: path });
    expect(imported.host.world.id).toBe('w-fixture01');
    expect(imported.host.world.size).toBe(4);
    expect(imported.host.roster().map(p => p.id)).toEqual(['p-alpha', 'p-bravo']);
    expect((await readdir(join(dir, 'backups'))).length).toBeGreaterThanOrEqual(1);
  });
});

describe('world storage', () => {
  it('keeps the newest backups only', async () => {
    const dir = await folder();
    const store = new WorldStore(dir, 2);
    await store.save(saveWorld(new World(DEFAULT_UNIVERSE, { id: 'w-1' })));
    for (let i = 0; i < 4; i++) { await store.backup(); await wait(5); }
    expect(await store.backupFiles()).toHaveLength(2);
  });

  it('moves an unusable world aside and restores the newest valid backup', async () => {
    const dir = await folder();
    const messages: string[] = [];
    const store = new WorldStore(dir, 5, m => messages.push(m));
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-good' });
    world.spawn({ ownerId: 'p' });
    await store.save(saveWorld(world));
    await store.backup();
    await writeFile(store.file, '{"format":"space-sim-world","version":1,');
    const restored = await store.load();
    expect(restored!.loaded.world.id).toBe('w-good');
    expect(restored!.from).toContain('backups');
    expect((await readdir(dir)).some(name => name.startsWith('world.unusable-'))).toBe(true);
    expect(messages.join('\n')).toContain('is unusable');
  });

  it('refuses to start over a damaged world without a usable backup', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'world.json'), 'garbage');
    await expect(new WorldStore(dir, 5).load()).rejects.toThrow('No usable world');
  });

  it('writes a default server.json and rejects typos in it', async () => {
    const dir = await folder();
    expect(await loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    expect(JSON.parse(await readFile(join(dir, 'server.json'), 'utf8'))).toEqual(DEFAULT_CONFIG);
    await writeFile(join(dir, 'server.json'), JSON.stringify({ maxPlayer: 4 }));
    await expect(loadConfig(dir)).rejects.toThrow('unknown setting "maxPlayer"');
    await writeFile(join(dir, 'server.json'), JSON.stringify({ port: 'x' }));
    await expect(loadConfig(dir)).rejects.toThrow('"port" must be a number');
    await mkdir(join(dir, 'nested'));
    expect((await loadConfig(join(dir, 'nested'), { name: 'Override' })).name).toBe('Override');
  });

  it('reads the command line', () => {
    expect(parseCommandLine(['--port', '7000', '--password', 'p', '--new', '--data', 'x'])).toMatchObject({
      overrides: { port: 7000, password: 'p' }, data: 'x', newWorld: true });
    expect(() => parseCommandLine(['--port', 'abc'])).toThrow('--port must be a number');
    expect(() => parseCommandLine(['--port', '70000'])).toThrow('"port" must be a whole number');
  });
});
