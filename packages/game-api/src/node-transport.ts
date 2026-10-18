import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { TextConnection } from './platform';

/** Borrowed native byte stream. Protocol providers do not own the HTTP listener. */
export interface UpgradeByteStream {
  readonly writableLength: number;
  readonly writable: boolean;
  readonly destroyed: boolean;
  setNoDelay?(enabled: boolean): unknown;
  on(event: 'data', listener: (data: Uint8Array) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close' | 'end', listener: () => void): unknown;
  write(data: string | Uint8Array): unknown;
  end(data?: string | Uint8Array): unknown;
  destroy(): unknown;
}
export interface HttpUpgrade {
  readonly method?: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}
/** Node-only engine primitives; no HTTP/WebSocket policy or connection state. */
export interface WebSocketCodecs {
  sha1Base64(text: string): string;
  /** Raw DEFLATE with level 1 and sync-flush termination, including its final empty block. */
  deflate(bytes: Uint8Array): Uint8Array;
  /** Raw sync-flushed DEFLATE. Must reject output exceeding maximumBytes. */
  inflate(bytes: Uint8Array, maximumBytes: number): Uint8Array;
}
export const NODE_WEBSOCKET_CODECS: ServiceKey<WebSocketCodecs> = Object.freeze({ slot: 'core.websocket-codecs', version: '1.0.0' });
export interface ServerSocketOptions {
  readonly maxMessageBytes: number;
  readonly pingIntervalMs: number;
  readonly label: string;
  /** Negotiated by the protocol provider; omitted by upgrade callers. */
  readonly deflate?: boolean;
}
export interface ServerTextConnection extends TextConnection {
  /** TCP has closed, including the bounded close-handshake grace period. */
  readonly closed: Promise<void>;
}
export interface NodeWebSocketProvider extends Disposable {
  /** Accept one borrowed HTTP upgrade or refuse it with an HTTP response. */
  accept(request: HttpUpgrade, stream: UpgradeByteStream, head: Uint8Array, options: ServerSocketOptions): ServerTextConnection | undefined;
}
export const NODE_WEBSOCKET_TRANSPORT: ServiceKey<NodeWebSocketProvider> = Object.freeze({ slot: 'net.node-ws', version: '1.0.0' });
