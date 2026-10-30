import { TRAINER_VEHICLE_ID, captureVehicleAppearance, createVehicleArtwork, type ModuleInitializationV2 } from '@space-sim/game-api';
/** Default trainer chevron appearance artwork with screen-space hull and throttle flame dimensions. */
export const trainerAppearance = captureVehicleAppearance({ vehicleId: TRAINER_VEHICLE_ID,
  hull: [{ x: 11, y: 0 }, { x: -7, y: -6 }, { x: -4, y: 0 }, { x: -7, y: 6 }],
  flame: { x: -7, halfWidth: 3, length: 8, throttleLength: 15 } });
/* Original first-party survey lander artwork, licensed under this module's MIT license. */
/** Five-metre circular survey lander: SI protective hull, glazed cabin, engine bell, RCS ports and side hatch.
 * Its paired authoritative handling must request contactRadiusMetres=2.5. */
export const surveyLanderAppearance = captureVehicleAppearance({ vehicleId: TRAINER_VEHICLE_ID, metresPerUnit: 1,
  hull: Array.from({ length: 128 }, (_, i) => ({ x: 2.5 * Math.cos(i * Math.PI / 64), y: 2.5 * Math.sin(i * Math.PI / 64) })),
  lines: [
    // Pressure cabin glazing and a seated helmet/seat silhouette, all original vectors.
    [{ x: 1.8, y: -.65 }, { x: 1.8, y: .65 }, { x: .55, y: .95 }, { x: .55, y: -.95 }, { x: 1.8, y: -.65 }],
    Array.from({ length: 19 }, (_, i) => ({ x: 1.25 + .22 * Math.cos(i * Math.PI / 9), y: .22 * Math.sin(i * Math.PI / 9) })),
    [{ x: 1.03, y: 0 }, { x: .7, y: 0 }, { x: .45, y: .3 }, { x: .15, y: .3 }],
    [{ x: .95, y: -.3 }, { x: .2, y: -.3 }, { x: .2, y: .45 }],
    // Recessed main engine: narrow throat and expanding bell. Side ports are RCS.
    [{ x: -.75, y: -.2 }, { x: -1.25, y: -.2 }, { x: -1.55, y: -.3 }, { x: -2.2, y: -.7 },
      { x: -2.2, y: .7 }, { x: -1.55, y: .3 }, { x: -1.25, y: .2 }, { x: -.75, y: .2 }],
    [{ x: -.75, y: 0 }, { x: -.3, y: 0 }],
    [{ x: .1, y: -1.7 }, { x: -.2, y: -1.9 }, { x: -.2, y: -2.2 }, { x: .25, y: -2.2 }, { x: .25, y: -1.9 }, { x: .5, y: -1.7 }],
    [{ x: .5, y: 1.7 }, { x: .25, y: 1.9 }, { x: .25, y: 2.2 }, { x: -.2, y: 2.2 }, { x: -.2, y: 1.9 }, { x: .1, y: 1.7 }],
    // Two-metre side hatch, with its lower edge 0.6 m above level ground.
    [{ x: -1.9, y: 1.55 }, { x: .1, y: 1.55 }, { x: .1, y: 1.25 }, { x: -1.9, y: 1.25 }, { x: -1.9, y: 1.55 }],
    [{ x: -.9, y: -1.1 }, { x: -2.15, y: -1.2 }],
    [{ x: -.9, y: 1.1 }, { x: -2.15, y: 1.2 }],
  ],
  flame: { x: -2.2, halfWidth: .65, length: .4, throttleLength: 2 } });
/** Compatibility injection while default manifest startup remains Phase 4. */
export const trainerArtwork = createVehicleArtwork([trainerAppearance]);

/** Initialize the trainer appearance module, contributing vector vehicle artwork and registering its usage guides. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeVehicleAppearance(context.settings.surveyLander === 1 ? surveyLanderAppearance : trainerAppearance);
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Vehicle vector artwork', summary: 'Shared optional Canvas/WebGL hull and flame data.', asset: 'docs/creators/usage.json' });
  context.contributeGuide({ id: 'flight', audience: 'players', title: 'Trainer appearance', summary: 'The familiar trainer chevron, independent of physics.', asset: 'docs/players/flight.json' });
}
