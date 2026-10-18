import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { desktopHosting } from '../../apps/desktop/src/hosting';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
}

async function upgrade(port: number, path: string, origin: string): Promise<{ socket: Socket; data(): string }> {
  const socket = connect(port, '127.0.0.1');
  cleanup.push(async () => { socket.destroy(); });
  let received = '';
  socket.on('data', chunk => { received += chunk.toString('utf8'); });
  socket.on('error', () => {});
  await new Promise<void>(resolve => socket.once('connect', resolve));
  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await expect.poll(() => received).toContain('\r\n\r\n');
  return { socket, data: () => received };
}

it('requires a local page capability and refuses another owner', async () => {
  const desktop = createServer((_request, response) => response.end());
  const hosting = desktopHosting(desktop, (_request, response) => response.end());
  const port = await listen(desktop);
  cleanup.push(hosting.stop);
  const origin = `http://127.0.0.1:${port}`;
  expect((await upgrade(port, '/desktop/host', origin)).data()).toContain('403 Forbidden');
  const path = `/desktop/host?token=${hosting.token}`;
  expect((await upgrade(port, path, 'http://elsewhere.example')).data()).toContain('403 Forbidden');
  const owner = await upgrade(port, path, origin);
  expect(owner.data()).toContain('101 Switching Protocols');
  await expect.poll(owner.data).toContain('"type":"ready"');
  expect((await upgrade(port, path, origin)).data()).toContain('409 Conflict');
});

it('uses a free port when 6464 is occupied and closes its listener on stop', async () => {
  const occupied = createServer((_request, response) => response.end('occupied'));
  await listen(occupied, 6464);
  const desktop = createServer((_request, response) => response.end());
  const hosting = desktopHosting(desktop, (_request, response) => response.end('game'));
  const port = await listen(desktop);
  cleanup.push(hosting.stop);
  const owner = await upgrade(port, `/desktop/host?token=${hosting.token}`, `http://127.0.0.1:${port}`);
  await expect.poll(owner.data).toContain('"type":"ready"');
  const ready = JSON.parse(owner.data().match(/\{"type":"ready"[^\r\n]*\}/)![0]) as { localAddress: string };
  expect(new URL(ready.localAddress).port).not.toBe('6464');
  expect(await (await fetch(ready.localAddress)).text()).toBe('game');
  await hosting.stop();
  await expect(fetch(ready.localAddress)).rejects.toThrow();
  expect(await (await fetch('http://127.0.0.1:6464')).text()).toBe('occupied');
});
