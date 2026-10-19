import type { ServiceKey } from './modules-v2';
import type { WorldRead } from './engine';
import type { FlightPlan } from './flight-plans';
export interface TransferRequest {
 readonly shipId: string; readonly destinationId: string;
 /** SI metres above the destination's reference radius. Equal values select a circle. */
 readonly periapsisAltitude: number; readonly apoapsisAltitude: number;
}
export interface TransferOption {
 readonly kind: 'efficient' | 'faster'; readonly plan: FlightPlan;
 readonly waitSeconds: number; readonly travelSeconds: number;
 readonly deltaV: number; readonly departureDeltaV: number; readonly arrivalDeltaV: number;
 readonly departureBurnSeconds: number; readonly arrivalBurnSeconds: number;
 readonly warning: string;
}
export interface TransferProgress { readonly tested: number; readonly total: number; readonly accepted: number }
export interface TransferResult { readonly options: readonly TransferOption[]; readonly reason: string }
/** Inert bounded search; each next() performs one bounded candidate operation or shared
 * forecast yield. return() cancels owned forecasts/contexts. No controls or live stepping. */
export interface TransferPlanner {
 search(world: WorldRead, request: TransferRequest): Generator<TransferProgress, TransferResult>;
}
export const TRANSFERS: ServiceKey<TransferPlanner> = Object.freeze({ slot: 'flight.transfers', version: '1.0.0' });
