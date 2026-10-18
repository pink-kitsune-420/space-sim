import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { TransportProvider } from './platform';

export interface SessionGreeting {
  readonly name: string; readonly players: number; readonly maxPlayers: number;
  readonly password: boolean; readonly protocol: string; readonly model?: string;
}
export interface FoundSession {
  readonly address: string; readonly name: string; readonly players: number; readonly maxPlayers: number;
  readonly password: boolean; readonly compatible: boolean;
}
export interface LanScanOptions {
  readonly concurrency?: number; readonly timeoutMs?: number; readonly signal?: AbortSignal;
  readonly onfound?: (server: FoundSession) => void; readonly onprogress?: (done: number, total: number) => void;
}
export interface LanDiscoveryOptions {
  readonly timeoutMs?: number; readonly concurrency?: number; readonly maxGreetingLength?: number;
  /** Borrowed provider; discovery owns only its own probes and connections. */
  readonly transport: TransportProvider;
  readonly protocolId: string; readonly modelId?: string;
  /** Explicit bounded protocol adapter. A transport alone does not imply compatible state. */
  greeting(text: string): SessionGreeting | undefined;
}
export interface LanDiscovery extends Disposable {
  probe(address: string, timeoutMs?: number, signal?: AbortSignal): Promise<FoundSession | undefined>;
  scan(candidates: readonly string[], options?: LanScanOptions): Promise<FoundSession[]>;
}
export interface LanDiscoveryFactory {
  create(options: LanDiscoveryOptions): LanDiscovery;
  candidates(hints: readonly string[], port: number): string[];
}
export const LAN_DISCOVERY: ServiceKey<LanDiscoveryFactory> = Object.freeze({ slot: 'net.lan-discovery', version: '1.0.0' });
