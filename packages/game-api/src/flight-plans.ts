import type { ServiceKey } from './modules-v2';
import type { WorldRead } from './engine';
import type { Ship } from './world';
import type { GhostEnd, GhostSample, State, Vec } from './state';

/** Maximum explicit planning horizon; default display forecasts retain their shorter cap. */
export const MAX_FLIGHT_PLAN_SECONDS = 100 * 365.25 * 86400;
/** Absolute-time comparisons remain below a fixed tick, including multi-year epochs. */
export const flightTimeTolerance = (time:number):number => Math.max(1e-7,Math.abs(time)*Number.EPSILON*4);

/** Portable SI intent only. No engine, warp, controls or execution state is persisted.
 * `time` is absolute simulation seconds; `prograde` and `radial` are impulse components in
 * m/s relative to the velocity at the node, in the frame of `bodyId`. */
export interface FlightPlanNode {
 readonly id: string; readonly label: string; readonly bodyId: string;
 readonly time: number; readonly prograde: number; readonly radial: number;
 readonly completed?: boolean;
 readonly alarm?: import('./alarms').NodeAlarmSettings;
 /** Use the selected finite-burn controller for progressive evaluation. */
 readonly finite?: boolean;
 /** Optional arrival goal, in SI metres above the destination's reference radius.
  * Intent only: never grants permission to coast, change a node, or ignite. */
 readonly targetOrbit?: { readonly periapsisAltitude:number; readonly apoapsisAltitude:number };
}
/** One ship's plan, bound to the world and motion model it was captured in. A changed
 * universe, system, simulation fingerprint or motion identity makes every node invalid
 * until the player reviews it. `epoch` is the coast start, local to `bodyId`. */
export interface FlightPlan {
 readonly shipId: string; readonly universeId: string; readonly systemId: string;
 readonly fingerprint: string; readonly motionIdentity: string; readonly bodyId: string;
 readonly epoch: { readonly time: number; readonly position: Vec; readonly velocity: Vec; readonly heading: number };
 readonly nodes: readonly FlightPlanNode[];
}
/** Portable `space-sim-flight-plans/1` archive containing up to 64 inert per-ship flight plans. */
export interface FlightPlanArchive { readonly format: 'space-sim-flight-plans/1'; readonly plans: readonly FlightPlan[] }
/** Per-node evaluation. An invalid node carries a readable `reason`; later nodes are not
 * evaluated past the first failure and repeat its reason. */
export interface EvaluatedFlightNode {
 readonly intent: FlightPlanNode; readonly valid: boolean; readonly reason: string;
 /** Incoming coast seed and state at the burn. All coordinates are local to bodyId. */
 readonly seed?: State; readonly before?: State; readonly after?: State; readonly delta?: Vec;
}
/** Progressive step yielded by `FlightPlanService.evaluateAsync` with the active node index and optional traced coast sample. */
export interface FlightPlanProgress { readonly node: number; readonly sample?: GhostSample }
/** Result of a detached finite-burn simulation in body-relative SI units (`after` state and `delta` velocity in `m/s`). */
export interface FiniteBurnResult {readonly after?:State;readonly delta?:Vec;readonly reason:string}
/** Result of refining an arrival capture node under a finite-burn controller in body-relative SI units. */
export interface FiniteCaptureResult {readonly node?:FlightPlanNode;readonly after?:State;readonly reason:string}
/** Bounded inert intent/codec and selected-provider orbital evaluation, without UI or execution. */
export interface FlightPlanService {
 /** Bind the host-selected controller for detached finite evaluation; no execution permission. */
 withBurns?(burns:import('./maneuver').ManeuverBurnFactory):FlightPlanService;
 /** Detached selected-controller validation; caller owns and cancels the generator. */
 simulateBurn?(world:WorldRead,ship:Ship,node:FlightPlanNode,burns:import('./maneuver').ManeuverBurnFactory):Generator<void,FiniteBurnResult>;
 refineCapture?(world:WorldRead,ship:Ship,node:FlightPlanNode,burns:import('./maneuver').ManeuverBurnFactory):Generator<void,FiniteCaptureResult>;
 /** Snapshot the ship's current coast and world identity as a new plan. Throws
  * `Flight plan: ...` for invalid nodes, like `read`. Never changes the world. */
 capture(world: WorldRead, ship: Ship, nodes: readonly FlightPlanNode[]): FlightPlan;
 /** Validate an untrusted `space-sim-flight-plans/1` archive (at most 64 plans of 16 nodes,
  * node times increasing and within 100 Julian years of the epoch). Unknown fields are
  * dropped. Throws an Error whose message starts with `Flight plan:`. */
 read(raw: unknown): FlightPlanArchive;
 /** Fast same-body compatibility evaluation; cross-body legs request progressive evaluation. */
 evaluate(plan: FlightPlan, world: WorldRead): readonly EvaluatedFlightNode[];
 /** Full bounded coast/contact/SOI and optional finite-burn evaluation; yields detached work. */
 evaluateAsync?(plan: FlightPlan, world: WorldRead, traceCoasts?: boolean): Generator<FlightPlanProgress, readonly EvaluatedFlightNode[]>;
 /** Progressive chained preview through the shared world predictor; cancellation closes its child job. */
 predict(plan: FlightPlan, world: WorldRead): Generator<GhostSample, GhostEnd>;
}
/** Shared flight-plan intent and evaluation, provided by `spacelab.flight-plans` in Space Sim. */
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
