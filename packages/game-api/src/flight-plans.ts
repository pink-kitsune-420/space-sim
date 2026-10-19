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
 /** Optional arrival goal, in SI metres above the destination's reference radius.
  * Intent only: never grants permission to coast, change a node, or ignite. */
 readonly targetOrbit?: { readonly periapsisAltitude:number; readonly apoapsisAltitude:number };
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
export interface FlightPlanProgress { readonly node: number; readonly sample?: GhostSample }
/** Bounded inert intent/codec and selected-provider orbital evaluation, without UI or execution. */
export interface FlightPlanService {
 capture(world: WorldRead, ship: Ship, nodes: readonly FlightPlanNode[]): FlightPlan;
 read(raw: unknown): FlightPlanArchive;
 /** Fast same-body compatibility evaluation; cross-body legs request progressive evaluation. */
 evaluate(plan: FlightPlan, world: WorldRead): readonly EvaluatedFlightNode[];
 /** Full bounded coast/contact/SOI evaluation, one shared forecast yield per step. */
 evaluateAsync?(plan: FlightPlan, world: WorldRead, traceCoasts?: boolean): Generator<FlightPlanProgress, readonly EvaluatedFlightNode[]>;
 /** Progressive chained preview through the shared world predictor; cancellation closes its child job. */
 predict(plan: FlightPlan, world: WorldRead): Generator<GhostSample, GhostEnd>;
}
export const FLIGHT_PLANS: ServiceKey<FlightPlanService> = Object.freeze({ slot: 'flight.plans', version: '1.0.0' });

/** Translate a timed sample between nonrotating body frames, including velocity.
 * bodyId remains the physical SOI. Encounter snapshots follow the sample frame. */
export function flightSampleInFrame(sample: GhostSample, frameId: string, system: import('./universe').LoadedSystem): GhostSample {
 const from=sample.frameId ?? sample.bodyId ?? frameId;
 if(from===frameId)return {...sample,frameId};
 const a=system.getBodyPosition(from,sample.time),b=system.getBodyPosition(frameId,sample.time),
  av=system.getBodyVelocity(from,sample.time),bv=system.getBodyVelocity(frameId,sample.time);
 return {...sample,frameId,position:{x:sample.position.x+(a.x-b.x),y:sample.position.y+(a.y-b.y)},
  velocity:{x:sample.velocity.x+(av.x-bv.x),y:sample.velocity.y+(av.y-bv.y)},
  ...(sample.encounterBody?{encounterBody:{...sample.encounterBody,position:{x:sample.encounterBody.position.x+(a.x-b.x),y:sample.encounterBody.position.y+(a.y-b.y)}}}:{})};
}
