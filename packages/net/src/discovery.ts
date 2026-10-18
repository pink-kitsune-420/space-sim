/** Legacy flight composition adapter. Generic discovery borrows transport and greeting codecs. */
import type { LanScanOptions, FoundSession } from '../../game-api/src/index';
import { createLanDiscovery, lanCandidates as candidates } from '../../../modules/discovery-lan/src/index';
import { createWebSocketTransport } from '../../../modules/net-websocket/src/index';
import { DEFAULT_PORT } from './websocket';
import { PROTOCOL, parseHostMessage } from './protocol';
export { COMMON_SUBNETS } from '../../../modules/discovery-lan/src/candidates';
export type FoundServer = FoundSession;
export const lanCandidates = (hints: readonly string[] = [], port = DEFAULT_PORT): string[] => candidates(hints, port);
const transport = createWebSocketTransport();
const discovery = createLanDiscovery({ transport, protocolId: PROTOCOL, greeting(text) {
  const value = parseHostMessage(text); return value.t === 'info' ? value : undefined;
} });
export const probeServer = (address: string, timeoutMs = 800): Promise<FoundServer | undefined> => discovery.probe(address, timeoutMs);
export const scanServers = (addresses: readonly string[], options: LanScanOptions = {}): Promise<FoundServer[]> => discovery.scan(addresses, options);
