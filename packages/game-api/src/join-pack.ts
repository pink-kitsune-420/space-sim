import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { TextConnection } from './platform';
import type { JoinOptions } from './session';
export interface JoinPackageRequirement {
  readonly id: string; readonly version: string; readonly digest: string; readonly bytes: number;
  readonly license: string; readonly containsCode: boolean; readonly sourceIncluded: boolean;
  readonly required: boolean; readonly tier: 'authoritative' | 'presentation' | 'platform' | 'network';
}
export interface JoinOffer {
  readonly format: 'spacelab-join-offer/1'; readonly id: string; readonly sessionId: string;
  readonly name: string; readonly protocol: string; readonly entitySchema: string; readonly model: string;
  readonly fingerprint: string; readonly lockDigest: string;
  readonly packDigest: string; readonly packBytes: number;
  readonly packages: readonly JoinPackageRequirement[];
}
/** Host adapter exports only the enabled distributable game; never an arbitrary library lookup. */
export interface JoinPackSource {
  current(signal: AbortSignal): Promise<{ readonly offer: JoinOffer; readonly bytes: Uint8Array }>;
}
/** Candidate has already passed whole-inventory validation and exact authority comparison.
 * activate publishes only after the authenticated session has joined successfully. */
export interface JoinStage extends Disposable {
  readonly options: JoinOptions;
  activate?(): void;
}
export interface JoinClientPort {
  readonly allowRuntimeCode: boolean;
  /** Approval is scoped to this source/session and exact offer, separate from cached bytes. */
  approved(offer: JoinOffer): Promise<boolean>;
  review(offer: JoinOffer, signal: AbortSignal): Promise<boolean>;
  cached(offer: JoinOffer): Promise<Uint8Array | undefined>;
  /** Validate inventory/code flags before evaluation; prepare in isolation, without publishing. */
  stage(offer: JoinOffer, bytes: Uint8Array, signal: AbortSignal): Promise<JoinStage>;
  /** Transactional verified installation/provenance and exact scoped approval, after staging. */
  remember(offer: JoinOffer, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  progress?(received: number, total: number): void;
}
export interface JoinNegotiation { readonly peer: TextConnection; readonly stage?: JoinStage }
export interface JoinPackFactory {
  /** Optional prejoin route; legacy hosts are passed to their existing session codec. */
  client(peer: TextConnection, port: JoinClientPort, signal: AbortSignal): Promise<JoinNegotiation>;
  /** Sends a versioned offer before handing the peer to the authenticated session. */
  host(peer: TextConnection, source: JoinPackSource, accept: (peer: TextConnection) => void, signal: AbortSignal): Promise<void>;
}
export const JOIN_PACKS: ServiceKey<JoinPackFactory> = Object.freeze({ slot: 'session.join-pack', version: '1.0.0' });
export interface JoinReviewService { review(offer: JoinOffer, address: string, signal: AbortSignal): Promise<boolean> }
export const JOIN_REVIEW: ServiceKey<JoinReviewService> = Object.freeze({ slot: 'ui.join-review', version: '1.0.0' });
