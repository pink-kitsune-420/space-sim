import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { TextConnection } from './platform';
import type { JoinOptions } from './session';
/** Metadata description for one module package required by a server join offer. */
export interface JoinPackageRequirement {
  /** Unique module package identifier. */
  readonly id: string;
  /** Semver package version. */
  readonly version: string;
  /** SHA-256 digest of the module package contents. */
  readonly digest: string;
  /** Package file size in bytes. */
  readonly bytes: number;
  /** SPDX license expression or license reference. */
  readonly license: string;
  /** Whether the package contains executable code (requiring user security consent). */
  readonly containsCode: boolean;
  /** Whether source code sidecars are bundled inside the package. */
  readonly sourceIncluded: boolean;
  /** Whether this package is strictly required to join the session. */
  readonly required: boolean;
  /** Architectural tier of the module. */
  readonly tier: 'authoritative' | 'presentation' | 'platform' | 'network';
}
/** Pre-join offer sent by a server listing required module packages and session metadata. */
export interface JoinOffer {
  /** Join offer format schema identifier. */
  readonly format: 'spacelab-join-offer/1';
  /** Unique offer identifier hash. */
  readonly id: string;
  /** Unique server session identifier. */
  readonly sessionId: string;
  /** Human-readable session or world name. */
  readonly name: string;
  /** Session protocol identifier (e.g. `space-sim-flight/1`). */
  readonly protocol: string;
  /** Entity schema identifier (e.g. `space-sim-flight-entities/1`). */
  readonly entitySchema: string;
  /** World physics and universe model identifier. */
  readonly model: string;
  /** Fingerprint identifying the composition of active modules. */
  readonly fingerprint: string;
  /** SHA-256 digest of the lock file. */
  readonly lockDigest: string;
  /** SHA-256 digest of the combined game pack payload. */
  readonly packDigest: string;
  /** Total byte size of the combined game pack payload. */
  readonly packBytes: number;
  /** List of individual module packages included in this game pack. */
  readonly packages: readonly JoinPackageRequirement[];
}
/** Host adapter exporting the active distributable game pack; never an arbitrary file lookup. */
export interface JoinPackSource {
  /** Retrieve the current join offer and game pack archive bytes. */
  current(signal: AbortSignal): Promise<{ readonly offer: JoinOffer; readonly bytes: Uint8Array }>;
}
/**
 * Isolated staging environment for an incoming game pack.
 * Staged candidate has passed validation; `activate()` commits and publishes once authenticated.
 */
export interface JoinStage extends Disposable {
  /** Client session join options derived from the staged game environment. */
  readonly options: JoinOptions;
  /** Publish the staged modules into active runtime use upon successful session authentication. */
  activate?(): void;
}
/** Client-side integration port for reviewing, caching, and staging incoming join packs. */
export interface JoinClientPort {
  /** Whether the current client runtime allows loading third-party executable code. */
  readonly allowRuntimeCode: boolean;
  /** Check whether this exact offer has already been approved by the user. */
  approved(offer: JoinOffer): Promise<boolean>;
  /** Prompt the user to review the offer and grant explicit installation consent. */
  review(offer: JoinOffer, signal: AbortSignal): Promise<boolean>;
  /** Check if identical game pack bytes are already available in local cache. */
  cached(offer: JoinOffer): Promise<Uint8Array | undefined>;
  /** Validate and stage the game pack in an isolated temporary environment. */
  stage(offer: JoinOffer, bytes: Uint8Array, signal: AbortSignal): Promise<JoinStage>;
  /** Persist the verified game pack and record scoped user approval. */
  remember(offer: JoinOffer, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Optional callback reporting byte download progress. */
  progress?(received: number, total: number): void;
}
/** Result of a completed prejoin negotiation. */
export interface JoinNegotiation {
  /** Active text connection handed off to the session protocol. */
  readonly peer: TextConnection;
  /** Staged game environment, if custom packages were negotiated. */
  readonly stage?: JoinStage;
}
/** Pre-join game pack negotiation factory for clients and hosts. */
export interface JoinPackFactory {
  /** Perform client-side prejoin negotiation with the remote peer before session connection. */
  client(peer: TextConnection, port: JoinClientPort, signal: AbortSignal): Promise<JoinNegotiation>;
  /** Host-side prejoin negotiation: delivers offer and chunks, then invokes accept with the authenticated peer. */
  host(peer: TextConnection, source: JoinPackSource, accept: (peer: TextConnection) => void, signal: AbortSignal): Promise<void>;
}
/** ServiceKey for pre-join game pack negotiation (slot `session.join-pack`). */
export const JOIN_PACKS: ServiceKey<JoinPackFactory> = Object.freeze({ slot: 'session.join-pack', version: '1.0.0' });
/** User interface service for presenting incoming server package offers for consent. */
export interface JoinReviewService {
  /** Present the join offer dialog to the user, resolving to true if approved or false if rejected. */
  review(offer: JoinOffer, address: string, signal: AbortSignal): Promise<boolean>;
}
/** ServiceKey for the server package review UI service (slot `ui.join-review`). */
export const JOIN_REVIEW: ServiceKey<JoinReviewService> = Object.freeze({ slot: 'ui.join-review', version: '1.0.0' });
