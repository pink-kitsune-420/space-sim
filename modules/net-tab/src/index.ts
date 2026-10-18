import { TAB_TRANSPORT, type Disposable, type ModuleInitializationV2, type TabAdvert, type TabDiscovery, type TabNetwork, type TabNetworkOptions, type TextConnection } from '@space-sim/game-api';
import { connectLocal, DEFAULT_MAX_TEXT_LENGTH, LocalDiscovery, LocalHost, type LocalAdvert, type LocalOptions } from './connection';

const advert = (wire: LocalAdvert): TabAdvert => ({ host: wire.host, name: wire.name, sessionId: wire.worldId, players: wire.players, maxPlayers: wire.maxPlayers });
function validate(options: TabNetworkOptions): void {
  for (const id of [options.scope, options.protocolId]) if (typeof id !== 'string' || !id.length || id.length > 128 || /[\x00-\x1f]/.test(id))
    throw new Error('Tab transport requires a bounded explicit scope and session protocol ID');
  if (options.channel !== undefined && typeof options.channel !== 'function' || options.locks !== undefined && options.locks !== null && typeof options.locks.request !== 'function')
    throw new Error('Invalid tab IO provider');
  for (const value of [options.beatMs, options.timeoutMs, options.connectTimeoutMs]) if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 300000))
    throw new Error('Invalid tab transport timing');
  if (options.maxTextLength !== undefined && (!Number.isSafeInteger(options.maxTextLength) || options.maxTextLength < 1 || options.maxTextLength > DEFAULT_MAX_TEXT_LENGTH))
    throw new Error('Invalid tab text limit');
}
function hostKey(address: string): string {
  const key = address.startsWith('tab://') ? address.slice(6) : address;
  if (!/^[0-9a-f]{32}$/.test(key)) throw new Error('Invalid tab host address'); return key;
}
/** A scope is shared by channels and locks, never inferred from a flight world. */
export function createTabNetwork(config: TabNetworkOptions, stopped: () => void = () => {}): TabNetwork {
  validate(config); const options = Object.freeze({ ...config });
  const io: LocalOptions = { ...options, channelName: `spacelab-tab/1/${encodeURIComponent(options.scope)}/${encodeURIComponent(options.protocolId)}` };
  const resources = new Set<Disposable>(); let disposed = false;
  const ready = (signal: AbortSignal): void => { if (disposed || signal.aborted) throw new Error('Tab network is disposed or cancelled'); };
  function own<T extends Disposable>(resource: T, signal: AbortSignal, onStop: () => void = () => {}): T {
    let closed = false;
    const managed = { ...resource, dispose() {
      if (closed) return; closed = true; resources.delete(managed); signal.removeEventListener('abort', abort);
      try { resource.dispose(); } finally { onStop(); }
    } };
    const abort = (): void => managed.dispose(); resources.add(managed); signal.addEventListener('abort', abort, { once: true });
    if (disposed || signal.aborted) { managed.dispose(); throw new Error('Tab network is disposed or cancelled'); }
    return managed;
  }
  function watch(change: (adverts: readonly TabAdvert[]) => void, signal: AbortSignal, onStop?: () => void): TabDiscovery {
    ready(signal); const discovery = new LocalDiscovery(worlds => change(worlds.map(advert)), io);
    return own({ adverts: () => discovery.worlds().map(advert), dispose: () => discovery.close() }, signal, onStop);
  }
  const network: TabNetwork = {
    name: 'tab', schemes: Object.freeze(['tab']), scope: options.scope, protocolId: options.protocolId,
    async connect(address, signal) {
      ready(signal); const key = hostKey(address), controller = new AbortController();
      let raw: TextConnection | undefined;
      const lease = own({ dispose() { try { raw?.close(signal.aborted ? 'Connection cancelled.' : 'Module disposed'); } finally { controller.abort(); } } }, signal);
      try {
        raw = await connectLocal(key, { ...io, signal: controller.signal });
        if (disposed || signal.aborted) { lease.dispose(); throw new Error('Tab connection cancelled'); }
        let closed = false, handler: TextConnection['onmessage'] = null;
        const peer: TextConnection = { label: raw.label, get bufferedAmount() { return raw!.bufferedAmount; },
          send(text) { if (!closed) raw!.send(text); }, close(reason) { if (closed) return; try { raw!.close(reason); } finally { lease.dispose(); } },
          get onmessage() { return handler; }, set onmessage(value) { handler = value; raw!.onmessage = value ? text => { if (!closed) value(text); } : null; }, onclose: null };
        raw.onclose = reason => { if (closed) return; closed = true; lease.dispose(); peer.onclose?.(reason); };
        return peer;
      } catch (error) { lease.dispose(); throw error; }
    },
    host(describe, accept, signal) {
      ready(signal);
      const host = new LocalHost(() => {
        const value = describe();
        if (typeof value.name !== 'string' || value.name.length > 80 || typeof value.sessionId !== 'string' || !value.sessionId.length || value.sessionId.length > 64
          || !Number.isSafeInteger(value.players) || value.players < 0 || !Number.isSafeInteger(value.maxPlayers) || value.maxPlayers < 1 || value.players > value.maxPlayers)
          throw new Error('Invalid tab session advertisement');
        return { name: value.name, worldId: value.sessionId, players: value.players, maxPlayers: value.maxPlayers };
      }, peer => { if (disposed || signal.aborted) peer.close('Host cancelled'); else accept(peer); }, io);
      return own({ key: host.key, announce: () => host.announce(), dispose: () => host.close() }, signal);
    },
    watch,
    discovery: { name: 'tab', scan(emit, signal) {
      return new Promise<void>((resolve, reject) => {
        let watcher: TabDiscovery | undefined, failed = false;
        try {
          watcher = watch(adverts => {
            try { for (const value of adverts) emit({ id: value.host, name: value.name, address: `tab://${value.host}`, players: value.players, maxPlayers: value.maxPlayers, protocol: options.protocolId }); }
            catch (error) { failed = true; reject(error); watcher?.dispose(); }
          }, signal, () => { if (!failed) resolve(); });
          if (failed) watcher.dispose();
        } catch (error) { reject(error); }
      });
    } },
    dispose() {
      if (disposed) return; disposed = true; const errors: unknown[] = [];
      for (const resource of [...resources]) { try { resource.dispose(); } catch (error) { errors.push(error); } }
      resources.clear(); stopped(); if (errors.length) throw new AggregateError(errors, 'Tab network cleanup failed');
    },
  };
  return network;
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Scoped tab transport',
    summary: 'Same-origin text links and discovery scoped by game and session protocol.', asset: 'docs/creators/usage.json' });
  if((context.settings.idleTimeoutMs??30000)<=(context.settings.beatMs??2000))throw new Error('Tab peer timeout must exceed its heartbeat interval');
  const networks = new Set<TabNetwork>(); let disposed = false;
  context.own({ dispose() {
    if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const network of [...networks]) { try { network.dispose(); } catch (error) { errors.push(error); } }
    networks.clear(); if (errors.length) throw new AggregateError(errors, 'Tab transport cleanup failed');
  } });
  context.provide(TAB_TRANSPORT, { create(options) {
    if (disposed) throw new Error('Tab transport provider is disposed');
    const network = createTabNetwork({beatMs:context.settings.beatMs,timeoutMs:context.settings.idleTimeoutMs,maxTextLength:context.settings.maxTextLength,...options,connectTimeoutMs:options.connectTimeoutMs??options.timeoutMs??context.settings.connectTimeoutMs}, () => networks.delete(network)); networks.add(network); return network;
  } });
}
