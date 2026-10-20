import { FLIGHT_PROFILES, type ControllerProfile, type FlightControllerProfiles,
  type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export interface ProfileValidator {
  validateAndNormalize(raw: unknown): ControllerProfile;
  getDefaults(): ControllerProfile;
}

export const PROFILE_VALIDATOR: ServiceKey<ProfileValidator> = Object.freeze({
  slot: 'example.profile-normalizer',
  version: '1.0.0',
});

export function createProfileValidator(profiles: FlightControllerProfiles): ProfileValidator {
  return Object.freeze({
    validateAndNormalize(raw: unknown) {
      return profiles.normalize(raw);
    },
    getDefaults() {
      return profiles.defaultProfile;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const profiles = context.use(FLIGHT_PROFILES);
  context.provide(PROFILE_VALIDATOR, createProfileValidator(profiles));
}
