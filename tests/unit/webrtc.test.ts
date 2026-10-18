import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerInvite, createInvite, REPLY_LIFETIME_MS } from '../../apps/web/src/webrtc';
import { deflateRawSync } from 'node:zlib';

import { Peer, code } from '../helpers/webrtc';

beforeEach(() => {
  Peer.all = []; Peer.gathering = 'complete'; Peer.offerFails = false;
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('CompressionStream', undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('manual WebRTC lifecycle', () => {
  it('rejects oversized untrusted codes before constructing a peer', async () => {
    await expect(answerInvite('SSO1.r' + 'a'.repeat(65536))).rejects.toThrow('not an invite');
    const compressed = deflateRawSync(JSON.stringify({ t: 'offer', s: 'x'.repeat(1_000_000) }));
    await expect(answerInvite('SSO1.z' + compressed.toString('base64url'))).rejects.toThrow('not an invite');
    expect(Peer.all).toHaveLength(0);
  });
  it('waits beyond five seconds for the complete candidate set', async () => {
    vi.useFakeTimers(); Peer.gathering = 'gathering';
    let ready = false;
    const pending = createInvite(false).then(value => { ready = true; return value; });
    await vi.advanceTimersByTimeAsync(8000);
    expect(ready).toBe(false);
    const pc = Peer.all[0]!;
    pc.iceGatheringState = 'complete';
    pc.localDescription!.sdp += 'a=candidate:1 1 udp 1 192.0.2.1 1234 typ srflx\r\n';
    pc.dispatchEvent(new Event('icegatheringstatechange'));
    const invite = await pending;
    const value = JSON.parse(Buffer.from(invite.code.slice(6), 'base64url').toString());
    expect(value.s).toContain('typ srflx');
    expect(invite.diagnostics().candidates).toEqual({ srflx: 1 });
    expect(JSON.stringify(invite.diagnostics())).not.toContain('192.0.2.1');
    invite.cancel();
  });

  it('fails clearly and closes the peer if gathering never completes', async () => {
    vi.useFakeTimers(); Peer.gathering = 'gathering';
    const failed = expect(createInvite(true)).rejects.toThrow('Address discovery timed out');
    await vi.advanceTimersByTimeAsync(45_000);
    await failed;
    expect(Peer.all[0]!.signalingState).toBe('closed');
  });

  it('cancels gathering immediately when hosting stops', async () => {
    vi.useFakeTimers(); Peer.gathering = 'gathering';
    const controller = new AbortController();
    const failed = expect(createInvite(true, controller.signal)).rejects.toThrow('Cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await failed;
    expect(Peer.all[0]!.signalingState).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves Unicode across transport chunk boundaries', async () => {
    const invite = await createInvite(false);
    const connection = await invite.accept(code('answer'));
    const pc = Peer.all[0]!;
    const payload = 'x'.repeat(16383) + '🚀' + 'y'.repeat(40000);
    connection.send(payload);
    let received = '';
    connection.onmessage = text => { received = text; };
    for (const data of pc.channel.sent) pc.channel.onmessage?.({ data });
    expect(received).toBe(payload);
    connection.close();
  });

  it('rejects malformed chunk framing', async () => {
    const invite = await createInvite(false);
    const connection = await invite.accept(code('answer'));
    let reason = '';
    connection.onclose = text => { reason = text; };
    Peer.all[0]!.channel.onmessage?.({ data: 'xunexpected' });
    expect(reason).toBe('Unexpected data.');
  });

  it('lets the player exchange the reply for ten minutes and cancels cleanly', async () => {
    vi.useFakeTimers();
    const reply = await answerInvite(code('offer'));
    const failure = expect(reply.connection).rejects.toThrow('Cancelled');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(Peer.all[0]!.signalingState).toBe('stable');
    expect(reply.expiresAt).toBeGreaterThan(Date.now());
    reply.cancel();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('explains expiry when the host never receives the reply', async () => {
    vi.useFakeTimers();
    const reply = await answerInvite(code('offer'));
    const failed = expect(reply.connection).rejects.toThrow('expired after 10 minutes');
    await vi.advanceTimersByTimeAsync(REPLY_LIFETIME_MS);
    await failed;
    expect(Peer.all[0]!.signalingState).toBe('closed');
  });

  it('releases a peer when setup fails', async () => {
    Peer.offerFails = true;
    await expect(createInvite(false)).rejects.toThrow('Offer failed');
    expect(Peer.all[0]!.signalingState).toBe('closed');
  });
});
