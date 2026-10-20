import { LOCAL_PILOTS, type Disposable, type LocalPilotFactory, type LocalPilotHost,
  type ModuleInitializationV2, type PilotRegistry, type ServiceKey } from '@space-sim/game-api';

export interface PilotHostHelper {
  createRegistry(playerIds: readonly string[]): {
    registry: PilotRegistry & Disposable;
    devices: Map<number, string>;
    releases: number[];
  };
}

export const PILOT_HOST_HELPER: ServiceKey<PilotHostHelper> = Object.freeze({
  slot: 'example.headless-pilot-host',
  version: '1.0.0',
});

export function createPilotHostHelper(factory: LocalPilotFactory): PilotHostHelper {
  return Object.freeze({
    createRegistry(playerIds: readonly string[]) {
      const devices = new Map<number, string>();
      const releases: number[] = [];
      const host: LocalPilotHost = {
        count: () => Math.max(1, Math.min(4, playerIds.length)),
        playerId: pilot => playerIds[pilot],
        assign: (pilot, device) => { devices.set(pilot, device); },
        release: pilot => { releases.push(pilot ?? -1); },
      };
      const registry = factory.create(host);
      return { registry, devices, releases };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(LOCAL_PILOTS);
  context.provide(PILOT_HOST_HELPER, createPilotHostHelper(factory));
}
