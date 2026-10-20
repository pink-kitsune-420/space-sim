import { FLIGHT_SESSIONS, type FlightHost, type FlightHostSettings, type FlightSessionFactory, type ModuleInitializationV2, type ServiceKey, type WorldControl } from '@space-sim/game-api';

export interface FlightHostManager {
  startSession(world: WorldControl, settings?: Partial<FlightHostSettings>): FlightHost;
  stepSession(host: FlightHost, steps?: number): void;
}

export const FLIGHT_HOST_MANAGER: ServiceKey<FlightHostManager> = Object.freeze({
  slot: 'example.flight-session-host',
  version: '1.0.0',
});

export function createFlightHostManager(factory: FlightSessionFactory): FlightHostManager {
  return Object.freeze({
    startSession(world: WorldControl, settings?: Partial<FlightHostSettings>): FlightHost {
      return factory.host(world, settings);
    },
    stepSession(host: FlightHost, steps = 1): void {
      for (let i = 0; i < steps; i++) {
        host.step();
      }
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(FLIGHT_SESSIONS);
  context.provide(FLIGHT_HOST_MANAGER, createFlightHostManager(factory));
}
