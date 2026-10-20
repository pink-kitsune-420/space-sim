import {
  MANEUVER_BURNS,
  type Controls,
  type ManeuverBurnControl,
  type ManeuverBurnFactory,
  type ModuleInitializationV2,
  type ServiceKey,
  type State,
  type Vec,
  type VehicleDefaults,
} from '@space-sim/game-api';

export interface BurnStepResult {
  readonly phase: 'aligning' | 'waiting' | 'burning' | 'complete';
  readonly controls: Controls;
  readonly throttle?: number;
  readonly remaining: number;
}

export interface ManeuverBurnExecutor {
  createBurn(time: number, delta: Vec, vehicle: VehicleDefaults): ManeuverBurnControl;
  stepBurn(burn: ManeuverBurnControl, state: State): BurnStepResult;
}

export const MANEUVER_BURN_EXECUTOR: ServiceKey<ManeuverBurnExecutor> = Object.freeze({
  slot: 'example.maneuver-burn',
  version: '1.0.0',
});

export function createManeuverBurnExecutor(factory: ManeuverBurnFactory): ManeuverBurnExecutor {
  return Object.freeze({
    createBurn(time: number, delta: Vec, vehicle: VehicleDefaults): ManeuverBurnControl {
      return factory.create(time, delta, vehicle);
    },
    stepBurn(burn: ManeuverBurnControl, state: State): BurnStepResult {
      const result = burn.next(state);
      return {
        phase: burn.phase,
        controls: result.controls,
        throttle: result.throttle,
        remaining: burn.remaining,
      };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(MANEUVER_BURNS);
  context.provide(MANEUVER_BURN_EXECUTOR, createManeuverBurnExecutor(factory));
}
