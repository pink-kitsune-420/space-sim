import type { Connection } from '../../../packages/net/src/connection';
import { connectWebSocket } from '../../../packages/net/src/websocket';

export interface DesktopHost {
  readonly addresses: readonly string[];
  readonly localAddress: string;
  stop(): void;
}

export const desktopHostToken = document.querySelector<HTMLMetaElement>('meta[name="space-sim-desktop"]')?.content;

/** Open the executable's LAN listener and bridge each incoming connection into the
 * existing LocalSession. No world serialization or second simulation is involved. */
export function hostOnComputer(accept: (connection: Connection) => void, onclose: (reason: string) => void): Promise<DesktopHost> {
  return new Promise((resolve, reject) => {
    const url = new URL('/desktop/host', location.href);
    url.protocol = 'ws:';
    url.searchParams.set('token', desktopHostToken ?? '');
    const control = new WebSocket(url);
    const peers = new Set<Connection>();
    let ready = false;
    let stopped = false;
    let failure = 'Could not start hosting on this computer.';
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      for (const peer of peers) peer.close('The host stopped hosting.');
      peers.clear();
      control.close();
    };
    const timer = setTimeout(() => { failure = 'The desktop host did not answer.'; stop(); reject(new Error(failure)); }, 15000);
    control.onmessage = event => {
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === 'ready' && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve({ addresses: data.addresses, localAddress: data.localAddress, stop });
        } else if (data.type === 'error') {
          failure = data.message;
        } else if (data.type === 'peer' && ready) {
          const peerUrl = new URL(`/desktop/peer/${data.id}`, url);
          peerUrl.search = url.search;
          void connectWebSocket(peerUrl.href).then(connection => {
            if (stopped) { connection.close(); return; }
            peers.add(connection);
            accept(connection);
            const closed = connection.onclose;
            connection.onclose = reason => { peers.delete(connection); closed?.(reason); };
          }).catch(() => { /* The remote peer times out if its bridge cannot open. */ });
        }
      } catch { failure = 'Invalid desktop host response.'; stop(); reject(new Error(failure)); }
    };
    control.onerror = () => { /* Followed by close. */ };
    control.onclose = event => {
      const wasStopped = stopped;
      stop();
      if (!ready) reject(new Error(failure));
      else if (!wasStopped) onclose(event.reason || 'Local hosting connection lost.');
    };
  });
}
