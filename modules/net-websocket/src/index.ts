import { WEBSOCKET_TRANSPORT, type Disposable, type ModuleInitializationV2, type TextConnection, type TransportProvider } from '@space-sim/game-api';
import { connectWebSocket, DEFAULT_MAX_TEXT_LENGTH, serverUrl } from './connection';

/** Owns pending and established links; no world/session state or eager network IO. */
export function createWebSocketTransport(timeoutMs = 10000, maxTextLength = DEFAULT_MAX_TEXT_LENGTH): TransportProvider & Disposable {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(maxTextLength) || maxTextLength < 1)
    throw new Error('Invalid WebSocket timeout/text limit');
  const leases = new Set<{ dispose(): void }>(); let disposed = false;
  return {
    name: 'websocket', schemes: Object.freeze(['ws', 'wss']),
    async connect(address, signal) {
      if (disposed) throw new Error('WebSocket provider is disposed');
      if (signal.aborted) throw new Error('WebSocket connection cancelled');
      const controller = new AbortController(), abort = () => lease.dispose();
      const forget = (): void => { leases.delete(lease); signal.removeEventListener('abort', abort); };
      const lease = { dispose() { forget(); controller.abort(signal.reason); } };
      leases.add(lease); signal.addEventListener('abort', abort, { once: true });
      try {
        const raw = await connectWebSocket(serverUrl(address, typeof location !== 'undefined' && location.protocol === 'https:'), timeoutMs,
          { signal: controller.signal, maxTextLength });
        if (disposed || signal.aborted || controller.signal.aborted) { raw.close('Connection cancelled'); throw new Error('WebSocket connection cancelled'); }
        let closed = false;
        const peer: TextConnection = { label: raw.label, get bufferedAmount() { return raw.bufferedAmount; },
          send(text) { if (!closed && !disposed && !controller.signal.aborted) raw.send(text); }, close(reason) { forget(); raw.close(reason); }, get onmessage() { return raw.onmessage; }, set onmessage(value) { raw.onmessage = value; }, onclose: null };
        raw.onclose = reason => { if (closed) return; closed = true; forget(); peer.onclose?.(reason); };
        return peer;
      } catch (error) { forget(); controller.abort(); throw error; }
    },
    dispose() {
      if (disposed) return; disposed = true;
      const errors: unknown[] = [];
      for (const lease of leases) { try { lease.dispose(); } catch (error) { errors.push(error); } }
      leases.clear(); if (errors.length) throw new AggregateError(errors, 'WebSocket transport cleanup failed');
    },
  };
}
/** Initialize the WebSocket transport module, providing net.websocket@1.0.0 and contributing the transport. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'WebSocket transport',
    summary: 'An ordered reliable text transport without flight or session implementation imports.', asset: 'docs/creators/usage.json' });
  const transport = context.own(createWebSocketTransport(context.settings.timeoutMs, context.settings.maxTextLength));
  context.provide(WEBSOCKET_TRANSPORT, transport); context.contributeTransport(transport);
}
