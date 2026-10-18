import { WEBRTC_SIGNALING, type Disposable, type ManualSignalingProvider, type ModuleInitializationV2, type TextConnection } from '@space-sim/game-api';
import { answerInvite, createInvite, isInviteCode, isReplyCode } from './connection';

/** Provider owns pending invitations and links; neither construction nor import starts IO. */
export function createManualSignaling(): ManualSignalingProvider & Disposable {
  const leases = new Set<{ dispose(): void }>(); let disposed = false;
  function begin(signal: AbortSignal) {
    if (disposed) throw new Error('WebRTC provider is disposed');
    if (signal.aborted) throw new Error('Cancelled.');
    const controller = new AbortController();
    const forget = (): void => { leases.delete(lease); signal.removeEventListener('abort', abort); };
    const lease = { dispose() { forget(); controller.abort(); } };
    const abort = (): void => lease.dispose();
    leases.add(lease); signal.addEventListener('abort', abort, { once: true });
    return { signal: controller.signal, forget, dispose: lease.dispose };
  }
  function peer(raw: TextConnection, lease: ReturnType<typeof begin>): TextConnection {
    if (lease.signal.aborted || disposed) { raw.close('Cancelled.'); throw new Error('Cancelled.'); }
    let closed = false;
    const result: TextConnection = { label: raw.label, get bufferedAmount() { return raw.bufferedAmount; },
      send(text) { if (!closed) raw.send(text); }, close(reason) { raw.close(reason); }, onmessage: null, onclose: null };
    raw.onmessage = text => { if (!closed) result.onmessage?.(text); };
    raw.onclose = reason => { if (closed) return; closed = true; lease.forget(); result.onclose?.(reason); };
    return result;
  }
  return {
    isInviteCode, isReplyCode,
    async create(stun, signal) {
      const lease = begin(signal);
      try {
        const invite = await createInvite(stun, lease.signal);
        let accepted: Promise<TextConnection> | undefined;
        return { code: invite.code, stun: invite.stun, diagnostics: invite.diagnostics,
          async accept(reply) {
            if (accepted) return accepted;
            accepted = invite.accept(reply).then(raw => peer(raw, lease));
            accepted.catch(() => { accepted = undefined; if (['closed', 'failed'].includes(invite.diagnostics().connection)) lease.dispose(); }); return accepted;
          }, dispose: lease.dispose };
      } catch (error) { lease.dispose(); throw error; }
    },
    async answer(offer, signal) {
      const lease = begin(signal);
      try {
        const reply = await answerInvite(offer, lease.signal);
        const connection = reply.connection.then(raw => peer(raw, lease), error => { lease.dispose(); throw error; });
        connection.catch(() => {});
        return { code: reply.code, expiresAt: reply.expiresAt, diagnostics: reply.diagnostics, connection, dispose: lease.dispose };
      } catch (error) { lease.dispose(); throw error; }
    },
    dispose() {
      if (disposed) return; disposed = true;
      const errors: unknown[] = [];
      for (const lease of leases) { try { lease.dispose(); } catch (error) { errors.push(error); } }
      leases.clear(); if (errors.length) throw new AggregateError(errors, 'WebRTC cleanup failed');
    },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Manual WebRTC transport',
    summary: 'Manual invite/reply signaling over reliable ordered text, independent of session state.', asset: 'docs/creators/usage.json' });
  context.provide(WEBRTC_SIGNALING, context.own(createManualSignaling()));
}
