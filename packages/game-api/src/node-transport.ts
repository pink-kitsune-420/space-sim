import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { TextConnection } from './platform';

/**
 * Borrowed native byte stream interface (e.g. Node.js `net.Socket`).
 * Protocol providers do not own the HTTP server or port listener.
 */
export interface UpgradeByteStream {
  /** Number of bytes buffered for writing. */
  readonly writableLength: number;
  /** Whether the stream is open for writes. */
  readonly writable: boolean;
  /** Whether the underlying socket has been destroyed. */
  readonly destroyed: boolean;
  /** Enable or disable TCP_NODELAY (Nagle's algorithm). */
  setNoDelay?(enabled: boolean): unknown;
  /** Subscribe to data chunks received on the socket. */
  on(event: 'data', listener: (data: Uint8Array) => void): unknown;
  /** Subscribe to socket communication errors. */
  on(event: 'error', listener: (error: Error) => void): unknown;
  /** Subscribe to socket closure or termination events. */
  on(event: 'close' | 'end', listener: () => void): unknown;
  /** Write string or byte data to the socket. */
  write(data: string | Uint8Array): unknown;
  /** End the stream, optionally sending final data. */
  end(data?: string | Uint8Array): unknown;
  /** Destroy the stream immediately. */
  destroy(): unknown;
}
/** HTTP upgrade request headers passed from the Node HTTP server. */
export interface HttpUpgrade {
  /** HTTP method (usually 'GET'). */
  readonly method?: string;
  /** Case-insensitive HTTP request headers. */
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}
/** Node-only engine primitives; no HTTP/WebSocket policy or connection state. */
export interface WebSocketCodecs {
  /** Compute standard SHA-1 base64 hash for the Sec-WebSocket-Accept handshake. */
  sha1Base64(text: string): string;
  /** Raw DEFLATE with level 1 and sync-flush termination, including its final empty block. */
  deflate(bytes: Uint8Array): Uint8Array;
  /** Raw sync-flushed DEFLATE. Must reject output exceeding maximumBytes. */
  inflate(bytes: Uint8Array, maximumBytes: number): Uint8Array;
}
/** ServiceKey for native WebSocket cryptographic and compression codecs (slot `core.websocket-codecs`). */
export const NODE_WEBSOCKET_CODECS: ServiceKey<WebSocketCodecs> = Object.freeze({ slot: 'core.websocket-codecs', version: '1.0.0' });
/** Configuration options for an accepted server WebSocket connection. */
export interface ServerSocketOptions {
  /** Maximum accepted message size in bytes before closing the connection. */
  readonly maxMessageBytes: number;
  /** Heartbeat ping interval in milliseconds. Zero or negative disables pings. */
  readonly pingIntervalMs: number;
  /** Diagnostic label identifying this server socket or endpoint. */
  readonly label: string;
  /** Whether permessage-deflate compression was negotiated. */
  readonly deflate?: boolean;
}
/** Server-side text connection extending TextConnection with socket close notification. */
export interface ServerTextConnection extends TextConnection {
  /** Resolves when TCP has closed, including the bounded close-handshake grace period. */
  readonly closed: Promise<void>;
}
/** Server WebSocket provider capable of upgrading HTTP requests into ServerTextConnection instances. */
export interface NodeWebSocketProvider extends Disposable {
  /**
   * Accept one borrowed HTTP upgrade or refuse it with an HTTP response.
   * Returns undefined if the handshake headers or key are invalid.
   */
  accept(request: HttpUpgrade, stream: UpgradeByteStream, head: Uint8Array, options: ServerSocketOptions): ServerTextConnection | undefined;
}
/** ServiceKey for the Node WebSocket server transport (slot `net.node-ws`). */
export const NODE_WEBSOCKET_TRANSPORT: ServiceKey<NodeWebSocketProvider> = Object.freeze({ slot: 'net.node-ws', version: '1.0.0' });
