import {
  TRANSFERS,
  type ModuleInitializationV2,
  type ServiceKey,
  type TransferPlanner,
  type TransferRelationship,
  type TransferRequest,
  type TransferResult,
  type WorldRead,
} from '@space-sim/game-api';

export interface TransferPlannerCapabilities {
  readonly relationships: readonly TransferRelationship[];
  readonly maxFlightSeconds?: number;
  readonly defaultFlightSeconds?: number;
  readonly parkingOrbits?: boolean;
}

export interface TransferPlannerHelper {
  getCapabilities(): TransferPlannerCapabilities;
  runSearch(world: WorldRead, request: TransferRequest, maxSteps?: number): TransferResult;
}

export const TRANSFER_PLANNER_HELPER: ServiceKey<TransferPlannerHelper> = Object.freeze({
  slot: 'example.transfer-planner',
  version: '1.0.0',
});

export function createTransferPlannerHelper(planner: TransferPlanner): TransferPlannerHelper {
  return Object.freeze({
    getCapabilities(): TransferPlannerCapabilities {
      return {
        relationships: planner.relationships ?? ['same-body', 'child', 'parent', 'sibling'],
        maxFlightSeconds: planner.maxFlightSeconds,
        defaultFlightSeconds: planner.defaultFlightSeconds,
        parkingOrbits: planner.parkingOrbits,
      };
    },
    runSearch(world: WorldRead, request: TransferRequest, maxSteps = 100): TransferResult {
      const generator = planner.search(world, request);
      let stepCount = 0;
      while (stepCount++ < maxSteps) {
        const next = generator.next();
        if (next.done) return next.value;
      }
      generator.return({ options: [], reason: 'Search stepped past maximum iterations.' });
      return { options: [], reason: 'Search stepped past maximum iterations.' };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const planner = context.use(TRANSFERS);
  context.provide(TRANSFER_PLANNER_HELPER, createTransferPlannerHelper(planner));
}
