import type { Connection } from './connection';
import { MAX_HOST_MESSAGE } from './protocol';

export const DEFAULT_PORT = 6464;
export const SOCKET_PATH = '/ws';

/** Accepts `host`, `host:port`, `http(s)://…` or `ws(s)://…`; returns a WebSocket URL.
 * Plain pages use ws:, HTTPS pages need wss: (browsers block mixed content). */
export function serverUrl(address: string, secure = false): string {
  const text = address.trim();
  if (!text) throw new Error('Enter a server address.');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url: URL;
  try { url = new URL(hasScheme ? text : `${secure ? 'wss' : 'ws'}://${text}`); } catch {
    throw new Error(`"${text}" is not a server address.`);
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error(`"${text}" is not a server address.`);
  // A bare host means the game's default port; a typed scheme keeps that scheme's default.
  if (!hasScheme && !/^(\[[^\]]+\]|[^/:[\]]+):\d+/.test(text)) url.port = String(DEFAULT_PORT);
  if (url.pathname === '/') url.pathname = SOCKET_PATH;
  url.hash = '';
  return url.href;
}

/** Open a WebSocket and resolve once connected. */
export function connectWebSocket(url: string, timeoutMs = 10000): Promise<Connection> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); return; }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error(`No answer from ${url}.`));
    }, timeoutMs);
    const connection: Connection = {
      label: url,
      get bufferedAmount() { return socket.bufferedAmount; },
      send(text) { if (socket.readyState === WebSocket.OPEN) socket.send(text); },
      close(reason = 'closed') {
        if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
        // Reasons are limited to 123 UTF-8 bytes on the wire.
        socket.close(1000, new TextDecoder().decode(new TextEncoder().encode(reason).slice(0, 120)).replace(/�$/, ''));
      },
      onmessage: null,
      onclose: null,
    };
    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(connection);
    };
    socket.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > MAX_HOST_MESSAGE) { connection.close('Unexpected data.'); return; }
      connection.onmessage?.(event.data);
    };
    socket.onclose = event => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Could not connect to ${url}.`));
        return;
      }
      connection.onclose?.(event.reason || (event.wasClean ? 'Disconnected.' : 'Connection lost.'));
    };
    socket.onerror = () => { /* followed by close */ };
  });
}
