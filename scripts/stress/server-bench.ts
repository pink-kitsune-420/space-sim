// End-to-end dedicated-server stress test: the built server (dist-server/space-sim-server.cjs)
// with the full solar system and many asteroids, headless clients flying over real
// WebSockets through a byte-counting TCP proxy (compressed bytes on the wire), server CPU
// sampled from /proc, and the server clock checked against real time.
//
// Run: npm run build && node scripts/stress/run.mjs scripts/stress/server-bench.ts --asteroids=50000 --clients=6 --seconds=30
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientSession } from '../../packages/net/src/client';
import { connectWebSocket } from '../../packages/net/src/websocket';

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const asteroids = Number(args.get('asteroids') ?? 50000);
const clients = Number(args.get('clients') ?? 6);
const seconds = Number(args.get('seconds') ?? 30);
const wait = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));

const dataDir = mkdtempSync(join(tmpdir(), 'space-sim-bench-'));
const server = spawn(process.execPath, ['dist-server/space-sim-server.cjs', '--data', dataDir, '--port', '0', '--host', '127.0.0.1',
  '--universe', 'full', '--name', 'Bench'], { stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
server.stdout!.on('data', chunk => { output += chunk; });
server.stderr!.on('data', chunk => { output += chunk; });
const console = globalThis.console;
try {
  for (let i = 0; i < 300 && !/http:\/\/localhost:(\d+)/.test(output); i++) await wait(50);
  const port = Number(/http:\/\/localhost:(\d+)/.exec(output)![1]);
  // Asteroids in commands of at most 50,000.
  for (let left = asteroids; left > 0; left -= 50000) {
    server.stdin!.write(`asteroids ${Math.min(50000, left)}\n`);
    await wait(500);
  }
  for (let i = 0; i < 100 && (output.match(/Added \d+ asteroids/g)?.length ?? 0) < Math.ceil(asteroids / 50000); i++) await wait(100);
  const status = async (): Promise<{ tick: number; time: number; ships: number }> =>
    await (await fetch(`http://127.0.0.1:${port}/status`)).json() as { tick: number; time: number; ships: number };

  // Byte-counting proxy: what crosses the wire, after permessage-deflate.
  let down = 0, up = 0;
  const proxy = createServer(socket => {
    const target = connect(port, '127.0.0.1');
    socket.on('data', chunk => { up += chunk.length; target.write(chunk); });
    target.on('data', chunk => { down += chunk.length; socket.write(chunk); });
    const end = (): void => { socket.destroy(); target.destroy(); };
    socket.on('error', end); target.on('error', end); socket.on('close', end); target.on('close', end);
  });
  await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done));
  const proxyPort = (proxy.address() as AddressInfo).port;

  const sessions: ClientSession[] = [];
  let decompressed = 0, updates = 0, updateMs = 0;
  for (let i = 0; i < clients; i++) {
    const connection = await connectWebSocket(`ws://127.0.0.1:${proxyPort}/ws`);
    const client = new ClientSession(connection, { name: `Bench ${i}` });
    const handler = connection.onmessage!;
    connection.onmessage = text => { decompressed += text.length; handler(text); };
    sessions.push(client);
  }
  for (let i = 0; i < 100 && sessions.some(s => s.phase !== 'joined'); i++) await wait(100);
  const joined = sessions.filter(s => s.phase === 'joined').length;
  const cpu = (): number => {
    const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
    return (Number(stat[11]) + Number(stat[12])) * 10; // utime + stime in ms (100 Hz clock ticks)
  };
  const start = { at: performance.now(), cpu: cpu(), status: await status(), down, up, decompressed };
  const timer = setInterval(() => {
    const t0 = performance.now();
    sessions.forEach((client, i) => {
      if (client.phase !== 'joined') return;
      const phase = Math.floor((performance.now() / 700) + i) % 6;
      client.control(client.ownShips()[0]?.id, phase < 2 ? { turn: phase ? 1 : 0, throttle: 0, engine: true }
        : { turn: 0, throttle: 0, engine: false });
      client.update();
    });
    updateMs += performance.now() - t0; updates++;
  }, 16);
  await wait(seconds * 1000);
  clearInterval(timer);
  const end = { at: performance.now(), cpu: cpu(), status: await status(), down, up };
  const wall = (end.at - start.at) / 1000;
  const report = {
    objects: end.status.ships, clients: joined, seconds: +wall.toFixed(1),
    server: { cpuPercentOfOneCore: +(100 * (end.cpu - start.cpu) / (wall * 1000)).toFixed(1),
      simulatedSecondsPerSecond: +((end.status.time - start.status.time) / wall).toFixed(3) },
    wire: { downBytesPerClientPerSecond: Math.round((end.down - start.down) / joined / wall),
      upBytesPerClientPerSecond: Math.round((end.up - start.up) / joined / wall),
      decompressedBytesPerClientPerSecond: Math.round((decompressed - start.decompressed) / joined / wall) },
    clients: { meanUpdateMsAllClients: +(updateMs / updates).toFixed(2) },
  };
  console.log(JSON.stringify(report, null, 2));
  for (const s of sessions) s.leave();
  proxy.close();
} finally {
  server.stdin!.write('stop\n');
  await wait(1500);
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
