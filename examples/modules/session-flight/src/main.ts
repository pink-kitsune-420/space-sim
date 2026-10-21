import { FLIGHT_SESSIONS, type FlightHost, type FlightHostSettings, type FlightSessionFactory, type ModuleInitializationV2, type ServiceKey, type WorldControl, type PresentationView, type PresentationControlTarget } from '@space-sim/game-api';

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

/** Consume the current hook view only; no world/session or caller-selected ship ID.
 * The owning game must register commandId and its numeric parameter schema. */
export function issueViewTool(view: PresentationView, commandId: string, args?: Readonly<Record<string, number>>): boolean {
  return view.commands?.issue(commandId, args) ?? false;
}

/** A layer's controlTarget callback may return this while its owned astronaut is active.
 * The game registers commandId with numeric turn/throttle/engine parameters. */
export function astronautControlTarget(shipId: string, commandId: string): PresentationControlTarget {
  return { entityId: `${shipId}/astronaut`, commandId };
}
