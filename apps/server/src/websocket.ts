import { createHash } from 'node:crypto';
import { constants, deflateRawSync, inflateRawSync } from 'node:zlib';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { Connection } from '../../../packages/net/src/connection';

/** RFC 6455 handshake constant. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface SocketOptions {
  /** Largest client message, after reassembling fragments. */
  readonly maxMessageBytes: number;
  /** Ping a quiet peer this often; drop it if it stays silent for another interval. */
  readonly pingIntervalMs: number;
  readonly label: string;
  /** Negotiated permessage-deflate (RFC 7692), without context takeover either way. */
  readonly deflate?: boolean;
}

/** The empty stored block that ends a sync-flushed deflate stream (RFC 7692 §7.2). */
const DEFLATE_TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
/** Smaller messages are sent as they are: compressing them saves nothing worth the time. */
const DEFLATE_MIN_BYTES = 256;

function refuse(socket: Duplex, status: string, headers = ''): undefined {
  const body = `${status}\n`;
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n${headers}\r\n${body}`);
  return undefined;
}

/** Complete a WebSocket upgrade, or answer with an HTTP error and return undefined.
 * Text messages only; no subprotocols. permessage-deflate is accepted when offered (every
 * browser and Node offer it): snapshots are JSON and shrink about four times. */
export function acceptWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer, options: SocketOptions): ServerWebSocket | undefined {
  socket.on('error', () => socket.destroy());
  if (request.method !== 'GET') return refuse(socket, '405 Method Not Allowed');
  const upgrade = String(request.headers.upgrade ?? '').toLowerCase();
  const tokens = String(request.headers.connection ?? '').toLowerCase().split(',').map(t => t.trim());
  if (upgrade !== 'websocket' || !tokens.includes('upgrade')) return refuse(socket, '400 Bad Request');
  if (request.headers['sec-websocket-version'] !== '13') return refuse(socket, '426 Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(socket, '400 Bad Request');
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  const deflate = String(request.headers['sec-websocket-extensions'] ?? '').split(',')
    .some(offer => offer.split(';')[0]!.trim().toLowerCase() === 'permessage-deflate');
  // Without context takeover each message inflates on its own: no per-connection zlib state.
  const extension = deflate ? 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' : '';
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${extension}\r\n`);
  return new ServerWebSocket(socket, head, { ...options, deflate });
}

/** Truncate to at most `bytes` of UTF-8 without splitting a character. */
function utf8Prefix(text: string, bytes: number): Buffer {
  const all = Buffer.from(text, 'utf8');
  if (all.length <= bytes) return all;
  let end = bytes;
  while (end > 0 && (all[end]! & 0xc0) === 0x80) end--;
  return all.subarray(0, end);
}

export class ServerWebSocket implements Connection {
  readonly label: string;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((reason: string) => void) | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private fragmented = false;
  /** The fragmented message being received is compressed. */
  private fragmentsCompressed = false;
  /** A close frame was sent; nothing else may follow. */
  private closing = false;
  private finished = false;
  private alive = true;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly socket: Duplex, head: Buffer, private readonly options: SocketOptions) {
    this.label = options.label;
    (socket as Socket).setNoDelay?.(true);
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('end', () => socket.end());
    socket.on('close', () => this.finish('Connection closed.'));
    this.timer = setInterval(() => this.keepAlive(), options.pingIntervalMs);
    this.timer.unref?.();
    if (head.length) this.receive(head);
  }

  get bufferedAmount(): number { return this.socket.writableLength; }

  send(text: string): void {
    if (this.closing) return;
    const payload = Buffer.from(text, 'utf8');
    if (!this.options.deflate || payload.length < DEFLATE_MIN_BYTES) { this.write(0x1, payload); return; }
    // Level 1: most of the gain at a fraction of the time (snapshots go to every player).
    const packed = deflateRawSync(payload, { level: 1, finishFlush: constants.Z_SYNC_FLUSH });
    const tail = packed.length >= 4 && packed.subarray(packed.length - 4).equals(DEFLATE_TAIL) ? packed.length - 4 : packed.length;
    this.write(0x1, packed.subarray(0, tail), true);
  }

  close(reason = ''): void { this.shutdown(1000, reason); }

  private shutdown(code: number, reason: string): void {
    if (this.closing || this.finished) return;
    this.closing = true;
    const text = utf8Prefix(reason, 123);
    const payload = Buffer.alloc(2 + text.length);
    payload.writeUInt16BE(code, 0);
    text.copy(payload, 2);
    this.write(0x8, payload);
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 2000).unref?.();
    this.finish(reason || `Closed (${code}).`);
  }

  private fail(code: number, reason: string): undefined {
    this.shutdown(code, reason);
    return undefined;
  }

  private finish(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.timer);
    this.onclose?.(reason);
  }

  private keepAlive(): void {
    if (this.finished) return;
    if (!this.alive) {
      this.socket.destroy();
      this.finish('Connection timed out.');
      return;
    }
    this.alive = false;
    this.write(0x9, Buffer.alloc(0));
  }

  private receive(chunk: Buffer): void {
    if (this.finished) return;
    this.alive = true;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const frame = this.parse();
      if (!frame || this.finished) return;
      this.handle(frame.fin, frame.opcode, frame.payload, frame.compressed);
      if (this.finished) return;
    }
  }

  private parse(): { fin: boolean; opcode: number; payload: Buffer; compressed: boolean } | undefined {
    const b = this.buffer;
    if (b.length < 2) return undefined;
    const fin = (b[0]! & 0x80) !== 0, opcode = b[0]! & 0x0f, compressed = (b[0]! & 0x40) !== 0;
    if ((b[0]! & 0x30) || (compressed && (!this.options.deflate || opcode === 0x0 || opcode >= 0x8))) {
      return this.fail(1002, 'Reserved bits are set.');
    }
    if (!(b[1]! & 0x80)) return this.fail(1002, 'Client frames must be masked.');
    let length = b[1]! & 0x7f, offset = 2;
    if (length === 126) {
      if (b.length < 4) return undefined;
      length = b.readUInt16BE(2); offset = 4;
    } else if (length === 127) {
      if (b.length < 10) return undefined;
      if (b.readUInt32BE(2) !== 0) return this.fail(1009, 'Message too large.');
      length = b.readUInt32BE(6); offset = 10;
    }
    if (opcode >= 0x8 && (!fin || length > 125)) return this.fail(1002, 'Invalid control frame.');
    if (length > this.options.maxMessageBytes) return this.fail(1009, 'Message too large.');
    if (b.length < offset + 4 + length) return undefined;
    const mask = b.subarray(offset, offset + 4), start = offset + 4;
    const payload = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) payload[i] = b[start + i]! ^ mask[i & 3]!;
    this.buffer = b.subarray(start + length);
    return { fin, opcode, payload, compressed };
  }

  private handle(fin: boolean, opcode: number, payload: Buffer, compressed: boolean): void {
    switch (opcode) {
      case 0x0:
        if (!this.fragmented) { this.fail(1002, 'Unexpected continuation frame.'); return; }
        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > this.options.maxMessageBytes) { this.fail(1009, 'Message too large.'); return; }
        this.fragments.push(payload);
        if (fin) {
          const message = Buffer.concat(this.fragments);
          this.fragments = []; this.fragmentBytes = 0; this.fragmented = false;
          this.deliver(message, this.fragmentsCompressed);
        }
        return;
      case 0x1:
        if (this.fragmented) { this.fail(1002, 'Expected a continuation frame.'); return; }
        if (fin) { this.deliver(payload, compressed); return; }
        this.fragmented = true; this.fragments = [payload]; this.fragmentBytes = payload.length;
        this.fragmentsCompressed = compressed;
        return;
      case 0x2: this.fail(1003, 'Only text messages are supported.'); return;
      case 0x8: {
        let reason = '';
        if (payload.length >= 2) {
          try { reason = this.decoder.decode(payload.subarray(2)); } catch { /* reason is informational */ }
        }
        if (!this.closing) {
          this.closing = true;
          this.write(0x8, payload.subarray(0, Math.min(2, payload.length)));
        }
        this.socket.end();
        this.finish(reason || 'Disconnected.');
        return;
      }
      case 0x9: if (!this.closing) this.write(0xa, payload); return;
      case 0xa: return;
      default: this.fail(1002, 'Unknown frame type.');
    }
  }

  private deliver(payload: Buffer, compressed = false): void {
    if (compressed) {
      // Bounded: a small compressed frame must not expand past the message limit.
      try {
        payload = inflateRawSync(Buffer.concat([payload, DEFLATE_TAIL]),
          { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: this.options.maxMessageBytes });
      }
      catch { this.fail(1009, 'Compressed message is invalid or too large.'); return; }
    }
    let text: string;
    try { text = this.decoder.decode(payload); } catch { this.fail(1007, 'Messages must be UTF-8 text.'); return; }
    try { this.onmessage?.(text); } catch { this.fail(1011, 'The server could not handle a message.'); }
  }

  private write(opcode: number, payload: Buffer, compressed = false): void {
    if (this.socket.destroyed || !this.socket.writable) return;
    const length = payload.length, first = 0x80 | (compressed ? 0x40 : 0) | opcode;
    let header: Buffer;
    if (length < 126) header = Buffer.from([first, length]);
    else if (length < 0x10000) {
      header = Buffer.alloc(4);
      header[0] = first; header[1] = 126; header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = first; header[1] = 127;
      header.writeUInt32BE(Math.floor(length / 2 ** 32), 2); header.writeUInt32BE(length >>> 0, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }
}
