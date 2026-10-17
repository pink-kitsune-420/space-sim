import { PROTOCOL, parseHostMessage } from './protocol';
import { DEFAULT_PORT, serverUrl } from './websocket';

/** A dedicated server that answered a probe. */
export interface FoundServer {
  /** What to type into Join: `host:port`. */
  readonly address: string;
  readonly name: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly password: boolean;
  /** Same protocol as this game; otherwise joining fails with a version message. */
  readonly compatible: boolean;
}

/** Open a WebSocket to `address` and read the server's greeting. Undefined when nothing
 * answers in time or the answer is not a Space Sim server. */
export function probeServer(address: string, timeoutMs = 800): Promise<FoundServer | undefined> {
  return new Promise(resolve => {
    let socket: WebSocket;
    try { socket = new WebSocket(serverUrl(address)); } catch { resolve(undefined); return; }
    let done = false;
    const finish = (found?: FoundServer): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(found);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.onmessage = event => {
      try {
        const info = typeof event.data === 'string' ? parseHostMessage(event.data) : undefined;
        if (info?.t !== 'info') { finish(); return; }
        finish({ address, name: info.name, players: info.players, maxPlayers: info.maxPlayers, password: info.password,
          compatible: info.protocol === PROTOCOL });
      } catch { finish(); }
    };
    socket.onerror = () => finish();
    socket.onclose = () => finish();
  });
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Private IPv4 ranges a home or office network uses. */
function privateSubnet(host: string): string | undefined {
  const m = IPV4.exec(host.trim());
  if (!m) return undefined;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const lan = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  return lan ? `${m[1]}.${m[2]}.${m[3]}` : undefined;
}
/** Browsers do not reveal this computer's address, so the scan tries the subnets of any
 * hint first (the page's own host, an address typed into Join), then the usual home ones. */
export const COMMON_SUBNETS: readonly string[] = ['192.168.1', '192.168.0', '10.0.0', '192.168.178'];

/** Addresses to probe, most likely first, each as `host:port`. */
export function lanCandidates(hints: readonly string[] = [], port = DEFAULT_PORT): string[] {
  const subnets: string[] = [];
  for (const hint of hints) {
    const host = hint.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');
    const subnet = privateSubnet(host);
    if (subnet && !subnets.includes(subnet)) subnets.push(subnet);
  }
  for (const subnet of COMMON_SUBNETS) if (!subnets.includes(subnet)) subnets.push(subnet);
  const out = [`localhost:${port}`];
  for (const subnet of subnets) for (let i = 1; i < 255; i++) out.push(`${subnet}.${i}:${port}`);
  return out;
}

/** Probe `candidates` a few at a time, reporting servers as they answer. Resolves with all
 * of them when done or aborted. */
export async function scanServers(candidates: readonly string[], options: {
  readonly concurrency?: number; readonly timeoutMs?: number; readonly signal?: AbortSignal;
  readonly onfound?: (server: FoundServer) => void; readonly onprogress?: (done: number, total: number) => void;
} = {}): Promise<FoundServer[]> {
  const found: FoundServer[] = [];
  let next = 0, done = 0;
  const worker = async (): Promise<void> => {
    while (next < candidates.length && !options.signal?.aborted) {
      const address = candidates[next++]!;
      const server = await probeServer(address, options.timeoutMs);
      done++;
      if (options.signal?.aborted) return;
      if (server) { found.push(server); options.onfound?.(server); }
      options.onprogress?.(done, candidates.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 32) }, worker));
  return found;
}
