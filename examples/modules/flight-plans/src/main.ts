import { FLIGHT_PLANS, type FlightPlanArchive, type FlightPlanService, type ModuleInitializationV2,
  type ServiceKey } from '@space-sim/game-api';

export interface PlanSummary {
  /** Readable lines for an untrusted space-sim-flight-plans/1 archive. Never throws. */
  describe(raw: unknown): readonly string[];
}
/** This example's own service, published for other modules or tests. */
export const PLAN_SUMMARY: ServiceKey<PlanSummary> = Object.freeze({ slot: 'example.plan-summary', version: '1.0.0' });

/** `plans` is undefined when the game enables no flight.plans provider. */
export function createPlanSummary(plans: FlightPlanService | undefined): PlanSummary {
  return Object.freeze({
    describe(raw: unknown): readonly string[] {
      if (!plans) return ['Flight plans are not available in this game.'];
      let archive: FlightPlanArchive;
      // read validates untrusted input and throws an Error starting with "Flight plan:".
      try { archive = plans.read(raw); } catch (error) { return [`Rejected. ${error instanceof Error ? error.message : String(error)}`]; }
      return archive.plans.flatMap(plan => [
        `${plan.shipId}: ${plan.nodes.length} node(s), starting around ${plan.bodyId}`,
        ...plan.nodes.map(node => `  ${node.label} at T+${(node.time - plan.epoch.time).toFixed(1)} s around ${node.bodyId}: `
          + `prograde ${node.prograde} m/s, radial ${node.radial} m/s`),
      ]);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  // flight.plans is declared optional, so tryUse returns undefined when nothing provides it.
  // An undeclared key, a wrong version or a failing provider still throws.
  context.provide(PLAN_SUMMARY, createPlanSummary(context.tryUse(FLIGHT_PLANS)));
}
