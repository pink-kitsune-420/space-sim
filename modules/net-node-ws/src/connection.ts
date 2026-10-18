import type { HttpUpgrade, ServerSocketOptions as SocketOptions, ServerTextConnection, UpgradeByteStream as Duplex, WebSocketCodecs } from '@space-sim/game-api';

const encoder = new TextEncoder();
const EMPTY = new Uint8Array(0);
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function unref(timer: ReturnType<typeof setTimeout>): void { (timer as unknown as { unref?(): void }).unref?.(); }

/** RFC 6455 handshake constant. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** The empty stored block that ends a sync-flushed deflate stream (RFC 7692 §7.2). */
const DEFLATE_TAIL = new Uint8Array([0x00, 0x00, 0xff, 0xff]);
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
export function acceptWebSocket(request: HttpUpgrade, socket: Duplex, head: Uint8Array, options: SocketOptions, codecs: WebSocketCodecs): ServerWebSocket | undefined {
  validateOptions(options);
  socket.on('error', () => socket.destroy());
  if (request.method !== 'GET') return refuse(socket, '405 Method Not Allowed');
  const upgrade = String(request.headers.upgrade ?? '').toLowerCase();
  const tokens = String(request.headers.connection ?? '').toLowerCase().split(',').map(t => t.trim());
  if (upgrade !== 'websocket' || !tokens.includes('upgrade')) return refuse(socket, '400 Bad Request');
  if (request.headers['sec-websocket-version'] !== '13') return refuse(socket, '426 Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(socket, '400 Bad Request');
  const accept = codecs.sha1Base64(key + GUID);
  const deflate = String(request.headers['sec-websocket-extensions'] ?? '').split(',')
    .some(offer => offer.split(';')[0]!.trim().toLowerCase() === 'permessage-deflate');
  // Without context takeover each message inflates on its own: no per-connection zlib state.
  const extension = deflate ? 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' : '';
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${extension}\r\n`);
  return new ServerWebSocket(socket, head, { ...options, deflate }, codecs);
}

/** Truncate to at most `bytes` of UTF-8 without splitting a character. */
function utf8Prefix(text: string, bytes: number): Uint8Array {
  const all = encoder.encode(text);
  if (all.length <= bytes) return all;
  let end = bytes;
  while (end > 0 && (all[end]! & 0xc0) === 0x80) end--;
  return all.subarray(0, end);
}

export class ServerWebSocket implements ServerTextConnection {
  readonly label: string;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((reason: string) => void) | null = null;
  private buffer: Uint8Array = EMPTY;
  private fragments: Uint8Array[] = [];
  private fragmentBytes = 0;
  private fragmented = false;
  /** The fragmented message being received is compressed. */
  private fragmentsCompressed = false;
  /** A close frame was sent; nothing else may follow. */
  private closing = false;
  private finished = false;
  private closeReason = '';
  private closeTimer?: ReturnType<typeof setTimeout>;
  private resolveClosed!: () => void;
  /** Resolves after TCP closes, including the bounded close-handshake grace period. */
  readonly closed = new Promise<void>(resolve => { this.resolveClosed = resolve; });
  private alive = true;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly socket: Duplex, head: Uint8Array, private readonly options: SocketOptions, private readonly codecs: WebSocketCodecs) {
    validateOptions(options);
    this.label = options.label;
    socket.setNoDelay?.(true);
    socket.on('data', (chunk: Uint8Array) => this.receive(chunk));
    socket.on('end', () => socket.end());
    socket.on('close', () => {
      clearTimeout(this.closeTimer);
      this.finish(this.closeReason || 'Connection closed.');
      this.resolveClosed();
    });
    this.timer = setInterval(() => this.keepAlive(), options.pingIntervalMs);
    unref(this.timer);
    if (head.length) this.receive(head);
  }

  get bufferedAmount(): number { return this.socket.writableLength; }

  send(text: string): void {
    if (this.closing) return;
    const payload = encoder.encode(text);
    if (!this.options.deflate || payload.length < DEFLATE_MIN_BYTES) { this.write(0x1, payload); return; }
    // Level 1: most of the gain at a fraction of the time (snapshots go to every player).
    const packed = this.codecs.deflate(payload);
    const tail = packed.length >= 4 && DEFLATE_TAIL.every((byte, index) => packed[packed.length - 4 + index] === byte) ? packed.length - 4 : packed.length;
    this.write(0x1, packed.subarray(0, tail), true);
  }

  close(reason = ''): void { this.shutdown(1000, reason); }

  private shutdown(code: number, reason: string): void {
    if (this.closing || this.finished) return;
    this.closing = true;
    this.closeReason = reason || `Closed (${code}).`;
    clearInterval(this.timer);
    const text = utf8Prefix(reason, 123);
    const payload = new Uint8Array(2 + text.length);
    view(payload).setUint16(0, code);
    payload.set(text, 2);
    this.write(0x8, payload);
    // Keep reading until the peer acknowledges Close. Ending TCP now can reset a
    // connection with incoming controls and discard our goodbye (RFC 6455 §7.1).
    this.closeTimer = setTimeout(() => this.socket.destroy(), 2000);
    unref(this.closeTimer);
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
    this.write(0x9, EMPTY);
  }

  private receive(chunk: Uint8Array): void {
    if (this.finished) return;
    this.alive = true;
    this.buffer = this.buffer.length ? concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const frame = this.parse();
      if (!frame || this.finished) return;
      this.handle(frame.fin, frame.opcode, frame.payload, frame.compressed);
      if (this.finished) return;
    }
  }

  private parse(): { fin: boolean; opcode: number; payload: Uint8Array; compressed: boolean } | undefined {
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
      length = view(b).getUint16(2); offset = 4;
    } else if (length === 127) {
      if (b.length < 10) return undefined;
      if (view(b).getUint32(2) !== 0) return this.fail(1009, 'Message too large.');
      length = view(b).getUint32(6); offset = 10;
    }
    if (opcode >= 0x8 && (!fin || length > 125)) return this.fail(1002, 'Invalid control frame.');
    if (length > this.options.maxMessageBytes) return this.fail(1009, 'Message too large.');
    if (b.length < offset + 4 + length) return undefined;
    const mask = b.subarray(offset, offset + 4), start = offset + 4;
    const payload = new Uint8Array(length);
    for (let i = 0; i < length; i++) payload[i] = b[start + i]! ^ mask[i & 3]!;
    this.buffer = b.subarray(start + length);
    return { fin, opcode, payload, compressed };
  }

  private handle(fin: boolean, opcode: number, payload: Uint8Array, compressed: boolean): void {
    if (this.closing && opcode !== 0x8) return;
    switch (opcode) {
      case 0x0:
        if (!this.fragmented) { this.fail(1002, 'Unexpected continuation frame.'); return; }
        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > this.options.maxMessageBytes) { this.fail(1009, 'Message too large.'); return; }
        this.fragments.push(payload);
        if (fin) {
          const message = concat(this.fragments);
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
        this.finish(this.closeReason || reason || 'Disconnected.');
        return;
      }
      case 0x9: if (!this.closing) this.write(0xa, payload); return;
      case 0xa: return;
      default: this.fail(1002, 'Unknown frame type.');
    }
  }

  private deliver(payload: Uint8Array, compressed = false): void {
    if (compressed) {
      // Bounded: a small compressed frame must not expand past the message limit.
      try {
        payload = this.codecs.inflate(concat([payload, DEFLATE_TAIL]), this.options.maxMessageBytes);
      }
      catch { this.fail(1009, 'Compressed message is invalid or too large.'); return; }
    }
    let text: string;
    try { text = this.decoder.decode(payload); } catch { this.fail(1007, 'Messages must be UTF-8 text.'); return; }
    try { this.onmessage?.(text); } catch { this.fail(1011, 'The server could not handle a message.'); }
  }

  private write(opcode: number, payload: Uint8Array, compressed = false): void {
    if (this.socket.destroyed || !this.socket.writable) return;
    const length = payload.length, first = 0x80 | (compressed ? 0x40 : 0) | opcode;
    let header: Uint8Array;
    if (length < 126) header = new Uint8Array([first, length]);
    else if (length < 0x10000) {
      header = new Uint8Array(4);
      header[0] = first; header[1] = 126; view(header).setUint16(2, length);
    } else {
      header = new Uint8Array(10);
      header[0] = first; header[1] = 127;
      view(header).setUint32(2, Math.floor(length / 2 ** 32)); view(header).setUint32(6, length >>> 0);
    }
    this.socket.write(concat([header, payload]));
  }
}

function validateOptions(options: SocketOptions): void {
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 1 || options.maxMessageBytes > 64 * 1024 * 1024
    || !Number.isFinite(options.pingIntervalMs) || options.pingIntervalMs <= 0 || typeof options.label !== 'string')
    throw new Error('Invalid Node WebSocket limits or label');
}
