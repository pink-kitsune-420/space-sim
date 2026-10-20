import { WEBRTC_SIGNALING, type ManualInvite, type ManualSignalingProvider, type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export interface WebRtcExchangeHelper {
  validateCode(text: string): 'invite' | 'reply' | 'invalid';
  createInvite(stun?: boolean, signal?: AbortSignal): Promise<ManualInvite>;
}

export const WEBRTC_EXCHANGE: ServiceKey<WebRtcExchangeHelper> = Object.freeze({
  slot: 'example.webrtc-manual-exchange',
  version: '1.0.0',
});

export function createWebRtcExchangeHelper(signaling: ManualSignalingProvider): WebRtcExchangeHelper {
  return Object.freeze({
    validateCode(text: string): 'invite' | 'reply' | 'invalid' {
      if (signaling.isInviteCode(text)) return 'invite';
      if (signaling.isReplyCode(text)) return 'reply';
      return 'invalid';
    },
    createInvite(stun = false, signal = new AbortController().signal): Promise<ManualInvite> {
      return signaling.create(stun, signal);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const signaling = context.use(WEBRTC_SIGNALING);
  context.provide(WEBRTC_EXCHANGE, createWebRtcExchangeHelper(signaling));
}
