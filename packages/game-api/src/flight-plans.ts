import type { ServiceKey } from './modules-v2';
import type { WorldRead } from './engine';
import type { Ship } from './world';
import type { GhostEnd, GhostSample, State, Vec } from './state';

/** Portable SI intent only. No engine, warp, controls or execution state is persisted. */
export interface FlightPlanNode {
 readonly id: string; readonly label: string; readonly bodyId: string;
 readonly time: number; readonly prograde: number; readonly radial: number;
 readonly completed?: boolean;
 readonly alarm?: import('./alarms').NodeAlarmSettings;
}
export interface FlightPlan {
 readonly shipId: string; readonly universeId: string; readonly systemId: string;
 readonly fingerprint: string; readonly motionIdentity: string; readonly bodyId: string;
 readonly epoch: { readonly time: number; readonly position: Vec; readonly velocity: Vec; readonly heading: number };
 readonly nodes: readonly FlightPlanNode[];
}
export interface FlightPlanArchive { readonly format: 'space-sim-flight-plans/1'; readonly plans: readonly FlightPlan[] }
export interface EvaluatedFlightNode {
 readonly intent: FlightPlanNode; readonly valid: boolean; readonly reason: string;
 /** Incoming coast seed and state at the burn. All coordinates are local to bodyId. */
 readonly seed?: State; readonly before?: State; readonly after?: State; readonly delta?: Vec;
}
/** Bounded inert intent/codec and selected-provider orbital evaluation, without UI or execution. */
export interface FlightPlanService {
 capture(world: WorldRead, ship: Ship, nodes: readonly FlightPlanNode[]): FlightPlan;
 read(raw: unknown): FlightPlanArchive;
 evaluate(plan: FlightPlan, world: WorldRead): readonly EvaluatedFlightNode[];
 /** Progressive chained preview through the shared world predictor; cancellation closes its child job. */
 predict(plan: FlightPlan, world: WorldRead): Generator<GhostSample, GhostEnd>;
}
export const FLIGHT_PLANS: ServiceKey<FlightPlanService> = Object.freeze({ slot: 'flight.plans', version: '1.0.0' });
