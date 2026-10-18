import { CORE_CLOCK, CORE_COMMANDS, CORE_MOTION, CORE_SAVE, CORE_WORLD, FLIGHT_SESSIONS,
  type Disposable, type FlightSessionFactory, type FlightSessionServices, type ModuleInitializationV2 } from '@space-sim/game-api';
import { createSessionFactory } from './factory';
import { HostSession } from './host';

/** One graph owns its sessions. Hosts borrow worlds; local/client sessions own theirs. */
export function createFlightSessions(services: FlightSessionServices): FlightSessionFactory & Disposable {
  const sessions = new Set<Disposable>(), pending = new Set<AbortController>(), base = createSessionFactory(services); let disposed = false;
  const check = (): void => { if (disposed) throw new Error('Flight session provider is disposed'); };
  function own<T extends Disposable>(resource: T): T {
    if (disposed) { resource.dispose(); throw new Error('Flight session provider is disposed'); }
    let ended = false; const release = resource.dispose.bind(resource);
    // Session handles are frozen projections; concrete hosts retain their original receiver.
    const owned = Object.isExtensible(resource) ? resource : Object.create(resource) as T;
    Object.defineProperty(owned, 'dispose', { value() {
      if (ended) return; ended = true; sessions.delete(owned); release();
    } });
    sessions.add(owned); return owned;
  }
  return {
    protocol: base.protocol, entitySchema: base.entitySchema,
    host(world, settings, options) { check(); return own(new HostSession(services, world, settings, options)); },
    local(world, options) { check(); return own(base.local(world, options)); },
    async join(peer, options, signal) {
      check(); signal.throwIfAborted();
      const controller = new AbortController(), abort = (): void => controller.abort(signal.reason);
      pending.add(controller); signal.addEventListener('abort', abort, { once: true });
      try {
        const session = await base.join(peer, options, controller.signal);
        const handle = Object.create(session) as typeof session;
        Object.defineProperty(handle, 'dispose', { configurable: true, value() {
          signal.removeEventListener('abort', abort); session.dispose();
        } });
        return own(handle);
      } catch (error) { signal.removeEventListener('abort', abort); throw error; }
      finally { pending.delete(controller); }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const controller of pending) controller.abort(new Error('Flight session provider is disposed'));
      pending.clear(); const errors: unknown[] = [];
      for (const session of sessions) { try { session.dispose(); } catch (error) { errors.push(error); } }
      sessions.clear(); if (errors.length) throw new AggregateError(errors, 'Flight session cleanup failed');
    },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Flight sessions',
    summary: 'Explicit flight protocol using privileged public engine ports and replaceable transports.', asset: 'docs/creators/usage.json' });
  const service = context.own(createFlightSessions({ world: context.use(CORE_WORLD), save: context.use(CORE_SAVE),
    clock: context.use(CORE_CLOCK), motion: context.use(CORE_MOTION), commands: context.use(CORE_COMMANDS) }));
  context.provide(FLIGHT_SESSIONS, service);
}
