import { LAN_DISCOVERY, type FoundSession, type LanDiscoveryFactory, type LanScanOptions, type ModuleInitializationV2, type ServiceKey, type TransportProvider } from '@space-sim/game-api';

export interface LanScannerHelper {
  generateCandidates(hints: readonly string[], port: number): string[];
  scan(transport: TransportProvider, protocolId: string, candidates: readonly string[], options?: LanScanOptions): Promise<FoundSession[]>;
}

export const LAN_SCANNER: ServiceKey<LanScannerHelper> = Object.freeze({
  slot: 'example.lan-service-scanner',
  version: '1.0.0',
});

export function createLanScannerHelper(factory: LanDiscoveryFactory): LanScannerHelper {
  return Object.freeze({
    generateCandidates(hints: readonly string[], port: number): string[] {
      return factory.candidates(hints, port);
    },
    async scan(transport: TransportProvider, protocolId: string, candidates: readonly string[], options?: LanScanOptions): Promise<FoundSession[]> {
      const scanner = factory.create({
        transport,
        protocolId,
        greeting(text: string) {
          try {
            const data = JSON.parse(text);
            if (data && typeof data.name === 'string' && typeof data.protocol === 'string') {
              return {
                name: data.name,
                players: Number(data.players) || 0,
                maxPlayers: Number(data.maxPlayers) || 1,
                password: Boolean(data.password),
                protocol: data.protocol,
                model: typeof data.model === 'string' ? data.model : undefined,
              };
            }
          } catch {
            return undefined;
          }
          return undefined;
        },
      });
      try {
        return await scanner.scan(candidates, options);
      } finally {
        scanner.dispose();
      }
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(LAN_DISCOVERY);
  context.provide(LAN_SCANNER, createLanScannerHelper(factory));
}
