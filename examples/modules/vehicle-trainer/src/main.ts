import {
  TRAINER_VEHICLE_ID,
  type ModuleInitializationV2,
  type ServiceKey,
  type VehicleDefinition,
} from '@space-sim/game-api';

export const exampleTrainer: VehicleDefinition = Object.freeze({
  id: 'example.vehicle-trainer/trainer-scout',
  name: 'Scout trainer variant',
  handling: Object.freeze({
    acceleration: 25,
    turnRate: 3.5,
    initialThrottle: 0,
  }),
});

export interface VehicleTrainerHelper {
  readonly defaultTrainerId: string;
  getCustomVehicle(): VehicleDefinition;
}

export const VEHICLE_TRAINER_HELPER: ServiceKey<VehicleTrainerHelper> = Object.freeze({
  slot: 'example.vehicle-trainer',
  version: '1.0.0',
});

export function createVehicleTrainerHelper(): VehicleTrainerHelper {
  return Object.freeze({
    defaultTrainerId: TRAINER_VEHICLE_ID,
    getCustomVehicle(): VehicleDefinition {
      return exampleTrainer;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.contributeVehicle(exampleTrainer);
  context.provide(VEHICLE_TRAINER_HELPER, createVehicleTrainerHelper());
}

/** Finite-radius handling for creators; match the hull artwork in metres. */
export const surveyHandling = Object.freeze({ acceleration: 24, turnRate: .65, initialThrottle: .65, contactRadiusMetres: 2.5 });
