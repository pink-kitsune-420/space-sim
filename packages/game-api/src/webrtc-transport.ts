import type { ServiceKey } from './modules-v2';
import type { Disposable } from './modules';
import type { TextConnection } from './platform';

/** Counts and error codes only; never addresses, SDP or invitation secrets. */
export interface ConnectionDiagnostics {
  readonly gathering: RTCIceGatheringState;
  readonly connection: RTCPeerConnectionState;
  readonly candidates: Readonly<Record<string, number>>;
  readonly errors: readonly number[];
}
export interface ManualInvite extends Disposable {
  readonly code: string;
  readonly stun: boolean;
  diagnostics(): ConnectionDiagnostics;
  accept(reply: string): Promise<TextConnection>;
}
export interface ManualReply extends Disposable {
  readonly code: string;
  readonly expiresAt: number;
  diagnostics(): ConnectionDiagnostics;
  /** Available before connection so the caller can send the reply to the host. */
  readonly connection: Promise<TextConnection>;
}
/** Reliable ordered text with explicit manual signaling. Signal owns the whole link. */
export interface ManualSignalingProvider {
  create(stun: boolean, signal: AbortSignal): Promise<ManualInvite>;
  answer(offer: string, signal: AbortSignal): Promise<ManualReply>;
  isInviteCode(text: string): boolean;
  isReplyCode(text: string): boolean;
}
export const WEBRTC_SIGNALING: ServiceKey<ManualSignalingProvider> = Object.freeze({ slot: 'net.webrtc-signaling', version: '1.0.0' });
