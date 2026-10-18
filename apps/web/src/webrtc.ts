import type { Connection } from '../../../packages/net/src/connection';
import { MAX_HOST_MESSAGE } from '../../../packages/net/src/protocol';

/** Browsers cannot accept incoming connections, so a browser host reaches players over a
 * WebRTC data channel. With no signaling server, the two sides swap codes by hand: the
 * host's invite (an SDP offer) and the player's reply (the answer). Each invite connects
 * one player. Without a STUN server only local-network addresses are offered; the invite
 * says whether the host used one, and the player's side follows. */
export const PUBLIC_STUN = 'stun:stun.l.google.com:19302';
const OFFER = 'SSO1';
const ANSWER = 'SSA1';
/** Data channel messages are limited (256 KiB in Chromium); larger texts are split. */
const CHUNK = 16 * 1024;
const GATHER_MS = 45_000;
const CONNECT_MS = 60_000;
const MAX_CODE_BYTES = 64 * 1024;
/** Human code exchange gets its own, visible invitation lifetime. */
export const REPLY_LIFETIME_MS = 10 * 60_000;

export interface ConnectionDiagnostics {
  readonly gathering: RTCIceGatheringState;
  readonly connection: RTCPeerConnectionState;
  readonly candidates: Readonly<Record<string, number>>;
  readonly errors: readonly number[];
}

/** Counts and error codes only: never export addresses, SDP or invitation secrets. */
function observe(pc: RTCPeerConnection): () => ConnectionDiagnostics {
  const errors: number[] = [];
  pc.addEventListener('icecandidateerror', event => { if (errors.length < 16) errors.push(event.errorCode); });
  return () => {
    const candidates: Record<string, number> = {};
    for (const match of (pc.localDescription?.sdp ?? '').matchAll(/^a=candidate:.*? typ (\w+)/gm)) {
      candidates[match[1]!] = (candidates[match[1]!] ?? 0) + 1;
    }
    return { gathering: pc.iceGatheringState, connection: pc.connectionState, candidates, errors: [...errors] };
  };
}

export const isInviteCode = (text: string): boolean => text.trim().startsWith(`${OFFER}.`);
export const isReplyCode = (text: string): boolean => text.trim().startsWith(`${ANSWER}.`);

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unbase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_CODE_BYTES) { await reader.cancel(); throw new Error('Invite is too large.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

async function encode(prefix: string, description: RTCSessionDescriptionInit, stun = false): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ t: description.type, s: description.sdp, ...(stun ? { n: 1 } : {}) }));
  if (typeof CompressionStream === 'function') return `${prefix}.z${base64url(await transform(json, new CompressionStream('deflate-raw')))}`;
  return `${prefix}.r${base64url(json)}`;
}
async function decode(prefix: string, code: string, type: RTCSdpType): Promise<{ readonly description: RTCSessionDescriptionInit; readonly stun: boolean }> {
  const text = code.replace(/\s+/g, '');
  const fail = (): never => { throw new Error(type === 'offer' ? 'That is not an invite code.' : 'That is not a reply code.'); };
  if (text.length > MAX_CODE_BYTES || !text.startsWith(`${prefix}.`)) fail();
  const body = text.slice(prefix.length + 2);
  try {
    let bytes = unbase64url(body);
    if (text[prefix.length + 1] === 'z') bytes = await transform(bytes, new DecompressionStream('deflate-raw'));
    else if (text[prefix.length + 1] !== 'r') fail();
    const value = JSON.parse(new TextDecoder().decode(bytes)) as { t?: unknown; s?: unknown; n?: unknown };
    if (value.t !== type || typeof value.s !== 'string' || value.s.length > 20_000) fail();
    return { description: { type, sdp: value.s as string }, stun: value.n === 1 };
  } catch { return fail(); }
}

/** Manual codes must contain the final candidate set; never silently freeze a partial SDP. */
function gathered(pc: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('Cancelled.'));
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((done, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else done();
    };
    const changed = (): void => { if (pc.iceGatheringState === 'complete') finish(); };
    const abort = (): void => finish(new Error('Cancelled.'));
    const timer = setTimeout(() => finish(new Error('Address discovery timed out. Try again, turn off Across the internet for local play, or use a server link.')), GATHER_MS);
    pc.addEventListener('icegatheringstatechange', changed);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function configuration(stun: boolean): RTCConfiguration {
  return { iceServers: stun ? [{ urls: PUBLIC_STUN }] : [] };
}

/** Wrap an open channel as a Connection, splitting long texts. */
function channelConnection(pc: RTCPeerConnection, channel: RTCDataChannel, label: string): Connection {
  let parts: string[] = [];
  let size = 0;
  let closed = false;
  const connection: Connection = {
    label,
    get bufferedAmount() { return channel.bufferedAmount; },
    send(text) {
      if (closed || channel.readyState !== 'open') return;
      // A full send buffer throws (16 MiB in Chromium): end the link instead of the caller.
      try {
        for (let i = 0; i < text.length;) {
          let end = Math.min(i + CHUNK, text.length);
          // A data-channel string is encoded independently: keep UTF-16 pairs together.
          if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
            && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
          channel.send((end < text.length ? '1' : '0') + text.slice(i, end));
          i = end;
        }
        if (!text.length) channel.send('0');
      } catch { finish('The connection could not keep up.'); }
    },
    close(reason = 'Disconnected.') { finish(reason); },
    onmessage: null,
    onclose: null,
  };
  const finish = (reason: string): void => {
    if (closed) return;
    closed = true;
    try { channel.close(); } catch { /* already closed */ }
    pc.close();
    connection.onclose?.(reason);
  };
  channel.onmessage = event => {
    if (typeof event.data !== 'string' || !event.data.length || !/^[01]/.test(event.data)) { finish('Unexpected data.'); return; }
    size += event.data.length - 1;
    if (size > MAX_HOST_MESSAGE) { finish('Message too large.'); return; }
    parts.push(event.data.slice(1));
    if (event.data[0] === '1') return;
    const text = parts.join('');
    parts = []; size = 0;
    connection.onmessage?.(text);
  };
  channel.onclose = () => finish('Connection closed.');
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish('Connection lost.');
  });
  return connection;
}

/** Resolves when the channel opens; rejects on failure, timeout or `cancelled`. */
function opened(pc: RTCPeerConnection, channel: Promise<RTCDataChannel>, label: string, stun: boolean,
  cancelled: Promise<never>, lifetime = CONNECT_MS): Promise<Connection> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.close();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(lifetime === REPLY_LIFETIME_MS
      ? 'This reply expired after 10 minutes. Ask the host for a new invite.'
      : 'The direct connection timed out. Try a new invite or ask the host for a server link.')), lifetime);
    cancelled.catch(fail);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        fail(new Error(stun
          ? 'Could not connect. Strict networks (some offices, mobile carriers) block direct links; use a dedicated server.'
          : 'Could not connect. Players on different networks need an invite made with "Across the internet" ticked.'));
      }
    });
    channel.then(ch => {
      const ready = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(channelConnection(pc, ch, label));
      };
      if (ch.readyState === 'open') ready(); else ch.addEventListener('open', ready, { once: true });
    }, fail);
  });
}
/** A promise that rejects when `cancel` is called. */
function cancellation(): { readonly cancelled: Promise<never>; cancel(): void } {
  let cancel = (): void => {};
  const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error('Cancelled.')); });
  cancelled.catch(() => { /* observed by whoever waits */ });
  return { cancelled, cancel };
}

export interface Invite {
  readonly code: string;
  /** Public address discovery was requested; direct connectivity is still best effort. */
  readonly stun: boolean;
  diagnostics(): ConnectionDiagnostics;
  /** Apply the player's reply code and wait for the channel to open. */
  accept(reply: string): Promise<Connection>;
  cancel(): void;
}

/** Host side: create one invite. */
export async function createInvite(stun: boolean, signal?: AbortSignal): Promise<Invite> {
  const pc = new RTCPeerConnection(configuration(stun));
  const diagnostics = observe(pc);
  try {
    const channel = pc.createDataChannel('space-sim', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, signal);
    const code = await encode(OFFER, pc.localDescription!.toJSON() as RTCSessionDescriptionInit, stun);
    const { cancelled, cancel } = cancellation();
    let accepting: Promise<Connection> | undefined;
    return {
      code,
      stun,
      diagnostics,
      async accept(reply) {
        if (accepting) return accepting;
        if (pc.signalingState === 'closed') throw new Error('This invite was cancelled. Create a new one.');
        const { description } = await decode(ANSWER, reply, 'answer');
        await pc.setRemoteDescription(description);
        accepting = opened(pc, Promise.resolve(channel), 'invited player', stun, cancelled);
        return accepting;
      },
      cancel() { cancel(); pc.close(); },
    };
  } catch (error) { pc.close(); throw error; }
}

export interface Reply {
  readonly code: string;
  readonly expiresAt: number;
  diagnostics(): ConnectionDiagnostics;
  /** Resolves when the host has applied the reply and the channel opens. */
  readonly connection: Promise<Connection>;
  cancel(): void;
}

/** Player side: answer an invite, using a STUN server exactly when the host did. */
export async function answerInvite(invite: string): Promise<Reply> {
  const { description, stun } = await decode(OFFER, invite, 'offer');
  const pc = new RTCPeerConnection(configuration(stun));
  const diagnostics = observe(pc);
  try {
    const channel = new Promise<RTCDataChannel>(resolve => { pc.ondatachannel = event => resolve(event.channel); });
    await pc.setRemoteDescription(description);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    const { cancelled, cancel } = cancellation();
    const code = await encode(ANSWER, pc.localDescription!.toJSON() as RTCSessionDescriptionInit);
    const connection = opened(pc, channel, 'browser host', stun, cancelled, REPLY_LIFETIME_MS);
    // A session may change before the UI claims this reply; cancellation is still observed.
    connection.catch(() => {});
    return {
      code,
      expiresAt: Date.now() + REPLY_LIFETIME_MS,
      diagnostics,
      connection,
      cancel() { cancel(); pc.close(); },
    };
  } catch (error) { pc.close(); throw error; }
}
