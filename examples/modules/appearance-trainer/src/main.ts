import { captureVehicleAppearance, createVehicleArtwork, type ModuleInitializationV2, type ServiceKey, type VehicleAppearance, type VehicleArtwork } from '@space-sim/game-api';

export const scoutAppearance: VehicleAppearance = captureVehicleAppearance({
  vehicleId: 'example.probe/scout-probe',
  hull: [
    { x: 8, y: 0 },
    { x: -5, y: -4 },
    { x: -2, y: 0 },
    { x: -5, y: 4 },
  ],
  flame: { x: -5, halfWidth: 2, length: 6, throttleLength: 10 },
});

export interface VehicleArtworkDetails {
  readonly found: boolean;
  readonly points: number;
  readonly hasFlame: boolean;
}

export interface VehicleArtworkCatalogHelper {
  lookup(artwork: VehicleArtwork, vehicleId?: string): VehicleArtworkDetails;
  compose(appearances: readonly VehicleAppearance[]): VehicleArtwork;
}

export const VEHICLE_ARTWORK_HELPER: ServiceKey<VehicleArtworkCatalogHelper> = Object.freeze({
  slot: 'example.trainer-appearance',
  version: '1.0.0',
});

export function createVehicleArtworkCatalogHelper(): VehicleArtworkCatalogHelper {
  return Object.freeze({
    lookup(artwork: VehicleArtwork, vehicleId?: string): VehicleArtworkDetails {
      const app = artwork.get(vehicleId);
      if (!app) return { found: false, points: 0, hasFlame: false };
      return {
        found: true,
        points: app.hull.length,
        hasFlame: app.flame !== undefined,
      };
    },
    compose(appearances: readonly VehicleAppearance[]): VehicleArtwork {
      return createVehicleArtwork(appearances);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.contributeVehicleAppearance(scoutAppearance);
  context.provide(VEHICLE_ARTWORK_HELPER, createVehicleArtworkCatalogHelper());
}
