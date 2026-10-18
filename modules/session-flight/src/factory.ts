import type { WorldControl, FlightSessionServices, SessionFactory, SessionHandle, SessionRead, LocalSessionControl } from '@space-sim/game-api';
import { LocalSession, RemoteSession } from './session';
import { ClientSession } from './client';
import { PROTOCOL } from './protocol';
import { readWorld } from './world-read';

function handle(session: LocalSession<WorldControl> | RemoteSession, dispose: () => void): SessionHandle {
  const world = readWorld(session.world);
  const view: SessionRead = {
    get kind() { return session.kind; }, get world() { return world; }, get playerId() { return session.playerId; },
    get paused() { return session.paused; }, get pauseReason() { return session.pauseReason; }, get warp() { return session.warp; },
    get requestedWarp() { return session.requestedWarp; }, get warpReason() { return session.warpReason; },
    get canWarp() { return session.canWarp; }, get alpha() { return session.alpha; },
    setWarp: session.setWarp.bind(session), previous: session.previous.bind(session), displayOffset: session.displayOffset.bind(session),
    update: session.update.bind(session), spawn: session.spawn.bind(session), respawn: session.respawn.bind(session), teleport: session.teleport.bind(session),
    remove: session.remove.bind(session), setThrottle: session.setThrottle.bind(session), setGodMode: session.setGodMode.bind(session),
    setGodModeAll: session.setGodModeAll.bind(session), command: session.command.bind(session), players: session.players.bind(session),
    playerName: session.playerName.bind(session), dataCommand: session.dataCommand.bind(session), chat: session.chat.bind(session),
    get onchat() { return session.onchat; }, set onchat(value) { session.onchat = value; },
  };
  let closed = false;
  return Object.freeze(Object.assign(Object.create(Object.freeze(view)) as SessionRead, { dispose() {
    if (closed) return; closed = true; dispose();
  } }));
}
/** Explicit flight session adapter; no DOM, renderer or application imports. */
export function createSessionFactory(services: FlightSessionServices): SessionFactory { return Object.freeze<SessionFactory>({
  protocol: PROTOCOL, entitySchema: 'space-sim-ships/1',
  local(world, options) {
    const session = new LocalSession(services, world, options);
    const local: LocalSessionControl = Object.freeze({
      get token() { return session.token; }, get hosting() { return session.hosting; },
      seatGuest: session.seatGuest.bind(session), unseatGuest: session.unseatGuest.bind(session), guestControls: session.guestControls.bind(session),
      spawnGuest: session.spawnGuest.bind(session), respawnGuest: session.respawnGuest.bind(session), setGuestThrottle: session.setGuestThrottle.bind(session),
      accept: session.accept.bind(session), setPaused: session.setPaused.bind(session), settle: session.settle.bind(session), catchUp: session.catchUp.bind(session),
      service: () => session.host.service(), snapshot: () => JSON.stringify(session.host.snapshot()), roster: () => session.host.roster(),
      close: (reason?: string) => session.host.close(reason),
    });
    return Object.freeze(Object.assign(Object.create(handle(session, () => session.dispose())) as SessionHandle, { local }));
  },
  async join(peer, options, signal) {
    signal.throwIfAborted();
    const client = new ClientSession(services, peer, options);
    return new Promise<SessionHandle>((resolve, reject) => {
      const abort = () => { client.leave(); reject(signal.reason ?? new Error('Join cancelled')); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      client.onjoined = () => {
        client.onjoined = null;
        if (signal.aborted) { abort(); return; }
        resolve(handle(new RemoteSession(client), () => { cleanup(); client.leave(); }));
      };
      client.onclose = reason => { cleanup(); reject(new Error(reason)); };
      if (signal.aborted) abort();
    });
  },
}); }
