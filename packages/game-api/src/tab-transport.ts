import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { DiscoveryProvider, TextConnection, TransportProvider } from './platform';

/**
 * Message channel abstraction for intra-browser communication (e.g. `BroadcastChannel`).
 */
export interface TabChannel {
  /** Post a message object across all listeners on this channel name. */
  postMessage(message: unknown): void;
  /** Close and release this channel instance. */
  close(): void;
  /** Handler receiving incoming message events. */
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}
/** Web Locks API abstraction for leader election and mutual exclusion between browser tabs. */
export interface TabLocks {
  /** Request an exclusive or shared lock by name. */
  request(name: string, options: { readonly signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}
/** Options for configuring a scoped same-origin tab network instance. */
export interface TabNetworkOptions {
  /** Namespace or game scope partitioning BroadcastChannels and Web Locks. */
  readonly scope: string;
  /** Session protocol identifier (e.g. `space-sim-flight/1`). */
  readonly protocolId: string;
  /** Optional channel factory. Defaults to native `BroadcastChannel` in browser environments. */
  readonly channel?: (name: string) => TabChannel;
  /** Optional lock adapter. Defaults to `navigator.locks`. Null disables Web Locks. */
  readonly locks?: TabLocks | null;
  /** Heartbeat interval in milliseconds when Web Locks are unavailable. */
  readonly beatMs?: number;
  /** Inactivity timeout in milliseconds before considering an idle peer disconnected. */
  readonly timeoutMs?: number;
  /** Maximum wait in milliseconds for a host tab to answer a connection handshake. */
  readonly connectTimeoutMs?: number;
  /** Maximum message text length in UTF-16 code units. */
  readonly maxTextLength?: number;
}
/** Broadcast advertisement published by a hosting tab. */
export interface TabAdvert {
  /** 32-character hexadecimal host identifier. */
  readonly host: string;
  /** Human-readable session name. */
  readonly name: string;
  /** Unique session identifier. */
  readonly sessionId: string;
  /** Current count of players in the session. */
  readonly players: number;
  /** Maximum players accepted by the host. */
  readonly maxPlayers: number;
}
/** Handle representing a hosting session in this tab. */
export interface TabHost extends Disposable {
  /** 32-character hexadecimal host address key. */
  readonly key: string;
  /** Force an immediate broadcast announcement of current session status. */
  announce(): void;
}
/** Active discovery subscription observing tab session advertisements. */
export interface TabDiscovery extends Disposable {
  /** Return snapshot of currently active tab session adverts. */
  adverts(): readonly TabAdvert[];
}
/**
 * Tab transport network instance providing scoped peer-to-peer connections and discovery across browser tabs.
 */
export interface TabNetwork extends TransportProvider, Disposable {
  /** Scope partitioning this tab network. */
  readonly scope: string;
  /** Session protocol identifier. */
  readonly protocolId: string;
  /** Discovery provider for scanning advertised sessions within this scope. */
  readonly discovery: DiscoveryProvider;
  /** Advertise and host a session from this tab, accepting incoming peer connections. */
  host(describe: () => Omit<TabAdvert, 'host'>, accept: (peer: TextConnection) => void, signal: AbortSignal): TabHost;
  /** Watch for active tab hosts, invoking change callback whenever adverts update. */
  watch(change: (adverts: readonly TabAdvert[]) => void, signal: AbortSignal): TabDiscovery;
}
/** Factory creating scoped TabNetwork instances. */
export interface TabNetworkFactory {
  /** Create a scoped tab network instance with the provided options. */
  create(options: TabNetworkOptions): TabNetwork;
}
/** ServiceKey for the scoped tab transport factory (slot `net.tab`). */
export const TAB_TRANSPORT: ServiceKey<TabNetworkFactory> = Object.freeze({ slot: 'net.tab', version: '1.0.0' });
