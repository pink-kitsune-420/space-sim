import {
  FLIGHT_SPLIT,
  type FlightSplitFactory,
  type FlightSplitScreen,
  type FlightSplitScreenHost,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface FlightSplitHelper {
  createSplit(viewport: HTMLElement, host: FlightSplitScreenHost): FlightSplitScreen;
  pollJoining(split: FlightSplitScreen): void;
}

export const FLIGHT_SPLIT_HELPER: ServiceKey<FlightSplitHelper> = Object.freeze({
  slot: 'example.flight-split',
  version: '1.0.0',
});

export function createFlightSplitHelper(factory: FlightSplitFactory): FlightSplitHelper {
  return Object.freeze({
    createSplit(viewport: HTMLElement, host: FlightSplitScreenHost): FlightSplitScreen {
      // host.singleView may temporarily restrict the active seat without changing split.config.
      return factory.create(viewport, host);
    },
    pollJoining(split: FlightSplitScreen): void {
      split.pollPads();
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(FLIGHT_SPLIT);
  context.provide(FLIGHT_SPLIT_HELPER, createFlightSplitHelper(factory));
}
