import {
  maneuverDelta,
  type GhostSample,
  type ManeuverPreview,
  type ModuleInitializationV2,
  type ServiceKey,
  type Vec,
} from '@space-sim/game-api';

export interface ManeuverSummary {
  readonly time: number;
  readonly deltaV: number;
  readonly valid: boolean;
  readonly completed: boolean;
  readonly nodeCount: number;
}

export interface ManeuverDisplayHelper {
  computeDelta(sample: GhostSample, prograde: number, radial: number): Vec;
  summarize(plan: ManeuverPreview): ManeuverSummary;
}

export const MANEUVER_DISPLAY_HELPER: ServiceKey<ManeuverDisplayHelper> = Object.freeze({
  slot: 'example.maneuver-display',
  version: '1.0.0',
});

export function createManeuverDisplayHelper(): ManeuverDisplayHelper {
  return Object.freeze({
    computeDelta(sample: GhostSample, prograde: number, radial: number): Vec {
      return maneuverDelta(sample, prograde, radial);
    },
    summarize(plan: ManeuverPreview): ManeuverSummary {
      const dv = Math.hypot(plan.deltaVelocity.x, plan.deltaVelocity.y);
      return {
        time: plan.time,
        deltaV: dv,
        valid: plan.valid,
        completed: plan.completed ?? false,
        nodeCount: plan.nodes?.length ?? 1,
      };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(MANEUVER_DISPLAY_HELPER, createManeuverDisplayHelper());
}
