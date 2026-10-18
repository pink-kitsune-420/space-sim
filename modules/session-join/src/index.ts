import { JOIN_PACKS, type Disposable, type JoinPackFactory, type JoinStage, type ModuleInitializationV2 } from '@space-sim/game-api';
import { Inbox } from './inbox';
import { base64, CHUNK, parse, unbase64, validateOffer } from './offer';
import { sha256Bytes } from './sha256';
const PROTOCOL = 'spacelab-prejoin/1';
/** Human consent has its own limit; byte transfer is separately bounded to two minutes. */
const REVIEW_MS = 10 * 60_000, TRANSFER_MS = 120_000;
export function createJoinPacks(): JoinPackFactory & Disposable {
  const pending = new Set<AbortController>(); let disposed = false;
  async function run<T>(peer: Parameters<JoinPackFactory['client']>[0], signal: AbortSignal, work: (inbox: Inbox, signal: AbortSignal, transfer: () => void) => Promise<T>): Promise<T> {
    if (disposed) throw new Error('Join-pack provider is disposed');
    if (pending.size >= 8) throw new Error('Too many pending game-pack negotiations');
    signal.throwIfAborted();
    const controller = new AbortController(), abort = (): void => controller.abort(signal.reason);
    pending.add(controller); signal.addEventListener('abort', abort, { once: true });
    const inbox = new Inbox(peer, controller.signal);
    let timer = setTimeout(() => controller.abort(new Error('Game-pack review timed out')), REVIEW_MS);
    const transfer = (): void => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('Game-pack transfer timed out')), TRANSFER_MS); };
    try { return await work(inbox, controller.signal, transfer); }
    catch (error) { inbox.fail(error instanceof Error ? error.message : String(error)); throw error; }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); pending.delete(controller); }
  }
  return {
    client(peer, port, signal) {
      return run(peer, signal, async (inbox, signal, transfer) => {
        let stage: JoinStage | undefined;
        try {
          const first = await inbox.next(), message = parse(first);
          if (message.t === 'info') return { peer: inbox.handoff(first) }; // Explicit unchanged legacy flight route.
          if (message.t !== 'offer' || message.protocol !== PROTOCOL) throw new Error('Unsupported prejoin protocol');
          const offer = validateOffer(message.offer);
          if (!port.allowRuntimeCode && offer.packages.some(item => item.containsCode)) throw new Error('This build does not allow the offered code modules');
          if (!await port.approved(offer) && !await port.review(offer, signal)) throw new Error('Game-pack installation cancelled');
          signal.throwIfAborted(); transfer();
          let bytes = await port.cached(offer); signal.throwIfAborted();
          if (!bytes || bytes.length !== offer.packBytes || sha256Bytes(bytes) !== offer.packDigest) {
            bytes = new Uint8Array(offer.packBytes);
            peer.send(JSON.stringify({ t: 'request', protocol: PROTOCOL, offer: offer.id }));
            let offset = 0, sequence = 0;
            while (offset < bytes.length) {
              const chunk = parse(await inbox.next());
              if (chunk.t !== 'chunk' || chunk.offer !== offer.id || chunk.seq !== sequence || typeof chunk.data !== 'string') throw new Error('Out-of-order or changed game pack');
              const data = unbase64(chunk.data);
              if (data.length !== Math.min(CHUNK, bytes.length - offset)) throw new Error('Game-pack chunk size mismatch');
              bytes.set(data, offset); offset += data.length; port.progress?.(offset, bytes.length);
              peer.send(JSON.stringify({ t: 'ack', protocol: PROTOCOL, offer: offer.id, seq: sequence++ }));
            }
            if (sha256Bytes(bytes) !== offer.packDigest) throw new Error('Game-pack digest mismatch');
          }
          signal.throwIfAborted();
          stage = await port.stage(offer, bytes, signal); signal.throwIfAborted();
          // Host rechecks its enabled lock/pack before allowing verified installation/publication.
          peer.send(JSON.stringify({ t: 'ready', protocol: PROTOCOL, offer: offer.id }));
          const ready = parse(await inbox.next());
          if (ready.t !== 'ready' || ready.offer !== offer.id || ready.protocol !== PROTOCOL) throw new Error('The host changed its game pack; review the new offer');
          await port.remember(offer, bytes, signal); signal.throwIfAborted();
          peer.send(JSON.stringify({ t: 'join', protocol: PROTOCOL, offer: offer.id }));
          return { peer: inbox.handoff(), stage };
        } catch (error) { stage?.dispose(); throw error; }
      });
    },
    host(peer, source, accept, signal) {
      return run(peer, signal, async (inbox, signal, transfer) => {
        const current = await source.current(signal), offer = validateOffer(current.offer), bytes = current.bytes.slice(); signal.throwIfAborted();
        if (bytes.length !== offer.packBytes || sha256Bytes(bytes) !== offer.packDigest) throw new Error('Host game-pack source differs from its offer');
        peer.send(JSON.stringify({ t: 'offer', protocol: PROTOCOL, offer }));
        let message = parse(await inbox.next());
        if (message.protocol !== PROTOCOL || message.offer !== offer.id) throw new Error('Game-pack offer changed or unsupported client');
        if (message.t === 'request') {
          transfer();
          for (let offset = 0, seq = 0; offset < bytes.length; offset += CHUNK, seq++) {
            signal.throwIfAborted();
            peer.send(JSON.stringify({ t: 'chunk', protocol: PROTOCOL, offer: offer.id, seq, data: base64(bytes.subarray(offset, offset + CHUNK)) }));
            const ack = parse(await inbox.next());
            if (ack.t !== 'ack' || ack.protocol !== PROTOCOL || ack.offer !== offer.id || ack.seq !== seq) throw new Error('Invalid game-pack acknowledgment');
          }
          message = parse(await inbox.next());
        }
        if (message.t !== 'ready' || message.protocol !== PROTOCOL || message.offer !== offer.id) throw new Error('Game-pack negotiation rejected');
        const refreshed = await source.current(signal); signal.throwIfAborted();
        if (refreshed.offer.id !== offer.id || refreshed.offer.packDigest !== offer.packDigest || refreshed.offer.fingerprint !== offer.fingerprint
          || refreshed.offer.lockDigest !== offer.lockDigest) throw new Error('The host changed its game pack; review the new offer');
        peer.send(JSON.stringify({ t: 'ready', protocol: PROTOCOL, offer: offer.id }));
        const join = parse(await inbox.next());
        if (join.t !== 'join' || join.protocol !== PROTOCOL || join.offer !== offer.id) throw new Error('Game-pack join rejected');
        signal.throwIfAborted(); accept(inbox.handoff());
      });
    },
    dispose() { if (disposed) return; disposed = true; for (const controller of pending) controller.abort(new Error('Join-pack provider disposed')); pending.clear(); },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Install on join', summary: 'Bounded, versioned negotiation before session construction and exact package approval.', asset: 'docs/creators/usage.json' });
  context.provide(JOIN_PACKS, context.own(createJoinPacks()));
}
