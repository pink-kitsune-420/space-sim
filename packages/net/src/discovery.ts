/** Host-only LAN discovery composition adapter (`packages/net`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `DiscoveryProvider` or `LAN_DISCOVERY` (`net.lan-discovery@1.0.0`) from `@space-sim/game-api`. */
import type { LanScanOptions, FoundSession } from '../../game-api/src/index';
import { createLanDiscovery, lanCandidates as candidates } from '../../../modules/discovery-lan/src/index';
import { createWebSocketTransport } from '../../../modules/net-websocket/src/index';
import { DEFAULT_PORT } from './websocket';
import { PROTOCOL, parseHostMessage } from './protocol';
export { COMMON_SUBNETS } from '../../../modules/discovery-lan/src/candidates';
/** Discovered server descriptor alias for `FoundSession`. Modules use `FoundSession` from `@space-sim/game-api`. Host-only (`packages/net`). */
export type FoundServer = FoundSession;
/** Generates LAN candidate IP addresses and WebSocket endpoints for discovery. Modules use `LAN_DISCOVERY` (`net.lan-discovery@1.0.0`). Host-only (`packages/net`). */
export const lanCandidates = (hints: readonly string[] = [], port = DEFAULT_PORT): string[] => candidates(hints, port);
const transport = createWebSocketTransport();
const discovery = createLanDiscovery({ transport, protocolId: PROTOCOL, greeting(text) {
  const value = parseHostMessage(text); return value.t === 'info' ? value : undefined;
} });
/** Probes a single WebSocket server address for a flight greeting. Modules use `LAN_DISCOVERY.probe`. Host-only (`packages/net`). */
export const probeServer = (address: string, timeoutMs = 800): Promise<FoundServer | undefined> => discovery.probe(address, timeoutMs);
/** Scans a list of server addresses concurrently for active flight sessions. Modules use `LAN_DISCOVERY.scan`. Host-only (`packages/net`). */
export const scanServers = (addresses: readonly string[], options: LanScanOptions = {}): Promise<FoundServer[]> => discovery.scan(addresses, options);
