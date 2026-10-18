import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { DiscoveryProvider, TextConnection, TransportProvider } from './platform';

export interface TabChannel {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}
export interface TabLocks {
  request(name: string, options: { readonly signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}
export interface TabNetworkOptions {
  readonly scope: string;
  readonly protocolId: string;
  /** Borrowed IO factory. Each returned channel is owned by the network instance. */
  readonly channel?: (name: string) => TabChannel;
  /** Null disables Web Locks; heartbeats remain available. */
  readonly locks?: TabLocks | null;
  readonly beatMs?: number;
  readonly timeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxTextLength?: number;
}
export interface TabAdvert {
  readonly host: string;
  readonly name: string;
  readonly sessionId: string;
  readonly players: number;
  readonly maxPlayers: number;
}
export interface TabHost extends Disposable {
  readonly key: string;
  announce(): void;
}
export interface TabDiscovery extends Disposable { adverts(): readonly TabAdvert[] }
export interface TabNetwork extends TransportProvider, Disposable {
  readonly scope: string;
  readonly protocolId: string;
  readonly discovery: DiscoveryProvider;
  host(describe: () => Omit<TabAdvert, 'host'>, accept: (peer: TextConnection) => void, signal: AbortSignal): TabHost;
  watch(change: (adverts: readonly TabAdvert[]) => void, signal: AbortSignal): TabDiscovery;
}
export interface TabNetworkFactory { create(options: TabNetworkOptions): TabNetwork }
export const TAB_TRANSPORT: ServiceKey<TabNetworkFactory> = Object.freeze({ slot: 'net.tab', version: '1.0.0' });
