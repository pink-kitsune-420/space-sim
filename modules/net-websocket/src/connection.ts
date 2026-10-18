import type { TextConnection as Connection } from '@space-sim/game-api';

/** Maximum received UTF-16 text length retained from the original adapter. */
export const DEFAULT_MAX_TEXT_LENGTH = 64 * 1024 * 1024;

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
export interface WebSocketConnectOptions { readonly signal?: AbortSignal; readonly maxTextLength?: number }
export function connectWebSocket(url: string, timeoutMs = 10000, options: WebSocketConnectOptions = {}): Promise<Connection> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new Error('WebSocket timeout must be finite and nonnegative'));
  const maximum = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  if (!Number.isSafeInteger(maximum) || maximum < 1) return Promise.reject(new Error('WebSocket text limit must be a positive safe integer'));
  if (options.signal?.aborted) return Promise.reject(new Error('WebSocket connection cancelled'));
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); return; }
    let settled = false, opened = false, closing = false;
    let receiver: Connection['onmessage'] = null, queuedSize = 0, scheduled = false;
    const queued: string[] = [];
    const flush = (): void => {
      scheduled = false;
      while (!closing && receiver && queued.length) {
        const text = queued.shift()!; queuedSize -= text.length; receiver(text);
      }
    };
    const detach = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    const abort = (): void => {
      if (!settled) { settled = true; reject(new Error('WebSocket connection cancelled')); }
      detach();
      connection.close('Connection cancelled');
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      detach();
      socket.close();
      reject(new Error(`No answer from ${url}.`));
    }, timeoutMs);
    const connection: Connection = {
      label: url,
      get bufferedAmount() { return socket.bufferedAmount; },
      send(text) { if (!closing && socket.readyState === WebSocket.OPEN) socket.send(text); },
      close(reason = 'closed') {
        closing = true; queued.length = 0; queuedSize = 0;
        if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
        // Reasons are limited to 123 UTF-8 bytes on the wire.
        socket.close(1000, new TextDecoder().decode(new TextEncoder().encode(reason).slice(0, 120)).replace(/�$/, ''));
      },
      get onmessage() { return receiver; },
      set onmessage(value) {
        receiver = value;
        if (value && queued.length && !scheduled) { scheduled = true; queueMicrotask(flush); }
      },
      onclose: null,
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    socket.onopen = () => {
      if (settled) return;
      settled = true;
      opened = true;
      clearTimeout(timer);
      resolve(connection);
    };
    socket.onmessage = event => {
      if (!opened || closing) return;
      if (typeof event.data !== 'string' || event.data.length > maximum) { connection.close('Unexpected data.'); return; }
      if (receiver && !queued.length) receiver(event.data);
      else {
        if (queued.length >= 64 || queuedSize + event.data.length > maximum) { connection.close('Message backlog too large.'); return; }
        queued.push(event.data); queuedSize += event.data.length;
      }
    };
    socket.onclose = event => {
      detach(); closing = true; queued.length = 0; queuedSize = 0;
      if (!settled) {
        settled = true;
        reject(new Error(`Could not connect to ${url}.`));
        return;
      }
      if (opened) connection.onclose?.(event.reason || (event.wasClean ? 'Disconnected.' : 'Connection lost.'));
    };
    socket.onerror = () => { /* followed by close */ };
    if (options.signal?.aborted) abort();
  });
}
