import type { ServiceKey } from './modules-v2';
import type { WorldRead } from './engine';
import type { FlightPlan } from './flight-plans';
export interface TransferRequest {
 readonly shipId: string; readonly destinationId: string;
 /** SI metres above the destination's reference radius. Equal values select a circle. */
 readonly periapsisAltitude: number; readonly apoapsisAltitude: number;
 /** Optional total search horizon from the source epoch, in SI seconds. */
 readonly maxFlightSeconds?: number;
 /** Staged routes park in a high orbit beside the neighbouring moon when true or
  * omitted; false keeps low parking near each stop body. Honoured when the provider
  * declares parkingOrbits. */
 readonly highParking?: boolean;
}
export interface TransferOption {
 readonly kind: 'efficient' | 'faster'; readonly plan: FlightPlan;
 readonly waitSeconds: number; readonly travelSeconds: number;
 readonly deltaV: number; readonly departureDeltaV: number; readonly arrivalDeltaV: number;
 readonly departureBurnSeconds: number; readonly arrivalBurnSeconds: number;
 readonly warning: string;
 /** Optional whole-route summary. IDs resolve through the same world hierarchy as the picker. */
 readonly route?: { readonly bodyIds:readonly string[];readonly stops:readonly string[];readonly maxFlightSeconds:number;readonly finiteValidated:boolean;readonly burns?:readonly {readonly nodeId:string;readonly deltaV:number;readonly seconds:number}[] };
}
export interface TransferProgress {
 /** Optional explanation of the leg or whole-route validation currently running. */
 readonly phase?: string;
 readonly tested: number; readonly total: number; readonly accepted: number;
 /** Fully validated best options so far; optional for existing providers.
  * A new array signals changed results. Search may continue after publication. */
 readonly options?: readonly TransferOption[];
}
export interface TransferResult {
 /** Fully validated whole-route alternatives, including those dominated by the displayed options. */
 readonly compared?: {readonly direct:number;readonly staged:number};
 readonly options: readonly TransferOption[]; readonly reason: string }
/** Inert bounded search; each next() performs one bounded candidate operation or shared
 * forecast yield. return() cancels owned forecasts/contexts. No controls or live stepping. */
export type TransferRelationship = 'same-body' | 'child' | 'parent' | 'sibling' | 'other';
export interface TransferPlanner {
 /** Bind the host-selected controller without a dependency on a higher module tier. */
 withBurns?(burns:import('./maneuver').ManeuverBurnFactory):TransferPlanner;
 /** Optional solver coverage for destination browsing. Absent: the search explains
  * suitability. A relationship being listed is not a feasibility guarantee. */
 readonly relationships?: readonly TransferRelationship[];
 /** Optional bounds for an explicit mission-duration input. */
 readonly maxFlightSeconds?:number;
 readonly defaultFlightSeconds?:number;
 /** True when search honours TransferRequest.highParking for intermediate stops. */
 readonly parkingOrbits?:boolean;
 search(world: WorldRead, request: TransferRequest): Generator<TransferProgress, TransferResult>;
}
export const TRANSFERS: ServiceKey<TransferPlanner> = Object.freeze({ slot: 'flight.transfers', version: '1.0.0' });
