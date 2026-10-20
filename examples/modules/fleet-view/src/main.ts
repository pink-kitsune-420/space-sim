import {
  FLEET_VIEWS,
  type FleetViewFactory,
  type FleetViewInput,
  type FleetViewStats,
  type FlightFleetView,
  type RenderShip,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface FleetViewerHelper {
  createFleet(): FlightFleetView;
  buildShips(view: FlightFleetView, input: FleetViewInput): RenderShip[];
  readStats(view: FlightFleetView): FleetViewStats;
}

export const FLEET_VIEWER_HELPER: ServiceKey<FleetViewerHelper> = Object.freeze({
  slot: 'example.fleet-view',
  version: '1.0.0',
});

export function createFleetViewerHelper(factory: FleetViewFactory): FleetViewerHelper {
  return Object.freeze({
    createFleet(): FlightFleetView {
      return factory.create();
    },
    buildShips(view: FlightFleetView, input: FleetViewInput): RenderShip[] {
      return view.build(input);
    },
    readStats(view: FlightFleetView): FleetViewStats {
      return view.stats;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(FLEET_VIEWS);
  context.provide(FLEET_VIEWER_HELPER, createFleetViewerHelper(factory));
}
