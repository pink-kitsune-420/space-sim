import { TRAINER_VEHICLE_ID, type ModuleInitializationV2, type VehicleDefinition } from '@space-sim/game-api';
/** System defaults retain their existing authoritative precedence. */
export const trainer: VehicleDefinition = Object.freeze({ id: TRAINER_VEHICLE_ID, name: 'Orbit trainer' });
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeVehicle(trainer);
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Portable trainer', summary: 'Per-craft handling over shared physics, with explicit save/session identity.', asset: 'docs/creators/usage.json' });
  context.contributeGuide({ id: 'flight', audience: 'players', title: 'Orbit trainer flight', summary: 'Simple turn, throttle and engine controls.', asset: 'docs/players/flight.json' });
}
