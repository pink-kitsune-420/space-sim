import { TRAINER_VEHICLE_ID, captureVehicleAppearance, createVehicleArtwork, type ModuleInitializationV2 } from '@space-sim/game-api';
/** Default trainer chevron appearance artwork with screen-space hull and throttle flame dimensions. */
export const trainerAppearance = captureVehicleAppearance({ vehicleId: TRAINER_VEHICLE_ID,
  hull: [{ x: 11, y: 0 }, { x: -7, y: -6 }, { x: -4, y: 0 }, { x: -7, y: 6 }],
  flame: { x: -7, halfWidth: 3, length: 8, throttleLength: 15 } });
/** Compatibility injection while default manifest startup remains Phase 4. */
export const trainerArtwork = createVehicleArtwork([trainerAppearance]);

/** Initialize the trainer appearance module, contributing vector vehicle artwork and registering its usage guides. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeVehicleAppearance(trainerAppearance);
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Vehicle vector artwork', summary: 'Shared optional Canvas/WebGL hull and flame data.', asset: 'docs/creators/usage.json' });
  context.contributeGuide({ id: 'flight', audience: 'players', title: 'Trainer appearance', summary: 'The familiar trainer chevron, independent of physics.', asset: 'docs/players/flight.json' });
}
