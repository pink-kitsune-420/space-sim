import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { TransportProvider } from './platform';

/** Structured handshake greeting returned by an active game session server. */
export interface SessionGreeting {
  /** Human-readable session or world name. */
  readonly name: string;
  /** Current count of connected players. */
  readonly players: number;
  /** Maximum number of players accepted by the host. */
  readonly maxPlayers: number;
  /** Whether the session requires a password to join. */
  readonly password: boolean;
  /** Protocol identifier advertised by the server (e.g. `space-sim-flight/1`). */
  readonly protocol: string;
  /** Optional universe or physics model identifier. */
  readonly model?: string;
}
/** Discovered server endpoint record with verified protocol compatibility. */
export interface FoundSession {
  /** Target server URL or connection address. */
  readonly address: string;
  /** Human-readable session or world name. */
  readonly name: string;
  /** Current count of connected players. */
  readonly players: number;
  /** Maximum players accepted by the host. */
  readonly maxPlayers: number;
  /** Whether the server requires password authentication. */
  readonly password: boolean;
  /** Whether the server protocol and model match the client's expected requirements. */
  readonly compatible: boolean;
}
/** Options controlling a concurrent discovery scan across candidate addresses. */
export interface LanScanOptions {
  /** Maximum number of simultaneous probes (1–64, default 32). */
  readonly concurrency?: number;
  /** Timeout per candidate probe in milliseconds (1–60000, default 800). */
  readonly timeoutMs?: number;
  /** Abort signal cancelling pending and future candidate probes. */
  readonly signal?: AbortSignal;
  /** Callback invoked as each compatible or incompatible server responds. */
  readonly onfound?: (server: FoundSession) => void;
  /** Progress callback reporting (probesCompleted, totalCandidates). */
  readonly onprogress?: (done: number, total: number) => void;
}
/** Configuration options for a LAN discovery scanner instance. */
export interface LanDiscoveryOptions {
  /** Default probe timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Default concurrency limit for candidate scanning. */
  readonly concurrency?: number;
  /** Maximum characters accepted in a discovery greeting before aborting (default 16384). */
  readonly maxGreetingLength?: number;
  /** Borrowed transport provider used to establish probe connections. */
  readonly transport: TransportProvider;
  /** Expected session protocol identifier (e.g. `space-sim-flight/1`). */
  readonly protocolId: string;
  /** Optional model identifier to check for exact world model compatibility. */
  readonly modelId?: string;
  /** Protocol adapter parsing the initial server text message into a SessionGreeting. */
  greeting(text: string): SessionGreeting | undefined;
}
/** Active LAN discovery scanner instance. */
export interface LanDiscovery extends Disposable {
  /** Probe a single candidate address. Resolves with FoundSession if responding, or undefined on timeout/error. */
  probe(address: string, timeoutMs?: number, signal?: AbortSignal): Promise<FoundSession | undefined>;
  /** Concurrently scan a list of candidate addresses, returning all responding servers. */
  scan(candidates: readonly string[], options?: LanScanOptions): Promise<FoundSession[]>;
}
/** Factory creating LAN discovery scanner instances and generating candidate IP lists. */
export interface LanDiscoveryFactory {
  /** Create a new LanDiscovery instance configured with the given options. */
  create(options: LanDiscoveryOptions): LanDiscovery;
  /** Expand subnet hints and host addresses into candidate URLs with the specified port. */
  candidates(hints: readonly string[], port: number): string[];
}
/** ServiceKey for the LAN discovery factory (slot `net.lan-discovery`). */
export const LAN_DISCOVERY: ServiceKey<LanDiscoveryFactory> = Object.freeze({ slot: 'net.lan-discovery', version: '1.0.0' });
