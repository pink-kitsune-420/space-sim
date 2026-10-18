import { LAN_DISCOVERY, type Disposable, type FoundSession, type LanDiscovery, type LanDiscoveryFactory, type LanDiscoveryOptions, type ModuleInitializationV2, type TextConnection } from '@space-sim/game-api';
import { lanCandidates } from './candidates';
export { lanCandidates, COMMON_SUBNETS } from './candidates';

export function createLanDiscovery(options: LanDiscoveryOptions): LanDiscovery {
  if (!options.protocolId || typeof options.greeting !== 'function') throw new Error('Discovery requires an explicit session protocol and greeting adapter');
  if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>60000)||options.concurrency!==undefined&&(!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>64)||options.maxGreetingLength!==undefined&&(!Number.isInteger(options.maxGreetingLength)||options.maxGreetingLength<1||options.maxGreetingLength>65536))throw new Error('Invalid discovery configuration');
  const pending = new Set<AbortController>(); let disposed = false;
  const discovery: LanDiscovery = {
    probe(address, timeoutMs = options.timeoutMs ?? 800, signal) {
      if (disposed) return Promise.reject(new Error('Discovery is disposed'));
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return Promise.reject(new Error('Invalid discovery timeout'));
      if (signal?.aborted) return Promise.resolve(undefined);
      return new Promise(resolve => {
        let done = false, peer: TextConnection | undefined;
        const controller = new AbortController(); pending.add(controller);
        const finish = (found?: FoundSession): void => {
          if (done) return; done = true;
          clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', abort);
          pending.delete(controller);
          try { if (peer) { peer.onmessage = null; peer.onclose = null; peer.close(); } }
          finally { controller.abort(); resolve(found); }
        };
        const abort = (): void => finish();
        const timer = setTimeout(abort, timeoutMs);
        signal?.addEventListener('abort', abort, { once: true }); controller.signal.addEventListener('abort', abort, { once: true });
        options.transport.connect(address, controller.signal).then(connection => {
          if (done) { connection.close(); return; }
          peer = connection; peer.onclose = abort;
          peer.onmessage = text => {
            if (done || disposed || signal?.aborted) return;
            try {
              if (text.length > (options.maxGreetingLength ?? 16384)) { finish(); return; }
              const greeting = options.greeting(text); if (!greeting) { finish(); return; }
              if (typeof greeting.name !== 'string' || greeting.name.length > 256 || !Number.isInteger(greeting.players) || greeting.players < 0
                || !Number.isInteger(greeting.maxPlayers) || greeting.maxPlayers < greeting.players || greeting.maxPlayers > 65536
                || typeof greeting.password !== 'boolean' || typeof greeting.protocol !== 'string') { finish(); return; }
              finish({ address, name: greeting.name, players: greeting.players, maxPlayers: greeting.maxPlayers, password: greeting.password,
                compatible: greeting.protocol === options.protocolId && (!options.modelId || greeting.model === options.modelId) });
            } catch { finish(); }
          };
        }, abort);
      });
    },
    async scan(candidates, scan = {}) {
      const concurrency = scan.concurrency ?? options.concurrency ?? 32;
      if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('Discovery concurrency must be 1–64');
      const found: FoundSession[] = []; let next = 0, done = 0;
      const worker = async (): Promise<void> => {
        while (next < candidates.length && !disposed && !scan.signal?.aborted) {
          const address = candidates[next++]!, server = await discovery.probe(address, scan.timeoutMs, scan.signal); done++;
          if (disposed || scan.signal?.aborted) return;
          if (server) { found.push(server); scan.onfound?.(server); }
          scan.onprogress?.(done, candidates.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker)); return found;
    },
    dispose() { if (disposed) return; disposed = true; for (const controller of pending) controller.abort(); pending.clear(); },
  };
  return discovery;
}
export function createLanDiscoveryFactory(defaults:Pick<LanDiscoveryOptions,'timeoutMs'|'concurrency'|'maxGreetingLength'> = {}): LanDiscoveryFactory & Disposable {
  const instances = new Set<LanDiscovery>(); let disposed = false;
  return { candidates: lanCandidates,
    create(options) {
      if (disposed) throw new Error('Discovery factory is disposed');
      const instance = createLanDiscovery({...defaults,...options}), dispose = instance.dispose.bind(instance);
      instance.dispose = () => { instances.delete(instance); dispose(); }; instances.add(instance); return instance;
    },
    dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
      for (const instance of instances) { try { instance.dispose(); } catch (error) { errors.push(error); } }
      instances.clear(); if (errors.length) throw new AggregateError(errors, 'Discovery provider cleanup failed'); },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'LAN discovery', summary: 'Borrowed text transports and explicit greeting codecs; no world dependencies.', asset: 'docs/creators/usage.json' });
  context.provide(LAN_DISCOVERY, context.own(createLanDiscoveryFactory({timeoutMs:context.settings.timeoutMs,concurrency:context.settings.concurrency,maxGreetingLength:context.settings.maxGreetingLength})));
}
