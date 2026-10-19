import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { AddressInfo } from 'node:net';
import { acceptWebSocket, type ServerWebSocket } from '../../server/src/websocket';
import { MAX_CLIENT_MESSAGE, MAX_HOST_MESSAGE } from '../../../packages/net/src/protocol';

type Serve = (request: IncomingMessage, response: ServerResponse) => void;
interface Peer { readonly remote: ServerWebSocket; bridge?: ServerWebSocket; readonly timer: ReturnType<typeof setTimeout> }

/** The game window remains authoritative. Only transports cross into Node, so hosting
 * preserves the exact loaded world, module runtime, host controls and split-screen seats. */
export function desktopHosting(server: Server, serveGame: Serve): { readonly token: string; stop(): Promise<void> } {
  const token = randomBytes(32).toString('hex');
  let owner: ServerWebSocket | undefined;
  let listener: Server | undefined;
  let stopping = Promise.resolve();
  const peers = new Map<string, Peer>();
  const loopback = (address: string | undefined) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  const reject = (socket: import('node:stream').Duplex, status = '403 Forbidden') => {
    socket.on('error', () => socket.destroy());
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const remove = (id: string, reason: string) => {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    clearTimeout(peer.timer);
    peer.remote.close(reason);
    peer.bridge?.close(reason);
  };
  const stop = (): Promise<void> => {
    const control = owner;
    owner = undefined;
    control?.close('Hosting stopped.');
    for (const id of peers.keys()) remove(id, 'The host stopped hosting.');
    const active = listener;
    listener = undefined;
    if (active) {
      stopping = new Promise<void>(resolve => {
        active.close(() => resolve());
        active.closeIdleConnections();
      });
    }
    return stopping;
  };

  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); } catch { reject(socket); return; }
    // Control is available only to the locally served page. LAN game pages never get
    // the capability token, and another website cannot open a control socket.
    if (!loopback(request.socket.remoteAddress) || url.searchParams.get('token') !== token
      || request.headers.origin !== `http://${request.headers.host}`) { reject(socket); return; }
    if (url.pathname.startsWith('/desktop/peer/')) {
      const id = url.pathname.slice('/desktop/peer/'.length);
      const peer = peers.get(id);
      if (!owner || !peer || peer.bridge) { reject(socket); return; }
      const bridge = acceptWebSocket(request, socket, head, {
        maxMessageBytes: MAX_HOST_MESSAGE, pingIntervalMs: 15000, label: 'Host window',
      });
      if (!bridge) return;
      peer.bridge = bridge;
      clearTimeout(peer.timer);
      bridge.onmessage = text => {
        if (peer.remote.bufferedAmount > (1 << 20)) { remove(id, 'Connection too slow.'); return; }
        peer.remote.send(text);
      };
      bridge.onclose = reason => remove(id, reason);
      return;
    }
    if (url.pathname !== '/desktop/host' || owner) { reject(socket, '409 Conflict'); return; }
    const control = acceptWebSocket(request, socket, head, {
      maxMessageBytes: 1024, pingIntervalMs: 15000, label: 'Host control',
    });
    if (!control) return;
    owner = control;
    control.onmessage = () => control.close('Unexpected control message.');
    control.onclose = () => { if (owner === control) void stop(); };
    void (async () => {
      await stopping;
      if (owner !== control) return;
      const lan = createServer(serveGame);
      listener = lan;
      lan.on('clientError', (_error, client) => client.destroy());
      lan.on('upgrade', (incoming, client, first) => {
        if (owner !== control || incoming.url?.split('?', 1)[0] !== '/ws' || peers.size >= 64) { reject(client, '503 Service Unavailable'); return; }
        const remote = acceptWebSocket(incoming, client, first, {
          maxMessageBytes: MAX_CLIENT_MESSAGE, pingIntervalMs: 15000, label: incoming.socket.remoteAddress ?? 'LAN pilot',
        });
        if (!remote) return;
        const id = randomBytes(16).toString('hex');
        const peer: Peer = { remote, timer: setTimeout(() => remove(id, 'Host window did not answer.'), 10000) };
        peers.set(id, peer);
        remote.onmessage = text => {
          // Players wait for the host greeting before sending their join request.
          if (!peer.bridge || peer.bridge.bufferedAmount > MAX_CLIENT_MESSAGE * 64) {
            remove(id, 'Host window is busy.'); return;
          }
          peer.bridge.send(text);
        };
        remote.onclose = reason => remove(id, reason);
        control.send(JSON.stringify({ type: 'peer', id }));
      });
      const listen = (port: number) => new Promise<void>((resolve, fail) => {
        lan.once('error', fail);
        lan.listen(port, '0.0.0.0', () => { lan.off('error', fail); resolve(); });
      });
      try {
        try { await listen(6464); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
          await listen(0);
        }
        if (owner !== control) { lan.close(); return; }
        const port = (lan.address() as AddressInfo).port;
        const addresses = Object.values(networkInterfaces()).flat().filter((info): info is NetworkInterfaceInfo =>
          !!info && info.family === 'IPv4' && !info.internal).map(info => `http://${info.address}:${port}/#join=1`);
        control.send(JSON.stringify({ type: 'ready', addresses, localAddress: `http://127.0.0.1:${port}/#join=1` }));
      } catch (error) {
        control.send(JSON.stringify({ type: 'error', message: `Could not start local hosting: ${(error as Error).message}` }));
        control.close('Could not start local hosting.');
      }
    })();
  });
  return { token, stop };
}
